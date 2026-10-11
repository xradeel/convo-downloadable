/**
 * Table Read — one scene, read several ways.
 *
 * The demo holds a single page of dialogue still and changes only the
 * direction it is performed under, so what you are watching is a script being
 * read rather than an audio clip being played.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Header } from './components/Header';
import { Landing } from './components/Landing';
import { Notice } from './components/Notice';
import { Stage } from './components/Stage';
import { Transport } from './components/Transport';
import { DirectionBar } from './components/DirectionBar';
import { VoicePlate } from './components/VoicePlate';
import { ScriptPane } from './components/ScriptPane';
import { UploadModal } from './components/UploadModal';
import { ScriptDrawer } from './components/ScriptDrawer';
import { SavedAudioModal } from './components/SavedAudioModal';
import { Footer } from './components/Footer';
import { SAMPLE_SCRIPTS } from './utils/sampleScripts';
import {
  parseScreenplay,
  generateDefaultCast,
  buildGeminiTtsPayload,
  buildSynthesisTurns,
  cleanDirection,
  writeDirections,
  SynthesisTurn,
} from './utils/screenplayParser';
import { DIRECTIONS, DEFAULT_DIRECTION, Direction, directionById } from './utils/directions';
import {
  AnalyzedCharacter,
  CharacterProfile,
  ScriptAnalysisResult,
  ScriptElement,
  GeminiTtsPayload,
} from './types';
import { globalAudioPlayer, PlaybackTurn, BackchannelClip } from './utils/audioPlayer';

/** The scene the demo opens on, and the one the directions are written for. */
const DEMO = SAMPLE_SCRIPTS[0];

const CAST_COLORS = ['#38bdf8', '#818cf8', '#f59e0b', '#10b981', '#ec4899', '#a855f7'];

/** Everything voiced for one direction, keyed by script element id. */
interface DirectionAudio {
  audio: Record<string, string>;
  backchannels: Record<string, BackchannelClip[]>;
}

const NO_AUDIO: DirectionAudio = { audio: {}, backchannels: {} };

function playerTurns(elements: ScriptElement[], voiced: DirectionAudio): PlaybackTurn[] {
  return elements
    .filter((elem) => elem.type === 'dialogue' && elem.character && elem.text)
    .map((elem) => ({
      id: elem.id,
      speaker: elem.character as string,
      text: elem.text as string,
      style: elem.style,
      audioUrl: voiced.audio[elem.id],
      duration: elem.durationEstimate,
      backchannels: voiced.backchannels[elem.id],
    }));
}

