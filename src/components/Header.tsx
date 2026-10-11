import React from 'react';
import { ThemeToggle } from './ThemeToggle';
import { Download } from 'lucide-react';

interface HeaderProps {
  onOpenUpload: () => void;
  onOpenCast: () => void;
  onOpenSavedAudio?: () => void;
}

/**
 * One rule across the top: the wordmark, what the demo is, and the things
 * you can do to it.
 */
export const Header: React.FC<HeaderProps> = ({ onOpenUpload, onOpenCast, onOpenSavedAudio }) => (
  <header
    id="table-read-header"
    className="shrink-0 bg-paper border-b border-ink"
  >
    <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-baseline justify-between gap-4 flex-wrap">
      <div className="flex items-baseline gap-4 min-w-0">
        <h1 className="font-display text-ink text-[24px] sm:text-[28px] leading-none tracking-[-0.02em] uppercase shrink-0">
          Table Read
        </h1>
        <p className="font-serif text-[14px] text-ink-soft truncate hidden sm:block">
          One scene, read five ways. The words never change — the direction does.
        </p>
      </div>

      <nav className="flex items-center gap-3 sm:gap-4 shrink-0" aria-label="Script actions">
        {onOpenSavedAudio && (
          <button
            id="btn-open-saved-audio"
            onClick={onOpenSavedAudio}
            className="label-meta text-ink-soft hover:text-ink cursor-pointer underline decoration-1 underline-offset-4 flex items-center gap-1"
            title="View scene audio files saved in ./data"
          >
            <Download className="w-3 h-3" />
            <span>Saved Audio</span>
          </button>
        )}
        <button
          id="btn-open-cast"
          onClick={onOpenCast}
          className="label-meta text-ink-soft hover:text-ink cursor-pointer underline decoration-1 underline-offset-4"
        >
          Cast
        </button>
        <button
          id="btn-upload-script"
          onClick={onOpenUpload}
          className="label-meta text-ink-soft hover:text-ink cursor-pointer underline decoration-1 underline-offset-4"
        >
          Own script
        </button>
        <span className="w-px h-4 bg-rule" aria-hidden="true" />
        <ThemeToggle id="header-theme-toggle" />
      </nav>
    </div>
  </header>
);
