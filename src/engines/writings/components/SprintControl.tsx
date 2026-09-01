import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Timer, Play, ChevronDown, Square, X, Check } from 'lucide-react';
// The non-reactive `t` is imported alongside the hook on purpose: strings
// read inside callbacks must not put the reactive `t` — a fresh identity on
// every render — into a dependency array that the running clock depends on.
import { useTranslation, t as translate } from '@/i18n/useTranslation';
import { toast } from '@/components/common/toast';
import { ConfirmDialog } from '@/engines/_shared';
import {
  DEFAULT_SPRINT_PREFS,
  SPRINT_PRESETS,
  beginSprint,
  clampMinutes,
  clampTarget,
  endSprint,
  formatCountdown,
  minutesBetween,
  peekActiveSprint,
  peekSprintPrefs,
  readSprintPrefs,
  reconcileSprint,
  targetMet,
} from '@/engines/writing-stats/sprints';
import type {
  ActiveSprint,
  SprintPrefs,
  SprintRecord,
} from '@/engines/writing-stats/types';

interface SprintControlProps {
  projectId: string;
  /** The writing open right now, filed with the sprint when there is one. */
  writingId?: string;
  /**
   * The project's live word count: every writing's saved count, plus whatever
   * the open document has gained since its last autosave.
   *
   * MUST be stable across renders. The countdown calls it once a second from
   * inside an interval that is set up once per sprint; a new identity every
   * render would tear that interval down and rebuild it sixty times a minute.
   */
  getProjectWords: () => number;
}

/**
 * Start / run / finish a writing sprint, from the writings toolbar.
 *
 * The clock is deliberately NOT React state. A sprint is up to 45 minutes of
 * ticks, and the editor it sits next to is the most expensive subtree in the
 * app — re-rendering it every second to move two digits is exactly the trap
 * `TeleprompterView` was rewritten to escape. The interval writes straight
 * into two small text nodes through refs; the component itself re-renders only
 * when the sprint actually changes state (started, finished, dismissed).
 *
 * Nothing here counts time. Remaining time is `endsAt - now` on every tick, so
 * a throttled background window, a route change, or a restart of the app all
 * produce the same answer.
 */
