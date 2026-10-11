import { CharacterProfile } from '../types';

/** The two lights the stage has: one cyclorama each. */
const STAGE_BLUE = 'var(--color-stage-blue, #7dd3fc)';
const STAGE_YELLOW = 'var(--color-stage-yellow, #fde68a)';

/**
 * Which colour a performer is lit in, and the one thing that decides it.
 *
 * The stage lights the man's cyclorama blue and the woman's yellow, so the
 * script and the plate read off this rather than the profile's own `color`,
 * which belongs to a different palette and is only ever the initials swatch
 * in the cast panel.
 *
 * `order` is where the performer comes in the scene. The stage seats two, so
 * a third speaker gets their cast colour instead of a repeat of one of these.
 */
export function stageColorFor(profile?: CharacterProfile, order = 0): string {
  if (order > 1 && profile?.color) return profile.color;
  return profile?.gender === 'female' ? STAGE_YELLOW : STAGE_BLUE;
}

/**
 * The same colour dropped to a wash, for a background 12px mono still reads
 * on. These are stage lights rather than inks, so anything drawn with them
 * has to be wide enough to carry: a butter yellow hairline is no hairline.
 */
export function stageWash(color: string): string {
  if (color.startsWith('var(')) {
    return `color-mix(in srgb, ${color} 25%, transparent)`;
  }
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}3d` : color;
}
