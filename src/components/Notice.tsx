import React from 'react';

interface NoticeProps {
  text: string;
  onDismiss: () => void;
}

/** A hairline strip under the masthead, for anything that went wrong. */
export const Notice: React.FC<NoticeProps> = ({ text, onDismiss }) => (
  <div className="shrink-0 border-b border-ink bg-paper-tint">
    <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-start gap-3">
      <span className="label-meta text-ink-soft shrink-0 pt-0.5">Note</span>
      <span className="text-[13px] text-ink flex-1">{text}</span>
      <button
        onClick={onDismiss}
        className="label-meta text-ink-soft hover:text-ink cursor-pointer shrink-0 pt-0.5"
      >
        Close
      </button>
    </div>
  </div>
);
