import fs from 'fs';
import express, { Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { pcmToWav, generateVocalTrackWav } from './server/audioUtils';
import {
  GEMINI_TTS_MODEL,
  GeminiTtsError,
  synthesizeConversational,
  synthesizeGeminiTts,
  type TurnRequest,
} from './server/geminiTts';
import {
  decodeWavDataUrl,
  interjectionSays,
  locatePipes,
  mixInterjections,
  pipeFractions,
  verifyNativeBackchannels,
  wavDurationSec,
} from './server/backchannel';

interface SpeakerConfig {
  speaker: string;
  voice: string;
}

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(process.cwd(), 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

app.use(express.json({ limit: '50mb' }));

// Lazy initialization of Gemini Client
let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    geminiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return geminiClient;
}

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

type SynthEngine = 'gemini-3.8-flash-tts';

/**
 * A listener's interjection. Normally it is already in the line's own clip
 * (`inLine`), and `atSec` says where; otherwise it is a clip of its own.
 */
interface SynthesizedBackchannel {
  /** Which |pipe| in the line this is, counting from zero. */
  index: number;
  text: string;
  speaker: string;
  audioUrl?: string;
  inLine?: boolean;
  atSec?: number;
  durationSec?: number;
  /** Voiced natively by the model, or laid into the line afterwards. */
  source?: 'native' | 'mixed';
}

/**
 * `native` asks the model to backchannel first and checks it; `mix` skips
 * straight to laying the listener's clips in, which is quicker per line.
 */
const BACKCHANNEL_MODE = process.env.BACKCHANNEL_MODE === 'mix' ? 'mix' : 'native';

/** Native takes tried per line before mixing; about half of them hold. */
const NATIVE_ATTEMPTS = Math.max(1, Number(process.env.BACKCHANNEL_NATIVE_ATTEMPTS) || 2);

interface SynthesizedTurn {
  id: string;
  turnIndex: number;
  speaker: string;
  text: string;
  style: string;
  audioUrl?: string;
  duration: number;
  engine: SynthEngine;
  backchannels: SynthesizedBackchannel[];
  error?: string;
}

/** How a per-line stage direction should read, shared by every prompt that writes one. */
const STAGE_DIRECTION_GUIDE = `Each direction is 2 to 6 plain, everyday words saying how the line is said: the feeling, and how the voice sounds (fast or slow, loud or quiet). Write it the way a friend would describe it, e.g. "annoyed, getting louder", "quiet and a bit scared", "teasing him", "tired, half asleep", "trying not to laugh". Only use words a ten-year-old would know. No fancy, literary or acting-school vocabulary such as "indignant", "indignation", "escalating", "conspiratorial", "prosecutorial", "incredulous", "sardonic", "wry", "dryly", "crisp", "unfazed", "breathless", "exasperated", "ominous", "pitch", "timbre" or "cadence" — say "annoyed", "whispering like a secret", "calm, not bothered", "out of breath" instead. Before answering, reread each direction and swap any word that sounds like a book review for a simpler one. Make it fit that exact line and moment, so lines next to each other don't get the same direction, and don't fall back on empty words like "neutral", "normal" or "says". Do not repeat the dialogue inside the direction, and do not use parentheses inside it.`;

/**
 * What a formatting pass may do with |interjections|. The writer's own are
 * part of the script and pass through untouched; new ones are only invented
 * for a script that has none.
 */
const BACKCHANNEL_RULE = `IF the source script already contains any |piped| interjections, copy every one of them EXACTLY as written — the same words, spelling and punctuation, the same number of them, each on the same line at the same point in that line — and do NOT add any new ones or remove, merge, move or reword any. ONLY if the source contains no pipes at all, and two or more characters are conversing, you may add natural listener interjections (e.g. |yeah|, |right|, |uh-huh|, |mhm|, |wait|): a word or two each, mid-line rather than at the very start or end, at most one per line on roughly half the lines, and never a word the speaker themselves would say. A single-character monologue or narration gets no pipes at all.`;

/** Every |interjection| in a script, in order, exactly as written. */
function backchannelsIn(script: string): string[] {
  return Array.from(script.matchAll(/\|([^|\n]+)\|/g), (m) => m[1].trim());
}

function sameBackchannels(expected: string[], actual: string[]): boolean {
  return expected.length === actual.length && expected.every((phrase, i) => phrase === actual[i]);
}

/** Rough spoken duration, used only until real audio reports its own length. */
function estimateDuration(text: string): number {
  return Math.max(1.8, text.split(/\s+/).filter(Boolean).length / 2.3);
}

/**
 * Pulls the |interjections| out of a line, leaving a pause where each was, for
 * voicing the speaker alone when the model's own backchannel didn't hold.
 */
function extractBackchannels(text: string): { spoken: string; pipes: string[] } {
  const pipes: string[] = [];
  const pattern = /\|([^|]+)\|/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    pipes.push(match[1].trim());
  }

  return {
    spoken: text.replace(/\|[^|]*\|/g, ' <short pause> ').replace(/[ \t]{2,}/g, ' ').trim(),
    pipes,
  };
}



/** Runs tasks with bounded concurrency, preserving input order in the results. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

// In-memory cache for synthesized turns across requests to avoid re-synthesizing identical lines
const serverTurnCache = new Map<string, SynthesizedTurn>();

/** Resamples linear Float32 PCM from one sample rate to another. */
function resampleTo(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || fromRate <= 0 || toRate <= 0) return samples;
  const ratio = fromRate / toRate;
  const newLength = Math.round(samples.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const i0 = Math.floor(srcIndex);
    const i1 = Math.min(samples.length - 1, i0 + 1);
    const frac = srcIndex - i0;
    result[i] = samples[i0] * (1 - frac) + (samples[i1] ?? 0) * frac;
  }
  return result;
}

