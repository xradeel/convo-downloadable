/**
 * Client for the gemini-3.8-flash-tts structured speech API.
 *
 * Direction travels in a structured `speech_metadata` annotation on each part
 * rather than baked into the transcript, because the TTS engine treats the text it
 * receives as a verbatim transcript and will read inline stage direction out
 * loud. Discrete vocal events (<breath>, <sigh>) stay inline in the text.
 *
 * Schema verified against the live v1beta endpoint:
 *   - `speech_metadata: { speaker?, style }` on each part is accepted.
 *   - Several parts with different styles may share one request.
 *   - `enable_filler_words` is the name of the feature, not a field: it 400s
 *     everywhere it can go, on either endpoint. The feature is the |pipes|.
 *   - `speech_config.mode: "conversational"` only exists on the Interactions
 *     endpoint (`/v1beta/interactions`, the request shape in the gemini-3.8-flash-tts
 *     docs); `generateContent` rejects it. Lines with |piped| interjections go
 *     there, see `synthesizeConversational`.
 *   - |Piped| interjections are only voiced with two speakers, by the second
 *     one, mid-delivery. With one voice they are dropped. Even then about half
 *     the takes drop, reword, move, or mis-assign an interjection, so
 *     server/backchannel.ts checks every such clip and rebuilds the ones that
 *     fail.
 *   - A line with no pipes gets one voice: there is nothing for a second to do.
 *   - generateContent returns raw L16 PCM, so it needs a WAV container;
 *     Interactions returns a 16-bit mono WAV already.
 */

import { pcmToWav } from './audioUtils';

/** Model string for Gemini Flash TTS. */
export const GEMINI_TTS_MODEL = 'gemini-3.8-flash-tts';
/** Backwards-compatible model alias. */
export const SONIC_BOOM_MODEL = GEMINI_TTS_MODEL;

const API_BASE =
  process.env.GEMINI_TTS_API_BASE ||
  process.env.SONIC_BOOM_API_BASE ||
  'https://generativelanguage.googleapis.com/v1beta';

const MODEL_PATH = GEMINI_TTS_MODEL.startsWith('models/')
  ? GEMINI_TTS_MODEL
  : `models/${GEMINI_TTS_MODEL}`;

const ENDPOINT = `${API_BASE}/${MODEL_PATH}:generateContent`;
const INTERACTIONS_ENDPOINT = `${API_BASE}/interactions`;

const REQUEST_TIMEOUT_MS =
  Number(process.env.GEMINI_TTS_TIMEOUT_MS || process.env.SONIC_BOOM_TIMEOUT_MS) || 60_000;

export interface SpeakerConfig {
  speaker: string;
  voice: string;
}

export interface TurnRequest {
  id: string;
  speaker: string;
  /** Verbatim transcript, including inline <breath>/<sigh> tags and |backchannel| pipes. */
  text: string;
  /** Sustained direction for the whole turn, e.g. "Wistful, British accent". */
  style: string;
}

export interface AudioResult {
  /** data: URL ready to hand to an <audio> element. */
  audioUrl: string;
  mimeType: string;
  /** Decoded length in seconds, derived from the PCM byte count. */
  durationSec?: number;
}

export class GeminiTtsError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'GeminiTtsError';
  }
}
/** Backwards-compatible error class alias. */
export const SonicBoomError = GeminiTtsError;

/**
 * Builds the request body for one or more turns.
 * When 2 speakers are provided, enables multi-speaker mode (allowing second-speaker
 * backchanneling via |interjections| and conversational turn-taking).
 */
export function buildGeminiTtsRequest(
  turns: TurnRequest[],
  speakers: SpeakerConfig[] | string,
  languageCode?: string
): Record<string, unknown> {
  const speakerList: SpeakerConfig[] =
    typeof speakers === 'string'
      ? [{ speaker: turns[0]?.speaker || 'Speaker', voice: speakers }]
      : speakers;

  let speechConfig: Record<string, unknown>;

  if (speakerList.length === 2) {
    // Multi-speaker configuration: activates partner speaker for backchanneling (|pipe|)
    speechConfig = {
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: speakerList.map((s) => ({
          speaker: s.speaker,
          voiceConfig: { prebuiltVoiceConfig: { voiceName: s.voice } },
        })),
      },
    };
  } else {
    // Single-speaker configuration
    const primaryVoice = speakerList[0]?.voice || 'Puck';
    speechConfig = {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: primaryVoice } },
    };
  }

  if (languageCode) speechConfig.language_code = languageCode;

  return {
    contents: [
      {
        parts: turns.map((turn) => ({
          text: turn.text,
          speech_metadata: { speaker: turn.speaker, style: turn.style },
        })),
      },
    ],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig,
    },
  };
}
/** Backwards-compatible builder alias. */
export const buildSonicBoomRequest = buildGeminiTtsRequest;

interface InlineAudio {
  data: string;
  mimeType?: string;
}

/** Pulls the inline audio blob out of a generateContent response. */
function extractInlineAudio(json: any): InlineAudio | null {
  const parts = json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;

  for (const part of parts) {
    const inline = part?.inlineData ?? part?.inline_data;
    if (typeof inline?.data === 'string' && inline.data.length > 0) {
      return { data: inline.data, mimeType: inline.mimeType ?? inline.mime_type };
    }
  }
  return null;
}

