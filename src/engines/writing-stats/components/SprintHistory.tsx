import { useEffect, useMemo } from 'react';
import { Timer, Target, Check } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSprintLog } from '../hooks';
import { minutesBetween, reconcileSprint, summarizeSprints, targetMet } from '../sprints';
import { toLocalDateKey } from '../date';
import type { SprintRecord } from '../types';

interface SprintHistoryProps {
  projectId: string;
}

/** How many sprints the compact list shows before it stops. */
const RECENT_LIMIT = 6;

export default function SprintHistory({ projectId }: SprintHistoryProps) {
  const { t } = useTranslation();
  const { items: sprints, loading } = useSprintLog(projectId);

  // A sprint whose window closed while the app was shut is filed here too, not
  // only in the editor — otherwise the log would sit one sprint behind until
  // the writer happened to open the manuscript again. `endSprint` announces
  // itself on `wh:data-changed`, which is what refreshes the list above.
  useEffect(() => {
    void reconcileSprint(projectId);
  }, [projectId]);

  const totals = useMemo(() => summarizeSprints(sprints), [sprints]);
  const recent = sprints.slice(0, RECENT_LIMIT);

  return (
    <div className="bg-surface border border-border rounded-lg p-6 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-text-primary">{t('stats.sprint.logTitle')}</h2>
        {sprints.length > 0 && (
          <span className="text-xs text-text-muted">
            {t('stats.sprint.logSummary')
              .replace('{count}', String(totals.thisWeek))
              .replace('{best}', totals.bestWords.toLocaleString())}
          </span>
        )}
      </div>

      {/* The empty line waits for the first read: "no sprints yet" flashing
          before the log arrives would be a lie, however briefly. */}
      {recent.length === 0 && !loading && (
        <p className="text-sm text-text-dim">{t('stats.sprint.logEmpty')}</p>
      )}
      {recent.map((sprint) => (
        <SprintRow key={sprint.id} sprint={sprint} />
      ))}
    </div>
  );
}

interface SprintRowProps {
  sprint: SprintRecord;
}

function SprintRow({ sprint }: SprintRowProps) {
  const { t } = useTranslation();
  const started = new Date(sprint.startedAt);
  const isToday = toLocalDateKey(started) === toLocalDateKey();
  const dateLabel = isToday
    ? t('common.today')
    : started.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const timeLabel = started.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const minutes = minutesBetween(sprint.startedAt, sprint.endedAt);
  const met = targetMet(sprint);

  return (
    <div className="flex items-center justify-between p-3 bg-elevated border border-border rounded-lg">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <Timer size={20} className="text-text-dim flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs text-text-muted">
              {dateLabel} · {timeLabel}
            </span>
            {sprint.stopped && (
              <span className="text-xs font-semibold px-2 py-1 rounded bg-warning/15 text-warning">
                {t('stats.sprint.stoppedBadge')}
              </span>
            )}
          </div>
          <p className="text-xs text-text-dim">
            {t('stats.sprint.minutesShort').replace('{minutes}', String(minutes))}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 ml-2 flex-shrink-0">
        {sprint.targetWords > 0 && (
          <span
            className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded ${
              met ? 'bg-success/15 text-success' : 'bg-surface text-text-dim border border-border'
            }`}
            title={
              met
                ? t('stats.sprint.targetMet')
                : t('stats.sprint.targetMissed').replace(
                    '{target}',
                    sprint.targetWords.toLocaleString(),
                  )
            }
          >
            {met ? <Check size={11} /> : <Target size={11} />}
            {sprint.targetWords.toLocaleString()}
          </span>
        )}
        <div className="text-right">
          <div className="text-sm font-bold text-text-primary">
            {sprint.actualWords.toLocaleString()}
          </div>
          <div className="text-xs text-text-dim">{t('writings.words')}</div>
        </div>
      </div>
    </div>
  );
}
