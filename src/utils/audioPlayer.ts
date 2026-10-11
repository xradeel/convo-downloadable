/**
 * High-Fidelity Web Audio Speech Engine for Table Read.
 * Drives playback of real synthesized audio, realistic turn-taking cadence,
 * and real-time lip-sync events for illustrated characters.
 */

/** A listener's interjection, already voiced in the listener's own voice. */
export interface BackchannelClip {
  /** Which |pipe| in the line this is, counting from zero. */
  index: number;
  text: string;
  speaker: string;
  /** Its own clip, for the fallback that drops it in over a pause. */
  audioUrl?: string;
  /** Already in the line's audio, starting `atSec` in: nothing to play or pause. */
  inLine?: boolean;
  atSec?: number;
  durationSec?: number;
}

export interface PlaybackTurn {
  id: string;
  speaker: string;
  text: string;
  style?: string;
  audioUrl?: string;
  duration?: number;
  backchannels?: BackchannelClip[];
}

/**
 * What the mouth needs to know each frame: how loud the voice is, and how
 * bright it is. Brightness (spectral centroid) separates the front vowels that
 * spread the lips wide from the back vowels that round them, which is as close
 * to real visemes as an amplitude envelope can get.
 */
export interface SpeechShape {
  /** 0..1 loudness, the same signal as onSpeechActivity. */
  level: number;
  /** 0 = dark and rounded ("oo"), 1 = bright and wide ("ee"). */
  brightness: number;
}

/** An interjection the listener drops into someone else's line. */
export interface Backchannel {
  /** The interjection as written, e.g. "mhm". */
  text: string;
  /** How far through the line it lands, 0..1. */
  at: number;
}

/** Phonetic classification for mouth viseme shaping during backchannels. */
export type BackchannelPhoneticType = 'hum' | 'spread' | 'open';

/** A backchannel that is happening right now, for whoever is animating it. */
export interface ActiveBackchannel {
  /** The listener saying it, not the speaker whose line it sits in. */
  speaker: string;
  text: string;
  /** 0..1 envelope: in fast, out slower. */
  level: number;
  duration: number;
  age: number;
  phoneticType: BackchannelPhoneticType;
}

/** Classifies the interjection into a mouth viseme shape. */
export function classifyBackchannelPhonetic(text: string): BackchannelPhoneticType {
  const clean = text.toLowerCase().replace(/[^a-z-]/g, '');
  if (/^(mhm|mm|hmm|hm|m-m|uh-uh|um)$/.test(clean)) {
    return 'hum';
  }
  if (/yeah|yes|right|itdid|hey|please|wait|spooky|agree|indeed|surely/.test(clean)) {
    return 'spread';
  }
  return 'open';
}

/** Calculates an organic duration based on word and character counts. */
export function estimateBackchannelDuration(text: string): number {
  const words = text.trim().split(/\s+/).length;
  const chars = text.trim().length;
  return Math.max(0.55, Math.min(1.25, 0.4 + words * 0.16 + chars * 0.02));
}

/** Rough spoken length, used only when a clip has no clock of its own. */
function estimateSpokenDuration(text: string): number {
  return Math.max(1.8, text.split(/\s+/).filter(Boolean).length / 2.3);
}

/** Length of a line as actually spoken: no direction tags, no interjections. */
function spokenLength(text: string): number {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\|[^|]*\|/g, '')
    .replace(/\s+/g, ' ')
    .trim().length;
}

/**
 * Finds the |pipes| Gemini TTS hands to the second speaker, and where in the
 * line each one lands.
 *
 * Position is measured in spoken characters rather than raw ones, so tags and
 * earlier interjections don't push an estimate out of step with the audio. It
 * is an approximation either way: the API returns one clip per line with no
 * word timings, so this is the closest we can place them.
 */
export function parseBackchannels(text: string): Backchannel[] {
  const total = spokenLength(text);
  if (total === 0) return [];

  const found: Backchannel[] = [];
  const pattern = /\|([^|]+)\|/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const at = spokenLength(text.slice(0, match.index)) / total;
    found.push({
      text: match[1].trim(),
      // Never right at the edges, where it would collide with the turn change.
      at: Math.min(0.92, Math.max(0.08, at)),
    });
  }

  return found;
}