/**
 * Combines an ordered list of decoded WAV clips into a single contiguous WAV buffer,
 * with natural conversational pauses between lines.
 */
function stitchAudioClipsToWav(
  clips: { samples: Float32Array; sampleRate: number }[],
  targetSampleRate: number = 24000,
  pauseSec: number = 0.35
): Buffer {
  if (clips.length === 0) {
    return pcmToWav(Buffer.alloc(0), targetSampleRate, 1);
  }

  const normalized = clips.map((clip) => {
    if (clip.sampleRate === targetSampleRate) return clip.samples;
    return resampleTo(clip.samples, clip.sampleRate, targetSampleRate);
  });

  const pauseSamples = Math.round(targetSampleRate * pauseSec);
  let totalSamples = 0;
  for (let i = 0; i < normalized.length; i++) {
    totalSamples += normalized[i].length;
    if (i < normalized.length - 1) totalSamples += pauseSamples;
  }

  const combined = new Float32Array(totalSamples);
  let cursor = 0;
  for (let i = 0; i < normalized.length; i++) {
    combined.set(normalized[i], cursor);
    cursor += normalized[i].length;
    if (i < normalized.length - 1) {
      cursor += pauseSamples;
    }
  }

  const pcm = Buffer.alloc(combined.length * 2);
  for (let i = 0; i < combined.length; i++) {
    const s = Math.max(-1, Math.min(1, combined[i]));
    pcm.writeInt16LE(Math.round(s * 32767), i * 2);
  }

  return pcmToWav(pcm, targetSampleRate, 1);
}

/** Synthesizes an individual dialogue line or retrieves from cache. */
async function synthesizeSingleTurn(
  turn: any,
  i: number,
  speakers: SpeakerConfig[],
  allTurns: any[],
  apiKey: string | undefined,
  interjectionCache: Map<string, Promise<string | undefined>>
): Promise<SynthesizedTurn> {
  const voiceFor = (speaker: string) => {
    const sLower = (speaker || '').toLowerCase();
    const match = speakers.find((s) => (s.speaker || '').toLowerCase() === sLower);
    if (match?.voice) return match.voice;
    return sLower.includes('sienna') ? 'Kore' : 'Puck';
  };

  const styleForSpeaker = (name: string) => {
    const nLower = (name || '').toLowerCase();
    const match = allTurns.find((t: any) => (t.speaker || '').toLowerCase() === nLower && t.style);
    return match?.style || (nLower.includes('sienna') ? 'British accent, natural delivery' : 'American accent, natural delivery');
  };

  const synthesizeInterjection = (listener: string, phrase: string) => {
    const key = `${voiceFor(listener)}|${phrase.toLowerCase()}`;
    const cached = interjectionCache.get(key);
    if (cached) return cached;

    const request: TurnRequest = {
      id: key,
      speaker: listener,
      text: phrase,
      style: `Brief quiet backchannel interjection, murmured under someone else. Say exactly the words given and nothing else, no added words or sounds. ${styleForSpeaker(listener)}`,
    };
    const attempt = async () => {
      if (!apiKey) return undefined;
      const { audioUrl } = await synthesizeGeminiTts(apiKey, [request], voiceFor(listener));
      return audioUrl;
    };
    const pending = attempt().catch((err) => {
      console.warn(`[backchannel] "${phrase}" failed — ${(err as Error).message}`);
      return undefined;
    });

    interjectionCache.set(key, pending);
    return pending;
  };

  const speaker = turn.speaker || 'NARRATOR';
  const style = turn.style || '';
  const text = turn.text || '';
  const voice = voiceFor(speaker);

  const cacheKey = `${speaker}:${voice}:${style}:${text}`;
  const cached = serverTurnCache.get(cacheKey);
  if (cached) {
    return {
      ...cached,
      id: turn.id || `turn-${i}`,
      turnIndex: i,
    };
  }

  const { spoken, pipes } = extractBackchannels(text);
  const listener = speakers.find((s) => s.speaker !== speaker)?.speaker;

  const base = {
    id: turn.id || `turn-${i}`,
    turnIndex: i,
    speaker,
    text,
    style,
    duration: turn.durationEstimate || estimateDuration(spoken),
  };

  const bare = (index: number): SynthesizedBackchannel => ({
    index,
    text: pipes[index],
    speaker: listener as string,
  });

  if (!apiKey) {
    const isFemale = /sienna|kore|aoede|leda|vega|capella/i.test(speaker);
    const wavBuf = generateVocalTrackWav(
      base.duration,
      isFemale ? 220 : 135,
      1.0,
      style || 'natural'
    );
    const audioUrl = `data:audio/wav;base64,${wavBuf.toString('base64')}`;
    const result: SynthesizedTurn = {
      ...base,
      audioUrl,
      duration: base.duration,
      engine: 'gemini-3.8-flash-tts',
      backchannels: [],
    };
    serverTurnCache.set(cacheKey, result);
    return result;
  }

  try {
    if (!listener || pipes.length === 0) {
      const { audioUrl, durationSec } = await synthesizeGeminiTts(
        apiKey,
        [{ id: base.id, speaker, text: spoken, style }],
        voice
      );
      const result: SynthesizedTurn = {
        ...base,
        audioUrl,
        duration: durationSec ?? wavDurationSec(audioUrl) ?? base.duration,
        engine: 'gemini-3.8-flash-tts',
        backchannels: [],
      };
      serverTurnCache.set(cacheKey, result);
      if (serverTurnCache.size > 500) serverTurnCache.clear();
      return result;
    }

    if (BACKCHANNEL_MODE === 'native') {
      try {
        const native = await synthesizeConversational(
          apiKey,
          { id: base.id, speaker, text, style },
          [
            { speaker, voice },
            { speaker: listener, voice: voiceFor(listener) },
          ]
        );
        if (native.audioUrl) {
          const dur = native.durationSec ?? wavDurationSec(native.audioUrl) ?? base.duration;
          const fractions = pipeFractions(text);
          const result: SynthesizedTurn = {
            ...base,
            audioUrl: native.audioUrl,
            duration: dur,
            engine: 'gemini-3.8-flash-tts',
            backchannels: fractions.map((frac, index) => ({
              ...bare(index),
              inLine: true,
              atSec: Math.max(0.1, frac * dur),
              durationSec: 1.0,
              source: 'native',
            })),
          };
          serverTurnCache.set(cacheKey, result);
          if (serverTurnCache.size > 500) serverTurnCache.clear();
          return result;
        }
      } catch (err) {
        console.warn(`[backchannel] turn ${i}: native take failed, falling back to mix — ${(err as Error).message}`);
      }
    }

    // Fallback: mix interjections into the speaker's pauses
    const [firstTake, ...clips] = await Promise.all([
      synthesizeGeminiTts(apiKey, [{ id: base.id, speaker, text: spoken, style }], voice),
      ...pipes.map((phrase) => synthesizeInterjection(listener, phrase)),
    ]);

    if (clips.every(Boolean)) {
      try {
        const mixed = mixInterjections(
          firstTake.audioUrl,
          clips as string[],
          pipeFractions(text)
        );
        const result: SynthesizedTurn = {
          ...base,
          audioUrl: mixed.audioUrl,
          duration: mixed.durationSec,
          engine: 'gemini-3.8-flash-tts',
          backchannels: mixed.placements.map((p, index) => ({
            ...bare(index),
            inLine: true,
            atSec: p.atSec,
            durationSec: p.durationSec,
            source: 'mixed',
          })),
        };
        serverTurnCache.set(cacheKey, result);
        if (serverTurnCache.size > 500) serverTurnCache.clear();
        return result;
      } catch (err) {
        console.warn(`[backchannel] turn ${i}: mixing failed — ${(err as Error).message}`);
      }
    }

    const fallbackResult: SynthesizedTurn = {
      ...base,
      audioUrl: firstTake.audioUrl,
      duration: firstTake.durationSec ?? wavDurationSec(firstTake.audioUrl) ?? base.duration,
      engine: 'gemini-3.8-flash-tts',
      backchannels: pipes.map((_, index) => ({ ...bare(index), audioUrl: clips[index] })),
    };
    serverTurnCache.set(cacheKey, fallbackResult);
    return fallbackResult;
  } catch (err) {
    const detail =
      err instanceof GeminiTtsError
        ? `${err.status ? `HTTP ${err.status}: ` : ''}${err.message}`
        : (err as Error).message;
    console.warn(`[gemini-3.8-flash-tts] turn ${i} warning (${detail}), generating vocal fallback`);

    const isFemale = /sienna|kore|aoede|leda|vega|capella/i.test(speaker);
    const wavBuf = generateVocalTrackWav(
      base.duration,
      isFemale ? 220 : 135,
      1.0,
      style || 'natural'
    );
    const audioUrl = `data:audio/wav;base64,${wavBuf.toString('base64')}`;

    return {
      ...base,
      audioUrl,
      duration: base.duration,
      engine: 'gemini-3.8-flash-tts',
      backchannels: [],
      error: detail,
    };
  }
}

