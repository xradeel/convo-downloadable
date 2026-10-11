import React, { useState, useEffect, useRef } from 'react';
import { X, Copy, Check, Loader2, Edit3 } from 'lucide-react';
import { ScriptElement, CharacterProfile, GeminiTtsPayload, SonicBoomPayload } from '../types';
import { CastStudio } from './CastStudio';
import { PayloadInspector } from './PayloadInspector';

interface ScriptDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  rawScript: string;
  onSaveScript: (newText: string) => void;
  elements: ScriptElement[];
  onFormatWithAI?: () => void;
  isFormatting?: boolean;
  initialTab?: 'screenplay' | 'edit' | 'cast' | 'payload';
  cast?: Record<string, CharacterProfile>;
  onUpdateCastMember?: (name: string, updated: Partial<CharacterProfile>) => void;
  onAuditionVoice?: (name: string) => void;
  auditioningCharacter?: string | null;
  geminiTtsPayload?: GeminiTtsPayload;
  sonicBoomPayload?: SonicBoomPayload;
}

export const ScriptDrawer: React.FC<ScriptDrawerProps> = ({
  isOpen,
  onClose,
  rawScript,
  onSaveScript,
  elements,
  onFormatWithAI,
  isFormatting,
  initialTab = 'screenplay',
  cast,
  onUpdateCastMember,
  onAuditionVoice,
  auditioningCharacter,
  geminiTtsPayload,
  sonicBoomPayload,
}) => {
  const activePayload = geminiTtsPayload || sonicBoomPayload;
  const [activeTab, setActiveTab] = useState<'screenplay' | 'edit' | 'cast' | 'payload'>(initialTab);
  const [editText, setEditText] = useState(rawScript);
  const [copied, setCopied] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const prevIsOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setActiveTab(initialTab);
      setEditText(rawScript);
      setSaveNotice(null);
    } else if (isOpen) {
      setEditText(rawScript);
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, initialTab, rawScript]);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(rawScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApplyEdit = () => {
    onSaveScript(editText);
    setActiveTab('screenplay');
    setSaveNotice('Script draft updated & re-parsed');
    setTimeout(() => setSaveNotice(null), 3500);
  };

  const tabClass = (isActive: boolean) =>
    `pb-2.5 label-meta border-b-2 transition cursor-pointer whitespace-nowrap ${
      isActive ? 'border-ink text-ink' : 'border-transparent text-ink-soft hover:text-ink'
    }`;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[2px]">
      <div 
        id="script-drawer"
        className="w-full max-w-2xl lg:max-w-3xl bg-paper border-l border-ink h-full shadow-lg flex flex-col"
      >
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-ink flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg leading-tight text-ink">Screenplay Studio</h2>
            <p className="text-xs text-ink-soft mt-1 leading-relaxed">
              Multi-voice casting, speech direction &amp; dialogue
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {activeTab === 'screenplay' && (
              <button
                onClick={handleCopy}
                className="btn-rule btn-rule-hover label-meta px-3 py-1.5"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              className="text-ink p-1.5 border border-rule hover:bg-paper-tint transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Save confirmation banner */}
        {saveNotice && (
          <div className="px-4 sm:px-6 py-2 bg-paper-tint border-b border-ink text-xs font-mono text-ink flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5 text-ink" />
              {saveNotice}
            </span>
            <button
              onClick={() => setSaveNotice(null)}
              className="text-ink-soft hover:text-ink cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Tab switch */}
        <div className="px-4 sm:px-6 pt-3 flex items-center justify-between gap-4 border-b border-rule bg-paper-tint overflow-x-auto">
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab('screenplay')}
              className={tabClass(activeTab === 'screenplay')}
            >
              Screenplay
            </button>
            <button
              onClick={() => {
                setEditText(rawScript);
                setActiveTab('edit');
              }}
              className={tabClass(activeTab === 'edit')}
            >
              Edit text
            </button>
            {cast && (
              <button
                onClick={() => setActiveTab('cast')}
                className={tabClass(activeTab === 'cast')}
              >
                Cast &amp; voices
              </button>
            )}
            {activePayload && (
              <button
                onClick={() => setActiveTab('payload')}
                className={tabClass(activeTab === 'payload')}
              >
                Payload
              </button>
            )}
          </div>

          {activeTab === 'screenplay' && onFormatWithAI && (
            <button
              onClick={onFormatWithAI}
              disabled={isFormatting}
              className="flex items-center gap-1.5 label-meta pb-2.5 text-ink-soft hover:text-ink cursor-pointer disabled:opacity-40 whitespace-nowrap"
            >
              {isFormatting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{isFormatting ? 'Polishing...' : 'Format with AI'}</span>
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-6 text-sm leading-relaxed">
          {activeTab === 'screenplay' ? (
            <div className="space-y-4">
              <div className="bg-paper-tint p-4 sm:p-6 border border-rule text-ink space-y-4">
                {elements.length === 0 ? (
                  <div className="text-center py-8 text-ink-soft text-xs space-y-3">
                    <p>No screenplay elements detected in this draft.</p>
                    <button
                      onClick={() => setActiveTab('edit')}
                      className="btn-rule btn-rule-hover px-3 py-1.5 label-meta inline-flex items-center gap-1.5"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit draft</span>
                    </button>
                  </div>
                ) : (
                  elements.map((el) => {
                    if (el.type === 'scene_heading') {
                      return (
                        <p key={el.id} className="label-meta text-script-ink font-semibold pt-2">
                          {el.text}
                        </p>
                      );
                    }
                    if (el.type === 'action') {
                      return (
                        <p key={el.id} className="font-serif text-xs italic text-script-soft">
                          {el.text}
                        </p>
                      );
                    }
                    if (el.type === 'character') {
                      return (
                        <div key={el.id} className="pt-2 text-center label-meta text-script-ink font-semibold">
                          {el.text}
                        </div>
                      );
                    }
                    if (el.type === 'parenthetical') {
                      return (
                        <div key={el.id} className="text-center font-serif text-xs italic text-script-soft">
                          ({el.text})
                        </div>
                      );
                    }
                    if (el.type === 'dialogue') {
                      return (
                        <div key={el.id} className="max-w-md mx-auto text-center font-serif text-sm text-script-ink mb-2">
                          {el.text}
                        </div>
                      );
                    }
                    if (el.type === 'transition') {
                      return (
                        <div key={el.id} className="text-right label-meta text-script-soft py-1">
                          {el.text}
                        </div>
                      );
                    }
                    return null;
                  })
                )}
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-ink-soft">
                  {elements.filter((e) => e.type === 'dialogue').length} dialogue turns parsed
                </span>
                <button
                  onClick={() => {
                    setEditText(rawScript);
                    setActiveTab('edit');
                  }}
                  className="btn-rule btn-rule-hover px-3 py-1.5 label-meta inline-flex items-center gap-1.5"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Edit draft</span>
                </button>
              </div>
            </div>
          ) : activeTab === 'edit' ? (
            <div className="h-full flex flex-col gap-3">
              <div className="flex items-center justify-between text-xs text-ink-soft px-1">
                <span>Supports standard screenplay (CHARACTER \n dialogue) or script lines (Character: Dialogue).</span>
                <span>{editText.split(/\r?\n/).filter(Boolean).length} lines</span>
              </div>
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="flex-1 w-full border border-rule bg-paper p-4 text-xs font-mono text-script-ink focus:border-ink focus:outline-none resize-none leading-relaxed min-h-[360px]"
                rows={20}
                placeholder="Paste or write screenplay text here..."
              />
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-xs text-ink-soft">
                  Saving updates dialogue turns and character roles instantly.
                </span>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => setActiveTab('screenplay')}
                    className="px-4 py-2 label-meta text-ink-soft hover:bg-paper-tint hover:text-ink transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleApplyEdit}
                    className="btn-solid px-4 py-2 label-meta"
                  >
                    Save &amp; re-parse
                  </button>
                </div>
              </div>
            </div>
          ) : activeTab === 'cast' && cast ? (
            <CastStudio
              cast={cast}
              onUpdateCastMember={onUpdateCastMember || (() => {})}
              onAuditionVoice={onAuditionVoice || (() => {})}
              auditioningCharacter={auditioningCharacter || null}
            />
          ) : activeTab === 'payload' && activePayload ? (
            <PayloadInspector payload={activePayload} />
          ) : null}
        </div>
      </div>
    </div>
  );
};
