import React from 'react';

interface StageBackdropProps {
  /** The cyclorama colour, which the script and the plate also read off. */
  color: string;
  name: string;
  isSpeaking: boolean;
  activeEmotion?: string;
  dialogueText?: string;
  /** What this performer is interjecting into the other one's line, if anything. */
  interjection?: string;
  /** Replaces Speaking/Listening, for a stage with nothing to read yet. */
  statusLabel?: string;
  /** The performer itself: a 2D canvas or a WebGL container. */
  children: React.ReactNode;
}

/**
 * The lit, gridded stage every performer stands on, plus the caption beneath
 * it. The frame is separate from the figure inside it, so both performers are
 * lit identically.
 *
 * The caption carries only the name and who has the line. The voice behind it
 * is credited in the plate under the stage, where it sits next to the style
 * that voice is being given, rather than being split across the two.
 */
/**
 * The line as this performer speaks it: without the <sigh> style cues, and
 * without the |interjections|, which belong to the listener and are captioned
 * on their card instead.
 */
function spokenText(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\|[^|]*\|/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const StageBackdrop: React.FC<StageBackdropProps> = ({
  color,
  name,
  isSpeaking,
  activeEmotion,
  dialogueText,
  interjection,
  statusLabel,
  children,
}) => {
  const showSubtitle = !!dialogueText;

  return (
    <figure className="flex flex-col h-full min-h-0">
      <div className="relative flex-1 min-h-0 overflow-hidden border border-ink">
        {/* Cyclorama. The same colour marks this performer's lines in the
            script and their row in the plate, so a glance ties the three. */}
        <div className="absolute inset-0" style={{ background: color }} />

        {/* Studio grid */}
        <div
          className="absolute inset-0 opacity-15 pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(to right, var(--color-ink) 1px, transparent 1px),
              linear-gradient(to bottom, var(--color-ink) 1px, transparent 1px)
            `,
            backgroundSize: '24px 24px',
          }}
        />

        {/* Key light from above, so the flat backdrop has a falloff */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 80% 60% at 50% 8%, rgba(255,255,255,0.5), transparent 72%)',
          }}
        />

        {/* Floor shadow, so the bust is standing on something */}
        <div
          className="absolute inset-x-0 bottom-0 h-1/2 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 62% 100% at 50% 100%, rgba(17,17,17,0.18), transparent 70%)',
          }}
        />

        {children}

        {/* Backchannel: the listener's interjection into the other line */}
        {!showSubtitle && interjection && (
          <div className="absolute bottom-3 left-3 z-10 bg-paper border border-ink px-2.5 py-1 pointer-events-none">
            <span className="font-serif italic text-[13px] text-script-ink">“{interjection}”</span>
          </div>
        )}

        {showSubtitle && (
          <div className="absolute bottom-0 inset-x-0 z-10 bg-paper border-t border-ink px-4 py-3 pointer-events-none transition-all">
            {activeEmotion && (
              <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                <span className="label-meta font-mono font-bold text-ink uppercase tracking-wider bg-paper-tint border border-rule px-1.5 py-0.5 text-[9px] shrink-0">
                  Stage Direction
                </span>
                <span className="label-meta text-ink font-serif italic text-xs font-semibold truncate max-w-full">
                  {activeEmotion}
                </span>
              </div>
            )}
            <p className="font-serif text-[15px] leading-snug text-script-ink line-clamp-3">
              {spokenText(dialogueText)}
            </p>
          </div>
        )}
      </div>

      <figcaption className="shrink-0 pt-2 flex items-baseline justify-between gap-3">
        <span className="label-meta truncate">
          <span className={isSpeaking ? 'text-ink font-bold' : 'text-ink'}>{name}</span>
        </span>
        <span className={`label-meta shrink-0 ${isSpeaking ? 'text-ink font-bold' : 'text-ink-soft'}`}>
          {statusLabel ?? (isSpeaking ? 'Speaking' : 'Listening')}
        </span>
      </figcaption>
    </figure>
  );
};