/**
 * POST /api/synthesize-table-read
 *
 * Synthesizes each dialogue turn through gemini-3.8-flash-tts, passing direction as
 * structured speech_metadata rather than inline text.
 *
 * One request per turn: the transport lets you jump to any line and animates
 * whichever character is speaking, so it needs an addressable clip per turn
 * rather than one continuous stream for the whole scene.
 *
 * A line with |interjections| is voiced the way gemini-3.8-flash-tts documents it:
 * conversational mode with both speakers, pipes intact, so the listener's
 * voice drops them in mid-delivery.
 */
app.post('/api/synthesize-table-read', async (req: Request, res: Response) => {
  try {
    const { payload, turns } = req.body;

    if (!payload || !turns || !Array.isArray(turns)) {
      return res.status(400).json({ error: 'Invalid request: payload and turns are required.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured.' });
    }

    const speakers: SpeakerConfig[] =
      payload?.generation_config?.speech_config?.speakers ?? [];
    const voiceFor = (speaker: string) => {
      const sLower = (speaker || '').toLowerCase();
      const match = speakers.find((s) => (s.speaker || '').toLowerCase() === sLower);
      if (match?.voice) return match.voice;
      return sLower.includes('sienna') ? 'Kore' : 'Puck';
    };

    // Capture failure details if any turn fails.
    let geminiTtsFailure: string | null = null;

    /** The sustained style the listener uses elsewhere, so their accent holds. */
    const styleForSpeaker = (name: string) => {
      const nLower = (name || '').toLowerCase();
      const match = turns.find((t: any) => (t.speaker || '').toLowerCase() === nLower && t.style);
      return match?.style || (nLower.includes('sienna') ? 'British accent, natural delivery' : 'American accent, natural delivery');
    };

    // The same "mhm" recurs across a scene; synthesize each one once.
    const interjectionCache = new Map<string, Promise<string | undefined>>();
    const synthesizeInterjection = (listener: string, phrase: string) => {
      const key = `${voiceFor(listener)}|${phrase.toLowerCase()}`;
      const cached = interjectionCache.get(key);
      if (cached) return cached;

      const request: TurnRequest = {
        id: key,
        speaker: listener,
        text: phrase,
        style: `Brief quiet backchannel interjection, murmured under someone else. Say exactly the words given and nothing else, no added words or sounds. ${styleForSpeaker(listener)}`,
      };
      const attempt = async () => {
        const { audioUrl } = await synthesizeGeminiTts(apiKey, [request], voiceFor(listener));
        return audioUrl;
      };
      const pending = attempt().catch((err) => {
        console.warn(`[backchannel] "${phrase}" failed — ${(err as Error).message}`);
        return undefined;
      });

      interjectionCache.set(key, pending);
      return pending;
    };

    const synthesizedTurns = await mapWithConcurrency<any, SynthesizedTurn>(
      turns,
      4,
      async (turn, i) => {
        const speaker = turn.speaker || 'NARRATOR';
        const style = turn.style || '';
        const text = turn.text || '';
        const voice = voiceFor(speaker);

        // Check server cache for identical voice delivery
        const cacheKey = `${speaker}:${voice}:${style}:${text}`;
        const cached = serverTurnCache.get(cacheKey);
        if (cached) {
          return {
            ...cached,
            id: turn.id || `turn-${i}`,
            turnIndex: i,
          };
        }

        const { spoken, pipes } = extractBackchannels(text);
        const listener = speakers.find((s) => s.speaker !== speaker)?.speaker;

        const base = {
          id: turn.id || `turn-${i}`,
          turnIndex: i,
          speaker,
          text,
          style,
          duration: turn.durationEstimate || estimateDuration(spoken),
        };

        const bare = (index: number): SynthesizedBackchannel => ({
          index,
          text: pipes[index],
          speaker: listener as string,
        });

        try {
          // Interjections only make sense when there is someone else to say them.
          if (!listener || pipes.length === 0) {
            const { audioUrl, durationSec } = await synthesizeGeminiTts(
              apiKey,
              [{ id: base.id, speaker, text: spoken, style }],
              voice
            );
            const result: SynthesizedTurn = {
              ...base,
              audioUrl,
              duration: durationSec ?? wavDurationSec(audioUrl) ?? base.duration,
              engine: 'gemini-3.8-flash-tts',
              backchannels: [],
            };
            serverTurnCache.set(cacheKey, result);
            if (serverTurnCache.size > 500) serverTurnCache.clear();
            return result;
          }

          // Fast native conversational synthesis with gemini-3.8-flash-tts
          if (BACKCHANNEL_MODE === 'native') {
            try {
              const native = await synthesizeConversational(
                apiKey,
                { id: base.id, speaker, text, style },
                [
                  { speaker, voice },
                  { speaker: listener, voice: voiceFor(listener) },
                ]
              );
              if (native.audioUrl) {
                const dur = native.durationSec ?? wavDurationSec(native.audioUrl) ?? base.duration;
                const fractions = pipeFractions(text);
                const result: SynthesizedTurn = {
                  ...base,
                  audioUrl: native.audioUrl,
                  duration: dur,
                  engine: 'gemini-3.8-flash-tts',
                  backchannels: fractions.map((frac, index) => ({
                    ...bare(index),
                    inLine: true,
                    atSec: Math.max(0.1, frac * dur),
                    durationSec: 1.0,
                    source: 'native',
                  })),
                };
                serverTurnCache.set(cacheKey, result);
                if (serverTurnCache.size > 500) serverTurnCache.clear();
                return result;
              }
            } catch (err) {
              console.warn(`[backchannel] turn ${i}: native take failed, falling back to mix — ${(err as Error).message}`);
            }
          }

          // Fallback: mix interjections into the speaker's pauses
          const [firstTake, ...clips] = await Promise.all([
            synthesizeGeminiTts(apiKey, [{ id: base.id, speaker, text: spoken, style }], voice),
            ...pipes.map((phrase) => synthesizeInterjection(listener, phrase)),
          ]);

          if (clips.every(Boolean)) {
            try {
              const mixed = mixInterjections(
                firstTake.audioUrl,
                clips as string[],
                pipeFractions(text)
              );
              const result: SynthesizedTurn = {
                ...base,
                audioUrl: mixed.audioUrl,
                duration: mixed.durationSec,
                engine: 'gemini-3.8-flash-tts',
                backchannels: mixed.placements.map((p, index) => ({
                  ...bare(index),
                  inLine: true,
                  atSec: p.atSec,
                  durationSec: p.durationSec,
                  source: 'mixed',
                })),
              };
              serverTurnCache.set(cacheKey, result);
              if (serverTurnCache.size > 500) serverTurnCache.clear();
              return result;
            } catch (err) {
              console.warn(`[backchannel] turn ${i}: mixing failed — ${(err as Error).message}`);
            }
          }

          // Last resort: separate clips, which the player drops in over a pause.
          const fallbackResult: SynthesizedTurn = {
            ...base,
            audioUrl: firstTake.audioUrl,
            duration: firstTake.durationSec ?? wavDurationSec(firstTake.audioUrl) ?? base.duration,
            engine: 'gemini-3.8-flash-tts',
            backchannels: pipes.map((_, index) => ({ ...bare(index), audioUrl: clips[index] })),
          };
          serverTurnCache.set(cacheKey, fallbackResult);
          return fallbackResult;
        } catch (err) {
          const detail =
            err instanceof GeminiTtsError
              ? `${err.status ? `HTTP ${err.status}: ` : ''}${err.message}`
              : (err as Error).message;
          geminiTtsFailure = detail;
          console.error(`[gemini-3.8-flash-tts] turn ${i} failed: ${detail}`);
          return {
            ...base,
            duration: base.duration,
            engine: 'gemini-3.8-flash-tts',
            backchannels: [],
            error: detail,
          };
        }
      }
    );

    const geminiTtsCount = synthesizedTurns.filter((t) => t.audioUrl).length;

    res.json({
      success: geminiTtsCount > 0,
      modelUsed: GEMINI_TTS_MODEL,
      geminiTtsCount,
      sonicBoomCount: geminiTtsCount,
      totalTurns: synthesizedTurns.length,
      geminiTtsError: geminiTtsFailure,
      sonicBoomError: geminiTtsFailure,
      statusNote: geminiTtsFailure
        ? `gemini-3.8-flash-tts error: ${geminiTtsFailure} (${geminiTtsCount}/${synthesizedTurns.length} turns succeeded)`
        : `Synthesized ${geminiTtsCount} turn(s) with ${GEMINI_TTS_MODEL}.`,
      payload,
      turns: synthesizedTurns,
    });
  } catch (error: any) {
    console.error('Synthesis error:', error);
    res.status(500).json({ error: error.message || 'Error during table read synthesis' });
  }
});

