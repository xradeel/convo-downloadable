/**
 * Human Voice Prosody & Organic Acoustic Effects Engine
 * Generates natural vocal cues (<sigh>, <breath>, <chuckle>) using Web Audio API
 * and selects premium human-sounding natural voices for table read performances.
 */

// Acoustic breath & vocal tag generator via Web Audio
export function playAcousticVocalCue(
  audioCtx: AudioContext,
  cueType: 'sigh' | 'breath' | 'chuckle',
  onDone?: () => void
) {
  try {
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const t0 = audioCtx.currentTime;

    if (cueType === 'sigh') {
      // Pink noise burst with descending resonant filter simulating an audible human sigh
      const bufferSize = audioCtx.sampleRate * 0.75;
      const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        output[i] = (b0 + b1 + b2) * 0.12;
      }

      const whiteNoise = audioCtx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 2.5;
      filter.frequency.setValueAtTime(1400, t0);
      filter.frequency.exponentialRampToValueAtTime(320, t0 + 0.7);

      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(0.25, t0 + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.72);

      whiteNoise.connect(filter);
      filter.connect(gain);
      gain.connect(audioCtx.destination);

      whiteNoise.start(t0);
      whiteNoise.stop(t0 + 0.75);
      setTimeout(() => onDone?.(), 750);
      return;
    }

    if (cueType === 'breath') {
      // Soft gentle air intake (inhalation)
      const bufferSize = audioCtx.sampleRate * 0.45;
      const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = (Math.random() * 2 - 1) * 0.08;
      }

      const noise = audioCtx.createBufferSource();
      noise.buffer = noiseBuffer;

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 3.0;
      filter.frequency.setValueAtTime(600, t0);
      filter.frequency.exponentialRampToValueAtTime(1800, t0 + 0.4);

      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(0.18, t0 + 0.25);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.44);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(audioCtx.destination);

      noise.start(t0);
      noise.stop(t0 + 0.45);
      setTimeout(() => onDone?.(), 450);
      return;
    }

    if (cueType === 'chuckle') {
      // Dual rhythmic glottal chuckles
      [0, 0.18].forEach((delay) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(180, t0 + delay);
        osc.frequency.exponentialRampToValueAtTime(110, t0 + delay + 0.12);

        gain.gain.setValueAtTime(0.001, t0 + delay);
        gain.gain.linearRampToValueAtTime(0.12, t0 + delay + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + delay + 0.13);

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start(t0 + delay);
        osc.stop(t0 + delay + 0.14);
      });
      setTimeout(() => onDone?.(), 380);
      return;
    }

    onDone?.();
  } catch (e) {
    onDone?.();
  }
}

/**
 * Returns the best, most human-sounding natural speech voice available on the device
 */
export function selectBestHumanVoice(
  voices: SpeechSynthesisVoice[],
  gender: 'male' | 'female' | 'neutral',
  accent: string = 'American'
): SpeechSynthesisVoice | null {
  if (!voices || voices.length === 0) return null;

  const englishVoices = voices.filter(v => v.lang.startsWith('en'));
  const targetVoices = englishVoices.length > 0 ? englishVoices : voices;

  if (gender === 'female') {
    // Prefer natural/enhanced female voices
    const preferredFemaleNames = [
      'Samantha (Enhanced)',
      'Samantha',
      'Google UK English Female',
      'Google US English',
      'Microsoft Jenny Online (Natural)',
      'Microsoft Jenny',
      'Victoria',
      'Karen',
      'Moira',
      'Fiona',
      'Zira',
      'Female'
    ];

    for (const name of preferredFemaleNames) {
      const match = targetVoices.find(v => 
        v.name.toLowerCase().includes(name.toLowerCase()) || 
        (v.name.toLowerCase().includes('female') && v.lang.startsWith('en'))
      );
      if (match) return match;
    }
  } else if (gender === 'male') {
    // Prefer natural/enhanced male voices
    const preferredMaleNames = [
      'Daniel (Enhanced)',
      'Daniel',
      'Google UK English Male',
      'Google US English',
      'Microsoft Guy Online (Natural)',
      'Microsoft Guy',
      'Microsoft David',
      'Alex',
      'Oliver',
      'George',
      'Arthur',
      'Fred',
      'Male'
    ];

    for (const name of preferredMaleNames) {
      const match = targetVoices.find(v => 
        v.name.toLowerCase().includes(name.toLowerCase()) || 
        (v.name.toLowerCase().includes('male') && v.lang.startsWith('en'))
      );
      if (match) return match;
    }
  }

  return targetVoices[0] || null;
}