function SprintControl({ projectId, writingId, getProjectWords }: SprintControlProps) {
  const { t } = useTranslation();

  // Seeded from what this session already knows, so a remount paints a running
  // sprint immediately instead of flashing a "start" button for a frame. Lazy
  // initialisers: these read module state and must run once, not every render.
  const [active, setActive] = useState<ActiveSprint | null>(
    () => peekActiveSprint(projectId) ?? null,
  );
  const [ready, setReady] = useState(() => peekActiveSprint(projectId) !== undefined);
  const [finished, setFinished] = useState<SprintRecord | null>(null);
  const [prefs, setPrefs] = useState<SprintPrefs>(() => peekSprintPrefs() ?? DEFAULT_SPRINT_PREFS);

  const [setupOpen, setSetupOpen] = useState(false);
  const [draftMinutes, setDraftMinutes] = useState('');
  const [draftTarget, setDraftTarget] = useState('');
  const [confirmStop, setConfirmStop] = useState(false);

  const clockNodeRef = useRef<HTMLSpanElement>(null);
  const wordsNodeRef = useRef<HTMLSpanElement>(null);
  // One sprint can only be filed once: the tick that reaches zero and a click
  // on Stop can land in the same moment, and both would otherwise append.
  const filingRef = useRef(false);
  // True once the writer has started or ended a sprint here. The initial read
  // below is a few milliseconds long, and a decision already made must not be
  // overwritten by an answer that was already stale when it arrived.
  const touchedRef = useRef(false);

  // Rehydrate on mount — a remount is what happens every time the author walks
  // list → chapter → list, and what happens when the app is reopened.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [reconciled, storedPrefs] = await Promise.all([
          reconcileSprint(projectId, getProjectWords()),
          readSprintPrefs(),
        ]);
        if (cancelled) return;
        if (!touchedRef.current) {
          setPrefs(storedPrefs);
          setActive(reconciled.active);
          if (reconciled.finished) setFinished(reconciled.finished);
        }
        setReady(true);
      } catch (err) {
        console.error('[writings] could not read the sprint state', err);
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, getProjectWords]);

  const fileSprint = useCallback(
    async (sprint: ActiveSprint, stopped: boolean) => {
      if (filingRef.current) return;
      filingRef.current = true;
      touchedRef.current = true;
      try {
        const record = await endSprint(sprint, {
          words: getProjectWords() - sprint.baselineWords,
          stopped,
        });
        setActive(null);
        setFinished(record);
      } catch (err) {
        console.error('[writings] could not file the sprint', err);
        toast.error(translate('stats.sprint.saveError'));
        setActive(null);
      } finally {
        filingRef.current = false;
      }
    },
    [getProjectWords],
  );

  // The clock. Runs once per sprint, ticks once a second, and never calls
  // setState until the sprint is over.
  //
  // A layout effect, not a passive one: the first paint has to land before the
  // browser draws, or resuming a sprint flashes the full duration for a frame
  // before snapping to the real remaining time.
  useLayoutEffect(() => {
    if (!active) return;
    const sprint = active;

    const paint = (): number => {
      const remaining = sprint.endsAt - Date.now();
      const clock = clockNodeRef.current;
      if (clock) clock.textContent = formatCountdown(remaining);
      const words = wordsNodeRef.current;
      if (words) {
        const written = Math.max(0, getProjectWords() - sprint.baselineWords);
        words.textContent =
          sprint.targetWords > 0
            ? `${written.toLocaleString()} / ${sprint.targetWords.toLocaleString()}`
            : written.toLocaleString();
      }
      return remaining;
    };

    if (paint() <= 0) {
      void fileSprint(sprint, false);
      return;
    }

    const timer = window.setInterval(() => {
      if (paint() > 0) return;
      window.clearInterval(timer);
      void fileSprint(sprint, false);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [active, getProjectWords, fileSprint]);

  // Close the setup popover on any click outside it — the same dismissal the
  // writings card menu uses.
  useEffect(() => {
    if (!setupOpen) return;
    const handler = () => setSetupOpen(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [setupOpen]);

  const start = useCallback(
    async (durationMinutes: number, targetWords: number) => {
      touchedRef.current = true;
      try {
        const sprint = await beginSprint({
          projectId,
          durationMinutes,
          targetWords,
          baselineWords: getProjectWords(),
          writingId,
        });
        filingRef.current = false;
        setPrefs({
          durationMinutes: minutesBetween(sprint.startedAt, sprint.endsAt),
          targetWords: sprint.targetWords,
        });
        setFinished(null);
        setSetupOpen(false);
        setActive(sprint);
        toast.success(
          translate('stats.sprint.started').replace(
            '{minutes}',
            String(minutesBetween(sprint.startedAt, sprint.endsAt)),
          ),
        );
      } catch (err) {
        console.error('[writings] could not start the sprint', err);
        toast.error(translate('stats.sprint.startError'));
      }
    },
    [projectId, writingId, getProjectWords],
  );

  const openSetup = useCallback(() => {
    setDraftMinutes(String(prefs.durationMinutes));
    setDraftTarget(prefs.targetWords > 0 ? String(prefs.targetWords) : '');
    setSetupOpen(true);
  }, [prefs]);

  // Nothing is drawn until the stored state is known: a "start" button that
  // turns into a running clock a frame later reads like a glitch.
  if (!ready) return null;

  // ---- Running ----------------------------------------------------------
  if (active) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg border border-accent-gold/40 bg-accent-gold/10">
        <Timer size={14} className="text-accent-gold flex-shrink-0" />
        {/* Both of these are written by the clock, never by React. Rendering
            them empty is the point: a value in the JSX would be React's to
            own, and it would put the stale one back on the next re-render. */}
        <span
          ref={clockNodeRef}
          className="text-sm font-mono font-semibold text-accent-gold tabular-nums"
          title={t('stats.sprint.remaining')}
        />
        <span className="text-xs text-text-muted" title={t('stats.sprint.wordsSoFar')}>
          <span ref={wordsNodeRef} className="tabular-nums" /> {t('writings.words')}
        </span>
        <button
          onClick={() => setConfirmStop(true)}
          className="p-1 rounded text-text-muted hover:text-danger transition"
          title={t('stats.sprint.stop')}
        >
          <Square size={13} />
        </button>

        <ConfirmDialog
          open={confirmStop}
          title={t('stats.sprint.stop')}
          message={t('stats.sprint.confirmStop')}
          confirmLabel={t('stats.sprint.stop')}
          onConfirm={() => {
            setConfirmStop(false);
            void fileSprint(active, true);
          }}
          onCancel={() => setConfirmStop(false)}
        />
      </div>
    );
  }

  // ---- Just finished ----------------------------------------------------
  if (finished) {
    const met = targetMet(finished);
    const detail = t('stats.sprint.result')
      .replace('{words}', finished.actualWords.toLocaleString())
      .replace('{minutes}', String(minutesBetween(finished.startedAt, finished.endedAt)));
    const verdict =
      finished.targetWords > 0
        ? met
          ? t('stats.sprint.targetMet')
          : t('stats.sprint.targetMissed').replace(
              '{target}',
              finished.targetWords.toLocaleString(),
            )
        : null;

    return (
      <div className="flex items-center gap-2.5 px-2.5 py-1 rounded-lg border border-accent-gold/30 bg-accent-gold/10">
        <Check size={14} className={met ? 'text-success' : 'text-accent-gold'} />
        <div className="leading-tight">
          <p className="text-xs font-semibold text-text-primary">
            {finished.stopped ? t('stats.sprint.stoppedTitle') : t('stats.sprint.finishedTitle')}
          </p>
          <p className="text-[11px] text-text-muted">
            {detail}
            {verdict ? ` · ${verdict}` : ''}
          </p>
        </div>
        <button
          onClick={() => setFinished(null)}
          className="p-1 rounded text-text-dim hover:text-text-primary transition"
          title={t('common.dismiss')}
        >
          <X size={13} />
        </button>
      </div>
    );
  }

  // ---- Idle -------------------------------------------------------------
  const presetLabel = t('stats.sprint.minutesShort').replace(
    '{minutes}',
    String(prefs.durationMinutes),
  );

  return (
    <div className="relative flex items-center" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center border border-border rounded-lg overflow-hidden">
        {/* One click for the common case: whatever was used last time. */}
        <button
          onClick={() => void start(prefs.durationMinutes, prefs.targetWords)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-text-muted hover:text-accent-gold hover:bg-elevated transition"
          title={t('stats.startSprint')}
        >
          <Play size={14} />
          {presetLabel}
        </button>
        <button
          onClick={() => (setupOpen ? setSetupOpen(false) : openSetup())}
          className={`px-1.5 py-1.5 border-l border-border transition ${
            setupOpen
              ? 'text-accent-gold bg-elevated'
              : 'text-text-muted hover:text-accent-gold hover:bg-elevated'
          }`}
          title={t('stats.sprint.options')}
        >
          <ChevronDown size={14} />
        </button>
      </div>

      {setupOpen && (
        <div className="absolute right-0 top-full mt-2 z-50 w-64 bg-surface border border-border/80 rounded-2xl shadow-2xl p-4 space-y-3">
          <p className="text-[10px] uppercase tracking-widest text-text-dim font-semibold">
            {t('stats.sprint.duration')}
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {SPRINT_PRESETS.map((minutes) => {
              const selected = clampMinutes(draftMinutes) === minutes;
              return (
                <button
                  key={minutes}
                  onClick={() => setDraftMinutes(String(minutes))}
                  className={`px-2 py-2 rounded-xl text-xs transition ${
                    selected
                      ? 'bg-accent-gold/15 text-accent-gold font-semibold'
                      : 'text-text-muted hover:bg-elevated'
                  }`}
                >
                  {t('stats.sprint.minutesShort').replace('{minutes}', String(minutes))}
                </button>
              );
            })}
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs text-text-muted">
              {t('stats.sprint.customMinutes')}
            </label>
            <input
              value={draftMinutes}
              onChange={(e) => setDraftMinutes(e.target.value.replace(/\D/g, '').slice(0, 3))}
              inputMode="numeric"
              placeholder={String(DEFAULT_SPRINT_PREFS.durationMinutes)}
              className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold transition"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs text-text-muted">{t('stats.sprint.target')}</label>
            <input
              value={draftTarget}
              onChange={(e) => setDraftTarget(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              placeholder={t('stats.sprint.noTarget')}
              className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold transition"
            />
          </div>

          <button
            onClick={() => void start(clampMinutes(draftMinutes), clampTarget(draftTarget))}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-accent-gold text-deep font-semibold text-sm rounded-lg hover:bg-accent-amber transition"
          >
            <Play size={15} />
            {t('stats.start')}
          </button>
        </div>
      )}
    </div>
  );
}

// Memoised: every prop is stable, and the writings view above re-renders on
// every keystroke. Without this the control would reconcile — and rebuild the
// clock's interval — on each one, which is exactly the coupling the ref-driven
// countdown exists to avoid.
export default memo(SprintControl);
