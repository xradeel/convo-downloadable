/**
 * Backchanneling: the listener's |interjections| inside someone else's line.
 *
 * gemini-3.8-flash-tts does this natively in conversational mode — the line goes up
 * with its pipes intact and both speakers configured, and the second voice
 * drops the interjection in mid-delivery, in one clip. Measured on the sample
 * scene with its full per-line styles about half the takes hold; the rest
 * drop the pipe, reword it, move it a sentence early or to the end, or have
 * the listener read part of the speaker's line.
 *
 * The script's interjections are part of the script, so every native clip is
 * transcribed word by word and checked against it — words, order, and where
 * each interjection falls — before it is used. One that fails is rebuilt here
 * instead: the line voiced alone with a pause where each pipe was, and the
 * listener's own clip for each interjection laid into the pause between the
 * words it was written between. Either way the result is a single clip with
 * the interjections already in it, and the time each one lands so the
 * listener can be animated on it.
 */

import { GoogleGenAI } from '@google/genai';
import { pcmToWav } from './audioUtils';

export interface Placement {
  /** When the interjection starts in the line's clip, in seconds. */
  atSec: number;
  durationSec: number;
}

/** Where, in seconds, the word before a pipe ends and the word after it begins. */
export interface Boundary {
  start: number;
  end: number;
}

interface Pcm {
  samples: Float32Array;
  sampleRate: number;
}

// ---------------------------------------------------------------- wav i/o

/** Decodes a 16-bit PCM WAV data URL, mixed down to mono. */
export function decodeWavDataUrl(url: string): Pcm {
  const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a WAV file');
  }

  let offset = 12;
  let sampleRate = 24000;
  let channels = 1;
  let bits = 16;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === 'fmt ') {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === 'data') {
      if (bits !== 16) throw new Error(`Unsupported WAV bit depth: ${bits}`);
      const end = Math.min(buf.length, body + size);
      const frames = Math.floor((end - body) / (2 * channels));
      const samples = new Float32Array(frames);
      for (let f = 0; f < frames; f++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) sum += buf.readInt16LE(body + (f * channels + c) * 2);
        samples[f] = sum / channels / 32768;
      }
      return { samples, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}

export function encodeWavDataUrl({ samples, sampleRate }: Pcm): string {
  const pcm = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
  }
  return `data:audio/wav;base64,${pcmToWav(pcm, sampleRate, 1).toString('base64')}`;
}

export function wavDurationSec(url: string): number | undefined {
  try {
    const { samples, sampleRate } = decodeWavDataUrl(url);
    return samples.length / sampleRate;
  } catch {
    return undefined;
  }
}

// ------------------------------------------------------------- analysis

const WINDOW_SEC = 0.02;

/** RMS per 20ms window. */
function envelope({ samples, sampleRate }: Pcm): Float32Array {
  const size = Math.max(1, Math.round(sampleRate * WINDOW_SEC));
  const out = new Float32Array(Math.ceil(samples.length / size));
  for (let w = 0; w < out.length; w++) {
    let sum = 0;
    const start = w * size;
    const end = Math.min(samples.length, start + size);
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    out[w] = Math.sqrt(sum / Math.max(1, end - start));
  }
  return out;
}

function percentile(values: Float32Array, p: number): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

/** Below this a window counts as silence: relative to the voice, with a floor. */
function silenceThreshold(env: Float32Array): number {
  return Math.max(0.006, percentile(env, 0.9) * 0.1);
}

/** Loudness of the voiced part alone, so pauses don't drag it down. */
function voicedRms(env: Float32Array): number {
  const threshold = silenceThreshold(env);
  let sum = 0;
  let n = 0;
  for (const v of env) {
    if (v > threshold) {
      sum += v * v;
      n++;
    }
  }
  return n ? Math.sqrt(sum / n) : 0;
}

/**
 * Cuts the padding TTS leaves either side of a short clip. Deliberately
 * loose: the soft edges of a word ("w" in "wait", the "m" of "mhm") sit far
 * below its vowel, and clipping them turns the word into a grunt.
 */
