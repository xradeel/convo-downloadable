import React from 'react';
import { Play, Pause, SkipBack, SkipForward, Loader2, Download } from 'lucide-react';

interface TransportProps {
  isPlaying: boolean;
  /** Blocking: the scene audio is being synthesized and loaded. */
  isSynthesizing: boolean;
  activeTurnIndex: number;
  turnCount: number;
  loadedCount?: number;
  speaker?: string;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onDownloadAudio?: () => void;
  isDownloadingAudio?: boolean;
}

/** Play, step, download, and where you are in the scene. */
export const Transport: React.FC<TransportProps> = ({
  isPlaying,
  isSynthesizing,
  activeTurnIndex,
  turnCount,
  loadedCount = 0,
  speaker,
  onTogglePlay,
  onPrev,
  onNext,
  onDownloadAudio,
  isDownloadingAudio = false,
}) => {
  const isFullyLoaded = turnCount > 0 && loadedCount >= turnCount;

  return (
    <div className="shrink-0 border-y border-ink py-3 flex items-center gap-3 flex-wrap">
      <button
        onClick={onPrev}
        disabled={activeTurnIndex === 0}
        className="btn-rule btn-rule-hover p-2 disabled:opacity-30 disabled:cursor-default"
        title="Previous line"
      >
        <SkipBack className="w-4 h-4" />
      </button>

      <button
        id="btn-play-pause-stage"
        onClick={onTogglePlay}
        disabled={isSynthesizing}
        className="btn-solid px-5 py-2.5 text-[13px] font-semibold min-w-[170px] justify-center disabled:opacity-60 disabled:cursor-wait"
      >
        {isSynthesizing ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading script ({loadedCount}/{turnCount})</span>
          </>
        ) : isPlaying ? (
          <>
            <Pause className="w-4 h-4 fill-current" />
            <span>Pause</span>
          </>
        ) : !isFullyLoaded ? (
          <>
            <Play className="w-4 h-4 fill-current" />
            <span>Load & read scene</span>
          </>
        ) : (
          <>
            <Play className="w-4 h-4 fill-current" />
            <span>{activeTurnIndex > 0 ? 'Resume' : 'Read the scene'}</span>
          </>
        )}
      </button>

      <button
        onClick={onNext}
        disabled={activeTurnIndex >= turnCount - 1}
        className="btn-rule btn-rule-hover p-2 disabled:opacity-30 disabled:cursor-default"
        title="Next line"
      >
        <SkipForward className="w-4 h-4" />
      </button>

      <div className="flex items-baseline gap-2 ml-1 min-w-0">
        <span className="label-meta text-ink-soft">Line</span>
        <span className="font-mono text-sm text-ink">
          {String(Math.min(activeTurnIndex + 1, turnCount)).padStart(2, '0')} /{' '}
          {String(turnCount).padStart(2, '0')}
        </span>
        {speaker && <span className="label-meta text-ink-soft truncate">— {speaker}</span>}
      </div>

      <div className="ml-auto flex items-center gap-3">
        {onDownloadAudio && (
          <button
            id="btn-download-audio"
            onClick={onDownloadAudio}
            disabled={isDownloadingAudio}
            className="btn-rule btn-rule-hover px-3 py-1.5 text-[12px] font-medium disabled:opacity-50 flex items-center gap-1.5"
            title="Download full scene audio (.wav) saved in ./data"
          >
            {isDownloadingAudio ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Making audio...</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                <span>Download audio</span>
              </>
            )}
          </button>
        )}

        {isSynthesizing ? (
          <span className="label-meta text-ink-soft flex items-center gap-1.5 text-[11px]">
            <Loader2 className="w-3 h-3 animate-spin text-ink" />
            Loading audio ({loadedCount}/{turnCount})
          </span>
        ) : isFullyLoaded ? (
          <span className="label-meta text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 text-[11px]" title="All script dialogue is loaded properly">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
            Script loaded ({loadedCount}/{turnCount})
          </span>
        ) : (
          <span className="label-meta text-amber-600 dark:text-amber-400 flex items-center gap-1.5 text-[11px]" title="Script audio not fully loaded yet">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-500"></span>
            {loadedCount}/{turnCount} lines loaded
          </span>
        )}
      </div>
    </div>
  );
};
