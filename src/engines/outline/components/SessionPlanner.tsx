import { useMemo, useRef, useState } from 'react';
import { CalendarDays, ExternalLink, Plus } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { createOutlineFromTemplate } from '../operations';
import { PLANNER_ORDER, groupSessions, updateSession } from '../session';
import { applyDockPreset, undoDockPreset } from '../sessionDock';
import { DOCK_PRESET_IDS, SESSION_STATUSES, SESSION_TEMPLATE_IDS, BEAT_SHEET_TEMPLATES } from '../types';
import type { DockPresetId, Outline, SessionStatus } from '../types';
import { navigateTo } from '@/engines/_shared/anchoring';
import type { Writing } from '@/types';

interface SessionPlannerProps {
  projectId: string;
  outlines: Outline[];
  writings: Writing[];
  /** Open this outline in the outline editor. */
  onOpenOutline: (outlineId: string) => void;
  /** Reload the outlines after a change made here. */
  onChanged: () => Promise<unknown> | void;
}

/** Group headings, in planner order. */
const GROUP_KEY: Record<SessionStatus, string> = {
  live: 'outline.session.status.live',
  next: 'outline.session.status.next',
  prep: 'outline.session.status.prep',
  played: 'outline.session.status.played',
};

export default function SessionPlanner({ projectId, outlines, writings, onOpenOutline, onChanged }: SessionPlannerProps) {
  const { t } = useTranslation();
  const groups = useMemo(() => groupSessions(outlines), [outlines]);
  const total = PLANNER_ORDER.reduce((sum, status) => sum + groups[status].length, 0);
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState<string>(SESSION_TEMPLATE_IDS[0]);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [receipt, setReceipt] = useState<{ noteId: string; receiptId: string } | null>(null);
  const busy = useRef(false);

  const say = (text: string, bad = false) => { setMessage(text); setFailed(bad); };

  const run = async (action: () => Promise<void>, errorKey = 'outline.session.conflict') => {
    if (busy.current) return;
    busy.current = true;
    try {
      await action();
      await onChanged();
    } catch {
      say(t(errorKey), true);
    } finally {
      busy.current = false;
    }
  };

  const setStatus = (outline: Outline, status: SessionStatus) =>
    run(async () => { await updateSession(outline.id, { status }, outline.sessionRevision ?? 0); });

  const create = () => run(async () => {
    if (!name.trim()) return;
    await createOutlineFromTemplate(projectId, name, templateId, t, { status: 'prep' });
    setName('');
    say('');
  }, 'outline.planner.createError');

  const applyPreset = (outline: Outline, preset: DockPresetId) => {
    if (!outline.linkedWritingId) { say(t('outline.planner.presetNoNote'), true); return; }
    const noteId = outline.linkedWritingId;
    return run(async () => {
      const applied = await applyDockPreset(projectId, noteId, preset);
      if (!applied) { say(t('outline.planner.presetNothing'), true); return; }
      setReceipt({ noteId, receiptId: applied.receiptId });
      say(t('outline.planner.presetApplied').replace('{name}', t(`outline.planner.preset.${preset}`)));
    }, 'outline.planner.presetError');
  };

  const undoPreset = () => {
    if (!receipt) return;
    return run(async () => {
      await undoDockPreset(projectId, receipt.noteId, receipt.receiptId);
      setReceipt(null);
      say(t('outline.planner.presetUndone'));
    }, 'outline.planner.presetError');
  };

  const noteTitle = (id?: string) => writings.find(writing => writing.id === id)?.title || '';

  return (
    <div className="space-y-4" data-testid="session-planner">
      <div className="border border-border rounded-xl bg-surface/50 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <CalendarDays size={14} className="text-accent-gold" />
          {t('outline.planner.title')}
        </h3>
        <div className="flex flex-wrap items-end gap-2" data-testid="session-new">
          <label className="text-xs text-text-dim flex flex-col gap-1">
            {t('outline.planner.new')}
            <input
              type="text"
              value={name}
              onChange={event => setName(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') void create(); }}
              placeholder={t('outline.planner.namePlaceholder')}
              data-testid="session-new-name"
              className="px-3 py-1.5 text-xs bg-surface border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-gold/50"
            />
          </label>
          <label className="text-xs text-text-dim flex flex-col gap-1">
            {t('outline.planner.template')}
            <select
              value={templateId}
              onChange={event => setTemplateId(event.target.value)}
              data-testid="session-new-template"
              className="px-2 py-1.5 text-xs bg-surface border border-border rounded-lg text-text-primary"
            >
              {SESSION_TEMPLATE_IDS.map(id => {
                const template = BEAT_SHEET_TEMPLATES.find(candidate => candidate.id === id);
                return <option key={id} value={id}>{template ? t(template.nameKey) : id}</option>;
              })}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void create()}
            disabled={!name.trim()}
            data-testid="session-new-create"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent-gold/10 text-accent-gold rounded-lg hover:bg-accent-gold/20 transition disabled:opacity-50"
          >
            <Plus size={13} />
            {t('outline.planner.create')}
          </button>
        </div>
        <p
          role={failed ? 'alert' : 'status'}
          aria-live="polite"
          data-testid="session-message"
          className={`text-xs min-h-4 ${failed ? 'text-red-400' : 'text-text-dim'}`}
        >
          {message}
          {receipt && !failed && (
            <button type="button" onClick={() => void undoPreset()} data-testid="session-preset-undo" className="ml-2 underline text-accent-gold">
              {t('outline.planner.presetUndo')}
            </button>
          )}
        </p>
      </div>

      {total === 0 && (
        <p className="text-sm text-text-dim text-center py-4" data-testid="session-empty">{t('outline.planner.empty')}</p>
      )}

      {PLANNER_ORDER.map(status => (
        <section key={status} data-testid={`session-group-${status}`} aria-label={t(GROUP_KEY[status])} className="border border-border rounded-xl bg-surface/50 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-text-dim mb-2">
            {t(GROUP_KEY[status])} <span data-testid={`session-count-${status}`}>({groups[status].length})</span>
          </h4>
          {groups[status].length === 0 ? (
            <p className="text-xs text-text-dim">{t('outline.planner.emptyGroup')}</p>
          ) : (
            <ul className="space-y-2">
              {groups[status].map(outline => (
                <li
                  key={outline.id}
                  data-testid="session-row"
                  data-outline-id={outline.id}
                  className="flex flex-wrap items-center gap-2 border border-border rounded-lg p-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text-primary truncate">{outline.title}</p>
                    <p className="text-xs text-text-dim">
                      {outline.sessionDate ?? t('outline.planner.noDate')}
                      {outline.linkedWritingId && noteTitle(outline.linkedWritingId) ? ` · ${noteTitle(outline.linkedWritingId)}` : ''}
                    </p>
                  </div>
                  <select
                    value={outline.sessionStatus ?? 'prep'}
                    onChange={event => void setStatus(outline, event.target.value as SessionStatus)}
                    aria-label={t('outline.session.status')}
                    data-testid="session-status"
                    className="px-2 py-1 text-xs bg-surface border border-border rounded-lg text-text-primary"
                  >
                    {SESSION_STATUSES.map(option => (
                      <option key={option} value={option}>{t(GROUP_KEY[option])}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => onOpenOutline(outline.id)}
                    data-testid="session-open"
                    className="px-2 py-1 text-xs rounded-lg bg-accent-gold/10 text-accent-gold hover:bg-accent-gold/20"
                  >
                    {t('outline.planner.open')}
                  </button>
                  {outline.linkedWritingId && (
                    <>
                      <button
                        type="button"
                        onClick={() => navigateTo(`/project/${encodeURIComponent(projectId)}/writings?writing=${encodeURIComponent(outline.linkedWritingId!)}`)}
                        data-testid="session-open-note"
                        className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-border text-text-primary hover:border-accent-gold/50"
                      >
                        <ExternalLink size={12} />
                        {t('outline.planner.openNote')}
                      </button>
                      <div className="flex items-center gap-1" role="group" aria-label={t('outline.planner.presets')}>
                        {DOCK_PRESET_IDS.map(preset => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => void applyPreset(outline, preset)}
                            data-testid={`session-preset-${preset}`}
                            className="px-2 py-1 text-xs rounded-lg border border-border text-text-dim hover:text-text-primary hover:border-accent-gold/50"
                          >
                            {t(`outline.planner.preset.${preset}`)}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