/**
 * POST /api/export-audio
 *
 * Prepares and downloads the full scene audio.
 * If the audio file is not already made in the ./data folder with the date,
 * it synthesizes all turns, stitches them into a full continuous audio WAV file,
 * and saves it into ./data with the date and metadata so it is downloadable.
 */
app.post('/api/export-audio', async (req: Request, res: Response) => {
  try {
    const {
      scriptTitle,
      directionId,
      directionName,
      turns,
      payload,
      cachedClips = {},
      forceNew = false,
    } = req.body;

    if (!turns || !Array.isArray(turns) || turns.length === 0) {
      return res.status(400).json({ error: 'No dialogue turns provided to export.' });
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    const safeTitle = (scriptTitle || 'scene')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'scene';
    const safeDir = (directionId || 'default').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const filename = `table_read_${safeTitle}_${safeDir}_${dateStr}.wav`;
    const filePath = path.join(DATA_DIR, filename);
    const metaPath = path.join(DATA_DIR, `${filename.replace(/\.wav$/, '')}.json`);

    // If already made in ./data and not forcing new, return existing downloadable file
    if (!forceNew && fs.existsSync(filePath) && fs.statSync(filePath).size > 100) {
      const stats = fs.statSync(filePath);
      let metadata: any = null;
      if (fs.existsSync(metaPath)) {
        try {
          metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        } catch {}
      }

      return res.json({
        success: true,
        alreadyExisted: true,
        filename,
        downloadUrl: `/api/download/${encodeURIComponent(filename)}`,
        date: dateStr,
        filePath: `./data/${filename}`,
        fileSizeBytes: stats.size,
        durationSec: metadata?.durationSec,
        message: `Found existing audio file from ${dateStr} in ./data/${filename}`,
      });
    }

    // If the audio file is not made, then we make it!
    const apiKey = process.env.GEMINI_API_KEY;
    const speakers: SpeakerConfig[] =
      payload?.generation_config?.speech_config?.speakers ?? [];
    const interjectionCache = new Map<string, Promise<string | undefined>>();

    const newClips: Record<string, string> = {};
    const turnAudioPcms: { samples: Float32Array; sampleRate: number }[] = [];

    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      let clipUrl = cachedClips[turn.id];

      if (!clipUrl) {
        const synthesized = await synthesizeSingleTurn(
          turn,
          i,
          speakers,
          turns,
          apiKey,
          interjectionCache
        );
        clipUrl = synthesized.audioUrl;
        if (clipUrl) {
          newClips[turn.id] = clipUrl;
        }
      }

      if (clipUrl) {
        try {
          const decoded = decodeWavDataUrl(clipUrl);
          turnAudioPcms.push(decoded);
        } catch (e) {
          console.warn(`Could not decode turn ${i} audio:`, e);
        }
      }
    }

    if (turnAudioPcms.length === 0) {
      return res.status(500).json({ error: 'Could not produce audio for the turns in this scene.' });
    }

    // Stitch all turns into a continuous audio WAV with 350ms natural pauses
    const fullWavBuffer = stitchAudioClipsToWav(turnAudioPcms, 24000, 0.35);

    // Save it to the ./data folder with the date
    fs.writeFileSync(filePath, fullWavBuffer);

    const totalSamplesSec = turnAudioPcms.reduce(
      (acc, t) => acc + t.samples.length / t.sampleRate,
      0
    );
    const durationSec = totalSamplesSec + (turnAudioPcms.length - 1) * 0.35;

    const metadata = {
      filename,
      date: dateStr,
      createdTime: now.toISOString(),
      scriptTitle: scriptTitle || 'Untitled Script',
      directionId: directionId || 'default',
      directionName: directionName || 'Direction',
      turnCount: turns.length,
      fileSizeBytes: fullWavBuffer.length,
      durationSec: Number(durationSec.toFixed(2)),
    };
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

    return res.json({
      success: true,
      alreadyExisted: false,
      filename,
      downloadUrl: `/api/download/${encodeURIComponent(filename)}`,
      date: dateStr,
      filePath: `./data/${filename}`,
      fileSizeBytes: fullWavBuffer.length,
      durationSec: Number(durationSec.toFixed(2)),
      newClips,
      message: `Audio file made and saved to ./data/${filename} (${dateStr})`,
    });
  } catch (err: any) {
    console.error('Export audio error:', err);
    res.status(500).json({ error: err.message || 'Failed to export audio file.' });
  }
});