function trimSilence(pcm: Pcm): Pcm {
  const env = envelope(pcm);
  const threshold = Math.max(0.003, percentile(env, 0.9) * 0.04);
  const first = env.findIndex((v) => v > threshold);
  if (first === -1) return pcm;
  let last = env.length - 1;
  while (last > first && env[last] <= threshold) last--;

  const size = Math.round(pcm.sampleRate * WINDOW_SEC);
  const margin = Math.round(pcm.sampleRate * 0.05);
  const start = Math.max(0, first * size - margin);
  const end = Math.min(pcm.samples.length, (last + 1) * size + margin);
  return { samples: pcm.samples.slice(start, end), sampleRate: pcm.sampleRate };
}

/** Pauses inside the line, in samples, not counting silence at either end. */
function interiorGaps(pcm: Pcm, minSec = 0.12): { start: number; end: number }[] {
  const env = envelope(pcm);
  const threshold = silenceThreshold(env);
  const size = Math.round(pcm.sampleRate * WINDOW_SEC);
  const minWindows = Math.ceil(minSec / WINDOW_SEC);
  const firstVoiced = env.findIndex((v) => v > threshold);
  let lastVoiced = env.length - 1;
  while (lastVoiced > 0 && env[lastVoiced] <= threshold) lastVoiced--;

  const gaps: { start: number; end: number }[] = [];
  let runStart = -1;
  for (let w = firstVoiced; w <= lastVoiced; w++) {
    const quiet = env[w] <= threshold;
    if (quiet && runStart === -1) runStart = w;
    if (!quiet && runStart !== -1) {
      if (w - runStart >= minWindows) gaps.push({ start: runStart * size, end: w * size });
      runStart = -1;
    }
  }
  return gaps;
}

/** The quietest point within reach of `sample`, so a forced cut never lands mid-word. */
function quietestNear(pcm: Pcm, sample: number, reachSec = 0.25): number {
  const env = envelope(pcm);
  const size = Math.round(pcm.sampleRate * WINDOW_SEC);
  const centre = Math.floor(sample / size);
  const reach = Math.ceil(reachSec / WINDOW_SEC);
  let best = Math.max(0, Math.min(env.length - 1, centre));
  for (let w = Math.max(0, centre - reach); w <= Math.min(env.length - 1, centre + reach); w++) {
    if (env[w] < env[best]) best = w;
  }
  return best * size;
}

// ---------------------------------------------------------------- mixing

/** Where each pipe sits in the line's spoken text, 0..1 — the same measure the player uses. */
export function pipeFractions(text: string): number[] {
  const spokenLength = (s: string) =>
    s.replace(/<[^>]+>/g, '').replace(/\|[^|]*\|/g, '').replace(/\s+/g, ' ').trim().length;
  const total = spokenLength(text) || 1;
  return Array.from(text.matchAll(/\|([^|]+)\|/g), (m) => spokenLength(text.slice(0, m.index)) / total);
}

/**
 * Lays each interjection clip into the pause the speaker left for it. A pause
 * too short to hold the interjection is widened rather than talked over, so
 * every one is heard clearly and none is cut short.
 *
 * `boundaries` (from `locatePipes`) say where, in seconds, the words either
 * side of each pipe end and begin; without them the pause is guessed from
 * `fractions`, which can land a sentence early or late.
 */
