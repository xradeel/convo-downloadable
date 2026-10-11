import React from 'react';
import { ArrowRight, FileText, Download } from 'lucide-react';
import { CharacterProfile } from '../types';
import { DIRECTIONS } from '../utils/directions';
import { stageColorFor } from '../utils/stageColors';
import { CastStudio } from './CastStudio';
import { ThreeCharacterSegment } from './ThreeCharacterSegment';
import { ScriptIntake, ScriptIntakeProps } from './ScriptIntake';
import { Footer } from './Footer';
import { ThemeToggle } from './ThemeToggle';

/** Everything the front page grows once a script is actually in it. */
interface LoadedScript {
  title: string;
  /** Who takes the two seats, in the order they speak. */
  performers: CharacterProfile[];
  cast: Record<string, CharacterProfile>;
  turnCount: number;
  onUpdateCastMember: (name: string, updated: Partial<CharacterProfile>) => void;
  onAuditionVoice: (name: string) => void;
  auditioningCharacter: string | null;
  onReadScene: () => void;
  onStartOver: () => void;
  onEditDraft?: () => void;
  /** The script itself, where each line's stage direction is read and set. */
  page?: React.ReactNode;
}

interface LandingProps {
  sampleTitle: string;
  sampleLogline: string;
  onUploadScript: ScriptIntakeProps['onUploadScript'];
  /** Fires when a script is in and the cast can be designed. */
  onLoaded: () => void;
  isAnalyzing: boolean;
  onUseSample: () => void;
  /**
   * Unset while the page is still asking for a script. Set once one is in,
   * which is the whole difference between the two states of this page.
   */
  script?: LoadedScript;
  /** The same strip the read carries, for anything that went wrong. */
  notice?: React.ReactNode;
  onOpenSavedAudio?: () => void;
}

/**
 * The two seats the stage has, standing empty until a script names them. Both
 * borrow a face by gender, the same way any uncast character does.
 */
const EMPTY_STAGE = [
  { name: 'Character A', gender: 'male', color: 'var(--color-stage-blue, #7dd3fc)' },
  { name: 'Character B', gender: 'female', color: 'var(--color-stage-yellow, #fde68a)' },
] as const;

/** What happens to a script once it's in, in the order it happens. */
const STEPS = [
  {
    title: 'Upload the script',
    body: 'A PDF, a text file, or pages pasted straight in. The draft is sorted into action and dialogue, the scene is read for who is in it, and every line comes back with its own stage direction — yours to rewrite, or Gemini’s to redo.',
  },
  {
    title: 'Design the cast',
    body: 'Every character is cast to their own voice and accent, leaving the sustained delivery open for you to direct in natural language.',
  },
  {
    title: 'Direct the read',
    body: 'Play it straight, then hand the same page back under a different direction. Not a word of the script changes — only the way it is performed.',
  },
];

/**
 * The front page, in both of its states.
 *
 * Empty, it says what this is, stands two uncast performers on the stage, and
 * asks for a script. With one in, the same page names those performers and the
 * column that took the script becomes the cast — so choosing a script and
 * designing its voices happen in one place rather than on two screens.
 */
