import { CharacterProfile, ScriptElement, GeminiTtsPayload, SonicBoomPayload } from '../types';
import { Direction } from './directions';

// Extended voice library for gemini-3.8-flash-tts & Gemini speech models
export const PRESET_VOICES = [
  // Original canonical named voices
  { id: 'Puck', name: 'Puck', gender: 'male', trait: 'Engaging, versatile, warm baritone' },
  { id: 'Kore', name: 'Kore', gender: 'female', trait: 'Expressive, clear, poised alto' },
  { id: 'Charon', name: 'Charon', gender: 'male', trait: 'Deep, resonant, dramatic bass' },
  { id: 'Fenrir', name: 'Fenrir', gender: 'male', trait: 'Gritty, intense, textured baritone' },
  { id: 'Aoede', name: 'Aoede', gender: 'female', trait: 'Melodic, dynamic, emotional soprano' },
  { id: 'Zephyr', name: 'Zephyr', gender: 'neutral', trait: 'Airy, modern, articulate narrator' },

  // Extended Gemini TTS voice library (verified live on models/gemini-3.8-flash-tts)
  { id: 'Orus', name: 'Orus', gender: 'male', trait: 'Commanding, powerful, authoritative baritone' },
  { id: 'Leda', name: 'Leda', gender: 'female', trait: 'Warm, gentle, empathetic alto' },
  { id: 'Iapetus', name: 'Iapetus', gender: 'male', trait: 'Mature, rich, grounded bass' },
  { id: 'Vega', name: 'Vega', gender: 'female', trait: 'Bright, youthful, energetic soprano' },
  { id: 'Capella', name: 'Capella', gender: 'female', trait: 'Crisp, measured, polished mezzo' },
  { id: 'Achernar', name: 'Achernar', gender: 'male', trait: 'Clear, thoughtful, intimate tenor' },
  { id: 'Achird', name: 'Achird', gender: 'male', trait: 'Steady, conversational, friendly baritone' },
  { id: 'Polaris', name: 'Polaris', gender: 'neutral', trait: 'Firm, precise, cinematic narrator' },
];

const CHARACTER_COLORS = [
  '#f59e0b', // amber
  '#38bdf8', // sky
  '#ec4899', // pink
  '#10b981', // emerald
  '#a855f7', // purple
  '#f97316', // orange
  '#06b6d4', // cyan
  '#e11d48', // rose
];

function cleanCharName(raw: string): string {
  return raw
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/:$/, '')
    .trim()
    .toUpperCase();
}