export function mixInterjections(
  lineUrl: string,
  clipUrls: string[],
  fractions: number[],
  boundaries?: (Boundary | undefined)[]
): { audioUrl: string; durationSec: number; placements: Placement[] } {
  const line = decodeWavDataUrl(lineUrl);
  const { sampleRate } = line;
  const lineEnv = envelope(line);
  const target = voicedRms(lineEnv) * 0.8;
  const gaps = interiorGaps(line);
  const pad = Math.round(0.08 * sampleRate);

  const chunks: Float32Array[] = [];
  const placements: Placement[] = [];
  let outLength = 0;
  let cursor = 0;
  const push = (chunk: Float32Array) => {
    chunks.push(chunk);
    outLength += chunk.length;
  };

  clipUrls.forEach((url, i) => {
    const clip = trimSilence(decodeWavDataUrl(url));
    if (clip.sampleRate !== sampleRate) throw new Error('Interjection sample rate differs from the line');

    // Sit a touch under the speaker, as a murmur does, without ever clipping.
    const clipRms = voicedRms(envelope(clip)) || 1;
    const peak = clip.samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
    const gain = Math.min(target / clipRms, 0.95 / peak);
    const fade = Math.min(Math.round(0.012 * sampleRate), Math.floor(clip.samples.length / 4));
    const shaped = clip.samples.map((v, k) => {
      const edge = Math.min(1, k / fade, (clip.samples.length - 1 - k) / fade);
      return v * gain * edge;
    });

    const boundary = boundaries?.[i];
    const centre = (g: { start: number; end: number }) => (g.start + g.end) / 2;
    const ahead = gaps.filter((g) => g.start >= cursor);
    let gap: { start: number; end: number } | undefined;
    let expected: number;

    if (boundary) {
      // The pause between the two words the pipe was written between; the
      // transcript's times are loose, so allow a little either side.
      const from = (boundary.start - 0.25) * sampleRate;
      const to = (boundary.end + 0.25) * sampleRate;
      expected = Math.round(((boundary.start + boundary.end) / 2) * sampleRate);
      gap = ahead
        .filter((g) => g.end >= from && g.start <= to)
        .sort((a, b) => Math.abs(centre(a) - expected) - Math.abs(centre(b) - expected))[0];
    } else {
      // The pause for the pipe is a <short pause>, so a long one near where
      // the pipe was written beats a nearer comma, but only slightly: a
      // strong pull toward long pauses lands the interjection a sentence off.
      expected = Math.round((fractions[i] ?? 0.5) * line.samples.length);
      const score = (g: { start: number; end: number }) =>
        Math.abs(centre(g) - expected) / sampleRate - 0.3 * ((g.end - g.start) / sampleRate);
      gap = ahead
        .filter((g) => Math.abs(centre(g) - expected) < 0.8 * sampleRate)
        .sort((a, b) => score(a) - score(b))[0];
    }

    // No pause where the pipe is: open one at the quietest point there.
    const regionStart = gap ? gap.start : Math.max(cursor, quietestNear(line, expected, boundary ? 0.15 : 0.25));
    const regionEnd = gap ? gap.end : regionStart;
    push(line.samples.slice(cursor, regionStart));

    const original = line.samples.slice(regionStart, regionEnd);
    const region = new Float32Array(Math.max(original.length, shaped.length + pad * 2));
    region.set(original);
    const offset = Math.floor((region.length - shaped.length) / 2);
    for (let k = 0; k < shaped.length; k++) region[offset + k] += shaped[k];

    placements.push({
      atSec: (outLength + offset) / sampleRate,
      durationSec: shaped.length / sampleRate,
    });
    push(region);
    cursor = regionEnd;
  });

  push(line.samples.slice(cursor));

  const samples = new Float32Array(outLength);
  let at = 0;
  for (const chunk of chunks) {
    samples.set(chunk, at);
    at += chunk.length;
  }
  return {
    audioUrl: encodeWavDataUrl({ samples, sampleRate }),
    durationSec: outLength / sampleRate,
    placements,
  };
}

// ---------------------------------------------------------- verification

//
// Both checks below transcribe the clip word by word, without being shown the
// script so the transcript can't lean toward it, and compare in code. A
// native take goes wrong in ways a yes/no question misses: the interjection
// comes a sentence early, moves to the end, or the listener reads part of the
// speaker's line. All of those are the line heard out of order.

interface HeardWord {
  word: string;
  /** Said by the second, interjecting voice rather than the main speaker. */
  second: boolean;
  start: number;
  end: number;
}

