import React, { useState, useRef } from 'react';
import { Upload, ArrowRight, Loader2 } from 'lucide-react';

export interface ScriptIntakeProps {
  /** Reads the script in. Resolves false when nothing could be loaded. */
  onUploadScript: (scriptContent: string, title?: string, pdfBase64?: string) => Promise<boolean>;
  /** Fires once a script is actually loaded, so the caller can move on. */
  onLoaded: () => void;
  isAnalyzing?: boolean;
}

/**
 * The way a script gets in: pasted pages, or a file dropped anywhere in the
 * panel. One surface rather than two — a file and a paste are the same ask.
 *
 * Every script goes through the screenplay analysis on the way in, so there is
 * nothing to choose here beyond the pages themselves.
 */
export const ScriptIntake: React.FC<ScriptIntakeProps> = ({
  onUploadScript,
  onLoaded,
  isAnalyzing = false,
}) => {
  const [pastedText, setPastedText] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async (content: string, title?: string, pdfBase64?: string) => {
    try {
      if (await onUploadScript(content, title, pdfBase64)) onLoaded();
    } catch {
      // Failures surface as a notice next to the script itself.
    }
  };

  const handleFile = (file: File) => {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const title = file.name.replace(/\.[^/.]+$/, '');
    const reader = new FileReader();

    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (!result) return;
      if (isPdf) {
        void load('', title, result.includes(',') ? result.split(',')[1] : result);
      } else {
        void load(result, title);
      }
    };

    if (isPdf) reader.readAsDataURL(file);
    else reader.readAsText(file);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <div
      className="p-4 sm:p-6 relative"
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      {/* Analysis overlay */}
      {isAnalyzing && (
        <div className="absolute inset-0 bg-paper/95 z-20 flex flex-col items-center justify-center text-center p-6 space-y-3">
          <Loader2 className="w-6 h-6 animate-spin text-ink" />
          <h3 className="font-display text-base text-ink">Reading the draft...</h3>
          <p className="text-xs text-ink-soft max-w-sm leading-relaxed">
            Sorting action from dialogue, identifying characters, and assigning voices so you can direct each performance in natural language.
          </p>
        </div>
      )}

      {/* Anywhere in the panel is a drop target */}
      {dragActive && !isAnalyzing && (
        <div className="absolute inset-0 bg-paper/95 border border-dashed border-ink z-10 flex flex-col items-center justify-center text-center p-6 pointer-events-none">
          <Upload className="w-5 h-5 text-ink mb-2" />
          <p className="text-sm font-semibold text-ink">Drop the script</p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.txt,.md,application/pdf"
        onChange={(e) => {
          if (e.target.files?.[0]) handleFile(e.target.files[0]);
        }}
        className="hidden"
      />

      <textarea
        value={pastedText}
        onChange={(e) => setPastedText(e.target.value)}
        placeholder={`INT. COFFEE SHOP - DAY\n\nMARCUS\n(thoughtful, quiet)\nDid you bring the key?\n\nSIENNA\n(wistful)\n<sigh> You know I did.`}
        className="w-full h-52 border border-rule bg-paper p-3 text-ink font-mono text-xs focus:border-ink focus:outline-none resize-none leading-relaxed placeholder:text-ink-soft/70"
      />

      <p className="text-[11px] text-ink-soft mt-2.5 leading-relaxed">
        Paste the pages above, or drop a .pdf, .txt or .md file anywhere in this panel.
      </p>

      <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="btn-rule btn-rule-hover label-meta px-3 py-2"
        >
          <Upload className="w-3.5 h-3.5" />
          <span>Choose a file</span>
        </button>

        <button
          onClick={() => void load(pastedText, 'Uploaded script draft')}
          disabled={!pastedText.trim()}
          className="btn-solid px-4 py-2 label-meta disabled:opacity-40"
        >
          <span>Cast the script</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