export function parseScreenplay(rawText: string): {
  elements: ScriptElement[];
  characters: string[];
} {
  const lines = rawText.split(/\r?\n/);
  const elements: ScriptElement[] = [];
  const characterSet = new Set<string>();

  let currentCharacter: string | null = null;
  let currentParenthetical: string | null = null;
  let currentParenLine: number | null = null;
  let accumulatedDialogue: string[] = [];
  let textStartLine = 0;
  let inlineCue = false;
  let turnCounter = 0;

  function setParenthetical(text: string | null, line: number | null) {
    currentParenthetical = text;
    currentParenLine = text ? line : null;
  }

  function addDialogue(text: string, line: number) {
    if (accumulatedDialogue.length === 0) textStartLine = line;
    accumulatedDialogue.push(text);
  }

  function flushDialogue() {
    if (currentCharacter && accumulatedDialogue.length > 0) {
      const fullText = accumulatedDialogue.join(' ').trim();
      if (fullText) {
        // Extract vocal tags <...>
        const vocalTagMatches = fullText.match(/<[^>]+>/g) || [];
        // Extract backchanneling |...|
        const backchannelMatches = fullText.match(/\|[^|]+\|/g) || [];

        // Estimate duration based on word count (~140 wpm = ~2.3 words/sec) + pause for tags
        const words = fullText.split(/\s+/).length;
        const tagTime = vocalTagMatches.length * 0.75;
        const durationEst = Math.max(1.5, words / 2.3 + tagTime);

        elements.push({
          id: `elem-${elements.length}-${Date.now()}`,
          type: 'dialogue',
          raw: fullText,
          character: currentCharacter,
          parenthetical: currentParenthetical || undefined,
          text: fullText,
          style: currentParenthetical || undefined,
          vocalTags: vocalTagMatches,
          backchannels: backchannelMatches,
          turnIndex: turnCounter++,
          source: {
            textLine: textStartLine,
            directionLine: currentParenLine ?? undefined,
            inlineCue: inlineCue || undefined,
          },
          durationEstimate: parseFloat(durationEst.toFixed(1)),
        });
      }
      accumulatedDialogue = [];
      inlineCue = false;
      setParenthetical(null, null);
    }
  }

  const sceneHeadingRegex = /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.|SCENE\b)/i;
  const transitionRegex = /^(FADE IN:|FADE OUT\.|CUT TO:|DISSOLVE TO:|SMASH CUT:|MATCH CUT:|JUMP CUT TO:|TIME CUT:|BACK TO SCENE:|IRIS IN:|IRIS OUT:|\b[A-Z0-9_]+\s+TO:)/i;
  const ignoreColonPrefixes = /^(NOTE|SCENE|ACT|PROLOGUE|EPILOGUE|TIME|SETTING|PLACE|DISCLAIMER):/i;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      flushDialogue();
      // Keep currentCharacter active so subsequent paragraphs or words added after
      // continue as regular dialogue for the active speaker.
      setParenthetical(null, null);
      continue;
    }

    // 1. Scene heading (INT. / EXT. / SCENE)
    if (sceneHeadingRegex.test(trimmed)) {
      flushDialogue();
      currentCharacter = null;
      setParenthetical(null, null);
      elements.push({
        id: `elem-${elements.length}-${Date.now()}`,
        type: 'scene_heading',
        raw: trimmed,
        text: trimmed,
      });
      continue;
    }

    // 2. Transition (explicit film transitions like CUT TO:, FADE OUT.)
    if (transitionRegex.test(trimmed)) {
      flushDialogue();
      currentCharacter = null;
      setParenthetical(null, null);
      elements.push({
        id: `elem-${elements.length}-${Date.now()}`,
        type: 'transition',
        raw: trimmed,
        text: trimmed,
      });
      continue;
    }

    // 3. Explicit bracketed action: [The room goes quiet] or Action: ... / NOTE: ...
    const isExplicitAction =
      (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      /^Action:\s*(.+)$/i.test(trimmed) ||
      /^NOTE:\s*(.+)$/i.test(trimmed);

    if (isExplicitAction) {
      flushDialogue();
      const actionText = trimmed.replace(/^(Action|NOTE):\s*/i, '').replace(/^\[|\]$/g, '').trim();
      elements.push({
        id: `elem-${elements.length}-${Date.now()}`,
        type: 'action',
        raw: trimmed,
        text: actionText,
      });
      continue;
    }

    // 4. Inline Dialogue with Speaker Prefix: "Speaker: Dialogue" or "Speaker (Paren): Dialogue"
    const inlineColonMatch =
      !ignoreColonPrefixes.test(trimmed) &&
      trimmed.match(/^([A-Za-z0-9_\s.'\u2019-]{2,30}?)(?:\s*\(([^)]+)\))?:\s*(.+)$/);
    if (inlineColonMatch) {
      const candidateName = inlineColonMatch[1].trim();
      const parentheticalInside = inlineColonMatch[2]?.trim();
      const dialogueText = inlineColonMatch[3].trim();

      if (candidateName.length <= 25 && !sceneHeadingRegex.test(candidateName)) {
        flushDialogue();
        const cleanName = cleanCharName(candidateName);
        currentCharacter = cleanName;
        setParenthetical(parentheticalInside || null, i);
        characterSet.add(cleanName);

        elements.push({
          id: `elem-${elements.length}-${Date.now()}`,
          type: 'character',
          raw: candidateName,
          character: cleanName,
          text: cleanName,
        });

        if (parentheticalInside) {
          elements.push({
            id: `elem-${elements.length}-${Date.now()}`,
            type: 'parenthetical',
            raw: `(${parentheticalInside})`,
            character: cleanName,
            text: parentheticalInside,
          });
        }

        addDialogue(dialogueText, i);
        inlineCue = true;
        continue;
      }
    }

    // 5. Standalone Parenthetical: "(whispering softly)" or "(beat)"
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
      const cleanParenthetical = trimmed.slice(1, -1).trim();
      if (currentCharacter) {
        if (accumulatedDialogue.length > 0) {
          flushDialogue();
        }
        setParenthetical(cleanParenthetical, i);
        elements.push({
          id: `elem-${elements.length}-${Date.now()}`,
          type: 'parenthetical',
          raw: trimmed,
          character: currentCharacter,
          text: cleanParenthetical,
        });
        continue;
      }
    }

    // 6. Parenthetical leading dialogue on same line: "(wistful) You know I did."
    const leadParenMatch = trimmed.match(/^\(([^)]+)\)\s*(.+)$/);
    if (leadParenMatch && currentCharacter) {
      if (accumulatedDialogue.length > 0) {
        flushDialogue();
      }
      setParenthetical(leadParenMatch[1].trim(), i);
      elements.push({
        id: `elem-${elements.length}-${Date.now()}`,
        type: 'parenthetical',
        raw: `(${leadParenMatch[1]})`,
        character: currentCharacter,
        text: leadParenMatch[1].trim(),
      });
      addDialogue(leadParenMatch[2].trim(), i);
      continue;
    }

    // 7. Standalone Character Cue on own line
    // Standard screenplay format requires character cues to be ALL-CAPS (e.g. "OFFICER VANCE", "DR. ARLO", "ALEX (V.O.)")
    // OR explicitly ending with a colon (e.g. "Officer Vance:", "Sugarplum:")
    // OR an exact match to a character already recognized in this script.
    //
    // CRITICAL: We NEVER treat ordinary Title Case words (like "Sugarplum", "Hello") as characters!
    const endsWithColon = trimmed.endsWith(':');
    const cueMatch = trimmed.match(/^([A-Za-z0-9_\s.'\u2019-]{2,30}?)(?:\s*\(([^)]+)\))?:?$/);

    let isCharacterCue = false;
    let charNameCandidate = '';
    let parenCueCandidate: string | undefined = undefined;

    if (
      cueMatch &&
      trimmed.length <= 35 &&
      !sceneHeadingRegex.test(trimmed) &&
      !transitionRegex.test(trimmed) &&
      !ignoreColonPrefixes.test(trimmed)
    ) {
      const rawChar = cueMatch[1].trim();
      const parenCue = cueMatch[2]?.trim();
      const lettersOnly = rawChar.replace(/[^A-Za-z]/g, '');

      // Check 1: Explicit colon at end of line (e.g. "Sugarplum:", "Officer Vance:")
      const isExplicitColon = endsWithColon;

      // Check 2: ALL CAPS screenplay cue (e.g. "OFFICER VANCE", "DR. ARLO")
      // Must contain at least 2 letters, all uppercase, with NO lowercase letters in the name
      const isAllCapsCue =
        lettersOnly.length >= 2 &&
        lettersOnly === lettersOnly.toUpperCase() &&
        !/[a-z]/.test(rawChar) &&
        !/[.!?]$/.test(rawChar);

      // Check 3: Known already-established character in this script
      const cleanCandidate = cleanCharName(rawChar);
      const isKnownCharacter =
        characterSet.size > 0 &&
        characterSet.has(cleanCandidate) &&
        !/[.!?]$/.test(rawChar);

      if (isExplicitColon || isAllCapsCue || isKnownCharacter) {
        isCharacterCue = true;
        charNameCandidate = cleanCandidate;
        parenCueCandidate = parenCue;
      }
    }

    if (isCharacterCue && charNameCandidate) {
      flushDialogue();
      currentCharacter = charNameCandidate;
      setParenthetical(parenCueCandidate || null, i);
      characterSet.add(charNameCandidate);

      elements.push({
        id: `elem-${elements.length}-${Date.now()}`,
        type: 'character',
        raw: trimmed,
        character: charNameCandidate,
        text: charNameCandidate,
      });

      if (parenCueCandidate) {
        elements.push({
          id: `elem-${elements.length}-${Date.now()}`,
          type: 'parenthetical',
          raw: `(${parenCueCandidate})`,
          character: charNameCandidate,
          text: parenCueCandidate,
        });
      }
      continue;
    }

    // 8. Regular Dialogue (or Action if before any character cue in a fresh scene)
    // The user's directive: "always keep it regular dialogue unless mentioned otherwise"
    if (currentCharacter) {
      addDialogue(trimmed, i);
    } else {
      // If we are before any character has spoken in the scene:
      // If the script contains scene headings, initial lines before a speaker are action description.
      // But if there are no scene headings or no character defined yet, default to SPEAKER 1 as regular dialogue!
      const hasSceneHeadings = sceneHeadingRegex.test(rawText);
      if (hasSceneHeadings) {
        elements.push({
          id: `elem-${elements.length}-${Date.now()}`,
          type: 'action',
          raw: trimmed,
          text: trimmed,
        });
      } else {
        // Plain dialogue script without headers: keep as regular dialogue under default speaker!
        currentCharacter = 'SPEAKER 1';
        characterSet.add('SPEAKER 1');
        addDialogue(trimmed, i);
      }
    }
  }

  // Final flush
  flushDialogue();

  return {
    elements,
    characters: Array.from(characterSet),
  };
}

/** A direction as it can sit inside one (parenthetical) on one line. */
export function cleanDirection(text: string): string {
  return text.replace(/[()\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Writes per-line stage directions back into the raw script, keyed by turn
 * index, so the script stays the one source of truth. An empty string removes
 * a line's direction. Only the parentheticals move: the spoken words and the
 * order of turns are left exactly as they were, so the re-parsed script has
 * the same turns in the same places.
 */
export function writeDirections(
  rawText: string,
  elements: ScriptElement[],
  edits: Record<number, string>
): string {
  const lines = rawText.split(/\r?\n/);

  // Bottom up, so lines inserted or removed for one turn never shift the
  // positions recorded for the turns above it.
  const targets = elements
    .filter(
      (e) =>
        e.type === 'dialogue' &&
        e.source &&
        e.turnIndex !== undefined &&
        edits[e.turnIndex] !== undefined
    )
    .sort((a, b) => (b.turnIndex as number) - (a.turnIndex as number));

  for (const turn of targets) {
    const next = cleanDirection(edits[turn.turnIndex as number]);
    const { textLine, directionLine, inlineCue } = turn.source!;
    if (next === cleanDirection(turn.parenthetical ?? '')) continue;

    if (directionLine !== undefined) {
      const line = lines[directionLine];
      const indent = line.match(/^\s*/)?.[0] ?? '';
      const trimmed = line.trim();

      if (next) {
        lines[directionLine] = line.replace(/\([^)]*\)/, `(${next})`);
      } else if (/^\([^)]*\)$/.test(trimmed)) {
        lines.splice(directionLine, 1);
      } else {
        lines[directionLine] = indent + trimmed.replace(/\s*\([^)]*\)/, '').trimStart();
      }
      continue;
    }

    if (!next) continue;

    if (inlineCue) {
      lines[textLine] = lines[textLine].replace(/^(\s*[^:(]+?)\s*:/, `$1 (${next}):`);
    } else {
      const indent = lines[textLine].match(/^\s*/)?.[0] ?? '';
      lines.splice(textLine, 0, `${indent}(${next})`);
    }
  }

  return lines.join('\n');
}

/**
 * The characters the app ships scenes for, cast on purpose rather than by
 * where they happen to fall in the script.
 *
 * The sample scene is a two-hander between someone who has decided this is an
 * emergency and someone who has decided it isn't, so the pair is designed as a
 * pair: a tight, high tenor against a low, unhurried mezzo, and delivery notes
 * that pull in opposite directions. Both are American — the scene is, and the
 * voices are far enough apart that they don't need an accent to tell them
 * apart.
 */
const DESIGNED_ROLES: Record<
  string,
  { gender: 'male' | 'female'; voice: string; accent: string; stylePrompt: string }
> = {
  elias: {
    gender: 'male',
    voice: 'Achernar', // clear, thoughtful, intimate tenor
    accent: 'American',
    stylePrompt: 'Tense, precise, hushed urgency, each word set down like evidence',
  },
  chloe: {
    gender: 'female',
    voice: 'Capella', // crisp, measured, polished mezzo
    accent: 'American',
    stylePrompt: 'Dry, unbothered, faintly amused, unhurried and low',
  },
  marcus: {
    gender: 'male',
    voice: 'Puck',
    accent: 'American',
    stylePrompt: 'Thoughtful, quiet, American accent',
  },
  sienna: {
    gender: 'female',
    voice: 'Kore',
    accent: 'British',
    stylePrompt: 'Wistful, dry chuckle, British accent',
  },
};

export function generateDefaultCast(
  characters: string[],
  includeNarrator: boolean = true,
  emptyStylePrompt: boolean = true
): Record<string, CharacterProfile> {
  const cast: Record<string, CharacterProfile> = {};

  const maleNames = ['marcus', 'cassian', 'leo', 'john', 'david', 'michael', 'alex', 'jack', 'peter', 'sam'];
  const femaleNames = ['sienna', 'eleanor', 'maya', 'bex', 'mary', 'sarah', 'claire', 'elena', 'anna', 'emma'];

  characters.forEach((charName, index) => {
    const lower = charName.toLowerCase();
    const designedKey = Object.keys(DESIGNED_ROLES).find((key) => lower.includes(key));
    const designed = designedKey ? DESIGNED_ROLES[designedKey] : undefined;

    let isMale = maleNames.some(m => lower.includes(m));
    let isFemale = femaleNames.some(f => lower.includes(f));

    if (designed) {
      isFemale = designed.gender === 'female';
      isMale = !isFemale;
    } else if (!isMale && !isFemale) {
      // Default alternating: index 0 is Male, index 1 is Female
      if (index % 2 === 0) {
        isMale = true;
      } else {
        isFemale = true;
      }
    }

    const gender: 'male' | 'female' = isFemale ? 'female' : 'male';
    const voice =
      designed?.voice ??
      (isFemale ? (index % 2 === 1 ? 'Kore' : 'Aoede') : (index % 2 === 0 ? 'Puck' : 'Charon'));
    const color = CHARACTER_COLORS[index % CHARACTER_COLORS.length];
    
    // Suggest stylistic traits based on common tropes or simple heuristic
    let suggestedStyle = designed?.stylePrompt ?? 'Natural acting delivery, clear pacing';
    const accent = designed?.accent ?? (isFemale ? 'British' : 'American');

    if (!designed) {
      if (index === 0) {
        suggestedStyle = 'Thoughtful, measured, subtle tension';
      } else if (index === 1) {
        suggestedStyle = 'Wistful, expressive, British accent';
      } else if (index === 2) {
        suggestedStyle = 'Energetic, fast-talking, playful';
      } else if (index === 3) {
        suggestedStyle = 'Deep, stoic, raspy baritone';
      }
    }

    cast[charName] = {
      name: charName,
      voice,
      gender,
      accent,
      stylePrompt: emptyStylePrompt ? '' : (designed?.stylePrompt ?? suggestedStyle),
      color,
      isNarrator: false,
      roleDescription: `${gender === 'female' ? 'Female' : 'Male'} Lead (${voice})`,
    };
  });

  if (includeNarrator && !cast['NARRATOR']) {
    cast['NARRATOR'] = {
      name: 'NARRATOR',
      voice: 'Zephyr',
      gender: 'neutral',
      accent: 'Mid-Atlantic',
      stylePrompt: emptyStylePrompt ? '' : 'Cinematic narrator, measured, descriptive stage directions',
      color: '#94a3b8',
      isNarrator: true,
      roleDescription: 'Voice for scene headings and action descriptions',
    };
  }

  return cast;
}

/**
 * Resolves the sustained direction for one turn: the parenthetical stacked on
 * top of the character's default delivery. This becomes `speech_metadata.style`
 * and must be identical in the payload and in the synthesis request.
 *
 * A `direction` carrying its own `style` overrides the delivery for the whole
 * scene, and may drop the script's own parentheticals along the way. One
 * without it leaves the cast's delivery standing and only lays its frame and
 * per-line cue on the end. The spoken text is untouched either way — reading
 * a scene a different way only ever means sending a different style with the
 * same words.
 */
export function resolveTurnStyle(
  elem: ScriptElement,
  profile?: CharacterProfile,
  direction?: Direction
): string {
  const rawScripted = (elem.parenthetical || elem.style)?.trim();
  const shouldKeepScripted = direction ? direction.keepScripted !== false : true;
  const scripted =
    shouldKeepScripted && rawScripted
      ? rawScripted.startsWith('(') && rawScripted.endsWith(')')
        ? rawScripted
        : `(${rawScripted})`
      : undefined;

  if (direction?.style && profile) {
    const baseStyle = direction.style(profile, elem.turnIndex);
    return [scripted, baseStyle].filter(Boolean).join(', ');
  }

  const accent = profile?.accent || (profile?.gender === 'female' ? 'British' : 'American');
  const own = profile?.stylePrompt?.trim();
  // Cast prompts routinely name the accent themselves, and saying it twice
  // reads as a stutter in the payload.
  let delivery: string | undefined;
  if (own) {
    delivery = own.toLowerCase().includes(accent.toLowerCase())
      ? own
      : `${accent} accent, ${own}`;
  } else {
    delivery = accent ? `${accent} accent` : undefined;
  }

  const cue =
    direction?.cues && elem.turnIndex !== undefined ? direction.cues[elem.turnIndex] : undefined;

  return [scripted, delivery, direction?.frame, cue].filter(Boolean).join(', ') || 'Natural acting delivery';
}

export interface SynthesisTurn {
  id: string;
  speaker: string;
  text: string;
  style: string;
  durationEstimate?: number;
}

/**
 * Flattens dialogue elements into the per-turn list sent to
 * /api/synthesize-table-read, keeping element ids so returned audio can be
 * matched back to the right line.
 */
export function buildSynthesisTurns(
  elements: ScriptElement[],
  cast: Record<string, CharacterProfile>,
  direction?: Direction
): SynthesisTurn[] {
  const turns: SynthesisTurn[] = [];

  for (const elem of elements) {
    if (elem.type !== 'dialogue' || !elem.character || !elem.text) continue;
    turns.push({
      id: elem.id,
      speaker: elem.character,
      text: elem.text,
      style: resolveTurnStyle(elem, cast[elem.character], direction),
      durationEstimate: elem.durationEstimate,
    });
  }

  return turns;
}

/**
 * Builds the exact Gemini TTS structured request payload
 * conforming to the gemini-3.8-flash-tts speech specification.
 */
export function buildGeminiTtsPayload(
  elements: ScriptElement[],
  cast: Record<string, CharacterProfile>,
  includeNarratorStageDirections: boolean = false,
  direction?: Direction
): GeminiTtsPayload {
  const speakersList: { speaker: string; voice: string }[] = [];
  const addedSpeakers = new Set<string>();

  // Extract speech turns
  const speechTurns: { speaker: string; text: string; style: string }[] = [];

  for (const elem of elements) {
    if (elem.type === 'dialogue' && elem.character && elem.text) {
      const charProfile = cast[elem.character];
      const speakerName = elem.character;
      const voiceName = charProfile?.voice || 'Puck';

      if (!addedSpeakers.has(speakerName)) {
        speakersList.push({ speaker: speakerName, voice: voiceName });
        addedSpeakers.add(speakerName);
      }

      speechTurns.push({
        speaker: speakerName,
        text: elem.text,
        style: resolveTurnStyle(elem, charProfile, direction),
      });
    } else if (
      includeNarratorStageDirections && 
      (elem.type === 'scene_heading' || elem.type === 'action') && 
      elem.text
    ) {
      const speakerName = 'NARRATOR';
      const voiceName = cast['NARRATOR']?.voice || 'Zephyr';

      if (!addedSpeakers.has(speakerName)) {
        speakersList.push({ speaker: speakerName, voice: voiceName });
        addedSpeakers.add(speakerName);
      }

      speechTurns.push({
        speaker: speakerName,
        text: elem.type === 'scene_heading' ? `Scene heading: ${elem.text}` : elem.text,
        style: cast['NARRATOR']?.stylePrompt || 'Measured, descriptive scene action',
      });
    }
  }

  // Build the structured content item annotations
  const contentItems = speechTurns.map(turn => ({
    type: 'text' as const,
    text: turn.text,
    annotations: [
      {
        type: 'speech_metadata' as const,
        speaker: turn.speaker,
        style: turn.style,
      }
    ]
  }));

  return {
    model: 'gemini-3.8-flash-tts',
    input: [
      {
        type: 'user_input',
        content: contentItems,
      }
    ],
    response_format: {
      type: 'audio',
    },
    generation_config: {
      speech_config: {
        mode: 'conversational',
        speakers: speakersList,
      },
    },
  };
}

/** Backwards-compatible payload builder alias. */
export const buildSonicBoomPayload = buildGeminiTtsPayload;