export const Landing: React.FC<LandingProps> = ({
  sampleTitle,
  sampleLogline,
  onUploadScript,
  onLoaded,
  isAnalyzing,
  onUseSample,
  script,
  notice,
  onOpenSavedAudio,
}) => {
  const seats = script
    ? script.performers.slice(0, 2).map((performer, order) => ({
        name: performer.name,
        gender: performer.gender === 'female' ? ('female' as const) : ('male' as const),
        color: stageColorFor(performer, order),
      }))
    : EMPTY_STAGE;

  // Which step the page is on, so the list reads as a position rather than an
  // explainer once you're standing in the middle of it.
  const currentStep = script ? 1 : 0;

  return (
    <div id="landing" className="min-h-screen flex flex-col bg-paper text-ink font-sans">
      {/* Masthead */}
      <header className="shrink-0 border-b border-ink">
        <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8">
          {/* Top rule banner with title tag and theme toggle */}
          <div className="py-2 border-b border-rule flex items-center justify-between gap-3">
            <span className="label-meta text-ink-soft">Table Read — Screenplay Direction</span>
            <div className="flex items-center gap-3">
              {onOpenSavedAudio && (
                <button
                  id="landing-open-saved-audio"
                  onClick={onOpenSavedAudio}
                  className="label-meta text-ink-soft hover:text-ink cursor-pointer underline decoration-1 underline-offset-4 flex items-center gap-1"
                  title="View scene audio files saved in ./data"
                >
                  <Download className="w-3 h-3" />
                  <span>Saved Audio</span>
                </button>
              )}
              <ThemeToggle id="landing-theme-toggle" />
            </div>
          </div>

          <div className="py-7 sm:py-9 grid gap-4 lg:gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:items-end">
            <h1 className="font-display uppercase leading-[0.86] tracking-[-0.035em] text-[clamp(44px,9vw,124px)]">
              Table Read
            </h1>
            <p className="font-serif text-[clamp(16px,1.6vw,20px)] leading-snug text-ink max-w-xl lg:pb-2">
              Upload a script and hear it performed. Each character is cast to a voice of their
              own, and you direct how the scene is played — the words never change, only the
              delivery.
            </p>
          </div>
        </div>
      </header>

      {notice}

      <main className="flex-1 w-full max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 grid gap-8 lg:gap-10 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
        <section className="flex flex-col gap-6 lg:gap-8">
          {/* The stage, standing empty until there's something to read */}
          <div>
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <span className="label-meta text-ink-soft truncate">
                {script ? script.title : 'The stage, waiting'}
              </span>
              <span className="label-meta text-ink-soft shrink-0">One voice each</span>
            </div>

            <div className="grid grid-cols-2 gap-4 h-[clamp(200px,32vh,320px)]">
              {seats.map((seat) => (
                <ThreeCharacterSegment
                  key={seat.name}
                  name={seat.name}
                  gender={seat.gender}
                  color={seat.color}
                  isSpeaking={false}
                  speechActivity={0}
                  statusLabel={script ? 'Cast' : 'Uncast'}
                />
              ))}
            </div>
          </div>

          {script?.page && <div className="h-[clamp(420px,70vh,760px)]">{script.page}</div>}

          {/* What happens to a script once it's in */}
          <ol className="border-t border-ink">
            {STEPS.map((step, index) => {
              const isCurrent = index === currentStep;
              return (
                <li
                  key={step.title}
                  className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 sm:gap-4 py-4 border-b border-rule"
                >
                  <span className={`label-meta pt-1 ${isCurrent ? 'text-ink' : 'text-ink-soft'}`}>
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <h2
                      className={`font-display text-[15px] uppercase tracking-[-0.01em] ${
                        isCurrent ? 'text-ink' : 'text-ink-soft'
                      }`}
                    >
                      {step.title}
                    </h2>
                    <p className="font-serif text-[15px] leading-relaxed text-ink-soft mt-1 max-w-2xl">
                      {step.body}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        {/* The way in, and then the cast that came back */}
        <aside className="flex flex-col gap-4 lg:border-l lg:border-rule lg:pl-8 lg:-ml-px">
          {script ? (
            <>
              <div className="border border-ink">
                <div className="px-4 sm:px-6 py-3.5 border-b border-ink bg-paper-tint flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-lg leading-tight text-ink">The cast</h2>
                    <p className="text-xs text-ink-soft mt-1 leading-relaxed">
                      {Object.keys(script.cast).length}{' '}
                      {Object.keys(script.cast).length === 1 ? 'role' : 'roles'} ·{' '}
                      {script.turnCount} {script.turnCount === 1 ? 'line' : 'lines'}. Nothing is voiced until you read it, so change
                      whatever you like.
                    </p>
                  </div>
                  {script.onEditDraft && (
                    <button
                      onClick={script.onEditDraft}
                      className="btn-rule btn-rule-hover px-2.5 py-1 text-xs label-meta shrink-0 inline-flex items-center gap-1.5"
                      title="View & edit script draft"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Edit draft</span>
                    </button>
                  )}
                </div>

                <CastStudio
                  variant="panel"
                  cast={script.cast}
                  onUpdateCastMember={script.onUpdateCastMember}
                  onAuditionVoice={script.onAuditionVoice}
                  auditioningCharacter={script.auditioningCharacter}
                />
              </div>

              <button
                id="btn-read-the-scene"
                onClick={script.onReadScene}
                className="btn-solid w-full justify-center px-4 py-3.5 label-meta"
              >
                <span>Read the scene</span>
                <ArrowRight className="w-4 h-4 shrink-0" />
              </button>

              <div className="flex items-center justify-center gap-4 text-xs">
                {script.onEditDraft && (
                  <button
                    onClick={script.onEditDraft}
                    className="label-meta text-ink hover:text-ink-soft cursor-pointer underline decoration-1 underline-offset-4"
                  >
                    View / edit script draft
                  </button>
                )}
                <button
                  onClick={script.onStartOver}
                  className="label-meta text-ink-soft hover:text-ink cursor-pointer underline decoration-1 underline-offset-4"
                >
                  Start over with another script
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="border border-ink">
                <div className="px-4 sm:px-6 py-3.5 border-b border-ink bg-paper-tint">
                  <h2 className="font-display text-lg leading-tight text-ink">
                    Bring your own script
                  </h2>
                  <p className="text-xs text-ink-soft mt-1 leading-relaxed">
                    It comes back cast, and you design the voices before anything is read.
                  </p>
                </div>

                <ScriptIntake
                  onUploadScript={onUploadScript}
                  onLoaded={onLoaded}
                  isAnalyzing={isAnalyzing}
                />
              </div>

              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-rule" />
                <span className="label-meta text-ink-soft">or</span>
                <span className="h-px flex-1 bg-rule" />
              </div>

              <button
                id="btn-use-sample-script"
                onClick={onUseSample}
                disabled={isAnalyzing}
                className="btn-rule btn-rule-hover group w-full items-center justify-between gap-4 px-4 py-3.5 text-left disabled:opacity-40"
              >
                <span className="min-w-0">
                  <span className="label-meta block text-ink-soft group-hover:text-paper">
                    Read the sample scene
                  </span>
                  <span className="font-display text-[13px] uppercase tracking-[-0.01em] block mt-1 truncate">
                    {sampleTitle}
                  </span>
                </span>
                <ArrowRight className="w-4 h-4 shrink-0" />
              </button>

              <p className="font-serif text-[14px] leading-relaxed text-ink-soft">
                {sampleLogline}
              </p>
            </>
          )}
        </aside>
      </main>

      <Footer showDirections={true} />
    </div>
  );
};
