export type ElementType = 
  | 'scene_heading' 
  | 'action' 
  | 'character' 
  | 'parenthetical' 
  | 'dialogue' 
  | 'transition';

export interface ScriptElement {
  id: string;
  type: ElementType;
  raw: string;
  character?: string;
  parenthetical?: string;
  text?: string;
  style?: string;
  vocalTags?: string[];
  backchannels?: string[];
  turnIndex?: number;
  /** Where a dialogue turn sits in the raw script, so its direction can be rewritten in place. */
  source?: {
    /** First line of the spoken text. */
    textLine: number;
    /** The line holding this turn's (parenthetical), if it has one. */
    directionLine?: number;
    /** Written as `NAME: text`, where the cue and the words share a line. */
    inlineCue?: boolean;
  };
  audioUrl?: string;
  durationEstimate?: number; // in seconds
}

export type VoiceName = 'Puck' | 'Kore' | 'Charon' | 'Fenrir' | 'Aoede' | 'Zephyr' | string;

export interface CharacterProfile {
  name: string;
  voice: VoiceName;
  gender?: 'male' | 'female' | 'neutral';
  accent: string;
  stylePrompt: string; // e.g., "Thoughtful, Quiet, American accent"
  color: string;
  isNarrator?: boolean;
  roleDescription?: string;
  avatarIcon?: string;
}

export interface GeminiTtsSpeakerConfig {
  speaker: string;
  voice: string;
}

export interface GeminiTtsAnnotation {
  type: 'speech_metadata';
  speaker: string;
  style: string;
}

export interface GeminiTtsContentItem {
  type: 'text';
  text: string;
  annotations: GeminiTtsAnnotation[];
}

export interface GeminiTtsTurnInput {
  type: 'user_input';
  content: GeminiTtsContentItem[];
}

export interface GeminiTtsPayload {
  model: string;
  input: GeminiTtsTurnInput[];
  response_format: {
    type: 'audio';
  };
  generation_config: {
    speech_config: {
      mode: 'conversational';
      speakers: GeminiTtsSpeakerConfig[];
    };
  };
}

// Backwards-compatible type aliases
export type SonicBoomSpeakerConfig = GeminiTtsSpeakerConfig;
export type SonicBoomAnnotation = GeminiTtsAnnotation;
export type SonicBoomContentItem = GeminiTtsContentItem;
export type SonicBoomTurnInput = GeminiTtsTurnInput;
export type SonicBoomPayload = GeminiTtsPayload;

export interface SynthesisTurnResult {
  id: string;
  turnIndex: number;
  speaker: string;
  text: string;
  style: string;
  audioBase64?: string;
  audioUrl?: string;
  duration: number; // seconds
}

export interface ScriptScene {
  id: string;
  title: string;
  elements: ScriptElement[];
  characters: string[];
}

export type NarrativeType = 'single' | 'two_character' | 'ensemble';

export interface AnalyzedCharacter {
  name: string;
  gender: 'male' | 'female';
  voice: string;
  accent: string;
  stylePrompt: string;
}

export interface ScriptAnalysisResult {
  narrativeType: NarrativeType;
  summary: string;
  characters: AnalyzedCharacter[];
  formattedScript: string;
  /** Set when the script's own |interjections| didn't survive formatting intact. */
  backchannelWarning?: string;
}