/**
 * GET /api/download/:filename
 * Streams the saved audio file from ./data as a downloadable attachment.
 */
app.get('/api/download/:filename', (req: Request, res: Response) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(DATA_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `File ${filename} not found in ./data` });
  }

  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', stat.size);

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
});

/**
 * GET /api/data/:filename
 * Alternative direct access to files in ./data.
 */
app.get('/api/data/:filename', (req: Request, res: Response) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(DATA_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `File ${filename} not found in ./data` });
  }

  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', stat.size);

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
});

/**
 * GET /api/saved-audio-files
 * Lists all audio recordings saved in ./data with their date and metadata.
 */
app.get('/api/saved-audio-files', (req: Request, res: Response) => {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      return res.json({ files: [] });
    }
    const fileNames = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.wav'));
    const files = fileNames
      .map((name) => {
        const p = path.join(DATA_DIR, name);
        const stat = fs.statSync(p);
        const metaPath = path.join(DATA_DIR, `${name.replace(/\.wav$/, '')}.json`);
        let meta: any = null;
        if (fs.existsSync(metaPath)) {
          try {
            meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          } catch {}
        }
        return {
          filename: name,
          downloadUrl: `/api/download/${encodeURIComponent(name)}`,
          filePath: `./data/${name}`,
          date: meta?.date || stat.mtime.toISOString().slice(0, 10),
          sizeBytes: stat.size,
          createdTime: stat.mtime.toISOString(),
          metadata: meta,
        };
      })
      .sort((a, b) => (b.createdTime > a.createdTime ? 1 : -1));

    res.json({ files });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/audition-voice
 * Plays a quick audition line for any cast member using gemini-3.8-flash-tts
 * with their assigned voice and sustained delivery style.
 */
app.post('/api/audition-voice', async (req: Request, res: Response) => {
  try {
    const { voice, characterName, style } = req.body;
    const targetVoice = voice || 'Puck';
    const targetStyle = style || 'Clear, natural theatrical delivery';
    const actorName = characterName || 'Actor';
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured.' });
    }

    const auditionText = `Hello, I'm ready to read for ${actorName}. Let's take it from the top.`;

    const { audioUrl, durationSec } = await synthesizeGeminiTts(
      apiKey,
      [{ id: 'audition', speaker: actorName, text: auditionText, style: targetStyle }],
      targetVoice
    );
    return res.json({
      audioUrl,
      duration: durationSec || 2.4,
      characterName: actorName,
      voice: targetVoice,
      engine: 'gemini-3.8-flash-tts',
    });
  } catch (err: any) {
    console.error('Audition error:', err);
    res.status(500).json({ error: err.message || 'Audition failed' });
  }
});

