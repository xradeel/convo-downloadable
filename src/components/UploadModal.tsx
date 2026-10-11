import React from 'react';
import { X } from 'lucide-react';
import { ScriptIntake, ScriptIntakeProps } from './ScriptIntake';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadScript: ScriptIntakeProps['onUploadScript'];
  /** Where a loaded script goes next, which isn't back to this read. */
  onLoaded: () => void;
  isAnalyzing?: boolean;
}

/** Swapping the script from inside the read. */
export const UploadModal: React.FC<UploadModalProps> = ({
  isOpen,
  onClose,
  onUploadScript,
  onLoaded,
  isAnalyzing = false,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-[2px]">
      <div
        id="upload-script-modal"
        className="w-full max-w-xl max-h-full bg-paper border border-ink shadow-lg overflow-y-auto flex flex-col"
      >
        <div className="px-4 sm:px-6 py-4 border-b border-ink flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg leading-tight text-ink">Read a different script</h2>
            <p className="text-xs text-ink-soft mt-1 max-w-md leading-relaxed">
              Paste the pages or drop a file. You'll design the cast before anything is read.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-ink p-1 border border-rule hover:bg-paper-tint transition cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <ScriptIntake
          onUploadScript={onUploadScript}
          onLoaded={onLoaded}
          isAnalyzing={isAnalyzing}
        />

        <div
          id="upload-modal-disclaimer"
          className="px-4 sm:px-6 py-3 border-t border-rule bg-paper-tint/60 text-[11px] leading-relaxed text-ink-soft"
        >
          <p>
            By using this feature, you confirm that you have the necessary rights to any content that
            you upload. Do not generate content that infringes on others’ intellectual property or
            privacy rights. Your use of this generative AI service is subject to our{' '}
            <a
              id="modal-link-prohibited-use-policy"
              href="https://policies.google.com/terms/generative-ai/use-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-ink hover:text-ink-soft transition-colors font-medium"
            >
              Prohibited Use Policy
            </a>
            .{' '}
            Please note that uploads from Google Workspace may be used to develop and improve Google
            products and services in accordance with our{' '}
            <a
              id="modal-link-gemini-terms"
              href="https://ai.google.dev/gemini-api/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-ink hover:text-ink-soft transition-colors font-medium"
            >
              terms
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
};
