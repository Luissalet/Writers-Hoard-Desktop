import { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { clearSession, isSession, updateSession, validDay } from '../session';
import { SESSION_STATUSES } from '../types';
import type { Outline, SessionStatus } from '../types';
import type { Writing } from '@/types';

/**
 * The "this outline is a table session" strip under an outline's title: the
 * marker, the date, the status and the prep note. Every change goes through
 * `updateSession`, so it bumps the session revision like the bridge does.
 */
export default function SessionFields({ outline, writings, onChanged }: {
  outline: Outline;
  writings: Writing[];
  onChanged: () => Promise<unknown> | void;
}) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const on = isSession(outline);

  const apply = async (change: () => Promise<unknown>) => {
    setFailed(false);
    try {
      await change();
      await onChanged();
    } catch {
      setFailed(true);
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-text-dim" data-testid="session-fields">
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={on}
          onChange={event => void apply(() => (event.target.checked ? updateSession(outline.id, {}) : clearSession(outline.id)))}
          data-testid="session-toggle"
        />
        {t('outline.session.mark')}
      </label>
      {on && (
        <>
          <label className="flex items-center gap-1.5">
            {t('outline.session.date')}
            <input
              type="date"
              value={outline.sessionDate ?? ''}
              onChange={event => {
                const value = event.target.value;
                if (value && !validDay(value)) return;
                void apply(() => updateSession(outline.id, { date: value || null }));
              }}
              data-testid="session-date"
              className="px-2 py-1 bg-surface border border-border rounded-lg text-text-primary"
            />
          </label>
          <label className="flex items-center gap-1.5">
            {t('outline.session.status')}
            <select
              value={outline.sessionStatus ?? 'prep'}
              onChange={event => void apply(() => updateSession(outline.id, { status: event.target.value as SessionStatus }))}
              data-testid="session-status-field"
              className="px-2 py-1 bg-surface border border-border rounded-lg text-text-primary"
            >
              {SESSION_STATUSES.map(status => (
                <option key={status} value={status}>{t(`outline.session.status.${status}`)}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            {t('outline.session.note')}
            <select
              value={outline.linkedWritingId ?? ''}
              onChange={event => void apply(() => updateSession(outline.id, { linkedWritingId: event.target.value || null }))}
              data-testid="session-note"
              className="px-2 py-1 bg-surface border border-border rounded-lg text-text-primary max-w-48"
            >
              <option value="">{t('outline.session.noNote')}</option>
              {writings.map(writing => (
                <option key={writing.id} value={writing.id}>{writing.title || writing.id}</option>
              ))}
            </select>
          </label>
        </>
      )}
      {failed && <span role="alert" className="text-red-400">{t('outline.session.conflict')}</span>}
    </div>
  );
}
