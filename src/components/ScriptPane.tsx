import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Pencil, Sparkles } from 'lucide-react';
import { CharacterProfile, ScriptElement } from '../types';
import { stageColorFor, stageWash } from '../utils/stageColors';

interface ScriptPaneProps {
  title: string;
  elements: ScriptElement[];
  cast: Record<string, CharacterProfile>;
  /** The line under the playhead; -1 before anything can be played. */
  activeTurnIndex: number;
  /** The interjection being voiced right now, so it can light up in place. */
  liveInterjection?: string | null;
  /** Left off where nothing is voiced yet, and the lines aren't playable. */
  onSelectTurn?: (turnIndex: number) => void;
  onEditScript: () => void;
  /** Sets the stage direction on lines by turn index; empty clears it. */
  onSetDirections?: (edits: Record<number, string>) => void;
  /** Has Gemini direct the given lines, or all of them when none are given. */
  onSuggestDirections?: (turnIndexes?: number[]) => void;
  /** Lines Gemini is directing right now. */
  directingTurns?: number[];
  /** A small label over the title. */
  kicker?: string;
}

/** The one-line editor that stands in for a line's (parenthetical). */
const DirectionEditor: React.FC<{
  initial: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}> = ({ initial, onSave, onCancel }) => {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <form
      className="pl-6 pr-3 py-1 flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(value);
      }}
    >
      <label className="flex items-center gap-1 font-serif italic text-[12px] text-ink">
        <span aria-hidden>(</span>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel();
          }}
          placeholder="e.g. hushed, pleading, fighting back tears"
          aria-label="Stage direction"
          className="flex-1 min-w-0 bg-paper border border-ink px-1.5 py-0.5 font-serif italic text-[12px] text-ink focus:outline-none"
        />
        <span aria-hidden>)</span>
      </label>
      <div className="flex items-center gap-3 label-meta">
        <button type="submit" className="text-ink underline decoration-1 underline-offset-4 cursor-pointer">
          Save
        </button>
        <button type="button" onClick={onCancel} className="text-ink-soft hover:text-ink cursor-pointer">
          Cancel
        </button>
        {initial && (
          <button
            type="button"
            onClick={() => onSave('')}
            className="text-ink-soft hover:text-ink cursor-pointer ml-auto"
          >
            Remove
          </button>
        )}
      </div>
    </form>
  );
};

/** The dialogue turn a block belongs to, or the standing text around it. */
type Block =
  | { kind: 'heading'; id: string; text: string }
  | { kind: 'action'; id: string; text: string }
  | {
      kind: 'turn';
      id: string;
      turnIndex: number;
      character: string;
      /** The other performer, who gets handed the |interjections|. */
      listener?: string;
      parenthetical?: string;
      text: string;
      /** The colour this character is lit in on the stage. */
      color: string;
    };

/**
 * Splits a line into what is spoken and the marks that aren't: <sigh> style
 * cues and the |interjections| the other performer drops over the top.
 */
function segment(text: string) {
  return text.split(/(<[^>]+>|\|[^|]*\|)/g).filter(Boolean);
}

/**
 * The script itself, running down the side of the stage and scrolling itself
 * to whatever line is being spoken.
 *
 * It is set as a screenplay rather than as a transcript on purpose: the point
 * of the demo is that there is a fixed page of words, and that everything you
 * hear change between reads is direction laid over them rather than a rewrite.
 * So the words stay put, and the direction under the live line is what moves.
 */