async function transcribeWords(ai: GoogleGenAI, audioUrl: string, twoVoices: boolean): Promise<HeardWord[]> {
  const data = audioUrl.slice(audioUrl.indexOf(',') + 1);
  const voices = twoVoices
    ? 'There is a main speaker and possibly a second, different voice that briefly interjects. Mark each word with the voice that says it: "main" or "second".'
    : 'There is one speaker; mark every word "main".';
  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash',
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'audio/wav', data } },
          {
            text: `Transcribe this clip word by word, exactly as spoken, in the order spoken. ${voices}
Write numbers as words. Leave out breaths, laughs, gasps and other non-speech sounds, but keep sounds like "mhm" or "uh-huh" as words.
Give each word's start and end time in seconds, to the nearest 0.05s.

Return ONLY JSON: {"words":[{"w":string,"voice":"main"|"second","start":number,"end":number}]}`,
          },
        ],
      },
    ],
    config: { responseMimeType: 'application/json' },
  });

  const parsed = JSON.parse(response.text || '{}');
  const words: any[] = Array.isArray(parsed.words) ? parsed.words : [];
  return words
    .filter((w) => typeof w?.w === 'string' && Number.isFinite(Number(w.start)))
    .map((w) => {
      const start = Number(w.start);
      const end = Number(w.end);
      return {
        word: w.w,
        second: twoVoices && w.voice === 'second',
        start,
        end: Number.isFinite(end) && end >= start ? end : start + 0.3,
      };
    });
}

const CONTRACTED: Record<string, string> = { gonna: 'going to', wanna: 'want to', gotta: 'got to' };

/** A word as compared: lowercase letters only, so "Wi-Fi" is "wifi" and "I'm" is "im". */
function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .flatMap((w) => (CONTRACTED[w.replace(/[^a-z]/g, '')] ?? w).split(' '))
    .map((w) => w.replace(/[^a-z]/g, ''))
    .filter(Boolean);
}

/** An interjection as compared: spellings of the same sound are one ("mm-hmm" is "mhm"). */
function canonicalInterjection(text: string): string {
  const s = normalizeWords(text).join('');
  if (/^m+h*m+$/.test(s)) return 'mhm';
  if (/^uh+h?uh+$/.test(s)) return 'uhhuh';
  if (s === 'ok') return 'okay';
  if (s === 'allright') return 'alright';
  return s;
}

/** The script's spoken words, and each pipe with how many of those words come before it. */
function scriptShape(text: string): { words: string[]; pipes: { phrase: string; at: number }[] } {
  const words: string[] = [];
  const pipes: { phrase: string; at: number }[] = [];
  text
    .replace(/<[^>]+>/g, ' ')
    .split(/(\|[^|]*\|)/)
    .forEach((part) => {
      if (/^\|[^|]*\|$/.test(part)) pipes.push({ phrase: part.slice(1, -1).trim(), at: words.length });
      else words.push(...normalizeWords(part));
    });
  return { words, pipes };
}

