import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Gauge,
  MessageSquarePlus,
  Pause,
  Play,
  Square,
  UsersRound,
  Volume2,
} from 'lucide-react';
import {
  BrowserSpeechDriver,
  ReadAloudController,
  collectCharacterVoiceAssignments,
  segmentReadAloudBlocks,
  voicePreferenceKey,
  type ReadAloudBlock,
  type ReadAloudGranularity,
  type ReadAloudLocale,
  type ReadAloudMode,
  type ReadAloudNoteAnchor,
  type ReadAloudSegment,
  type SpeechDriver,
} from '@/services/readAloud';
import { getReadAloudCopy, type ReadAloudCopy } from './copy';

const EMPTY_VOICE_PREFERENCES: Readonly<Record<string, string | undefined>> = {};

export interface ReadAloudPanelProps {
  blocks: readonly ReadAloudBlock[];
  mode?: ReadAloudMode;
  locale?: ReadAloudLocale;
  copy?: Partial<ReadAloudCopy>;
  initialGranularity?: ReadAloudGranularity;
  initialRate?: number;
  voicePreferences?: Readonly<Record<string, string | undefined>>;
  onVoicePreferenceChange?: (key: string, voiceURI: string | undefined) => void | Promise<void>;
  onCreateNote?: (anchor: ReadAloudNoteAnchor) => void | Promise<void>;
  onJumpToSource?: (anchor: ReadAloudNoteAnchor) => void | Promise<void>;
  speechDriver?: SpeechDriver;
  className?: string;
}

function anchorFor(segment: ReadAloudSegment): ReadAloudNoteAnchor {
  return {
    sourceId: segment.sourceId,
    sourceKind: segment.sourceKind,
    blockId: segment.sourceKind === 'dialog-block' ? segment.sourceId : segment.id,
    segmentId: segment.segmentId,
    segmentIndex: segment.segmentIndex,
    startOffset: segment.startOffset,
    endOffset: segment.endOffset,
    quote: segment.text,
    characterId: segment.characterId,
    characterName: segment.characterName,
  };
}

function isFormControl(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && Boolean(target.closest('input, textarea, select, button, [contenteditable="true"]'));
}

function kindLabel(segment: ReadAloudSegment, copy: ReadAloudCopy): string {
  const labels = {
    prose: copy.kindProse,
    dialogue: copy.kindDialogue,
    'stage-direction': copy.kindStageDirection,
    action: copy.kindAction,
    transition: copy.kindTransition,
    note: copy.kindNote,
    slug: copy.kindSlug,
  };
  return labels[segment.kind];
}

function playbackStatusLabel(
  status: ReturnType<ReadAloudController['getSnapshot']>['status'],
  copy: ReadAloudCopy,
): string {
  if (status === 'playing') return copy.stateCurrent;
  if (status === 'paused') return copy.statePaused;
  if (status === 'finished') return copy.stateFinished;
  if (status === 'error') return copy.stateError;
  return copy.stateStopped;
}

