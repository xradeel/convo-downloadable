import React from 'react';
import { Play } from 'lucide-react';
import { CharacterProfile } from '../types';
import { PRESET_VOICES } from '../utils/screenplayParser';

interface CastStudioProps {
  cast: Record<string, CharacterProfile>;
  onUpdateCastMember: (name: string, updated: Partial<CharacterProfile>) => void;
  onAuditionVoice: (name: string) => void;
  auditioningCharacter: string | null;
  /**
   * `studio` is the full drawer panel. `panel` is the same fields in a column
   * beside the stage: no frame of its own, and stacked rather than paired,
   * since the breakpoints can't see how narrow the column is.
   */
  variant?: 'studio' | 'panel';
}

const ACCENT_OPTIONS = [
  'American (General)',
  'American (Southern)',
  'American (New York)',
  'British (RP)',
  'British (Cockney)',
  'Irish',
  'Scottish',
  'Transatlantic',
  'Australian',
  'French Accent',
  'Neutral International',
];

const PRESET_STYLES = [
  'Thoughtful, Quiet, American accent',
  'Wistful, British accent',
  'Authoritative, crisp delivery',
  'Whispering with a nervous tone',
  'Energetic, fast-talking, playful',
  'Low, raspy, world-weary tone',
  'Deadpan, sarcastic, measured pace',
  'Warm, melodic, gentle cadence',
];