class AudioPlayerEngine {
  private audioCtx: AudioContext | null = null;
  private currentAudioElement: HTMLAudioElement | null = null;
  private isPlaying: boolean = false;
  private playbackRate: number = 1.0;

  private onTurnChangeCallback: ((turnIndex: number) => void) | null = null;
  private onPlaybackStateChangeCallback: ((isPlaying: boolean) => void) | null = null;
  private onTimeUpdateCallback: ((currentSec: number, totalSec: number) => void) | null = null;
  private onSpeakingCharacterCallback: ((speaker: string | null, isSpeaking: boolean) => void) | null = null;
  private onSpeechActivityCallback: ((activity: number) => void) | null = null;

  private currentTurnIndex: number = 0;
  private turns: PlaybackTurn[] = [];
  private timeoutHandle: any = null;
  private activityInterval: any = null;
  /** How long we've been holding on a line whose clip hasn't arrived yet. */
  private awaitingAudioTicks: number = 0;

  // Real-time amplitude analysis of the synthesized audio, used to drive lip sync.
  private analyser: AnalyserNode | null = null;
  // Explicitly backed by ArrayBuffer: getByteTimeDomainData rejects the
  // SharedArrayBuffer-compatible default in newer TS DOM lib definitions.
  private analyserData: Uint8Array<ArrayBuffer> | null = null;
  private mediaSource: MediaElementAudioSourceNode | null = null;
  private spectrumData: Uint8Array<ArrayBuffer> | null = null;
  private rafHandle: number | null = null;
  private levelPeak: number = 0;
  private speechShape: SpeechShape = { level: 0, brightness: 0.5 };

  // Backchannels for the line being played, and which listener voices them.
  private turnBackchannels: Backchannel[] = [];
  private backchannelClips: BackchannelClip[] = [];
  private backchannelCursor: number = 0;
  private backchannelSpeaker: string | null = null;
  private activeBackchannel: {
    speaker: string;
    text: string;
    firedAt: number;
    /** Real length of the clip, once the audio reports it. */
    clipDuration?: number;
    /** Heard in the line's own audio, so its level is the line's waveform. */
    inLine?: boolean;
  } | null = null;
  /** The line's clip carries its interjections; the player only animates them. */
  private backchannelsInLine: boolean = false;
  /** Hands the line back to its speaker once an in-line interjection is over. */
  private inLineTimer: any = null;
  /** The interjection's own audio, played during a dedicated pause pocket. */
  private backchannelAudio: HTMLAudioElement | null = null;
  private isPausedForBackchannel: boolean = false;
  private backchannelResumeTimer: any = null;
  // Measured separately from the speaker's waveform: the listener's mouth has
  // to follow the interjection, not the line it lands in.
  private backchannelAnalyser: AnalyserNode | null = null;
  private backchannelData: Uint8Array<ArrayBuffer> | null = null;
  private turnStartedAt: number = 0;
  private turnSpan: number = 0;
  private onBackchannelCallback: ((speaker: string, text: string) => void) | null = null;

  constructor() {
    // AudioContext will be initialized on first user interaction
  }

  public getAudioContext(): AudioContext | null {
    this.initContext();
    return this.audioCtx;
  }

