import React from 'react';
import { DIRECTIONS } from '../utils/directions';

interface FooterProps {
  showDirections?: boolean;
}

export const Footer: React.FC<FooterProps> = ({ showDirections = false }) => {
  return (
    <footer id="app-footer" className="shrink-0 border-t border-ink bg-paper mt-auto">
      {showDirections && (
        <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="label-meta text-ink-soft mr-1">Direction</span>
            {DIRECTIONS.map((direction) => (
              <span
                key={direction.id}
                className="label-meta text-ink border border-rule px-2.5 py-1.5"
              >
                {direction.name}
              </span>
            ))}
          </div>
          <span className="label-meta text-ink-soft">Every line voiced on its own</span>
        </div>
      )}

      <div
        id="footer-disclaimer-bar"
        className={`px-4 sm:px-6 lg:px-8 py-2.5 bg-paper-tint/60 ${
          showDirections ? 'border-t border-rule' : ''
        }`}
      >
        <div className="max-w-[1500px] mx-auto text-[11px] leading-relaxed text-ink-soft">
          <p>
            By using this feature, you confirm that you have the necessary rights to any content that
            you upload. Do not generate content that infringes on others’ intellectual property or
            privacy rights. Your use of this generative AI service is subject to our{' '}
            <a
              id="link-prohibited-use-policy"
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
              id="link-gemini-terms"
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
    </footer>
  );
};
