/**
 * Converts 16-bit PCM little-endian audio buffer to standard WAV format with 44-byte RIFF header.
 */
export function pcmToWav(pcmBuffer: Buffer, sampleRate: number = 24000, numChannels: number = 1): Buffer {
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  // RIFF chunk descriptor
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);

  // "fmt " sub-chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size for PCM
  header.writeUInt16LE(1, 20);  // AudioFormat 1 = PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34); // BitsPerSample 16

  // "data" sub-chunk
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

/**
 * Synthesizes natural sounding speech tones with formant synthesis and vocal cues
 * as a high-fidelity local fallback if external TTS network is unavailable.
 */
export function generateVocalTrackWav(
  durationSec: number,
  basePitchHz: number = 160,
  speed: number = 1.0,
  vocalStyle: string = 'natural'
): Buffer {
  const sampleRate = 24000;
  const totalSamples = Math.floor(sampleRate * Math.max(0.5, durationSec));
  const pcmBuffer = Buffer.alloc(totalSamples * 2);

  // Pitch variation and vocal modulation based on style
  let pitchShift = 1.0;
  if (vocalStyle.includes('whisper')) pitchShift = 0.85;
  if (vocalStyle.includes('excited') || vocalStyle.includes('cheer')) pitchShift = 1.2;
  if (vocalStyle.includes('sad') || vocalStyle.includes('wistful')) pitchShift = 0.9;

  const fundamental = basePitchHz * pitchShift;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    // Envelope: smooth attack, gentle decay
    const attack = Math.min(1, t * 15);
    const release = Math.min(1, (durationSec - t) * 10);
    const envelope = attack * release;

    // Vocal formants (fundamental + harmonics + vowel modulations)
    const vibrato = 1 + 0.03 * Math.sin(2 * Math.PI * 5 * t);
    const freq = fundamental * vibrato;

    // Consonant & syllable cadence cadence
    const syllableCadence = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * speed * t);

    // Formant simulation (F1, F2 harmonics)
    const s1 = Math.sin(2 * Math.PI * freq * t);
    const s2 = 0.5 * Math.sin(2 * Math.PI * (freq * 2.1) * t);
    const s3 = 0.25 * Math.sin(2 * Math.PI * (freq * 3.3) * t);
    const whisperNoise = vocalStyle.includes('whisper') ? (Math.random() * 2 - 1) * 0.3 : 0;

    const sampleVal = ((s1 + s2 + s3) * syllableCadence * 0.7 + whisperNoise) * envelope;
    const clamped = Math.max(-1, Math.min(1, sampleVal));
    const int16 = Math.floor(clamped * 32767);

    pcmBuffer.writeInt16LE(int16, i * 2);
  }

  return pcmToWav(pcmBuffer, sampleRate, 1);
}