export default function App() {
  // Front page, then the cast, then the read. Nothing is voiced before the
  // third of those, so the first two are free to be changed as often as you like.
  const [view, setView] = useState<'landing' | 'casting' | 'read'>('landing');
  const [rawScript, setRawScript] = useState<string>(DEMO.content);
  const [scriptTitle, setScriptTitle] = useState<string>(DEMO.title);
  const [directionId, setDirectionId] = useState<string>(DEFAULT_DIRECTION.id);

  const [activeTurnIndex, setActiveTurnIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isSynthesizing, setIsSynthesizing] = useState<boolean>(false);
  const [busyDirectionId, setBusyDirectionId] = useState<string | null>(null);

  const [speakingSpeaker, setSpeakingSpeaker] = useState<string | null>(null);
  const [interjection, setInterjection] = useState<{ speaker: string; text: string } | null>(null);
  const interjectionTimer = useRef<number | null>(null);

  const [notice, setNotice] = useState<string | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'screenplay' | 'edit' | 'cast' | 'payload'>('screenplay');
  const [isAnalyzingScript, setIsAnalyzingScript] = useState(false);
  const [isFormatting, setIsFormatting] = useState(false);
  const [auditioningCharacter, setAuditioningCharacter] = useState<string | null>(null);
  const [isSavedAudioOpen, setIsSavedAudioOpen] = useState(false);
  const [isDownloadingAudio, setIsDownloadingAudio] = useState(false);
  /** Turn indexes Gemini is writing a stage direction for right now. */
  const [directingTurns, setDirectingTurns] = useState<number[]>([]);

  const direction = useMemo(() => directionById(directionId), [directionId]);
  const { elements, characters } = useMemo(() => parseScreenplay(rawScript), [rawScript]);

  const [cast, setCast] = useState<Record<string, CharacterProfile>>(() =>
    generateDefaultCast(parseScreenplay(DEMO.content).characters)
  );

  // Handlers fire from audio callbacks and background requests, where React's
  // committed state is a render behind. These mirror it for those paths.
  const directionRef = useRef(direction);
  const elementsRef = useRef(elements);
  const castRef = useRef(cast);
  const rawScriptRef = useRef(rawScript);
  directionRef.current = direction;
  elementsRef.current = elements;
  castRef.current = cast;
  rawScriptRef.current = rawScript;

  useEffect(() => {
    setCast((prev) => {
      const updated: Record<string, CharacterProfile> = {};
      let changed = false;
      const isDemo = rawScript === DEMO.content;
      const activeCharNames = new Set(characters);

      // Check if any old character is no longer in the script
      for (const name of Object.keys(prev)) {
        if (name !== 'NARRATOR' && !activeCharNames.has(name)) {
          changed = true;
        }
      }

      characters.forEach((name, i) => {
        if (prev[name]) {
          updated[name] = prev[name];
        } else {
          changed = true;
          const defaults = generateDefaultCast([name], true, !isDemo);
          updated[name] = {
            ...defaults[name],
            stylePrompt: isDemo ? defaults[name].stylePrompt : '',
            color: CAST_COLORS[i % CAST_COLORS.length],
          };
        }
      });

      if (prev['NARRATOR']) {
        updated['NARRATOR'] = prev['NARRATOR'];
      }

      return changed ? updated : prev;
    });
  }, [characters, rawScript]);

  // ---------------------------------------------------------------- audio

  const [audioCache, setAudioCache] = useState<Record<string, DirectionAudio>>({});
  const audioCacheRef = useRef(audioCache);

  /**
   * Folds a batch of voiced lines into one direction's cache. Clips land in
   * two batches when a direction is switched mid-scene, and the second batch
   * can arrive after the listener has moved on again, so the merge is additive
   * and only reaches the player when that direction is still the live one.
   */
  const commitAudio = useCallback((dirId: string, batch: DirectionAudio) => {
    const previous = audioCacheRef.current[dirId] ?? NO_AUDIO;
    const merged: DirectionAudio = {
      audio: { ...previous.audio, ...batch.audio },
      backchannels: { ...previous.backchannels, ...batch.backchannels },
    };

    audioCacheRef.current = { ...audioCacheRef.current, [dirId]: merged };
    setAudioCache(audioCacheRef.current);

    if (directionRef.current.id === dirId) {
      globalAudioPlayer.setTurns(playerTurns(elementsRef.current, merged));
    }
    return merged;
  }, []);

  /** `direction:elementId` for every line with a voicing request out. */
  const inFlightRef = useRef<Set<string>>(new Set());

  /**
   * Set just before a stage-direction edit rewrites the script: the turns as
   * they stood, and which of them were re-directed. Every other line keeps its
   * clips across the re-parse instead of being voiced again.
   */
  const carryAudioRef = useRef<{ before: ScriptElement[]; changed: Set<number> } | null>(null);

  // Clips are tied to the exact words and voices they came from, so an edit to
  // either invalidates every direction at once — unless all that changed was
  // the direction on a few lines, in which case only those lines are dropped.
  useEffect(() => {
    const carry = carryAudioRef.current;
    carryAudioRef.current = null;

    const spoken = (list: ScriptElement[]) => list.filter((e) => e.type === 'dialogue');
    const before = carry ? spoken(carry.before) : [];
    const after = spoken(elementsRef.current);
    const sameLines =
      !!carry &&
      before.length === after.length &&
      before.every((t, i) => t.text === after[i].text && t.character === after[i].character);

    if (!carry || !sameLines) {
      audioCacheRef.current = {};
      setAudioCache({});
      return;
    }

    const carried: Record<string, DirectionAudio> = {};
    for (const [dirId, voiced] of Object.entries(audioCacheRef.current) as [string, DirectionAudio][]) {
      const next: DirectionAudio = { audio: {}, backchannels: {} };
      before.forEach((oldTurn, i) => {
        if (carry.changed.has(i)) return;
        const newId = after[i].id;
        if (voiced.audio[oldTurn.id]) next.audio[newId] = voiced.audio[oldTurn.id];
        if (voiced.backchannels[oldTurn.id]) next.backchannels[newId] = voiced.backchannels[oldTurn.id];
      });
      carried[dirId] = next;
    }
    audioCacheRef.current = carried;
    setAudioCache(carried);
  }, [rawScript, cast]);

  const voicedForDirection = audioCache[directionId] ?? NO_AUDIO;
  const playbackTurns = useMemo(
    () => playerTurns(elements, voicedForDirection),
    [elements, voicedForDirection]
  );

  useEffect(() => {
    globalAudioPlayer.setTurns(playbackTurns);
  }, [playbackTurns]);

  useEffect(() => {
    globalAudioPlayer.setCallbacks({
      onTurnChange: setActiveTurnIndex,
      onPlaybackStateChange: setIsPlaying,
      onSpeakingCharacter: (speaker, speaking) => setSpeakingSpeaker(speaking ? speaker : null),
      onBackchannel: (speaker, text) => {
        setInterjection({ speaker, text });
        if (interjectionTimer.current) window.clearTimeout(interjectionTimer.current);
        // Outlasts the sound itself, so a quick "mhm" is still readable.
        interjectionTimer.current = window.setTimeout(() => setInterjection(null), 1600);
      },
      // Speech activity is deliberately not subscribed: the performers poll the
      // player's waveform per frame, and pushing it through React would rerender
      // the stage sixty times a second for a value nothing here reads.
    });

    return () => {
      globalAudioPlayer.stop();
      if (interjectionTimer.current) window.clearTimeout(interjectionTimer.current);
    };
  }, []);

  const requestVoicing = async (
    turns: SynthesisTurn[],
    payload: GeminiTtsPayload
  ): Promise<DirectionAudio & { serviceError?: string }> => {
    const response = await fetch('/api/synthesize-table-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload, turns }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || `Synthesis failed (${response.status})`);

    const audio: Record<string, string> = {};
    const backchannels: Record<string, BackchannelClip[]> = {};
    for (const turn of data.turns ?? []) {
      if (turn.audioUrl) audio[turn.id] = turn.audioUrl;
      if (turn.backchannels?.length) backchannels[turn.id] = turn.backchannels;
    }

    return { audio, backchannels, serviceError: data.geminiTtsError || data.sonicBoomError };
  };

  /**
   * Voices the entire scene under one direction until all lines are loaded.
   * Playback only ever starts when ALL lines in the script are loaded properly.
   */
  const voiceScene = useCallback(
    async (
      sceneElements: ScriptElement[],
      sceneCast: Record<string, CharacterProfile>,
      dir: Direction
    ): Promise<boolean> => {
      const turns = buildSynthesisTurns(sceneElements, sceneCast, dir);
      if (turns.length === 0) return false;

      const voiced = audioCacheRef.current[dir.id]?.audio ?? {};
      const missingTurns = turns.filter((turn) => !voiced[turn.id]);
      if (missingTurns.length === 0) return true;

      const inFlight = inFlightRef.current;
      const pending = missingTurns.filter((turn) => !inFlight.has(`${dir.id}:${turn.id}`));

      if (pending.length === 0) {
        // Wait for in-flight requests for this direction to complete
        while (missingTurns.some((t) => inFlight.has(`${dir.id}:${t.id}`))) {
          await new Promise((r) => setTimeout(r, 200));
        }
        const updatedVoiced = audioCacheRef.current[dir.id]?.audio ?? {};
        return turns.every((turn) => Boolean(updatedVoiced[turn.id]));
      }

      setBusyDirectionId(dir.id);
      setIsSynthesizing(true);
      setNotice(null);

      const payload = buildGeminiTtsPayload(sceneElements, sceneCast, false, dir);

      try {
        pending.forEach((turn) => inFlight.add(`${dir.id}:${turn.id}`));

        // Synthesize in batches with concurrent workers so progress updates smoothly and loads much faster
        const BATCH_SIZE = 4;
        const batches: SynthesisTurn[][] = [];
        for (let i = 0; i < pending.length; i += BATCH_SIZE) {
          batches.push(pending.slice(i, i + BATCH_SIZE));
        }

        const MAX_CONCURRENT_BATCHES = 2;
        let batchIndex = 0;

        const processBatch = async (batch: SynthesisTurn[]) => {
          try {
            const batchAudio = await requestVoicing(batch, payload);
            commitAudio(dir.id, batchAudio);
            if (batchAudio.serviceError) {
              setNotice(`Voice service: ${batchAudio.serviceError}`);
            }
          } catch (batchErr: any) {
            console.warn('Batch voicing error, retrying once...', batchErr);
            try {
              await new Promise((r) => setTimeout(r, 600));
              const retryAudio = await requestVoicing(batch, payload);
              commitAudio(dir.id, retryAudio);
            } catch (retryErr: any) {
              console.error('Batch voicing retry failed:', retryErr);
              throw new Error(`Failed to load script audio: ${retryErr.message || 'connection error'}`);
            }
          } finally {
            batch.forEach((turn) => inFlight.delete(`${dir.id}:${turn.id}`));
          }
        };

        const workers = Array.from(
          { length: Math.min(MAX_CONCURRENT_BATCHES, batches.length) },
          async () => {
            while (batchIndex < batches.length) {
              const current = batches[batchIndex++];
              await processBatch(current);
            }
          }
        );

        await Promise.all(workers);

        // Verify that every single dialogue turn now has loaded audio
        const finalVoiced = audioCacheRef.current[dir.id]?.audio ?? {};
        const allReady = turns.every((turn) => Boolean(finalVoiced[turn.id]));

        if (allReady) {
          if (directionRef.current.id === dir.id) {
            globalAudioPlayer.setTurns(playerTurns(elementsRef.current, audioCacheRef.current[dir.id]));
          }
          return true;
        } else {
          const missingCount = turns.filter((turn) => !finalVoiced[turn.id]).length;
          setNotice(`Could not voice ${missingCount} line(s) in this scene. Please try again.`);
          return false;
        }
      } catch (err: any) {
        console.error('Synthesis error:', err);
        setNotice(`Synthesis failed: ${err.message || 'the voice service is unreachable'}`);
        return false;
      } finally {
        pending.forEach((turn) => inFlight.delete(`${dir.id}:${turn.id}`));
        setIsSynthesizing(false);
        setBusyDirectionId(null);
      }
    },
    [commitAudio]
  );

  const dialogueTurns = useMemo(
    () => elements.filter((elem) => elem.type === 'dialogue' && elem.turnIndex !== undefined),
    [elements]
  );
  const currentTurn =
    dialogueTurns.find((turn) => turn.turnIndex === activeTurnIndex) ?? dialogueTurns[0];

  /** Voices the live direction if it hasn't been, guaranteeing all lines are loaded before play. */
  const ensureAudio = useCallback(async (): Promise<boolean> => {
    const dirId = directionRef.current.id;
    const voiced = audioCacheRef.current[dirId];
    if (
      voiced &&
      dialogueTurns.length > 0 &&
      dialogueTurns.every((turn) => Boolean(voiced.audio[turn.id]))
    ) {
      return true;
    }
    return await voiceScene(elementsRef.current, castRef.current, directionRef.current);
  }, [dialogueTurns, voiceScene]);

  // When in read view, ensure audio for the scene is fully loaded
  useEffect(() => {
    if (view === 'read' && dialogueTurns.length > 0) {
      void ensureAudio();
    }
  }, [view, dialogueTurns.length, ensureAudio]);

  // ------------------------------------------------------------ transport

  /** Directions voiced right through, which switch back with no wait. */
  const readyDirectionIds = useMemo(
    () =>
      Object.keys(audioCache).filter(
        (id) =>
          dialogueTurns.length > 0 &&
          dialogueTurns.every((turn) => Boolean(audioCache[id]?.audio[turn.id]))
      ),
    [audioCache, dialogueTurns]
  );

  const performers = useMemo(() => {
    const everyone = Object.values(cast) as CharacterProfile[];
    const onStage = everyone.filter((member) => !member.isNarrator);
    return onStage.length > 0 ? onStage : everyone;
  }, [cast]);

  const currentVoiced = audioCache[directionId]?.audio ?? {};
  const loadedTurnCount = dialogueTurns.filter((turn) => Boolean(currentVoiced[turn.id])).length;
  const isScriptFullyLoaded = dialogueTurns.length > 0 && loadedTurnCount === dialogueTurns.length;

  const handleTogglePlay = async () => {
    if (isPlaying) {
      globalAudioPlayer.pause();
      return;
    }

    if (isSynthesizing) return;

    const ready = await ensureAudio();
    if (!ready) return;

    const dirId = directionRef.current.id;
    const currentAudio = audioCacheRef.current[dirId];
    if (
      !currentAudio ||
      dialogueTurns.length === 0 ||
      !dialogueTurns.every((turn) => Boolean(currentAudio.audio[turn.id]))
    ) {
      setNotice('Cannot play: some lines are not yet loaded properly.');
      return;
    }

    globalAudioPlayer.setTurns(playerTurns(elementsRef.current, currentAudio));
    globalAudioPlayer.play(activeTurnIndex);
  };

  const handleSelectTurn = async (index: number) => {
    setActiveTurnIndex(index);
    if (isPlaying) {
      const dirId = directionRef.current.id;
      const currentAudio = audioCacheRef.current[dirId];
      const isLoaded =
        currentAudio &&
        dialogueTurns.length > 0 &&
        dialogueTurns.every((turn) => Boolean(currentAudio.audio[turn.id]));

      if (isLoaded) {
        globalAudioPlayer.play(index);
      } else {
        const ready = await ensureAudio();
        if (!ready) return;
        const fresh = audioCacheRef.current[directionRef.current.id];
        if (fresh && dialogueTurns.every((turn) => Boolean(fresh.audio[turn.id]))) {
          globalAudioPlayer.setTurns(playerTurns(elementsRef.current, fresh));
          globalAudioPlayer.play(index);
        }
      }
    }
  };

  const handlePrev = () => {
    if (activeTurnIndex > 0) {
      const nextIdx = activeTurnIndex - 1;
      setActiveTurnIndex(nextIdx);
      if (isPlaying && isScriptFullyLoaded) {
        globalAudioPlayer.play(nextIdx);
      }
    }
  };

  const handleNext = () => {
    if (activeTurnIndex < dialogueTurns.length - 1) {
      const nextIdx = activeTurnIndex + 1;
      setActiveTurnIndex(nextIdx);
      if (isPlaying && isScriptFullyLoaded) {
        globalAudioPlayer.play(nextIdx);
      }
    }
  };

  /**
   * Downloads the complete audio file for the current script and direction.
   * If the audio file is not already made in ./data with the date,
   * it is synthesized, stitched, saved to ./data with the date, and downloaded.
   */
  const handleDownloadAudio = async () => {
    if (isDownloadingAudio) return;
    if (dialogueTurns.length === 0) {
      setNotice('No dialogue lines to export.');
      return;
    }

    setIsDownloadingAudio(true);
    setNotice('Checking audio in ./data and preparing download...');

    try {
      const turns = buildSynthesisTurns(elementsRef.current, castRef.current, directionRef.current);
      const payload = buildGeminiTtsPayload(elementsRef.current, castRef.current, false, directionRef.current);
      const cachedClips = audioCacheRef.current[directionRef.current.id]?.audio || {};

      const response = await fetch('/api/export-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scriptTitle,
          directionId: directionRef.current.id,
          directionName: directionRef.current.name,
          turns,
          payload,
          cachedClips,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to export audio');
      }

      // If server generated any new clips during export, fold them into client cache so playback has them
      if (data.newClips && Object.keys(data.newClips).length > 0) {
        commitAudio(directionRef.current.id, {
          audio: data.newClips,
          backchannels: {},
        });
      }

      // Trigger browser download
      const link = document.createElement('a');
      link.href = data.downloadUrl;
      link.download = data.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      const statusMsg = data.alreadyExisted
        ? `Downloaded existing audio from ${data.filePath} (${data.date})`
        : `Audio made, saved to ${data.filePath} (${data.date}) and downloaded.`;
      setNotice(statusMsg);
    } catch (err: any) {
      console.error('Download audio error:', err);
      setNotice(`Download audio failed: ${err.message || 'could not export audio'}`);
    } finally {
      setIsDownloadingAudio(false);
    }
  };

  /**
   * Keep the page and playhead where they are, and hand the same words
   * to the model under a different direction. All lines are loaded before playback resumes.
   */
  const handleSelectDirection = async (next: Direction) => {
    if (next.id === directionId || busyDirectionId) return;

    const resumeAt = activeTurnIndex;
    const wasPlaying = isPlaying;
    globalAudioPlayer.pause();
    setDirectionId(next.id);
    directionRef.current = next;

    const cached = audioCacheRef.current[next.id];
    const isNextFullyLoaded =
      cached &&
      dialogueTurns.length > 0 &&
      dialogueTurns.every((turn) => Boolean(cached.audio[turn.id]));

    if (isNextFullyLoaded) {
      globalAudioPlayer.setTurns(playerTurns(elementsRef.current, cached));
      if (wasPlaying) {
        globalAudioPlayer.play(resumeAt);
      }
      return;
    }

    // Next direction is not fully loaded yet: load all lines before resuming playback
    const ready = await voiceScene(elementsRef.current, castRef.current, next);
    if (!ready) return;

    const freshlyLoaded = audioCacheRef.current[next.id];
    if (
      freshlyLoaded &&
      dialogueTurns.every((turn) => Boolean(freshlyLoaded.audio[turn.id]))
    ) {
      globalAudioPlayer.setTurns(playerTurns(elementsRef.current, freshlyLoaded));
      if (wasPlaying) {
        globalAudioPlayer.play(resumeAt);
      }
    }
  };

  // ----------------------------------------------------------- script i/o

  /** Applies an analysed script and its detected cast in one go. */
  const applyAnalysis = (
    script: string,
    analyzed?: AnalyzedCharacter[],
    isUpload: boolean = false
  ) => {
    setRawScript(script);
    const parsed = parseScreenplay(script);
    const next: Record<string, CharacterProfile> = {};

    (analyzed ?? []).forEach((item: any, i) => {
      const name = typeof item === 'string' ? item : item.name;
      if (!name) return;
      const gender = typeof item === 'string' ? (i % 2 === 0 ? 'male' : 'female') : item.gender || 'male';
      const voice = typeof item === 'string' ? (gender === 'female' ? 'Kore' : 'Puck') : item.voice || (gender === 'female' ? 'Kore' : 'Puck');
      const accent = typeof item === 'string' ? 'American' : item.accent || 'American';
      const stylePrompt = isUpload ? '' : (typeof item === 'string' ? '' : (item.stylePrompt ?? ''));
      next[name] = {
        name,
        voice,
        gender,
        accent,
        stylePrompt,
        color: CAST_COLORS[i % CAST_COLORS.length],
        isNarrator: false,
        roleDescription: `${gender === 'female' ? 'Female' : 'Male'} (${voice})`,
      };
    });

    // Cast in one pass over the whole scene: the defaults are picked by a
    // character's place in it, so casting them one at a time hands every role
    // the first voice of its gender.
    const defaults = generateDefaultCast(parsed.characters, true, isUpload);
    parsed.characters.forEach((name) => {
      if (!next[name]) {
        next[name] = isUpload
          ? { ...defaults[name], stylePrompt: '' }
          : defaults[name];
      }
    });

    setCast(next);
    setActiveTurnIndex(0);
  };

  /** Saves user edits made to the script, re-parses dialogue turns, and updates the cast. */
  const handleSaveScript = (nextScript: string) => {
    globalAudioPlayer.stop();
    audioCacheRef.current = {};
    setAudioCache({});
    setRawScript(nextScript);

    const parsed = parseScreenplay(nextScript);
    const isDemo = nextScript === DEMO.content;
    const defaults = generateDefaultCast(parsed.characters, true, !isDemo);

    setCast((prev) => {
      const nextCast: Record<string, CharacterProfile> = {};

      parsed.characters.forEach((charName, i) => {
        if (prev[charName]) {
          nextCast[charName] = prev[charName];
        } else if (defaults[charName]) {
          nextCast[charName] = {
            ...defaults[charName],
            stylePrompt: isDemo ? defaults[charName].stylePrompt : '',
            color: CAST_COLORS[i % CAST_COLORS.length],
          };
        }
      });

      if (prev['NARRATOR']) {
        nextCast['NARRATOR'] = prev['NARRATOR'];
      }

      return nextCast;
    });

    setActiveTurnIndex(0);
    const dialogueCount = parsed.elements.filter((e) => e.type === 'dialogue').length;
    setNotice(
      `Script draft updated: ${dialogueCount} dialogue ${dialogueCount === 1 ? 'line' : 'lines'} across ${parsed.characters.length} ${parsed.characters.length === 1 ? 'character' : 'characters'}.`
    );
  };

  /**
   * Sets the stage direction on one or more lines, keyed by turn index. The
   * direction is written into the script itself, so it shows everywhere the
   * script does and survives an edit of the raw text.
   */
  const handleSetDirections = (edits: Record<number, string>) => {
    // Parsed fresh rather than read from the last render: two replies from
    // Gemini can land before React has re-parsed the first one.
    const current = rawScriptRef.current;
    const { elements: latest } = parseScreenplay(current);
    const changed = Object.keys(edits)
      .map(Number)
      .filter((i) => {
        const turn = latest.find((e) => e.type === 'dialogue' && e.turnIndex === i);
        return turn && cleanDirection(turn.parenthetical ?? '') !== cleanDirection(edits[i]);
      });
    if (changed.length === 0) return;

    const next = writeDirections(current, latest, edits);
    if (next === current) return;

    const pending = carryAudioRef.current;
    carryAudioRef.current = {
      before: pending?.before ?? elementsRef.current,
      changed: new Set([...(pending?.changed ?? []), ...changed]),
    };
    rawScriptRef.current = next;
    setRawScript(next);
  };

  /** Has Gemini direct the given lines, or every line when none are given. */
  const handleSuggestDirections = async (targets?: number[]) => {
    const asked = dialogueTurns;
    const lines = asked.map((turn) => ({
      speaker: turn.character,
      text: turn.text,
      direction: turn.parenthetical,
    }));
    if (lines.length === 0) return;
    const wanted = targets ?? lines.map((_, i) => i);

    setDirectingTurns((prev) => Array.from(new Set([...prev, ...wanted])));
    try {
      const response = await fetch('/api/direct-lines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines, targets: wanted }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `Server responded with ${response.status}`);

      // The script may have moved on while Gemini was thinking; only land a
      // direction on a line that still says what it said when we asked.
      const live = elementsRef.current.filter((e) => e.type === 'dialogue');
      const edits: Record<number, string> = {};
      for (const item of data.directions ?? []) {
        const then = asked[item.index];
        const now = live[item.index];
        if (then && now && then.text === now.text && then.character === now.character) {
          edits[item.index] = item.direction;
        }
      }
      handleSetDirections(edits);
    } catch (err: any) {
      console.error('Direct lines error:', err);
      setNotice(`Couldn't direct ${wanted.length === 1 ? 'that line' : 'the scene'}: ${err.message}`);
    } finally {
      setDirectingTurns((prev) => prev.filter((i) => !wanted.includes(i)));
    }
  };

  /** Reads a script in. False means nothing loaded and the notice says why. */
  const handleUploadScript = async (
    content: string,
    title?: string,
    pdfBase64?: string
  ): Promise<boolean> => {
    globalAudioPlayer.stop();
    setScriptTitle(title || 'Uploaded script');

    setIsAnalyzingScript(true);
    setNotice(null);

    try {
      const response = await fetch('/api/analyze-and-format-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawScript: content || '', pdfBase64, analyzeWithAI: true }),
      });

      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        throw new Error(failure.error || `Server responded with ${response.status}`);
      }

      const data: ScriptAnalysisResult = await response.json();
      const script = data.formattedScript || content;
      if (!script) throw new Error('No screenplay text could be read out of that file.');

      applyAnalysis(script, data.characters, true);
      if (data.backchannelWarning) setNotice(data.backchannelWarning);
      return true;
    } catch (err: any) {
      console.error('Upload error:', err);
      setNotice(`Couldn't read that script: ${err.message}`);
      // Raw pages are still readable unanalysed; a PDF we couldn't parse isn't.
      if (!content) return false;
      applyAnalysis(content, undefined, true);
      return true;
    } finally {
      setIsAnalyzingScript(false);
    }
  };

  /** Skips the upload and reads the scene the directions were written for. */
  const handleUseSample = () => {
    globalAudioPlayer.stop();
    setScriptTitle(DEMO.title);
    applyAnalysis(DEMO.content, undefined, false);
    setNotice(null);
    setView('read');
  };

  const handleFormatWithAI = async () => {
    setIsFormatting(true);
    setNotice(null);

    try {
      const response = await fetch('/api/analyze-and-format-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawScript }),
      });
      const data: ScriptAnalysisResult = await response.json();
      if (data.formattedScript) {
        // Keep existing user-configured sustained directions intact
        const existingStyles: Record<string, string> = {};
        Object.keys(castRef.current).forEach((k) => {
          existingStyles[k] = castRef.current[k].stylePrompt;
        });

        applyAnalysis(data.formattedScript, data.characters, false);
        if (data.backchannelWarning) setNotice(data.backchannelWarning);

        setCast((current) => {
          const preserved = { ...current };
          Object.keys(existingStyles).forEach((k) => {
            if (preserved[k] && existingStyles[k]) {
              preserved[k] = { ...preserved[k], stylePrompt: existingStyles[k] };
            }
          });
          return preserved;
        });
      }
    } catch (err: any) {
      console.error('Format error:', err);
      setNotice('AI formatting failed; check the server connection.');
    } finally {
      setIsFormatting(false);
    }
  };

  const handleAuditionVoice = async (name: string) => {
    const profile = cast[name];
    if (!profile) return;
    setAuditioningCharacter(name);

    try {
      const response = await fetch('/api/audition-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voice: profile.voice,
          characterName: name,
          style: profile.stylePrompt?.trim() || `${profile.accent} accent, natural acting delivery`,
        }),
      });
      const data = await response.json();
      if (!data.audioUrl) {
        setAuditioningCharacter(null);
        return;
      }
      const audio = new Audio(data.audioUrl);
      audio.onended = () => setAuditioningCharacter(null);
      audio.onerror = () => setAuditioningCharacter(null);
      await audio.play();
    } catch (err: any) {
      console.error('Audition error:', err);
      setNotice(`Audition failed: ${err.message}`);
      setAuditioningCharacter(null);
    }
  };

  const openDrawer = (tab: typeof drawerTab) => {
    setDrawerTab(tab);
    setIsDrawerOpen(true);
  };

  const geminiTtsPayload = useMemo(
    () => buildGeminiTtsPayload(elements, cast, false, direction),
    [elements, cast, direction]
  );

  // The caption over the performer: the writer's own beat when the script is
  // being honoured, layered with the active direction name.
  const rawParenthetical = currentTurn?.parenthetical?.trim();
  const formattedParen = rawParenthetical
    ? rawParenthetical.startsWith('(') && rawParenthetical.endsWith(')')
      ? rawParenthetical
      : `(${rawParenthetical})`
    : undefined;

  const captionLabel = formattedParen
    ? `${formattedParen} · ${direction.name}`
    : direction.name;

  // Who the stage and the plate both light up: whoever the player says is
  // mid-line, falling back to the speaker of the line under the playhead.
  const liveSpeaker = speakingSpeaker ?? currentTurn?.character ?? null;

  const noticeStrip = notice && <Notice text={notice} onDismiss={() => setNotice(null)} />;

  if (view === 'landing' || view === 'casting') {
    return (
      <>
        <Landing
          sampleTitle={DEMO.title}
          sampleLogline={DEMO.logline}
          onUploadScript={handleUploadScript}
          onLoaded={() => setView('casting')}
          isAnalyzing={isAnalyzingScript}
          onUseSample={handleUseSample}
          script={
            view === 'casting'
              ? {
                  title: scriptTitle,
                  performers,
                  cast,
                  turnCount: dialogueTurns.length,
                  onUpdateCastMember: (name, updated) =>
                    setCast((prev) => ({ ...prev, [name]: { ...prev[name], ...updated } })),
                  onAuditionVoice: handleAuditionVoice,
                  auditioningCharacter,
                  onReadScene: () => setView('read'),
                  onStartOver: () => setView('landing'),
                  onEditDraft: () => openDrawer('edit'),
                  page: (
                    <ScriptPane
                      kicker="Stage directions, line by line"
                      title={scriptTitle}
                      elements={elements}
                      cast={cast}
                      activeTurnIndex={-1}
                      onEditScript={() => openDrawer('edit')}
                      onSetDirections={handleSetDirections}
                      onSuggestDirections={handleSuggestDirections}
                      directingTurns={directingTurns}
                    />
                  ),
                }
              : undefined
          }
          notice={noticeStrip}
          onOpenSavedAudio={() => setIsSavedAudioOpen(true)}
        />

        <UploadModal
          isOpen={isUploadOpen}
          onClose={() => setIsUploadOpen(false)}
          onUploadScript={handleUploadScript}
          onLoaded={() => {
            setIsUploadOpen(false);
            setView('casting');
          }}
          isAnalyzing={isAnalyzingScript}
        />

        <ScriptDrawer
          isOpen={isDrawerOpen}
          onClose={() => setIsDrawerOpen(false)}
          rawScript={rawScript}
          onSaveScript={handleSaveScript}
          elements={elements}
          onFormatWithAI={handleFormatWithAI}
          isFormatting={isFormatting}
          initialTab={drawerTab}
          cast={cast}
          onUpdateCastMember={(name, updated) =>
            setCast((prev) => ({ ...prev, [name]: { ...prev[name], ...updated } }))
          }
          onAuditionVoice={handleAuditionVoice}
          auditioningCharacter={auditioningCharacter}
          geminiTtsPayload={geminiTtsPayload}
        />

        <SavedAudioModal
          isOpen={isSavedAudioOpen}
          onClose={() => setIsSavedAudioOpen(false)}
          onDownloadCurrentScene={handleDownloadAudio}
          isDownloadingCurrentScene={isDownloadingAudio}
          currentScriptTitle={scriptTitle}
          currentDirectionName={direction.name}
        />
      </>
    );
  }

  return (
    /**
     * Locked to the viewport only once the layout goes two-column, where the
     * script is the one thing that scrolls. Narrower than that the page scrolls
     * as a page: height-capping the columns there just squeezes the stage.
     */
    <div className="min-h-screen lg:h-screen flex flex-col bg-paper text-ink font-sans lg:overflow-hidden">
      <Header
        onOpenUpload={() => setIsUploadOpen(true)}
        onOpenCast={() => openDrawer('cast')}
        onOpenSavedAudio={() => setIsSavedAudioOpen(true)}
      />

      {noticeStrip}

      <main className="flex-1 lg:min-h-0 w-full max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-5 grid gap-6 lg:gap-8 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] lg:overflow-hidden">
        <section className="flex flex-col gap-4 lg:min-h-0">
          <Stage
            performers={performers}
            speakingName={liveSpeaker}
            lineOwner={currentTurn?.character}
            currentLine={currentTurn?.text}
            directionLabel={captionLabel}
            interjection={interjection}
            isPlaying={isPlaying}
          />

          <VoicePlate
            performers={performers}
            direction={direction}
            liveTurn={currentTurn}
            speakingName={liveSpeaker}
          />

          <Transport
            isPlaying={isPlaying}
            isSynthesizing={isSynthesizing}
            activeTurnIndex={activeTurnIndex}
            turnCount={dialogueTurns.length}
            loadedCount={loadedTurnCount}
            speaker={currentTurn?.character}
            onTogglePlay={handleTogglePlay}
            onPrev={handlePrev}
            onNext={handleNext}
            onDownloadAudio={handleDownloadAudio}
            isDownloadingAudio={isDownloadingAudio}
          />

          <DirectionBar
            directions={DIRECTIONS}
            activeId={directionId}
            readyIds={readyDirectionIds}
            busyId={busyDirectionId}
            onSelect={handleSelectDirection}
          />
        </section>

        <aside className="h-[70vh] lg:h-full lg:min-h-0">
          <ScriptPane
            title={scriptTitle}
            elements={elements}
            cast={cast}
            activeTurnIndex={activeTurnIndex}
            liveInterjection={interjection?.text}
            onSelectTurn={handleSelectTurn}
            onEditScript={() => openDrawer('edit')}
            onSetDirections={handleSetDirections}
            onSuggestDirections={handleSuggestDirections}
            directingTurns={directingTurns}
          />
        </aside>
      </main>

      <Footer />

      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onUploadScript={handleUploadScript}
        // A new script arrives uncast, so it goes through the cast first too.
        onLoaded={() => {
          setIsUploadOpen(false);
          setView('casting');
        }}
        isAnalyzing={isAnalyzingScript}
      />

      <ScriptDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        rawScript={rawScript}
        onSaveScript={handleSaveScript}
        elements={elements}
        onFormatWithAI={handleFormatWithAI}
        isFormatting={isFormatting}
        initialTab={drawerTab}
        cast={cast}
        onUpdateCastMember={(name, updated) =>
          setCast((prev) => ({ ...prev, [name]: { ...prev[name], ...updated } }))
        }
        onAuditionVoice={handleAuditionVoice}
        auditioningCharacter={auditioningCharacter}
        geminiTtsPayload={geminiTtsPayload}
      />

      <SavedAudioModal
        isOpen={isSavedAudioOpen}
        onClose={() => setIsSavedAudioOpen(false)}
        onDownloadCurrentScene={handleDownloadAudio}
        isDownloadingCurrentScene={isDownloadingAudio}
        currentScriptTitle={scriptTitle}
        currentDirectionName={direction.name}
      />
    </div>
  );
}