/**
 * POST /api/analyze-and-format-script
 * Analyzes uploaded screenplay or text using Gemini:
 * 1. Categorizes as "single" (monologue / solo narration) vs "two_character" vs "ensemble"
 * 2. Assigns appropriate Gemini TTS voice, gender, regional accent, and sustained stylePrompt per character
 * 3. Rewrites the script into standard screenplay format with:
 *    - Parentheticals containing sustained delivery cues for speech_metadata style
 *    - Discrete vocal tags (<breath>, <sigh>, <chuckle>, <laugh>, <gasp>, <cough>, <short pause>)
 *    - Contextual backchanneling (|yeah|, |right|, |uh-huh|, |mhm|) IF AND ONLY IF there is a multi-speaker conversation!
 *    - If single character monologue or solo narration, strictly NO backchanneling pipes.
 */
app.post('/api/analyze-and-format-script', async (req: Request, res: Response) => {
  try {
    const { rawScript, pdfBase64, analyzeWithAI = true } = req.body;
    if ((!rawScript || typeof rawScript !== 'string') && (!pdfBase64 || typeof pdfBase64 !== 'string')) {
      return res.status(400).json({ error: 'rawScript string or pdfBase64 is required' });
    }

    const ai = getGeminiClient();

    const parts: any[] = [];
    if (pdfBase64 && typeof pdfBase64 === 'string') {
      const cleanBase64 = pdfBase64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
      parts.push({
        inlineData: {
          mimeType: 'application/pdf',
          data: cleanBase64,
        },
      });
    }

    const promptText = analyzeWithAI
      ? `You are an expert Hollywood script supervisor and Gemini TTS director.
Analyze the following screenplay document (provided as ${pdfBase64 ? 'attached PDF file' : 'script text'}) and enhance it for the "gemini-3.8-flash-tts" voice engine.

Tasks:
1. Determine if this is a "single" (single character monologue/speech/audiobook narration) or "two_character" (dialogue between two people, or narrator + character) or "ensemble" (3+ characters).
2. For each detected character, suggest:
   - name: character name in ALL CAPS
   - gender: "male" or "female"
   - voice: select the most fitting voice from: Puck (male warm baritone), Kore (female clear alto), Charon (male deep bass), Fenrir (male gritty), Aoede (female emotional soprano), Zephyr (neutral articulate narrator), Orus (male commanding), Leda (female warm alto), Iapetus (male rich bass), Vega (female energetic soprano), Capella (female crisp mezzo), Achernar (male intimate tenor), Achird (male friendly baritone), Polaris (neutral cinematic narrator).
   - accent: regional accent (e.g. American, British, Irish, Scottish, French, etc.)
   - stylePrompt: leave as an empty string "" so the user can fill in the sustained delivery in natural language
3. Reformat the script into industry-standard screenplay format:
   - Scene headings: INT./EXT. LOCATION - TIME
   - Action lines
   - CHARACTER NAMES in ALL CAPS
   - A stage direction for EVERY dialogue turn, no exceptions: a parenthetical on its own line directly under the character name, e.g. (quiet, thinking it over). ${STAGE_DIRECTION_GUIDE}
   - Discrete vocal tags inline in angle brackets where natural: <breath>, <sigh>, <chuckle>, <laugh>, <gasp>, <cough>, <short pause>
   - Backchanneling (listener interjections written |in pipes|, voiced by the OTHER character): ${BACKCHANNEL_RULE}

${rawScript ? `Additional text:\n${rawScript}\n\n` : ''}Return ONLY valid JSON matching this schema:
{
  "narrativeType": "single" | "two_character" | "ensemble",
  "summary": "Brief explanation of structure, characters, and tone",
  "characters": [
    {
      "name": "CHARACTER NAME",
      "gender": "male" | "female",
      "voice": "VoiceName",
      "accent": "AccentName",
      "stylePrompt": ""
    }
  ],
  "formattedScript": "Standard formatted screenplay text..."
}`
      : `Extract the full screenplay text from this PDF document verbatim, preserving screenplay layout (scene headings, character names, dialogue, parentheticals) without adding any commentary.

${rawScript ? `Additional text:\n${rawScript}\n\n` : ''}Return ONLY valid JSON:
{
  "narrativeType": "single" | "two_character" | "ensemble",
  "summary": "Verbatim extraction from uploaded PDF screenplay",
  "characters": [],
  "formattedScript": "Standard formatted screenplay text..."
}`;

    parts.push({ text: promptText });

    const contents = [{ role: 'user', parts }];
    let resultJson: any = null;

    const generate = async (turns: any[]) => {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: turns,
        config: {
          responseMimeType: 'application/json',
        },
      });
      return response.text ? JSON.parse(response.text) : null;
    };

    // Primary generation: gemini-3.8-flash (no model fallbacks)
    try {
      resultJson = await generate(contents);
    } catch (e: any) {
      console.error('[analyze-script] gemini-3.8-flash failed:', e.message);
    }

    // The writer's interjections are part of the script. Where the source text
    // is in hand, hold the model to them exactly: one corrective retry, then
    // report rather than silently pass a changed set through.
    const expected = backchannelsIn(rawScript || '');
    if (analyzeWithAI && expected.length > 0 && resultJson?.formattedScript) {
      const returned = backchannelsIn(resultJson.formattedScript);
      if (!sameBackchannels(expected, returned)) {
        console.warn(
          `[analyze-script] backchannels changed (${expected.length} in, ${returned.length} out); retrying`
        );
        try {
          const retry = await generate([
            ...contents,
            { role: 'model', parts: [{ text: JSON.stringify(resultJson) }] },
            {
              role: 'user',
              parts: [
                {
                  text: `Your formattedScript changed the backchannels. The source has exactly ${expected.length}, in this order: ${expected
                    .map((p) => `|${p}|`)
                    .join(' ')}. Return the full JSON again with exactly these, word for word, each on the line it came from, and no others.`,
                },
              ],
            },
          ]);
          if (retry?.formattedScript) resultJson = retry;
        } catch (e: any) {
          console.error('[analyze-script] backchannel retry failed:', e.message);
        }

        if (!sameBackchannels(expected, backchannelsIn(resultJson.formattedScript))) {
          resultJson.backchannelWarning =
            "Gemini didn't keep the script's |interjections| exactly as written. Check them in Edit text.";
        }
      }
    }

    if (resultJson && resultJson.formattedScript) {
      // If characters weren't populated or were returned as strings, normalize to structured objects
      if (!resultJson.characters || resultJson.characters.length === 0 || typeof resultJson.characters[0] === 'string') {
        const charNames: string[] = typeof resultJson.characters?.[0] === 'string'
          ? resultJson.characters
          : Array.from(new Set(
              ((resultJson.formattedScript || '').match(/^([A-Z0-9_\s]{2,20})$/gm) || []).map((c: string) => c.trim())
            )).filter((c: string) => !/^(INT|EXT|SCENE|FADE|CUT)/.test(c));
        const isSingle = charNames.length <= 1;
        resultJson.narrativeType = isSingle ? 'single' : charNames.length === 2 ? 'two_character' : 'ensemble';
        resultJson.characters = charNames.map((name: string, i: number) => ({
          name,
          gender: i % 2 === 0 ? 'male' : 'female',
          voice: i % 2 === 0 ? 'Puck' : 'Kore',
          accent: i % 2 === 0 ? 'American' : 'British',
          stylePrompt: '',
        }));
      }
      return res.json(resultJson);
    }

    // Rule-based fallback (if rawScript was provided)
    const fallbackFormatted = formatScriptHeuristically(rawScript || '');
    const colonMatches = fallbackFormatted.match(/^([A-Z0-9_\s]{2,20})$/gm) || [];
    const uniqueChars = Array.from(new Set(colonMatches.map((c) => c.trim()))).filter(
      (c) => !/^(INT|EXT|SCENE|FADE|CUT)/.test(c)
    );

    const isSingle = uniqueChars.length <= 1;
    const narrativeType = isSingle ? 'single' : uniqueChars.length === 2 ? 'two_character' : 'ensemble';

    res.json({
      narrativeType,
      summary: isSingle
        ? 'Single-character performance / solo monologue'
        : `${uniqueChars.length}-character screenplay dialogue`,
      characters: uniqueChars.map((name, i) => ({
        name,
        gender: i % 2 === 0 ? 'male' : 'female',
        voice: i % 2 === 0 ? 'Puck' : 'Kore',
        accent: i % 2 === 0 ? 'American' : 'British',
        stylePrompt: '',
      })),
      formattedScript: fallbackFormatted,
    });
  } catch (err: any) {
    console.error('Analyze script error:', err);
    res.status(500).json({ error: err.message || 'Script analysis failed' });
  }
});

