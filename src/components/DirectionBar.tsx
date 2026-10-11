import React from 'react';
import { Loader2 } from 'lucide-react';
import { Direction } from '../utils/directions';

interface DirectionBarProps {
  directions: Direction[];
  activeId: string;
  /** Directions already voiced, which switch back instantly. */
  readyIds: string[];
  busyId: string | null;
  onSelect: (direction: Direction) => void;
}

/**
 * The one control the demo is about: the same page of dialogue, handed to the
 * model under a different sustained style. Picking a direction re-voices the
 * scene and drops you back on the line you were already on, so the change you
 * hear is the delivery and only the delivery.
 */
export const DirectionBar: React.FC<DirectionBarProps> = ({
  directions,
  activeId,
  readyIds,
  busyId,
  onSelect,
}) => {
  const active = directions.find((d) => d.id === activeId) ?? directions[0];

  return (
    <div className="shrink-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="label-meta text-ink-soft shrink-0 mr-1">Direction</span>

        {directions.map((direction) => {
          const isActive = direction.id === activeId;
          const isBusy = direction.id === busyId;
          return (
            <button
              key={direction.id}
              id={`btn-direction-${direction.id}`}
              onClick={() => onSelect(direction)}
              aria-pressed={isActive}
              disabled={!!busyId}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs whitespace-nowrap border cursor-pointer transition-colors disabled:cursor-wait ${
                isActive
                  ? 'bg-ink text-paper border-ink font-semibold'
                  : 'bg-paper text-ink-soft border-rule hover:border-ink hover:text-ink disabled:hover:border-rule disabled:hover:text-ink-soft'
              }`}
            >
              {isBusy && <Loader2 className="w-3 h-3 animate-spin" />}
              {direction.name}
              {!isActive && !isBusy && readyIds.includes(direction.id) && (
                <span className="text-[9px] opacity-60" title="Already voiced">
                  ●
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-2.5 max-w-2xl">
        <p className="font-serif text-[15px] leading-relaxed text-ink">
          {active.note}
        </p>
      </div>
    </div>
  );
};