/** Word edit distance, and for each script word the heard word it lines up with. */
function align(script: string[], heard: string[]): { distance: number; match: (number | undefined)[] } {
  const d = Array.from({ length: script.length + 1 }, (_, i) => {
    const row = new Array<number>(heard.length + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 1; j <= heard.length; j++) d[0][j] = j;
  for (let i = 1; i <= script.length; i++) {
    for (let j = 1; j <= heard.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (script[i - 1] === heard[j - 1] ? 0 : 1));
    }
  }

  const match = new Array<number | undefined>(script.length).fill(undefined);
  let i = script.length;
  let j = heard.length;
  while (i > 0 && j > 0) {
    if (d[i][j] === d[i - 1][j - 1] + (script[i - 1] === heard[j - 1] ? 0 : 1)) {
      match[--i] = --j;
    } else if (d[i][j] === d[i - 1][j] + 1) {
      i--;
    } else {
      j--;
    }
  }
  return { distance: d[script.length][heard.length], match };
}

/** How far the heard words may stray from the script before the take is wrong. */
const allowedEdits = (wordCount: number) => Math.max(1, Math.floor(wordCount / 12));

/**
 * Listens to a native multi-speaker clip and confirms it is the line as
 * written: the speaker's words in order, and the second voice saying each
 * interjection, word for word, at the point in the line it was written.
 * Returns where each interjection lands, or why the take doesn't hold.
 */
export async function verifyNativeBackchannels(
  ai: GoogleGenAI,
  audioUrl: string,
  text: string
): Promise<{ placements: Placement[] } | { problem: string }> {
  const script = scriptShape(text);
  const heard = await transcribeWords(ai, audioUrl, true);

  const main: string[] = [];
  const runs: { words: string[]; at: number; start: number; end: number }[] = [];
  let previousSecond = false;
  for (const w of heard) {
    if (w.second) {
      if (!previousSecond) runs.push({ words: [], at: main.length, start: w.start, end: w.end });
      const run = runs[runs.length - 1];
      run.words.push(w.word);
      run.end = w.end;
    } else {
      main.push(...normalizeWords(w.word));
    }
    previousSecond = w.second;
  }

  const said = runs.map((r) => `|${r.words.join(' ')}|@${r.at}`).join(' ') || 'none';
  if (runs.length !== script.pipes.length) {
    return { problem: `second voice said ${runs.length} interjection(s), expected ${script.pipes.length} (heard ${said})` };
  }
  for (let k = 0; k < runs.length; k++) {
    const expected = script.pipes[k];
    if (canonicalInterjection(runs[k].words.join(' ')) !== canonicalInterjection(expected.phrase)) {
      return { problem: `heard |${runs[k].words.join(' ')}| for |${expected.phrase}|` };
    }
    if (Math.abs(runs[k].at - expected.at) > 1) {
      return { problem: `|${expected.phrase}| came after word ${runs[k].at}, written after word ${expected.at}` };
    }
  }

  const { distance } = align(script.words, main);
  if (distance > allowedEdits(script.words.length)) {
    return { problem: `speaker's words are ${distance} word(s) off the script` };
  }

  return {
    placements: runs.map((r) => ({ atSec: Math.max(0, r.start), durationSec: Math.max(0.2, r.end - r.start) })),
  };
}

/** Whether a listener's own interjection clip says the phrase, and only it. */
export async function interjectionSays(ai: GoogleGenAI, clipUrl: string, phrase: string): Promise<boolean> {
  const heard = await transcribeWords(ai, clipUrl, false);
  return canonicalInterjection(heard.map((w) => w.word).join(' ')) === canonicalInterjection(phrase);
}

/**
 * Finds, in the speaker's take of the line alone, the words each pipe was
 * written between, so the interjection goes into that pause and no other.
 * `problem` is set when the take itself strays from the script.
 */
export async function locatePipes(
  ai: GoogleGenAI,
  lineUrl: string,
  text: string
): Promise<{ boundaries: (Boundary | undefined)[]; problem?: string }> {
  const script = scriptShape(text);
  const heard = (await transcribeWords(ai, lineUrl, false)).flatMap((w) =>
    normalizeWords(w.word).map((word) => ({ ...w, word }))
  );
  const { distance, match } = align(
    script.words,
    heard.map((w) => w.word)
  );

  const heardBefore = (i: number) => {
    for (let k = i; k >= 0; k--) if (match[k] !== undefined) return heard[match[k] as number];
    return undefined;
  };
  const heardAfter = (i: number) => {
    for (let k = i; k < match.length; k++) if (match[k] !== undefined) return heard[match[k] as number];
    return undefined;
  };

  const boundaries = script.pipes.map(({ at }) => {
    const before = heardBefore(at - 1);
    const after = heardAfter(at);
    if (!before && !after) return undefined;
    const start = before ? before.end : Math.max(0, (after as HeardWord).start - 0.3);
    const end = after ? after.start : start + 0.3;
    return { start: Math.min(start, end), end: Math.max(start, end) };
  });

  return {
    boundaries,
    problem:
      distance > allowedEdits(script.words.length)
        ? `speaker's take is ${distance} word(s) off the script`
        : undefined,
  };
}