export const CastStudio: React.FC<CastStudioProps> = ({
  cast,
  onUpdateCastMember,
  onAuditionVoice,
  auditioningCharacter,
  variant = 'studio',
}) => {
  const characters = Object.keys(cast);
  const isPanel = variant === 'panel';

  return (
    <div
      id="cast-studio-container"
      className={
        isPanel
          ? 'flex flex-col'
          : 'flex flex-col h-full bg-paper border border-rule overflow-hidden'
      }
    >
      {/* Subheader */}
      {!isPanel && (
        <div className="px-4 py-3 bg-paper-tint border-b border-rule flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-display text-base leading-tight text-ink">
              Voice casting &amp; character ensembles
            </h2>
            <p className="text-xs text-ink-soft mt-1 max-w-lg leading-relaxed">
              Map each character role to dedicated voices with regional accents and delivery styles.
            </p>
          </div>
          <div className="label-meta text-ink border border-rule bg-paper px-2.5 py-1">
            {characters.length} roles assigned
          </div>
        </div>
      )}

      {/* Cast Cards Grid */}
      <div
        className={
          isPanel ? 'p-4 space-y-3' : 'flex-1 p-3 sm:p-4 lg:p-6 overflow-y-auto space-y-4'
        }
      >
        {characters.map((charName) => {
          const profile = cast[charName];
          const isAuditioning = auditioningCharacter === charName;

          return (
            <div
              key={charName}
              id={`cast-card-${charName}`}
              className="bg-paper border border-rule p-3 sm:p-4 transition hover:border-ink relative group"
            >
              {/* Header row: Character name, color picker, audition button */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-rule">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-8 h-8 border border-ink flex items-center justify-center font-mono font-bold text-ink text-xs shrink-0"
                    style={{ backgroundColor: profile.color }}
                  >
                    {charName.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm text-ink tracking-wide">
                      {charName}
                      {profile.isNarrator && (
                        <span className="ml-2 label-meta font-normal px-2 py-0.5 rounded-full bg-paper-tint text-ink-soft border border-rule">
                          Narrator / stage action
                        </span>
                      )}
                    </h3>
                    <p className="text-[11px] text-ink-soft mt-0.5">
                      {profile.roleDescription || 'Cast character'}
                    </p>
                  </div>
                </div>

                {/* Audition Button */}
                <button
                  onClick={() => onAuditionVoice(charName)}
                  disabled={isAuditioning}
                  className="btn-rule btn-rule-hover label-meta px-3 py-1.5 disabled:opacity-40"
                  title="Audition line for this character"
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>{isAuditioning ? 'Auditioning...' : 'Audition voice'}</span>
                </button>
              </div>

              {/* Grid of settings: Voice, Accent, Style prompt */}
              <div
                className={`grid grid-cols-1 gap-3 text-xs ${isPanel ? '' : 'md:grid-cols-2'}`}
              >
                {/* Voice Selection */}
                <div>
                  <label className="block label-meta text-ink-soft mb-1.5">
                    Assigned voice
                  </label>
                  <select
                    value={profile.voice}
                    onChange={(e) => onUpdateCastMember(charName, { voice: e.target.value })}
                    className="w-full border border-rule bg-paper p-2 text-ink focus:border-ink focus:outline-none cursor-pointer"
                  >
                    {PRESET_VOICES.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({v.trait})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Accent Selection */}
                <div>
                  <label className="block label-meta text-ink-soft mb-1.5">
                    Accent / dialect
                  </label>
                  <select
                    value={profile.accent}
                    onChange={(e) => onUpdateCastMember(charName, { accent: e.target.value })}
                    className="w-full border border-rule bg-paper p-2 text-ink focus:border-ink focus:outline-none cursor-pointer"
                  >
                    {ACCENT_OPTIONS.map((acc) => (
                      <option key={acc} value={acc}>
                        {acc}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Sustained Direction / Style Prompt */}
                <div className={isPanel ? '' : 'md:col-span-2'}>
                  <div className="flex flex-wrap items-center justify-between gap-1 mb-1.5">
                    <label className="label-meta text-ink-soft">
                      {isPanel
                        ? 'Sustained direction / style'
                        : 'Sustained direction / style (speech_metadata)'}
                    </label>
                    <span className="label-meta text-ink-soft/80">
                      {isPanel
                        ? 'Describe delivery in natural language'
                        : 'Read under Naturalistic · replaced by the other directions'}
                    </span>
                  </div>
                  {/* The string itself is the voice design, so in the column it
                      gets the room to be read rather than a line to clip on. */}
                  {isPanel ? (
                    <textarea
                      rows={3}
                      value={profile.stylePrompt}
                      onChange={(e) =>
                        onUpdateCastMember(charName, { stylePrompt: e.target.value })
                      }
                      placeholder="Describe delivery in natural language (e.g., quiet, tense whisper, unhurried, breathless...)"
                      className="w-full border border-rule bg-paper p-2 text-ink focus:border-ink focus:outline-none font-sans text-xs leading-snug resize-none placeholder:text-ink-soft/70"
                    />
                  ) : (
                    <input
                      type="text"
                      value={profile.stylePrompt}
                      onChange={(e) =>
                        onUpdateCastMember(charName, { stylePrompt: e.target.value })
                      }
                      placeholder="Describe delivery in natural language (e.g., quiet, tense whisper, unhurried, breathless...)"
                      className="w-full border border-rule bg-paper p-2 text-ink focus:border-ink focus:outline-none font-sans text-xs placeholder:text-ink-soft/70"
                    />
                  )}

                  {/* Preset quick pills */}
                  <div className="flex flex-wrap items-center gap-1 mt-2">
                    <span className="label-meta text-ink-soft/60 mr-1">Quick ideas:</span>
                    {PRESET_STYLES.slice(0, isPanel ? 3 : 4).map((styleText, sIdx) => (
                      <button
                        key={sIdx}
                        type="button"
                        onClick={() => onUpdateCastMember(charName, { stylePrompt: styleText })}
                        className="label-meta px-2 py-1 border border-rule text-ink-soft hover:bg-paper-tint hover:text-ink transition cursor-pointer"
                      >
                        {styleText}
                      </button>
                    ))}
                    {profile.stylePrompt ? (
                      <button
                        type="button"
                        onClick={() => onUpdateCastMember(charName, { stylePrompt: '' })}
                        className="label-meta px-2 py-1 border border-rule text-ink-soft/70 hover:bg-paper-tint hover:text-ink transition cursor-pointer"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer Info */}
      {!isPanel && (
        <div className="px-4 py-2.5 bg-paper-tint border-t border-rule flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-ink-soft leading-relaxed">
            Voices maintain consistency across extended scenes without room tone or accent drift.
          </span>
          <span className="label-meta text-ink">Voice engine</span>
        </div>
      )}
    </div>
  );
};