  private initContext() {
    if (!this.audioCtx && typeof window !== 'undefined') {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  public setCallbacks(options: {
    onTurnChange?: (turnIndex: number) => void;
    onPlaybackStateChange?: (isPlaying: boolean) => void;
    onTimeUpdate?: (currentSec: number, totalSec: number) => void;
    onSpeakingCharacter?: (speaker: string | null, isSpeaking: boolean) => void;
    onSpeechActivity?: (activity: number) => void;
    onBackchannel?: (speaker: string, text: string) => void;
  }) {
    if (options.onTurnChange) this.onTurnChangeCallback = options.onTurnChange;
    if (options.onPlaybackStateChange) this.onPlaybackStateChangeCallback = options.onPlaybackStateChange;
    if (options.onTimeUpdate) this.onTimeUpdateCallback = options.onTimeUpdate;
    if (options.onSpeakingCharacter) this.onSpeakingCharacterCallback = options.onSpeakingCharacter;
    if (options.onSpeechActivity) this.onSpeechActivityCallback = options.onSpeechActivity;
    if (options.onBackchannel) this.onBackchannelCallback = options.onBackchannel;
  }

  public setTurns(turns: PlaybackTurn[]) {
    this.turns = turns;
  }

  public setPlaybackRate(rate: number) {
    this.playbackRate = rate;
    if (this.currentAudioElement) {
      this.currentAudioElement.playbackRate = rate;
    }
  }

  public getCurrentTurnIndex(): number {
    return this.currentTurnIndex;
  }

  public isCurrentlyPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * True when speech activity is being measured from a real waveform rather
   * than approximated. Consumers can follow the signal directly instead of
   * mixing in a synthetic envelope.
   */
  public hasLiveWaveform(): boolean {
    return this.analyser !== null;
  }

  /**
   * Latest loudness and brightness of the voice, for renderers that animate
   * per frame. Polled rather than pushed so a 60fps canvas always reads the
   * freshest value instead of whatever React last committed.
   */
  public getSpeechShape(): SpeechShape {
    return this.speechShape;
  }

  /**
   * The interjection in flight, if any, for renderers that animate per frame.
   * Returns the listener who says it, so a performer can check whether the
   * interjection is theirs.
   */
  public getBackchannel(): ActiveBackchannel | null {
    const active = this.activeBackchannel;
    if (!active) return null;

    // Prefer the clip's real length; fall back to an estimate when the
    // interjection has no audio of its own.
    const duration = active.clipDuration ?? estimateBackchannelDuration(active.text);
    const age = (performance.now() - active.firedAt) * 0.001;
    if (age > duration) {
      this.activeBackchannel = null;
      return null;
    }

    const attack = Math.min(0.12, duration * 0.22);
    const shaped =
      age < attack ? age / attack : Math.max(0, 1 - (age - attack) / (duration - attack));

    return {
      speaker: active.speaker,
      text: active.text,
      // The interjection's own waveform when we have it, so the listener's
      // mouth opens on the sound rather than on a timer. In the line's audio,
      // what is sounding during the interjection is the interjection.
      level: active.inLine ? this.speechShape.level : this.measureBackchannelLevel() ?? shaped,
      duration,
      age,
      phoneticType: classifyBackchannelPhonetic(active.text),
    };
  }

  /** RMS of the interjection clip, or null when it isn't routed through Web Audio. */
  private measureBackchannelLevel(): number | null {
    if (!this.backchannelAnalyser || !this.backchannelData) return null;

    this.backchannelAnalyser.getByteTimeDomainData(this.backchannelData);

    let sumSquares = 0;
    for (let i = 0; i < this.backchannelData.length; i++) {
      const sample = (this.backchannelData[i] - 128) / 128;
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / this.backchannelData.length);

    // Interjections are murmured, so they need a lower ceiling than a full line
    // before they read as a fully open mouth.
    return Math.max(0, Math.min(1, (rms - 0.004) / 0.09));
  }

  /** The other person in the scene: whoever Gemini TTS hands the |pipes| to. */
  private listenerFor(speaker: string): string | null {
    const other = this.turns.find(
      (turn) => turn.speaker.toUpperCase() !== speaker.toUpperCase()
    );
    return other?.speaker ?? null;
  }

  /** Releases any interjections the playhead has now reached. */
  private advanceBackchannels(progress: number) {
    if (!this.backchannelSpeaker) return;
    if (this.backchannelsInLine) {
      this.advanceInLineBackchannels();
      return;
    }
    if (this.isPausedForBackchannel) return;

    while (
      this.backchannelCursor < this.turnBackchannels.length &&
      progress >= this.turnBackchannels[this.backchannelCursor].at
    ) {
      const index = this.backchannelCursor++;
      const next = this.turnBackchannels[index];
      const speaker = this.backchannelSpeaker;

      this.activeBackchannel = { speaker, text: next.text, firedAt: performance.now() };
      this.playBackchannelClip(index, next.text);
      this.onBackchannelCallback?.(speaker, next.text);
      break;
    }
  }

  /**
   * Hands the performance to the listener while an interjection that is
   * already in the line's audio sounds, and back when it's over. The audio
   * itself is never touched, so the line plays straight through.
   */
  private advanceInLineBackchannels() {
    const audio = this.currentAudioElement;
    if (!audio || this.backchannelCursor >= this.backchannelClips.length) return;

    const clip = this.backchannelClips.find((c) => c.index === this.backchannelCursor);
    if (!clip) {
      this.backchannelCursor++;
      return;
    }
    if (audio.currentTime < (clip.atSec ?? 0)) return;
    this.backchannelCursor++;

    const speaker = clip.speaker || (this.backchannelSpeaker as string);
    const duration = (clip.durationSec ?? estimateBackchannelDuration(clip.text)) / this.playbackRate;
    const owner = this.turns[this.currentTurnIndex]?.speaker;

    this.activeBackchannel = {
      speaker,
      text: clip.text,
      firedAt: performance.now(),
      clipDuration: duration,
      inLine: true,
    };
    this.onBackchannelCallback?.(speaker, clip.text);
    this.onSpeakingCharacterCallback?.(speaker, true);

    if (this.inLineTimer) clearTimeout(this.inLineTimer);
    this.inLineTimer = setTimeout(() => {
      this.inLineTimer = null;
      if (this.isPlaying && owner) this.onSpeakingCharacterCallback?.(owner, true);
    }, duration * 1000);
  }

  /**
   * Plays the backchannel interjection during an intentional conversational pause,
   * pausing the main speaker so both characters do not speak simultaneously.
   */
  private playBackchannelClip(index: number, text: string, onDone?: () => void) {
    const clip = this.backchannelClips.find((c) => c.index === index);

    this.releaseBackchannelAudio();

    // Pause the primary speaker element so the listener voices into a clear pause pocket
    const currentAudio = this.currentAudioElement;
    const pausedSpeaker = !!currentAudio && !currentAudio.paused;
    if (pausedSpeaker) {
      currentAudio!.pause();
      this.isPausedForBackchannel = true;
    }

    const currentTurn = this.turns[this.currentTurnIndex];
    if (this.backchannelSpeaker) {
      this.onSpeakingCharacterCallback?.(this.backchannelSpeaker, true);
    }

    let resumed = false;
    const resumeSpeaker = () => {
      if (resumed) return;
      resumed = true;
      if (this.backchannelResumeTimer) {
        clearTimeout(this.backchannelResumeTimer);
        this.backchannelResumeTimer = null;
      }
      this.isPausedForBackchannel = false;

      // Natural conversational breath/pause (180ms) after the listener finishes before speaker resumes
      this.backchannelResumeTimer = setTimeout(() => {
        this.backchannelResumeTimer = null;
        if (onDone) {
          if (this.isPlaying) onDone();
          return;
        }
        // Only a speaker this interjection paused is picked back up: calling
        // play() on a clip that already ended would start the line over.
        if (
          pausedSpeaker &&
          this.isPlaying &&
          this.currentAudioElement &&
          this.currentAudioElement === currentAudio
        ) {
          if (currentTurn) {
            this.onSpeakingCharacterCallback?.(currentTurn.speaker, true);
          }
          currentAudio.play().catch(() => {});
        }
      }, 180 / this.playbackRate);
    };

    if (!clip?.audioUrl) {
      // Hold a clear pause beat (~650ms) for the interjection
      const pauseDuration = Math.max(0.65, estimateBackchannelDuration(text));
      this.backchannelResumeTimer = setTimeout(resumeSpeaker, (pauseDuration * 1000) / this.playbackRate);
      return;
    }

    const audio = new Audio(clip.audioUrl);
    audio.volume = 0.95;
    audio.playbackRate = this.playbackRate;
    this.backchannelAudio = audio;

    // Route it so the listener's mouth can follow this clip specifically.
    this.initContext();
    if (this.audioCtx) {
      try {
        const source = this.audioCtx.createMediaElementSource(audio);
        const analyser = this.audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.25;
        source.connect(analyser);
        analyser.connect(this.audioCtx.destination);
        this.backchannelAnalyser = analyser;
        this.backchannelData = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      } catch {
        this.backchannelAnalyser = null;
        this.backchannelData = null;
      }
    }

    audio.onloadedmetadata = () => {
      if (
        this.activeBackchannel?.text === text &&
        Number.isFinite(audio.duration) &&
        audio.duration > 0
      ) {
        this.activeBackchannel.clipDuration = audio.duration / this.playbackRate;
      }
    };

    audio.onended = resumeSpeaker;
    audio.onerror = resumeSpeaker;

    // Safety fallback: if audio playback stalls or onended never fires, resume cleanly
    const estSec = Math.max(0.85, estimateBackchannelDuration(text) + 0.4);
    this.backchannelResumeTimer = setTimeout(resumeSpeaker, (estSec * 1000) / this.playbackRate);

    audio.play().catch(() => {
      resumeSpeaker();
    });
  }

  /**
   * Voices, one after another, any interjections the line finished before
   * reaching, then hands on. Every |pipe| in the script is heard exactly once.
   */
  private flushBackchannels(done: () => void) {
    if (!this.isPlaying) return;
    if (
      this.backchannelsInLine ||
      !this.backchannelSpeaker ||
      this.backchannelCursor >= this.turnBackchannels.length
    ) {
      done();
      return;
    }

    const index = this.backchannelCursor++;
    const next = this.turnBackchannels[index];
    const speaker = this.backchannelSpeaker;

    this.activeBackchannel = { speaker, text: next.text, firedAt: performance.now() };
    this.onBackchannelCallback?.(speaker, next.text);
    this.playBackchannelClip(index, next.text, () => this.flushBackchannels(done));
  }

  /** Tears down the previous interjection's element and its analyser. */
  private releaseBackchannelAudio() {
    if (this.backchannelResumeTimer) {
      clearTimeout(this.backchannelResumeTimer);
      this.backchannelResumeTimer = null;
    }
    if (this.backchannelAudio) {
      this.backchannelAudio.pause();
      this.backchannelAudio = null;
    }
    try {
      this.backchannelAnalyser?.disconnect();
    } catch {
      /* already torn down */
    }
    this.backchannelAnalyser = null;
    this.backchannelData = null;
    if (this.isPausedForBackchannel) {
      this.isPausedForBackchannel = false;
      if (this.isPlaying && this.currentAudioElement && this.currentAudioElement.paused) {
        this.currentAudioElement.play().catch(() => {});
      }
    }
  }

  /** Progress through the current line, from the clip if there is one. */
  private turnProgress(): number {
    const audio = this.currentAudioElement;
    if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
      return audio.currentTime / audio.duration;
    }
    // Browser speech fallback exposes no clock, so fall back to the estimate.
    if (this.turnSpan > 0) {
      return ((performance.now() - this.turnStartedAt) * 0.001) / this.turnSpan;
    }
    return 0;
  }

  public areAllTurnsLoaded(): boolean {
    if (this.turns.length === 0) return false;
    return this.turns.every(
      (turn) => typeof turn.audioUrl === 'string' && turn.audioUrl.trim().length > 0
    );
  }

  public getLoadedTurnCount(): number {
    return this.turns.filter(
      (turn) => typeof turn.audioUrl === 'string' && turn.audioUrl.trim().length > 0
    ).length;
  }

  public stop() {
    this.isPlaying = false;
    this.isPausedForBackchannel = false;
    if (this.inLineTimer) {
      clearTimeout(this.inLineTimer);
      this.inLineTimer = null;
    }
    if (this.backchannelResumeTimer) {
      clearTimeout(this.backchannelResumeTimer);
      this.backchannelResumeTimer = null;
    }
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    if (this.activityInterval) {
      clearInterval(this.activityInterval);
      this.activityInterval = null;
    }
    this.releaseBackchannelAudio();
    this.detachAnalyser();
    if (this.currentAudioElement) {
      this.currentAudioElement.pause();
      this.currentAudioElement = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.onSpeakingCharacterCallback?.(null, false);
    this.onSpeechActivityCallback?.(0);
    this.onPlaybackStateChangeCallback?.(false);
  }

  public pause() {
    this.stop();
  }

  public play(startIndex: number = 0) {
    if (this.turns.length === 0) return;
    if (!this.areAllTurnsLoaded()) {
      console.warn(
        `[AudioPlayerEngine] Cannot play: not all turns in the script are loaded properly (${this.getLoadedTurnCount()}/${this.turns.length} loaded).`
      );
      return;
    }
    this.initContext();
    this.stop();
    this.isPlaying = true;
    this.awaitingAudioTicks = 0;
    this.currentTurnIndex = Math.max(0, Math.min(startIndex, this.turns.length - 1));
    this.onPlaybackStateChangeCallback?.(true);
    this.playTurn(this.currentTurnIndex);
  }

  public playNext() {
    if (!this.areAllTurnsLoaded()) return;
    if (this.currentTurnIndex < this.turns.length - 1) {
      this.play(this.currentTurnIndex + 1);
    } else {
      this.stop();
      this.currentTurnIndex = 0;
      this.onTurnChangeCallback?.(0);
    }
  }

  public playPrevious() {
    if (!this.areAllTurnsLoaded()) return;
    if (this.currentTurnIndex > 0) {
      this.play(this.currentTurnIndex - 1);
    } else {
      this.play(0);
    }
  }

  /**
   * Routes an audio element through an AnalyserNode so lip sync can follow the
   * actual waveform. Returns false if Web Audio is unavailable, in which case
   * the caller falls back to the synthetic envelope.
   *
   * Note the element's output now flows through the graph, so the analyser must
   * stay connected to the destination or playback goes silent.
   */
  private attachAnalyser(audio: HTMLAudioElement): boolean {
    this.initContext();
    if (!this.audioCtx) return false;

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }

    try {
      const source = this.audioCtx.createMediaElementSource(audio);
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.35;

      source.connect(analyser);
      analyser.connect(this.audioCtx.destination);

      this.mediaSource = source;
      this.analyser = analyser;
      this.analyserData = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      this.spectrumData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      this.levelPeak = 0;
      return true;
    } catch {
      // createMediaElementSource throws if the element is already routed.
      return false;
    }
  }

  private detachAnalyser() {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    try {
      this.mediaSource?.disconnect();
      this.analyser?.disconnect();
    } catch {
      /* already torn down */
    }
    this.mediaSource = null;
    this.analyser = null;
    this.analyserData = null;
    this.spectrumData = null;
    this.speechShape = { level: 0, brightness: 0.5 };
    this.activeBackchannel = null;
    this.turnSpan = 0;
  }

  /**
   * Spectral centroid of the voice band, mapped to 0..1. Bins below ~300Hz are
   * skipped so the fundamental doesn't drag every vowel towards "dark", and the
   * useful range is roughly 400Hz-3kHz where the formants live.
   */
  private measureBrightness(): number {
    if (!this.analyser || !this.spectrumData) return 0.5;

    this.analyser.getByteFrequencyData(this.spectrumData);

    const nyquist = (this.audioCtx?.sampleRate ?? 48000) / 2;
    const hzPerBin = nyquist / this.spectrumData.length;
    const firstBin = Math.ceil(300 / hzPerBin);
    const lastBin = Math.min(this.spectrumData.length - 1, Math.floor(4000 / hzPerBin));

    let weighted = 0;
    let total = 0;
    for (let i = firstBin; i <= lastBin; i++) {
      const magnitude = this.spectrumData[i];
      weighted += magnitude * i * hzPerBin;
      total += magnitude;
    }
    if (total < 1) return 0.5;

    const centroid = weighted / total;
    return Math.max(0, Math.min(1, (centroid - 500) / 1400));
  }

  /** Per-frame RMS of the waveform, normalised against a decaying peak. */
  private startAmplitudeTracking() {
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);

    const tick = () => {
      if (!this.isPlaying || !this.analyser || !this.analyserData) {
        this.rafHandle = null;
        return;
      }

      this.analyser.getByteTimeDomainData(this.analyserData);

      let sumSquares = 0;
      for (let i = 0; i < this.analyserData.length; i++) {
        const sample = (this.analyserData[i] - 128) / 128;
        sumSquares += sample * sample;
      }
      const rms = Math.sqrt(sumSquares / this.analyserData.length);

      // Normalise against a decaying peak so quiet turns still open the mouth.
      // Speech sits well under its own peak (measured mean ~0.02 against peaks
      // of ~0.26), so scale against a fraction of it or the mouth barely moves.
      // The floor stops room tone being amplified into chatter.
      this.levelPeak = Math.max(rms, this.levelPeak * 0.99);
      const scale = Math.max(this.levelPeak * 0.7, 0.05);
      const level = Math.max(0, Math.min(1, (rms - 0.004) / scale));

      this.speechShape = { level, brightness: this.measureBrightness() };
      this.onSpeechActivityCallback?.(level);
      this.advanceBackchannels(this.turnProgress());
      this.rafHandle = requestAnimationFrame(tick);
    };

    this.rafHandle = requestAnimationFrame(tick);
  }