/**
 * POST /api/direct-lines
 * Writes a stage direction for each targeted dialogue line with gemini-3.8-flash.
 *
 * The whole scene goes up every time, even when one line is being directed,
 * because a direction only reads right against the lines either side of it.
 * Body: { lines: [{ speaker, text, direction? }], targets?: number[], note?: string }
 * Returns: { directions: { index, direction }[] } for the targeted lines only.
 */
app.post('/api/direct-lines', async (req: Request, res: Response) => {
  try {
    const { lines, targets, note } = req.body ?? {};
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'lines array is required' });
    }

    const wanted: number[] = (Array.isArray(targets) ? targets : lines.map((_: unknown, i: number) => i))
      .filter((i: unknown): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < lines.length);
    if (wanted.length === 0) {
      return res.status(400).json({ error: 'targets must index into lines' });
    }

    const scene = lines
      .map((line: any, i: number) => {
        const current = typeof line.direction === 'string' && line.direction.trim() ? ` (${line.direction.trim()})` : '';
        return `[${i}] ${String(line.speaker || 'SPEAKER')}${current}: ${String(line.text || '')}`;
      })
      .join('\n');

    const single = wanted.length === 1;
    const prompt = `You are a theatre director giving an actor a stage direction for ${single ? 'one line' : 'each line'} of a table read, performed by an expressive text-to-speech voice.

The scene, one numbered line each. Any direction already written is in parentheses after the speaker:
${scene}

Write a fresh stage direction for line${single ? '' : 's'} ${wanted.join(', ')}. ${STAGE_DIRECTION_GUIDE}${
      single ? ' It should be a stronger, more playable reading than the current direction, if there is one.' : ''
    }${typeof note === 'string' && note.trim() ? `\n\nThe director's note for this pass: ${note.trim()}` : ''}

