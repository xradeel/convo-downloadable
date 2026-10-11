import React, { useEffect, useState } from 'react';
import { X, Download, Loader2, Music, RefreshCw, HardDrive } from 'lucide-react';

export interface SavedAudioFile {
  filename: string;
  downloadUrl: string;
  filePath: string;
  date: string;
  sizeBytes: number;
  createdTime: string;
  metadata?: {
    scriptTitle?: string;
    directionId?: string;
    directionName?: string;
    turnCount?: number;
    durationSec?: number;
  };
}

interface SavedAudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDownloadCurrentScene: () => void;
  isDownloadingCurrentScene: boolean;
  currentScriptTitle: string;
  currentDirectionName: string;
}

export const SavedAudioModal: React.FC<SavedAudioModalProps> = ({
  isOpen,
  onClose,
  onDownloadCurrentScene,
  isDownloadingCurrentScene,
  currentScriptTitle,
  currentDirectionName,
}) => {
  const [files, setFiles] = useState<SavedAudioFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFiles = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/saved-audio-files');
      if (!response.ok) throw new Error('Failed to load saved audio files');
      const data = await response.json();
      setFiles(data.files || []);
    } catch (err: any) {
      setError(err.message || 'Error loading files');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchFiles();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-[2px]">
      <div
        id="saved-audio-modal"
        className="w-full max-w-2xl max-h-[85vh] bg-paper border border-ink shadow-lg overflow-y-auto flex flex-col"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-ink flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <HardDrive className="w-5 h-5 text-ink" />
            <div>
              <h2 className="font-display text-lg leading-tight text-ink">Scene Audio Recordings</h2>
              <p className="text-xs text-ink-soft mt-0.5">
                Saved files in <code className="font-mono bg-paper-tint px-1 py-0.5 border border-rule">./data</code> with dates
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-ink p-1 border border-rule hover:bg-paper-tint transition cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Current scene action box */}
        <div className="px-5 py-4 bg-paper-tint/70 border-b border-rule flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <span className="label-meta text-ink-soft">Current Scene</span>
            <div className="font-serif font-bold text-ink text-sm mt-0.5">{currentScriptTitle}</div>
            <div className="label-meta text-ink-soft mt-0.5">Direction: {currentDirectionName}</div>
          </div>
          <button
            onClick={async () => {
              await onDownloadCurrentScene();
              fetchFiles();
            }}
            disabled={isDownloadingCurrentScene}
            className="btn-solid px-4 py-2 text-[12px] font-semibold shrink-0"
          >
            {isDownloadingCurrentScene ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Making & saving audio...</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                <span>Make & download scene audio</span>
              </>
            )}
          </button>
        </div>

        {/* Saved files list */}
        <div className="p-5 flex-1 min-h-[220px]">
          <div className="flex items-center justify-between mb-3">
            <span className="label-meta text-ink-soft">
              Saved Files in ./data ({files.length})
            </span>
            <button
              onClick={fetchFiles}
              disabled={isLoading}
              className="label-meta text-ink-soft hover:text-ink cursor-pointer flex items-center gap-1 underline decoration-1"
            >
              <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-ink-soft">
              <Loader2 className="w-6 h-6 animate-spin text-ink" />
              <span className="text-xs font-mono">Loading recordings...</span>
            </div>
          ) : error ? (
            <div className="py-8 text-center text-rose-600 text-xs">
              {error}
            </div>
          ) : files.length === 0 ? (
            <div className="py-12 border border-dashed border-rule text-center px-4 flex flex-col items-center justify-center">
              <Music className="w-8 h-8 text-ink-soft/50 mb-2" />
              <p className="font-serif text-sm text-ink mb-1">No audio files made yet</p>
              <p className="text-xs text-ink-soft max-w-sm">
                When you click "Download audio", the scene is synthesized, saved to the <code className="font-mono">./data</code> directory with today's date, and downloaded to your computer.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {files.map((file) => (
                <div
                  key={file.filename}
                  className="border border-rule p-3 hover:border-ink transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-paper"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-semibold text-ink truncate">
                        {file.filename}
                      </span>
                      <span className="bg-paper-tint border border-rule px-1.5 py-0.5 text-[10px] font-mono text-ink-soft">
                        {file.date}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 mt-1 text-[11px] text-ink-soft flex-wrap">
                      <span>Size: {formatSize(file.sizeBytes)}</span>
                      {file.metadata?.durationSec && (
                        <span>Duration: {file.metadata.durationSec}s</span>
                      )}
                      {file.metadata?.directionName && (
                        <span>Direction: {file.metadata.directionName}</span>
                      )}
                    </div>
                  </div>

                  <a
                    href={file.downloadUrl}
                    download={file.filename}
                    className="btn-rule btn-rule-hover px-3 py-1.5 text-xs font-medium shrink-0 justify-center"
                    title={`Download ${file.filename}`}
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download</span>
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-rule bg-paper-tint/50 text-[11px] text-ink-soft flex items-center justify-between">
          <span>Audio files are exported as 16-bit 24kHz mono master WAV tracks.</span>
          <button
            onClick={onClose}
            className="label-meta text-ink underline decoration-1 hover:text-ink-soft cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