  /**
   * Synthetic envelope for the browser speech fallback, which exposes no
   * waveform to measure.
   */
  private startActivitySimulation() {
    if (this.activityInterval) clearInterval(this.activityInterval);
    this.activityInterval = setInterval(() => {
      if (!this.isPlaying) {
        clearInterval(this.activityInterval);
        return;
      }
      // Rhythmic speech envelope variance
      const level = 0.35 + Math.random() * 0.65;
      this.speechShape = { level, brightness: 0.3 + Math.random() * 0.5 };
      this.onSpeechActivityCallback?.(level);
      this.advanceBackchannels(this.turnProgress());
    }, 85);
  }

  private stopActivitySimulation() {
    if (this.activityInterval) {
      clearInterval(this.activityInterval);
      this.activityInterval = null;
    }
    this.detachAnalyser();
    this.onSpeechActivityCallback?.(0);
  }

  private playTurn(index: number) {
    if (!this.isPlaying || index >= this.turns.length) {
      this.stop();
      return;
    }

    if (!this.areAllTurnsLoaded()) {
      console.warn(`[AudioPlayerEngine] Halted: Turn ${index} cannot play because not all turns in the script are loaded properly.`);
      this.stop();
      return;
    }

    this.currentTurnIndex = index;
    this.onTurnChangeCallback?.(index);

    const turn = this.turns[index];
    if (!turn || !turn.audioUrl) {
      console.warn(`[AudioPlayerEngine] Turn ${index} has no audio URL. Stopping playback.`);
      this.stop();
      return;
    }
    this.onSpeakingCharacterCallback?.(turn.speaker, true);

    // Arm this line's interjections for the listener to drop in. The written
    // pipes give the timing, the clips give the voice.
    this.turnBackchannels = parseBackchannels(turn.text);
    this.backchannelClips = turn.backchannels ?? [];
    this.backchannelsInLine =
      this.backchannelClips.length > 0 &&
      this.backchannelClips.every((c) => c.inLine && c.atSec !== undefined);
    this.backchannelCursor = 0;
    if (this.inLineTimer) {
      clearTimeout(this.inLineTimer);
      this.inLineTimer = null;
    }
    this.backchannelSpeaker =
      this.backchannelClips[0]?.speaker ?? this.listenerFor(turn.speaker);
    this.activeBackchannel = null;
    this.releaseBackchannelAudio();
    // A line with no clip of its own must not time its interjections off the
    // previous line's finished one.
    if (this.currentAudioElement) {
      this.currentAudioElement.pause();
      this.currentAudioElement = null;
    }
    this.turnStartedAt = performance.now();
    this.turnSpan = turn.duration || estimateSpokenDuration(turn.text);

    // Real synthesized audio: drive lip sync from the waveform itself.
    if (turn.audioUrl && (turn.audioUrl.startsWith('data:audio') || turn.audioUrl.startsWith('http') || turn.audioUrl.startsWith('blob:'))) {
      this.awaitingAudioTicks = 0;
      const audio = new Audio(turn.audioUrl);
      this.currentAudioElement = audio;
      audio.playbackRate = this.playbackRate;

      if (this.attachAnalyser(audio)) {
        this.startAmplitudeTracking();
      } else {
        this.startActivitySimulation();
      }

      audio.onended = () => {
        this.stopActivitySimulation();
        this.onSpeakingCharacterCallback?.(turn.speaker, false);
        if (!this.isPlaying) return;
        this.flushBackchannels(() => {
          this.timeoutHandle = setTimeout(() => {
            this.playTurn(index + 1);
          }, 340 / this.playbackRate);
        });
      };

      // If the clip won't play, release the analyser and advance to the next turn
      const handleAudioError = () => {
        this.detachAnalyser();
        this.stopActivitySimulation();
        this.onSpeakingCharacterCallback?.(turn.speaker, false);
        if (!this.isPlaying) return;
        this.timeoutHandle = setTimeout(() => {
          this.playTurn(index + 1);
        }, 340 / this.playbackRate);
      };

      audio.onerror = handleAudioError;
      audio.play().catch(handleAudioError);
    } else {
      this.stopActivitySimulation();
      this.onSpeakingCharacterCallback?.(turn.speaker, false);
      this.stop();
    }
  }