export default function ReadAloudPanel({
  blocks,
  mode = 'read-aloud',
  locale = 'es',
  copy: copyOverrides,
  initialGranularity = 'sentence',
  initialRate = 1,
  voicePreferences = EMPTY_VOICE_PREFERENCES,
  onVoicePreferenceChange,
  onCreateNote,
  onJumpToSource,
  speechDriver,
  className = '',
}: ReadAloudPanelProps) {
  const copy = useMemo(() => getReadAloudCopy(locale, copyOverrides), [copyOverrides, locale]);
  const [granularity, setGranularity] = useState<ReadAloudGranularity>(initialGranularity);
  const [voiceOverrides, setVoiceOverrides] = useState<Record<string, string | undefined>>({});
  const [announcement, setAnnouncement] = useState('');
  const titleId = useId();
  const granularityId = useId();
  const rateId = useId();
  const rootRef = useRef<HTMLElement>(null);

  const driver = useMemo(() => speechDriver ?? new BrowserSpeechDriver(), [speechDriver]);
  const [voices, setVoices] = useState(() => driver.getVoices());
  const resolvedVoicePreferences = useMemo(
    () => ({ ...voicePreferences, ...voiceOverrides }),
    [voiceOverrides, voicePreferences],
  );
  const segments = useMemo(
    () => segmentReadAloudBlocks(blocks, granularity, locale),
    [blocks, granularity, locale],
  );
  // The cast is not part of the controller's identity: picking a character's
  // voice mid-read used to build a new controller, which stopped the speech
  // and sent the table read back to line 1. The controller reads the cast at
  // each line it speaks, so handing it the new one is enough.
  const controller = useMemo(
    () => new ReadAloudController({ driver, segments, locale, rate: initialRate }),
    [driver, initialRate, locale, segments],
  );
  useEffect(() => {
    controller.setVoicePreferences(resolvedVoicePreferences);
  }, [controller, resolvedVoicePreferences]);
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  // Stop, not destroy: the memoised controller outlives StrictMode's
  // unmount/remount of this effect, and a destroyed one never speaks again
  // (tasks/lessons #19). `stop` silences it and voids its pending callbacks
  // just the same, and leaves the remounted panel a controller that plays.
  useEffect(() => () => controller.stop(), [controller]);

  useEffect(() => {
    return driver.subscribeVoices?.(() => setVoices(driver.getVoices()));
  }, [driver]);

  useEffect(() => {
    rootRef.current
      ?.querySelector<HTMLElement>('[data-read-aloud-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [snapshot.activeIndex]);

  const assignments = useMemo(
    () => collectCharacterVoiceAssignments(blocks, resolvedVoicePreferences),
    [blocks, resolvedVoicePreferences],
  );
  const completed = useMemo(() => new Set(snapshot.completedIndexes), [snapshot.completedIndexes]);

  const runHostAction = async (
    action: ((anchor: ReadAloudNoteAnchor) => void | Promise<void>) | undefined,
    segment: ReadAloudSegment,
    success: string,
    failure: string,
  ) => {
    if (!action) return;
    try {
      await action(anchorFor(segment));
      setAnnouncement(success);
    } catch {
      setAnnouncement(failure);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (isFormControl(event.target)) return;
    if (event.key === ' ') {
      event.preventDefault();
      controller.toggle();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      controller.skip(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      controller.skip(-1);
    } else if (event.key === 'Escape') {
      controller.stop();
    }
  };

  const isPlaying = snapshot.status === 'playing';
  const isPaused = snapshot.status === 'paused';
  const active = segments[snapshot.activeIndex];
  const rate = snapshot.rate;
  const title = mode === 'table-read' ? copy.tableReadTitle : copy.readAloudTitle;

  return (
    <section
      ref={rootRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-labelledby={titleId}
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface outline-none focus-visible:ring-2 focus-visible:ring-accent-gold/70 ${className}`}
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-[12rem] flex-1 items-center gap-2.5">
          {mode === 'table-read'
            ? <UsersRound size={19} className="text-accent-gold" aria-hidden="true" />
            : <Volume2 size={19} className="text-accent-gold" aria-hidden="true" />}
          <div>
            <h2 id={titleId} className="font-serif text-lg font-bold text-text-primary">{title}</h2>
            <p className="text-[11px] text-text-dim">{copy.keyboardHelp}</p>
          </div>
        </div>

        <div className="flex items-center gap-1" aria-label={title}>
          <button
            type="button"
            onClick={() => controller.skip(-1)}
            disabled={segments.length === 0 || snapshot.activeIndex <= 0}
            aria-label={copy.previous}
            title={copy.previous}
            className="rounded-lg border border-border p-2 text-text-muted transition hover:bg-elevated hover:text-text-primary disabled:opacity-35"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => controller.toggle()}
            disabled={!snapshot.supported || segments.length === 0}
            aria-label={isPlaying ? copy.pause : isPaused ? copy.resume : copy.play}
            className="flex min-w-[7.5rem] items-center justify-center gap-2 rounded-lg bg-accent-gold px-3 py-2 text-sm font-semibold text-deep transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isPlaying
              ? <Pause size={16} aria-hidden="true" />
              : <Play size={16} aria-hidden="true" />}
            {isPlaying ? copy.pause : isPaused ? copy.resume : copy.play}
          </button>
          <button
            type="button"
            onClick={() => controller.stop()}
            disabled={!isPlaying && !isPaused}
            aria-label={copy.stop}
            title={copy.stop}
            className="rounded-lg border border-border p-2 text-text-muted transition hover:bg-elevated hover:text-text-primary disabled:opacity-35"
          >
            <Square size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => controller.skip(1)}
            disabled={segments.length === 0 || snapshot.activeIndex >= segments.length - 1}
            aria-label={copy.next}
            title={copy.next}
            className="rounded-lg border border-border p-2 text-text-muted transition hover:bg-elevated hover:text-text-primary disabled:opacity-35"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-border bg-deep/35 px-4 py-3">
        <label htmlFor={granularityId} className="grid gap-1 text-[11px] font-medium text-text-muted">
          {copy.segmentation}
          <select
            id={granularityId}
            value={granularity}
            onChange={(event) => setGranularity(event.target.value as ReadAloudGranularity)}
            className="rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-accent-gold"
          >
            <option value="sentence">{copy.sentence}</option>
            <option value="block">{copy.block}</option>
          </select>
        </label>

        <label htmlFor={rateId} className="grid min-w-[13rem] flex-1 gap-1 text-[11px] font-medium text-text-muted">
          <span className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5"><Gauge size={13} aria-hidden="true" />{copy.speed}</span>
            <output htmlFor={rateId} className="tabular-nums text-text-primary">{rate.toFixed(1)}×</output>
          </span>
          <input
            id={rateId}
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={rate}
            onChange={(event) => controller.setRate(Number(event.target.value))}
            className="accent-accent-gold"
          />
        </label>

        <p role="status" aria-live="polite" className="min-w-[9rem] text-xs text-text-muted">
          {playbackStatusLabel(snapshot.status, copy)}
          {active && (
            <span className="ml-1 tabular-nums text-text-dim">
              {' \u00b7 '}{copy.segmentOf
                .replace('{current}', String(snapshot.activeIndex + 1))
                .replace('{total}', String(segments.length))}
            </span>
          )}
        </p>
      </div>

      {!snapshot.supported && (
        <p role="alert" className="border-b border-border bg-danger/10 px-4 py-3 text-sm text-text-primary">
          {copy.unsupported}
        </p>
      )}
      {snapshot.supported && !snapshot.boundaryEvents && (
        <p className="border-b border-border px-4 py-2 text-xs text-text-dim">{copy.noBoundary}</p>
      )}
      {snapshot.error && (
        <p role="alert" className="border-b border-border bg-danger/10 px-4 py-2 text-sm text-text-primary">
          {copy.stateError}: {snapshot.error}
        </p>
      )}

      {mode === 'table-read' && assignments.length > 0 && (
        <fieldset className="border-b border-border px-4 py-3">
          <legend className="px-1 text-xs font-semibold text-text-primary">{copy.voices}</legend>
          <p className="mb-2 text-[11px] text-text-dim">{copy.voicesHint}</p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {assignments.map((assignment) => (
              <label key={assignment.key} className="flex min-w-0 items-center gap-2 text-xs text-text-muted">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: assignment.color || 'var(--color-accent-gold)' }}
                />
                <span className="w-24 flex-shrink-0 truncate font-semibold text-text-primary">
                  {assignment.characterName}
                </span>
                <select
                  aria-label={`${copy.voices}: ${assignment.characterName}`}
                  value={assignment.voiceURI ?? ''}
                  onChange={(event) => {
                    const voiceURI = event.target.value || undefined;
                    setVoiceOverrides((current) => ({ ...current, [assignment.key]: voiceURI }));
                    void onVoicePreferenceChange?.(assignment.key, voiceURI);
                  }}
                  className="min-w-0 flex-1 rounded-lg border border-border bg-elevated px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent-gold"
                >
                  <option value="">{copy.systemDefaultVoice}</option>
                  {voices.map((voice) => (
                    <option key={voice.voiceURI} value={voice.voiceURI}>
                      {voice.name} {' \u00b7 '}{voice.lang}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {voices.length === 0 && <p className="mt-2 text-xs italic text-text-dim">{copy.noVoices}</p>}
        </fieldset>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <h3 className="sr-only">{copy.transcript}</h3>
        {segments.length === 0 ? (
          <p className="px-3 py-10 text-center text-sm italic text-text-dim">{copy.empty}</p>
        ) : (
          <ol className="space-y-1.5">
            {segments.map((segment, index) => {
              const current = index === snapshot.activeIndex;
              const done = completed.has(index);
              const state = current
                ? playbackStatusLabel(snapshot.status, copy)
                : done ? copy.stateDone : copy.stateQueued;
              const isDirection = segment.kind === 'stage-direction';
              const speaker = segment.kind === 'dialogue' ? segment.characterName : undefined;
              const preference = voicePreferenceKey(segment);
              return (
                <li
                  key={segment.segmentId}
                  data-read-aloud-active={current ? 'true' : undefined}
                  data-read-aloud-state={current ? 'current' : done ? 'done' : 'queued'}
                  className={`group grid grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-2 rounded-lg px-2 py-2 transition ${
                    current
                      ? 'bg-accent-gold/12 text-text-primary ring-1 ring-inset ring-accent-gold/45'
                      : done
                        ? 'text-text-dim'
                        : 'text-text-muted hover:bg-elevated/60'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => controller.jumpTo(index)}
                    aria-label={`${state}: ${index + 1}`}
                    title={`${state}: ${index + 1}`}
                    className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-md text-[11px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-accent-gold"
                  >
                    {done && !current ? <Check size={14} aria-hidden="true" /> : index + 1}
                  </button>

                  <button
                    type="button"
                    onClick={() => controller.jumpTo(index)}
                    aria-current={current ? 'step' : undefined}
                    className="min-w-0 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-accent-gold"
                  >
                    <span className="mb-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] uppercase tracking-wider text-text-dim">
                      {speaker && (
                        <strong className="normal-case tracking-normal text-text-primary">
                          {speaker}
                        </strong>
                      )}
                      <span>{kindLabel(segment, copy)}</span>
                      {preference && resolvedVoicePreferences[preference] && (
                        <Volume2 size={11} aria-label={copy.voices} />
                      )}
                      <span className="sr-only">{state}</span>
                    </span>
                    <span className={`block text-sm leading-relaxed ${isDirection ? 'text-center italic text-text-dim' : ''}`}>
                      {segment.text}
                    </span>
                  </button>

                  <span className="flex items-center gap-1 opacity-60 transition group-hover:opacity-100 group-focus-within:opacity-100">
                    {onCreateNote && (
                      <button
                        type="button"
                        onClick={() => void runHostAction(onCreateNote, segment, copy.noteCreated, copy.noteFailed)}
                        aria-label={copy.createNote}
                        title={copy.createNote}
                        className="rounded-md p-1.5 text-text-muted outline-none transition hover:bg-deep hover:text-accent-gold focus-visible:ring-2 focus-visible:ring-accent-gold"
                      >
                        <MessageSquarePlus size={15} aria-hidden="true" />
                      </button>
                    )}
                    {onJumpToSource && (
                      <button
                        type="button"
                        onClick={() => void runHostAction(onJumpToSource, segment, copy.sourceOpened, copy.sourceFailed)}
                        aria-label={copy.jumpToSource}
                        title={copy.jumpToSource}
                        className="rounded-md p-1.5 text-text-muted outline-none transition hover:bg-deep hover:text-accent-gold focus-visible:ring-2 focus-visible:ring-accent-gold"
                      >
                        <ExternalLink size={15} aria-hidden="true" />
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    </section>
  );
}
