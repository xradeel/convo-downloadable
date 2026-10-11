import { CharacterProfile } from '../types';

/**
 * A way of reading the scene.
 *
 * The script is never rewritten between directions — not a word of it. All
 * that changes is the sustained `speech_metadata.style` each line is
 * synthesized under, which is the thing the demo is actually about.
 */
export interface Direction {
  id: string;
  /** What the chip says. */
  name: string;
  /** One line on what this does to the read, shown under the stage. */
  note: string;
  /** Tone & Energy description */
  toneAndEnergy?: string;
  /** Specific per-line cues for the scene */
  cues?: string[];
  /** 24 normalized amplitudes driving the audio visualizer */
  wave?: number[];
  /**
   * Replaces every performer's own delivery. Left off, the cast's own
   * delivery stands and the direction only lays `frame` and its cues over it.
   */
  style?: (character: CharacterProfile, turnIndex?: number) => string;
  /**
   * How the scene is played, for a direction that keeps the cast's delivery.
   * Sent after that delivery rather than in place of it.
   */
  frame?: string;
  /** Whether the script's own (parentheticals) still apply on top. */
  keepScripted: boolean;
}

/**
 * A note per line, indexed by the line's turn in the scene. These track the
 * beats of the sample scene — the standoff over the container, the struggle,
 * the thud, the retreat — so a direction gives each turn its own reading
 * rather than the same adjective twenty-seven times. A scene longer than the
 * list simply runs out of notes and keeps the direction's standing style.
 */
const naturalisticCues = [
  'low, not turning round',
  'mouth full, unhurried',
  'flat and factual',
  'wary, slowing right down',
  'defensive, half an excuse',
  'squinting, working it out',
  'three flat words',
  'the arithmetic landing',
  'building a case, reasonably',
  'lightly, nothing to hide',
  'precise, quietly wounded',
  'a shrug and nothing more',
  'level, entirely sincere',
  'brightening, leaning in',
  'real alarm, kept quiet',
  'reasonable, coaxing',
  'quiet, immovable',
  'dry, hand already out',
  'sharp, protective',
  'matter of fact, no boast',
  'one word, torn out of him',
  'after a beat, small',
  'barely audible',
  'brisk, moving on',
  "small, doing as he's told",
  'calm, step by step',
  'relieved, already going',
];

const heightenedCues = [
  'a warning to the whole building',
  'grandly bored',
  'announcing a catastrophe',
  'invoking forbidden ground',
  'the confession of a brave man',
  'dawning, operatic',
  'tolling it like a bell',
  'appalled by the calendar',
  'the prosecution rests',
  'wounded innocence, hand on heart',
  'a speech in defence of labels',
  'tossing out a theory, airily',
  'prophetic, aghast',
  'delighted, cruel',
  'declaiming, arms wide',
  'the voice of sweet reason',
  'planting a flag on the hill',
  'one devastating word',
  'barring the way',
  'boasting of her credentials',
  'a cry to the gods',
  'hushed, disbelieving',
  'the verdict, whispered',
  'taking command of the room',
  'a small voice in a large scene',
  'laying out the evacuation',
  'exiting on a vow',
];

const underplayedCues = [
  'barely over the fridge hum',
  'not looking up',
  'reading out a memo',
  'mildly, no alarm',
  'as a matter of record',
  'no particular interest',
  'flat, three beats',
  'stating the month',
  'evenly, no heat in it',
  'unbothered',
  'listing facts',
  'almost a shrug',
  'plainly, no emphasis',
  'faintly curious',
  'refusing, quietly',
  'reasonable, uninflected',
  'not moving an inch',
  'tossed away',
  'clipped and low',
  'no boast in it at all',
  'said, not shouted',
  'asking about the weather',
  'half to himself',
  'no ceremony',
  'small, flat',
  'itemised',
  'already halfway out',
];

