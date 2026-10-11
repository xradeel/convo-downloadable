import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { GeminiTtsPayload } from '../types';

interface PayloadInspectorProps {
  payload: GeminiTtsPayload;
}

export const PayloadInspector: React.FC<PayloadInspectorProps> = ({ payload }) => {
  const [copied, setCopied] = useState(false);

  const jsonString = JSON.stringify(payload, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div id="payload-inspector-container" className="flex flex-col h-full bg-paper border border-rule overflow-hidden">
      {/* Subheader */}
      <div className="px-4 py-3 bg-paper-tint border-b border-rule flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-base leading-tight text-ink">
            Request payload inspector
          </h2>
          <p className="text-xs text-ink-soft mt-1 leading-relaxed">
            Structured turn metadata &amp; conversational ensemble schema
          </p>
        </div>

        <button
          onClick={handleCopy}
          className="btn-rule btn-rule-hover label-meta px-3 py-1.5"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Copied payload' : 'Copy JSON'}</span>
        </button>
      </div>

      {/* Main Container */}
      <div className="flex-1 p-3 sm:p-4 lg:p-6 overflow-y-auto space-y-6">
        {/* Architectural Explanations from Documentation */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="p-3 bg-paper-tint border border-rule">
            <h4 className="label-meta text-ink mb-1.5">
              Structured speech format
            </h4>
            <p className="text-ink-soft leading-relaxed">
              Direction and speaker move into <code className="font-mono text-ink">speech_metadata</code>. The transcript is spoken verbatim without the model reciting stage cues.
            </p>
          </div>

          <div className="p-3 bg-paper-tint border border-rule">
            <h4 className="label-meta text-ink mb-1.5">
              Discrete vocal events
            </h4>
            <p className="text-ink-soft leading-relaxed">
              Events stay inline in angle brackets at point of occurrence: <code className="font-mono text-ink">&lt;breath&gt;</code>, <code className="font-mono text-ink">&lt;laugh&gt;</code>, <code className="font-mono text-ink">&lt;sigh&gt;</code>, <code className="font-mono text-ink">&lt;chuckle&gt;</code>, <code className="font-mono text-ink">&lt;short pause&gt;</code>.
            </p>
          </div>

          <div className="p-3 bg-paper-tint border border-rule">
            <h4 className="label-meta text-ink mb-1.5">
              Multi-speaker &amp; backchannels
            </h4>
            <p className="text-ink-soft leading-relaxed">
              Carries speaker on every turn. Natural interruptions and backchannels placed <code className="font-mono text-ink">|in pipes|</code> for spontaneous ensemble reads.
            </p>
          </div>
        </div>

        {/* Formatted JSON Payload Block */}
        <div>
          <div className="flex justify-end mb-1.5">
            <span className="label-meta text-ink-soft">
              {payload.input?.[0]?.content?.length || 0} turns mapped
            </span>
          </div>
          <pre className="p-4 bg-paper-tint border border-rule text-[12px] font-mono text-ink leading-relaxed overflow-auto max-h-[500px]">
            <code>{jsonString}</code>
          </pre>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 bg-paper-tint border-t border-rule label-meta text-ink-soft flex flex-wrap items-center justify-between gap-2">
        <span>Model: <strong className="text-ink font-normal">Speech generation model</strong></span>
        <span>Mode: <strong className="text-ink font-normal">conversational</strong></span>
      </div>
    </div>
  );
};
