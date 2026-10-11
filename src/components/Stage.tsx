import React from 'react';
import { CharacterProfile } from '../types';
import { stageColorFor } from '../utils/stageColors';
import { ThreeCharacterSegment } from './ThreeCharacterSegment';

interface StageProps {
  /** One or two performers. Anyone past the second doesn't fit the stage. */
  performers: CharacterProfile[];
  /** Who is making sound right now, by name — the listener, mid-interjection. */
  speakingName: string | null;
  /**
   * Whose line it is. The caption and its stage direction stay on them while
   * the listener drops an interjection in, since the direction is theirs.
   */
  lineOwner?: string | null;
  /** The line as written, captioned under whoever is speaking it. */
  currentLine?: string;
  /** How the live line is being read, shown over the caption. */
  directionLabel?: string;
  /** The interjection in flight, captioned on the listener rather than the speaker. */
  interjection: { speaker: string; text: string } | null;
  /** Whether audio playback is currently running */
  isPlaying?: boolean;
}

/**
 * The performers and nothing else. Every control that used to sit under them
 * lives in the transport now, so the stage is only ever the thing you watch.
 */
export const Stage: React.FC<StageProps> = ({
  performers,
  speakingName,
  lineOwner,
  currentLine,
  directionLabel,
  interjection,
  isPlaying,
}) => {
  const cast = performers.slice(0, 2);
  const solo = cast.length <= 1;

  const card = (character: CharacterProfile, order: number) => {
    const name = character.name.toUpperCase();
    const isTarget = (lineOwner ?? speakingName)?.toUpperCase() === name;
    const isInterjecting = interjection?.speaker.toUpperCase() === name;
    const isSpeaking = speakingName?.toUpperCase() === name && !!isPlaying;
    const gender = character.gender === 'female' ? 'female' : 'male';

    return (
      <ThreeCharacterSegment
        key={character.name}
        name={character.name}
        gender={gender}
        color={stageColorFor(character, order)}
        isSpeaking={isSpeaking}
        speechActivity={0}
        activeEmotion={isTarget ? directionLabel : undefined}
        dialogueText={isTarget ? currentLine : undefined}
        interjection={isInterjecting && !isTarget ? interjection?.text : undefined}
        statusLabel={
          isInterjecting && !isTarget
            ? 'Interjecting'
            : isTarget
            ? isPlaying
              ? 'Speaking'
              : 'Cue Ready'
            : 'Listening'
        }
      />
    );
  };

  return (
    /**
     * Fixed aspect until the layout goes two-column, where the stage instead
     * takes whatever height the transport and directions leave it. Holding an
     * aspect inside a height-capped row would overflow it.
     */
    <div
      id="stage"
      className={`grid gap-4 lg:flex-1 lg:min-h-0 ${
        solo ? 'grid-cols-1 max-w-md mx-auto w-full' : 'grid-cols-1 sm:grid-cols-2'
      }`}
    >
      {cast.map((character, order) => (
        <div
          key={character.name}
          className="min-h-0 aspect-[5/4] sm:aspect-square lg:aspect-auto"
        >
          {card(character, order)}
        </div>
      ))}
    </div>
  );
};
