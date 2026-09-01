import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Clock } from 'lucide-react';
import type { Writing } from '@/types';
import { useTranslation } from '@/i18n/useTranslation';
import { shiftLocalDateKey, toLocalDateKey } from '@/engines/writing-stats/date';
import {
  CHANGE_WINDOWS,
  changedInWindow,
  readWordDeltas,
  windowStartMs,
  type ChangeWindow,
} from '../recentChanges';

/** Shared identity for "nothing measured", so a failed read is a no-op re-render. */
const NO_DELTAS: ReadonlyMap<string, number> = new Map();

interface RecentlyChangedProps {
  projectId: string;
  writings: Writing[];
  onOpen: (writing: Writing) => void;
}

/**
 * What moved lately, above the list.
 *
 * The list sorts by manuscript order, which is the right order to write in and
 * the wrong one to come back to on a Monday: nothing in it says which five
 * chapters were touched last week. This does, with the word delta beside each
 * one where version history can supply an honest baseline — and a dash, not a
 * guess, where it cannot.
 */
export default function RecentlyChanged({ projectId, writings, onOpen }: RecentlyChangedProps) {
  const { t, locale } = useTranslation();
  const [activeWindow, setActiveWindow] = useState<ChangeWindow>('week');
  const [expanded, setExpanded] = useState(true);
  const [deltas, setDeltas] = useState<ReadonlyMap<string, number>>(NO_DELTAS);

  // One read of the calendar for both the window bound and the day labels, so
  // the two can never disagree about which day "today" is.
  const { startMs, todayKey, yesterdayKey } = useMemo(() => {
    const today = toLocalDateKey();
    return {
      startMs: windowStartMs(activeWindow, today),
      todayKey: today,
      yesterdayKey: shiftLocalDateKey(today, -1),
    };
  }, [activeWindow]);

  const changed = useMemo(() => changedInWindow(writings, startMs), [writings, startMs]);

  useEffect(() => {
    let cancelled = false;
    void readWordDeltas(projectId, changed, startMs)
      .then((measured) => {
        if (!cancelled) setDeltas(measured);
      })
      .catch((err) => {
        console.error('[writings] could not measure recent word deltas', err);
        if (!cancelled) setDeltas(NO_DELTAS);
      });
    return () => {
      cancelled = true;
    };
  }, [changed, projectId, startMs]);

  if (writings.length === 0) return null;

  // Spelled out rather than composed, so the locale check can see every key.
  const windowLabel = (window: ChangeWindow): string => {
    if (window === 'today') return t('common.today');
    if (window === 'month') return t('writings.recent.window.month');
    return t('writings.recent.window.week');
  };

  const whenLabel = (updatedAt: number): string => {
    const moment = new Date(updatedAt);
    const key = toLocalDateKey(moment);
    const day =
      key === todayKey
        ? t('common.today')
        : key === yesterdayKey
          ? t('writings.recent.yesterday')
          : moment.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
    const time = moment.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    return `${day} · ${time}`;
  };

  const chipClass = 'rounded-lg border px-2 py-0.5 text-[11px] transition';
  const activeChip = 'border-accent-gold bg-accent-gold/10 text-accent-gold';
  const idleChip = 'border-border text-text-muted hover:border-accent-gold hover:text-accent-gold';

  return (
    <section className="rounded-xl border border-border bg-surface/60 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="flex items-center gap-1.5 text-xs font-semibold text-text-primary transition hover:text-accent-gold"
        >
          <Clock size={13} className="text-accent-gold" />
          {t('writings.recent.title')}
          <ChevronDown
            size={13}
            className={`text-text-dim transition-transform ${expanded ? '' : '-rotate-90'}`}
          />
        </button>

        {changed.length > 0 && (
          <span className="rounded-full bg-elevated px-1.5 py-0.5 text-[10px] text-text-dim">
            {changed.length.toLocaleString(locale)}
          </span>
        )}

        <div className="flex-1" />

        <div className="flex items-center gap-1">
          {CHANGE_WINDOWS.map((window) => (
            <button
              key={window}
              type="button"
              onClick={() => setActiveWindow(window)}
              aria-pressed={window === activeWindow}
              className={`${chipClass} ${window === activeWindow ? activeChip : idleChip}`}
            >
              {windowLabel(window)}
            </button>
          ))}
        </div>
      </div>

      {expanded && (
        changed.length === 0 ? (
          <p className="mt-2 text-xs text-text-dim">{t('writings.recent.empty')}</p>
        ) : (
          <div className="mt-2 max-h-56 space-y-0.5 overflow-y-auto pr-1">
            {changed.map((writing) => {
              const delta = deltas.get(writing.id);
              return (
                <button
                  key={writing.id}
                  type="button"
                  onClick={() => onOpen(writing)}
                  title={t('common.open')}
                  className="flex w-full items-center gap-3 rounded-lg border border-transparent px-2 py-1.5 text-left transition hover:border-accent-gold/30 hover:bg-elevated"
                >
                  <span className="w-5 flex-shrink-0 text-right text-[10px] tabular-nums text-text-dim">
                    {writing.chapter ?? ''}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
                    {writing.title || t('writings.untitled')}
                  </span>
                  {delta === undefined ? (
                    <span
                      title={t('writings.recent.deltaUnknown')}
                      className="w-24 flex-shrink-0 text-right text-[11px] text-text-dim"
                    >
                      —
                    </span>
                  ) : delta === 0 ? (
                    <span
                      title={t('writings.recent.deltaHint')}
                      className="w-24 flex-shrink-0 truncate text-right text-[11px] text-text-dim"
                    >
                      {t('writings.recent.deltaNone')}
                    </span>
                  ) : (
                    <span
                      title={t('writings.recent.deltaHint')}
                      className={`w-24 flex-shrink-0 truncate text-right text-[11px] tabular-nums ${
                        delta > 0 ? 'text-accent-gold' : 'text-text-muted'
                      }`}
                    >
                      {`${delta > 0 ? '+' : ''}${delta.toLocaleString(locale)} ${t('writings.words')}`}
                    </span>
                  )}
                  <span className="w-28 flex-shrink-0 text-right text-[10px] text-text-dim">
                    {whenLabel(writing.updatedAt)}
                  </span>
                </button>
              );
            })}
          </div>
        )
      )}
    </section>
  );
}
