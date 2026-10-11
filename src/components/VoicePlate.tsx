import React from 'react';
import { CharacterProfile, ScriptElement } from '../types';
import { Direction } from '../utils/directions';
import { PRESET_VOICES, resolveTurnStyle } from '../utils/screenplayParser';
import { stageColorFor } from '../utils/stageColors';

interface VoicePlateProps {
  /** The same one or two performers the stage is showing, in the same order. */
  performers: CharacterProfile[];
  direction: Direction;
  /** The line under the playhead. Its cue belongs to whoever speaks it. */
  liveTurn?: ScriptElement;
  speakingName: string | null;
}

/** What the voice itself sounds like, before anyone directs it. */
function traitFor(voice: string): string | undefined {
  return PRESET_VOICES.find((v) => v.id === voice)?.trait;
}

/** A turn with nothing particular about it, for the standing style. */
const STANDING: ScriptElement = { id: 'standing', type: 'dialogue', raw: '' };

/**
 * The credit under the stage: who each performer is as a voice, and the exact
 * `speech_metadata.style` going to the model for them right now.
 *
 * It is set in mono at reading size rather than as a caption on purpose. The
 * string is the demo — the words on the page never change, so the only visible
 * evidence that a direction did anything is this line changing under it.
 */
export const VoicePlate: React.FC<VoicePlateProps> = ({
  performers,
  direction,
  liveTurn,
  speakingName,
}) => {
  const cast = performers.slice(0, 2);
  const solo = cast.length <= 1;

  return (
    <div id="voice-plate" className="shrink-0">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1.5">
        <span className="label-meta text-ink-soft">
          Reading as · {direction.name}
        </span>
        <span className="label-meta text-ink-soft">
          sent as speech_metadata.style
        </span>
      </div>

      <div
        className={`grid gap-4 ${
          solo ? 'grid-cols-1 max-w-md mx-auto w-full' : 'grid-cols-1 sm:grid-cols-2'
        }`}
      >
        {cast.map((performer, order) => {
          const upper = performer.name.toUpperCase();
          const isSpeaking = speakingName?.toUpperCase() === upper;
          // Cues are indexed by position in the scene rather than by speaker,
          // so only whoever holds the line under the playhead is shown its
          // cue — and they are shown it paused as well as mid-line, or the
          // plate would sit on a half-string until something played.
          const onThisLine = liveTurn?.character?.toUpperCase() === upper;
          const style = resolveTurnStyle(
            onThisLine && liveTurn ? liveTurn : STANDING,
            performer,
            direction
          );
          const trait = traitFor(performer.voice);

          return (
            <div
              key={performer.name}
              id={`voice-plate-${performer.name}`}
              className={`border border-l-4 px-3 py-2 ${
                isSpeaking ? 'border-ink bg-paper-tint' : 'border-rule'
              }`}
              style={{ borderLeftColor: stageColorFor(performer, order) }}
            >
              <div className="font-display text-[13px] uppercase tracking-[-0.01em] text-ink">
                {performer.name}
              </div>
              <div className="label-meta text-ink-soft truncate mt-0.5">
                {[performer.voice, trait, performer.accent].filter(Boolean).join(' · ')}
              </div>

              <p className="font-mono text-[13px] leading-snug text-ink mt-1.5">{style}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
};