/** Wraps raw PCM in a WAV container; passes through anything already containerised. */
export function toPlayableAudio(raw: InlineAudio): AudioResult {
  const mime = raw.mimeType || '';

  if (/wav|mpeg|mp3|ogg/.test(mime)) {
    return { audioUrl: `data:${mime.split(';')[0]};base64,${raw.data}`, mimeType: mime };
  }

  // e.g. "audio/l16; rate=24000; channels=1"
  const sampleRate = Number(mime.match(/rate=(\d+)/)?.[1]) || 24000;
  const channels = Number(mime.match(/channels=(\d+)/)?.[1]) || 1;
  const pcm = Buffer.from(raw.data, 'base64');
  const wav = pcmToWav(pcm, sampleRate, channels);

  return {
    audioUrl: `data:audio/wav;base64,${wav.toString('base64')}`,
    mimeType: 'audio/wav',
    durationSec: pcm.length / (sampleRate * channels * 2),
  };
}

/**
 * Synthesizes turns through gemini-3.8-flash-tts.
 *
 * Supports single-speaker or 2-speaker multiSpeakerVoiceConfig (which enables
 * the second speaker to interject on |backchannel| pipes).
 */
export async function synthesizeGeminiTts(
  apiKey: string,
  turns: TurnRequest[],
  speakers: SpeakerConfig[] | string,
  languageCode?: string,
  retries = 2
): Promise<AudioResult> {
  const parsed = await postJson(apiKey, ENDPOINT, buildGeminiTtsRequest(turns, speakers, languageCode), retries);
  const raw = extractInlineAudio(parsed);
  if (!raw) throw new GeminiTtsError('No audio returned');
  return toPlayableAudio(raw);
}

/**
 * The documented gemini-3.8-flash-tts multi-speaker request: Interactions endpoint,
 * `mode: "conversational"`, both speakers named, the turn's speaker and style
 * as a `speech_metadata` annotation, and the |pipes| left in the text for the
 * other speaker to voice.
 */
export function buildConversationalRequest(
  turn: TurnRequest,
  speakers: SpeakerConfig[],
  languageCode?: string
): Record<string, unknown> {
  const speechConfig: Record<string, unknown> = {
    mode: 'conversational',
    speakers: speakers.map((s) => ({ speaker: s.speaker, voice: s.voice })),
  };
  if (languageCode) speechConfig.language_code = languageCode;

  return {
    model: MODEL_PATH,
    input: [
      {
        type: 'user_input',
        content: [
          {
            type: 'text',
            text: turn.text,
            annotations: [{ type: 'speech_metadata', speaker: turn.speaker, style: turn.style }],
          },
        ],
      },
    ],
    response_format: { type: 'audio' },
    generation_config: { speech_config: speechConfig },
  };
}

/** One line with |backchannels|, voiced by both speakers in one clip. */
export async function synthesizeConversational(
  apiKey: string,
  turn: TurnRequest,
  speakers: SpeakerConfig[],
  languageCode?: string,
  retries = 2
): Promise<AudioResult> {
  const parsed: any = await postJson(
    apiKey,
    INTERACTIONS_ENDPOINT,
    buildConversationalRequest(turn, speakers, languageCode),
    retries
  );
  const steps: any[] = Array.isArray(parsed?.steps) ? parsed.steps : [];
  const audio = steps
    .flatMap((step) => (Array.isArray(step?.content) ? step.content : []))
    .find((c: any) => c?.type === 'audio' && typeof c.data === 'string' && c.data.length > 0);
  if (!audio) throw new GeminiTtsError('No audio returned');
  return toPlayableAudio({ data: audio.data, mimeType: audio.mime_type ?? audio.mimeType });
}

/** POSTs to the API, retrying network errors and rate limits. */
async function postJson(apiKey: string, url: string, body: unknown, retries: number): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
        'User-Agent': 'aistudio-build',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const e = err as Error;
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 1500));
      return postJson(apiKey, url, body, retries - 1);
    }
    throw new GeminiTtsError(
      e.name === 'TimeoutError'
        ? `Request timed out after ${REQUEST_TIMEOUT_MS}ms`
        : `Network error: ${e.message}`
    );
  }

  const text = await response.text();

  if (!response.ok) {
    if (response.status === 429 && retries > 0) {
      console.warn('[gemini-3.8-flash-tts] 429 rate limit hit, retrying in 2s...');
      await new Promise((r) => setTimeout(r, 2000));
      return postJson(apiKey, url, body, retries - 1);
    }
    let message = text;
    try {
      message = JSON.parse(text)?.error?.message ?? text;
    } catch {
      /* keep raw body */
    }
    throw new GeminiTtsError(String(message).replace(/\s+/g, ' ').slice(0, 300), response.status);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new GeminiTtsError('Response was not JSON');
  }
}
/** Backwards-compatible synthesizer alias. */
export const synthesizeSonicBoom = synthesizeGeminiTts;