Return ONLY valid JSON: { "directions": [{ "index": number, "direction": string }] }, one entry per requested line.`;

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json' },
    });

    const parsed = JSON.parse(response.text || '{}');
    const wantedSet = new Set(wanted);
    const directions = (Array.isArray(parsed.directions) ? parsed.directions : [])
      .filter((d: any) => wantedSet.has(d?.index) && typeof d.direction === 'string' && d.direction.trim())
      .map((d: any) => ({
        index: d.index as number,
        direction: d.direction.replace(/[()\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim(),
      }));

    if (directions.length === 0) {
      return res.status(502).json({ error: 'The model returned no usable directions.' });
    }
    res.json({ directions });
  } catch (err: any) {
    console.error('Direct lines error:', err);
    res.status(500).json({ error: err.message || 'Line direction failed' });
  }
});

/**
 * POST /api/extract-pdf-text
 * Direct verbatim extraction of screenplay text from an uploaded PDF.
 */
app.post('/api/extract-pdf-text', async (req: Request, res: Response) => {
  try {
    const { pdfBase64 } = req.body;
    if (!pdfBase64 || typeof pdfBase64 !== 'string') {
      return res.status(400).json({ error: 'pdfBase64 string is required' });
    }

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: pdfBase64,
              },
            },
            {
              text: 'Extract the full screenplay text from this PDF document verbatim, preserving screenplay layout (scene headings, character names, dialogue, parentheticals) without adding any commentary or extra text.',
            },
          ],
        },
      ],
    });

    const text = (response.text || '').replace(/^```[a-z]*\n/i, '').replace(/\n```$/i, '').trim();
    res.json({ text });
  } catch (err: any) {
    console.error('Extract PDF text error:', err);
    res.status(500).json({ error: err.message || 'PDF extraction failed' });
  }
});

/**
 * POST /api/enhance-script
 * Uses Gemini 3.8 Flash to intelligently polish raw text into standard screenplay format
 * with Gemini TTS style parentheticals, interruptions, and vocal tags (<breath>, <sigh>, etc.).
 */
app.post('/api/enhance-script', async (req: Request, res: Response) => {
  try {
    const { rawScript } = req.body;
    if (!rawScript || typeof rawScript !== 'string') {
      return res.status(400).json({ error: 'rawScript string is required' });
    }

    const ai = getGeminiClient();
    const prompt = `You are a Hollywood script doctor and table read director preparing a script for gemini-3.8-flash-tts multi-speaker synthesis.
Enhance and format the following script draft into industry-standard screenplay format:
1. Scene headings in standard format: INT. LOCATION - DAY/NIGHT
2. Clear action descriptions
3. CHARACTER NAMES in ALL CAPS
4. A parenthetical stage direction on its own line under the character name for EVERY dialogue line (e.g. (thoughtful, quiet), (whispering with a nervous tone)). ${STAGE_DIRECTION_GUIDE}
5. Embed natural gemini-3.8-flash-tts vocal tags where appropriate: <breath>, <laugh>, <chuckle>, <sigh>, <cough>, <short pause>, <argh>
6. Backchanneling (listener interjections written |in pipes|): ${BACKCHANNEL_RULE}
7. Return ONLY the formatted script text, without commentary or markdown codeblocks.

Raw script:
${rawScript}`;

    let formatted = '';
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
      });
      formatted = (response.text || '').replace(/^```[a-z]*\n/i, '').replace(/\n```$/i, '').trim();
    } catch (e: any) {
      console.error('[enhance-script] gemini-3.8-flash error:', e.message);
      formatted = formatScriptHeuristically(rawScript);
    }

    res.json({
      formattedScript: formatted || rawScript,
    });
  } catch (err: any) {
    console.error('Enhance script error:', err);
    res.status(500).json({ error: err.message || 'Script enhancement failed' });
  }
});

function formatScriptHeuristically(input: string): string {
  const lines = input.split(/\r?\n/);
  const result: string[] = [];
  let inScene = false;

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      result.push('');
      continue;
    }

    if (/^(INT\.|EXT\.|SCENE)/i.test(trimmed)) {
      result.push('', trimmed.toUpperCase(), '');
      inScene = true;
      continue;
    }

    if (!inScene && result.length === 0) {
      result.push('INT. PRODUCTION STUDIO - DAY', '');
      inScene = true;
    }

    // Check if line looks like "Speaker: Dialogue"
    const colonMatch = trimmed.match(/^([A-Za-z0-9_\s]{2,20}):\s*(.*)$/);
    if (colonMatch) {
      const speaker = colonMatch[1].trim().toUpperCase();
      const dialogue = colonMatch[2].trim();
      result.push('', speaker, dialogue);
    } else {
      result.push(trimmed);
    }
  }

  return result.join('\n').trim();
}

async function startServer() {
  // Vite middleware in development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Table Read server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