  /** Re-checks a line for its clip; if delayed, speaks via speech synthesis so character is NEVER silent. */
  private waitForTurnAudio(index: number) {
    this.awaitingAudioTicks += 1;

    this.timeoutHandle = setTimeout(() => {
      if (!this.isPlaying) return;

      if (this.turns[index]?.audioUrl) {
        this.awaitingAudioTicks = 0;
        this.playTurn(index);
      } else if (this.awaitingAudioTicks < 16) {
        // Wait up to ~4 seconds for the network clip
        this.waitForTurnAudio(index);
      } else {
        // Fall back to browser speech synthesis so neither character is ever silent
        this.awaitingAudioTicks = 0;
        this.playFallbackSpeech(index);
      }
    }, 250 / this.playbackRate);
  }

  /**
   * Browser speech synthesis fallback so neither performer is ever silent
   * even during network lag, rate limits, or pending background synthesis.
   */
  private playFallbackSpeech(index: number) {
    if (!this.isPlaying) return;
    const turn = this.turns[index];
    if (!turn) return;

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const cleanText = turn.text
        .replace(/<[^>]+>/g, '')
        .replace(/\|[^|]*\|/g, ', ... , ')
        .replace(/\s+/g, ' ')
        .trim();
      const utterance = new SpeechSynthesisUtterance(cleanText);
      const isFemale = /sienna|kore|aoede|leda|vega|capella/i.test(turn.speaker);
      utterance.rate = this.playbackRate;
      utterance.pitch = isFemale ? 1.15 : 0.9;

      const voices = window.speechSynthesis.getVoices();
      const voice = voices.find((v) =>
        isFemale
          ? v.name.includes('Female') || v.lang.includes('GB') || v.name.includes('Samantha') || v.name.includes('Victoria')
          : v.name.includes('Male') || v.lang.includes('US') || v.name.includes('Alex') || v.name.includes('Daniel')
      );
      if (voice) utterance.voice = voice;

      utterance.onstart = () => {
        this.onSpeakingCharacterCallback?.(turn.speaker, true);
        this.startActivitySimulation();
      };
      utterance.onend = () => {
        this.stopActivitySimulation();
        this.onSpeakingCharacterCallback?.(turn.speaker, false);
        if (!this.isPlaying) return;
        this.flushBackchannels(() => {
          this.timeoutHandle = setTimeout(() => {
            this.playTurn(index + 1);
          }, 340 / this.playbackRate);
        });
      };
      utterance.onerror = () => {
        this.stopActivitySimulation();
        this.onSpeakingCharacterCallback?.(turn.speaker, false);
        if (!this.isPlaying) return;
        this.timeoutHandle = setTimeout(() => {
          this.playTurn(index + 1);
        }, 340 / this.playbackRate);
      };

      window.speechSynthesis.speak(utterance);
    } else {
      this.playTurn(index + 1);
    }
  }
}

export const globalAudioPlayer = new AudioPlayerEngine();