export const ScriptPane: React.FC<ScriptPaneProps> = ({
  title,
  elements,
  cast,
  activeTurnIndex,
  liveInterjection,
  onSelectTurn,
  onEditScript,
  onSetDirections,
  onSuggestDirections,
  directingTurns = [],
  kicker = 'The page',
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const turnRefs = useRef<Record<number, HTMLElement | null>>({});
  const [editingTurn, setEditingTurn] = useState<number | null>(null);

  const blocks = useMemo<Block[]>(() => {
    const speakers: string[] = Array.from(
      new Set<string>(
        elements
          .filter((e) => e.type === 'dialogue' && !!e.character)
          .map((e) => e.character as string)
      )
    );

    const out: Block[] = [];
    for (const elem of elements) {
      if (elem.type === 'scene_heading') {
        out.push({ kind: 'heading', id: elem.id, text: elem.text ?? elem.raw });
      } else if (elem.type === 'action' && elem.text) {
        out.push({ kind: 'action', id: elem.id, text: elem.text });
      } else if (elem.type === 'dialogue' && elem.character && elem.text) {
        out.push({
          kind: 'turn',
          id: elem.id,
          turnIndex: elem.turnIndex ?? out.length,
          character: elem.character,
          listener: speakers.find((s) => s !== elem.character),
          parenthetical: elem.parenthetical,
          text: elem.text,
          color: stageColorFor(cast[elem.character], speakers.indexOf(elem.character)),
        });
      }
    }
    return out;
  }, [elements, cast]);

  const turns = blocks.filter((b) => b.kind === 'turn');
  const directedCount = turns.filter((b) => b.kind === 'turn' && b.parenthetical?.trim()).length;
  const directingAll = turns.length > 0 && directingTurns.length >= turns.length;
  const canDirect = !!onSetDirections;

  // Follow the read. Scrolling the pane rather than the node keeps the page
  // itself still while the script moves.
  useEffect(() => {
    const container = scrollRef.current;
    const node = turnRefs.current[activeTurnIndex];
    if (!container || !node) return;

    container.scrollTo({
      top: Math.max(0, node.offsetTop - container.clientHeight * 0.42),
      behavior: 'smooth',
    });
  }, [activeTurnIndex]);

  return (
    <section
      id="script-pane"
      className="flex flex-col min-h-0 h-full border border-ink bg-paper"
      aria-label="Screenplay"
    >
      <header className="shrink-0 flex items-baseline justify-between gap-3 border-b border-ink px-4 py-2.5">
        <div className="min-w-0">
          <span className="label-meta text-ink-soft">{kicker}</span>
          <h2 className="font-display text-ink text-[13px] uppercase tracking-[-0.01em] truncate">
            {title}
          </h2>
        </div>
        <button
          onClick={onEditScript}
          className="label-meta text-ink-soft hover:text-ink cursor-pointer shrink-0 underline decoration-1 underline-offset-4"
        >
          Edit
        </button>
      </header>

      {canDirect && turns.length > 0 && (
        <div className="shrink-0 flex items-center justify-between gap-3 border-b border-rule bg-paper-tint px-4 py-2">
          <span className="label-meta text-ink-soft">
            Stage directions · {directedCount}/{turns.length} lines
          </span>
          {onSuggestDirections && (
            <button
              onClick={() => onSuggestDirections()}
              disabled={directingTurns.length > 0}
              className="btn-rule btn-rule-hover label-meta px-2.5 py-1 inline-flex items-center gap-1.5 shrink-0 disabled:opacity-40"
              title="Gemini writes a fresh stage direction for every line"
            >
              {directingAll ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>{directingAll ? 'Directing…' : 'Direct every line'}</span>
            </button>
          )}
        </div>
      )}

      <div
        ref={scrollRef}
        className="relative flex-1 min-h-0 overflow-y-auto px-4 py-5 font-mono text-[13px] leading-[1.7]"
      >
        {blocks.map((block) => {
          if (block.kind === 'heading') {
            return (
              <p
                key={block.id}
                className="text-script-ink font-bold uppercase tracking-[0.04em] border-b border-rule pb-1.5 mb-4"
              >
                {block.text}
              </p>
            );
          }

          if (block.kind === 'action') {
            return (
              <p
                key={block.id}
                className="font-serif text-[12px] italic text-script-soft pl-6 mb-3 max-w-lg leading-normal"
              >
                {block.text}
              </p>
            );
          }

          const isActive = block.turnIndex === activeTurnIndex;
          // With nothing to play yet every line is being read, not just one.
          const lit = isActive || !onSelectTurn;
          const isEditing = editingTurn === block.turnIndex;
          const isDirecting = directingTurns.includes(block.turnIndex);
          const playable = !!onSelectTurn && !isEditing;

          const characterCue = (
            <span
              className={`block pl-14 pr-14 uppercase tracking-[0.06em] ${
                isActive ? 'text-script-ink font-bold' : lit ? 'text-script-ink' : 'text-script-soft'
              }`}
            >
              {block.character}
            </span>
          );

          const direction = isDirecting ? (
            <span className="flex items-center gap-1.5 pl-10 font-serif italic text-[11px] text-ink-soft">
              <Loader2 className="w-3 h-3 animate-spin" />
              Gemini is directing this line…
            </span>
          ) : block.parenthetical ? (
            <span
              className={`block pl-10 font-serif italic text-[11px] transition-colors ${
                isActive ? 'text-ink font-semibold' : lit ? 'text-ink' : 'text-script-soft'
              }`}
            >
              ({block.parenthetical})
            </span>
          ) : canDirect ? (
            <span className="block pl-10 font-serif italic text-[11px] text-ink-soft/60">
              no stage direction
            </span>
          ) : null;

          const Wrapper = playable ? 'button' : 'div';

          return (
            <article
              key={block.id}
              ref={(node) => {
                turnRefs.current[block.turnIndex] = node;
              }}
              className="relative mb-4 border-l-4 transition-colors"
              style={{
                borderLeftColor: block.color,
                backgroundColor: isActive || isEditing ? stageWash(block.color) : undefined,
              }}
            >
              {canDirect && !isEditing && (
                <div className="absolute right-1.5 top-1 z-10 flex items-center gap-0.5">
                  <button
                    onClick={() => setEditingTurn(block.turnIndex)}
                    disabled={isDirecting}
                    className="p-1 text-ink-soft hover:text-ink cursor-pointer disabled:opacity-30"
                    title="Edit this line's stage direction"
                    aria-label={`Edit stage direction for line ${block.turnIndex + 1}`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  {onSuggestDirections && (
                    <button
                      onClick={() => onSuggestDirections([block.turnIndex])}
                      disabled={isDirecting}
                      className="p-1 text-ink-soft hover:text-ink cursor-pointer disabled:opacity-30"
                      title="Have Gemini direct this line"
                      aria-label={`Have Gemini direct line ${block.turnIndex + 1}`}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}

              <Wrapper
                {...(playable
                  ? {
                      onClick: () => onSelectTurn?.(block.turnIndex),
                      title: `Play from line ${block.turnIndex + 1}`,
                    }
                  : {})}
                className={`block w-full text-left py-1.5 pr-3 ${playable ? 'cursor-pointer' : ''}`}
              >
                {characterCue}

                {isEditing ? (
                  <DirectionEditor
                    initial={block.parenthetical ?? ''}
                    onSave={(value) => {
                      onSetDirections?.({ [block.turnIndex]: value });
                      setEditingTurn(null);
                    }}
                    onCancel={() => setEditingTurn(null)}
                  />
                ) : (
                  direction
                )}

                <span
                  className={`block pl-6 ${lit ? 'text-script-ink' : 'text-script-soft'}`}
                >
                  {segment(block.text).map((part, i) => {
                    if (/^<.+>$/.test(part)) {
                      return (
                        <span
                          key={i}
                          className="text-ink-soft/60 dark:text-script-cue dark:opacity-100 font-normal"
                          title="Vocal cue"
                        >
                          {part}
                        </span>
                      );
                    }
                    if (/^\|.*\|$/.test(part)) {
                      const phrase = part.slice(1, -1).trim();
                      const live =
                        isActive &&
                        !!liveInterjection &&
                        liveInterjection.toLowerCase() === phrase.toLowerCase();
                      return (
                        <span
                          key={i}
                          title={`${block.listener ?? 'The listener'} talks over this`}
                          className={`transition-colors ${
                            live
                              ? 'bg-ink text-paper px-0.5'
                              : 'text-script-soft'
                          }`}
                        >
                          |{phrase}|
                        </span>
                      );
                    }
                    return <React.Fragment key={i}>{part}</React.Fragment>;
                  })}
                </span>
              </Wrapper>
            </article>
          );
        })}
      </div>

    </section>
  );
};
