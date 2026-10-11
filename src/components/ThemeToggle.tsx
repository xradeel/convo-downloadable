import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

interface ThemeToggleProps {
  id?: string;
  className?: string;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({
  id = 'theme-toggle',
  className = '',
}) => {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      id={id}
      type="button"
      onClick={toggleTheme}
      aria-label={`Toggle color theme. Current theme is ${theme} mode.`}
      title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      className={`inline-flex items-center border border-rule bg-paper-tint/70 p-0.5 transition-colors hover:border-ink cursor-pointer select-none ${className}`}
    >
      <span
        className={`inline-flex items-center gap-1 px-2 py-1 label-meta transition-colors ${
          theme === 'light'
            ? 'bg-paper text-ink border border-ink shadow-xs font-bold'
            : 'text-ink-soft hover:text-ink'
        }`}
      >
        <Sun className="w-3 h-3 shrink-0" />
        <span>Light</span>
      </span>
      <span
        className={`inline-flex items-center gap-1 px-2 py-1 label-meta transition-colors ${
          theme === 'dark'
            ? 'bg-ink text-paper border border-ink shadow-xs font-bold'
            : 'text-ink-soft hover:text-ink'
        }`}
      >
        <Moon className="w-3 h-3 shrink-0" />
        <span>Dark</span>
      </span>
    </button>
  );
};