const franticCues = [
  'an urgent whisper, at speed',
  'talking straight over him',
  'no breath at all',
  'fast, cutting in',
  'gabbling the excuse',
  'quick, alarmed',
  'snapped out',
  'stacked, no pause',
  'firing the questions',
  'straight back at him',
  'the whole list in one go',
  'thrown in over him',
  'racing the logic',
  'already reaching for it',
  'shouting through the panic',
  'overlapping, insistent',
  'clipped, no room left',
  'grabbing at it',
  'shouted, fast',
  'hardly a pause for air',
  'ripped out at full volume',
  'no air left in her',
  'winded, quick',
  'already on the next thing',
  'fast and small',
  'rattling off the plan',
  'gone before the line ends',
];

export const DIRECTIONS: Direction[] = [
  {
    id: 'naturalistic',
    name: 'Naturalistic',
    note: 'Played straight. Real people in a real kitchen. Pauses land where they would land in life, and nobody is performing for the room.',
    toneAndEnergy: 'Grounded, conversational, organic timing. Lower-to-moderate dynamic range.',
    cues: naturalisticCues,
    wave: [.22, .48, .72, .55, .3, .26, .68, .74, .44, .5, .62, .4, .34, .2, .36, .7, .66, .38, .72, .28, .42, .46, .3, .18],
    keepScripted: true,
    // No `style`: playing it straight means the cast's own delivery, the one
    // designed in the cast panel, with only the frame and cues on top.
    frame: 'played straight, grounded, conversational',
  },
  {
    id: 'heightened',
    name: 'Heightened',
    note: 'Pitched up a register. Everything matters more than it should. The container is a hostage, the bottom shelf is a war zone, and both of them know it.',
    toneAndEnergy: 'Theatrical, dramatic, high stakes, full of grand gestures and exaggerated vocal peaks.',
    cues: heightenedCues,
    wave: [.3, .72, 1, .64, .4, .34, .92, 1, .58, .7, .86, .52, .44, .26, .5, .96, .88, .46, 1, .36, .6, .64, .4, .24],
    keepScripted: true,
    style: (c, turnIndex) => {
      const cue = turnIndex !== undefined && turnIndex >= 0 ? heightenedCues[turnIndex] : undefined;
      return `${c.accent} accent, heightened dramatic delivery, theatrical projection, high stakes${cue ? `, ${cue}` : ''}`;
    },
  },
  {
    id: 'underplayed',
    name: 'Underplayed',
    note: 'Thrown away. The funnier the line, the less either of them sells it. Nothing is allowed to land on the nose.',
    toneAndEnergy: 'Deadpan, low energy, understated, minimal vocal inflection, flat dynamic waveform.',
    cues: underplayedCues,
    wave: [.16, .3, .4, .32, .22, .2, .38, .42, .28, .3, .36, .26, .24, .15, .24, .4, .38, .25, .41, .2, .27, .29, .21, .14],
    keepScripted: true,
    style: (c, turnIndex) => {
      const cue = turnIndex !== undefined && turnIndex >= 0 ? underplayedCues[turnIndex] : undefined;
      return `${c.accent} accent, utterly deadpan, flat affect, unhurried, understated${cue ? `, ${cue}` : ''}`;
    },
  },
  {
    id: 'frantic',
    name: 'Frantic',
    note: 'No air in it. They are talking over the ends of each other’s lines, the thing in the tongs is getting heavier, and neither of them will be the one to stop.',
    toneAndEnergy: 'Rapid-fire, overlapping, anxious, breathless, and sustained high audio intensity throughout.',
    cues: franticCues,
    wave: [.5, .9, .7, .95, .62, .86, .74, .98, .66, .9, .58, .88, .7, .94, .6, .84, .76, .92, .64, .88, .72, .8, .56, .6],
    keepScripted: true,
    style: (c, turnIndex) => {
      const cue = turnIndex !== undefined && turnIndex >= 0 ? franticCues[turnIndex] : undefined;
      return `${c.accent} accent, frantic rapid-fire delivery, rushed, breathless${cue ? `, ${cue}` : ''}`;
    },
  },
];

export const DEFAULT_DIRECTION = DIRECTIONS[0];

export function directionById(id: string): Direction {
  return DIRECTIONS.find((d) => d.id === id) ?? DEFAULT_DIRECTION;
}
