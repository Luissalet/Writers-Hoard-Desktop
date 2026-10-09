import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import Modal from '@/components/common/Modal';
import {
  defaultWorldCalendar, validateWorldCalendar, type WorldCalendar,
} from '../worldCalendar';
import { saveWorldCalendar, type ResolvedWorldCalendar } from '../worldCalendarStore';

interface WorldCalendarEditorProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
  resolved: ResolvedWorldCalendar | null | undefined;
}

const input = 'px-2 py-1.5 bg-elevated border border-border rounded-md text-sm text-text-primary outline-none focus:border-accent-gold transition';
const num = `${input} w-20`;
const section = 'space-y-2 border-t border-border pt-3';
const heading = 'text-xs font-semibold uppercase tracking-wide text-text-muted';
const iconButton = 'p-1.5 rounded hover:bg-danger/20 text-danger';
const addButton = 'inline-flex items-center gap-1 text-xs text-accent-gold hover:underline';

/** Clone so edits never touch the stored row until saved. */
const copy = (c: WorldCalendar): WorldCalendar => JSON.parse(JSON.stringify(c)) as WorldCalendar;

export default function WorldCalendarEditor({ projectId, open, onClose, resolved }: WorldCalendarEditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<WorldCalendar>(() => defaultWorldCalendar(t('timeline.world.defaultName')));
  const [weekdaysText, setWeekdaysText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const start = resolved ? copy(resolved.calendar) : defaultWorldCalendar(t('timeline.world.defaultName'));
    setDraft(start);
    setWeekdaysText(start.weekdays.join(', '));
    setErrors([]);
  }, [open, resolved, t]);

  const set = (patch: Partial<WorldCalendar>) => setDraft((d) => ({ ...d, ...patch }));
  const withWeekdays = (): WorldCalendar => ({
    ...draft,
    weekdays: weekdaysText.split(',').map((w) => w.trim()).filter(Boolean),
  });

  const save = async () => {
    const calendar = withWeekdays();
    const problems = validateWorldCalendar(calendar);
    setErrors(problems);
    if (problems.length) return;
    setSaving(true);
    try {
      await saveWorldCalendar(projectId, calendar);
      onClose();
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await saveWorldCalendar(projectId, null);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const ownCalendar = resolved && !resolved.inherited;
  return (
    <Modal open={open} onClose={() => { if (!saving) onClose(); }} title={t('timeline.world.editorTitle')} wide busy={saving}>
      <fieldset disabled={saving} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1" data-testid="world-calendar-editor">
        {resolved?.inherited && (
          <p className="text-xs text-text-muted bg-elevated rounded-md p-2">{t('timeline.world.inheritedNote')}</p>
        )}
        <div>
          <label htmlFor="wc-name" className="block text-sm text-text-muted mb-1">{t('timeline.world.name')}</label>
          <input id="wc-name" className={`${input} w-full`} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </div>

        <div className={section}>
          <p className={heading}>{t('timeline.world.months')}</p>
          {draft.months.map((m, i) => (
            <div key={i} className="flex items-center gap-2">
              <input aria-label={t('timeline.world.monthName').replace('{n}', String(i + 1))} className={`${input} flex-1`} value={m.name}
                onChange={(e) => set({ months: draft.months.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <input aria-label={t('timeline.world.monthDays').replace('{n}', String(i + 1))} type="number" min={1} className={num} value={m.days}
                onChange={(e) => set({ months: draft.months.map((x, j) => (j === i ? { ...x, days: Number(e.target.value) } : x)) })} />
              <label className="flex items-center gap-1 text-xs text-text-muted" title={t('timeline.world.intercalaryHelp')}>
                <input type="checkbox" checked={!!m.intercalary}
                  onChange={(e) => set({ months: draft.months.map((x, j) => (j === i ? { ...x, intercalary: e.target.checked || undefined } : x)) })} />
                {t('timeline.world.intercalary')}
              </label>
              <button type="button" className={iconButton} aria-label={t('timeline.world.removeMonth').replace('{n}', String(i + 1))}
                disabled={draft.months.length === 1}
                onClick={() => set({ months: draft.months.filter((_, j) => j !== i) })}><Trash2 size={14} aria-hidden="true" /></button>
            </div>
          ))}
          <button type="button" className={addButton} onClick={() => set({ months: [...draft.months, { name: `${t('timeline.world.month')} ${draft.months.length + 1}`, days: 30 }] })}>
            <Plus size={12} aria-hidden="true" /> {t('timeline.world.addMonth')}
          </button>
        </div>

        <div className={section}>
          <label htmlFor="wc-weekdays" className={heading}>{t('timeline.world.weekdays')}</label>
          <input id="wc-weekdays" className={`${input} w-full`} value={weekdaysText} onChange={(e) => setWeekdaysText(e.target.value)} />
          <p className="text-[11px] text-text-dim">{t('timeline.world.weekdaysHelp')}</p>
        </div>

        <div className={section}>
          <p className={heading}>{t('timeline.world.eras')}</p>
          {draft.eras.map((era, i) => (
            <div key={i} className="flex items-center gap-2">
              <input aria-label={t('timeline.world.eraName')} className={`${input} flex-1`} value={era.name}
                onChange={(e) => set({ eras: draft.eras.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <input aria-label={t('timeline.world.eraAbbr')} className={`${input} w-20`} value={era.abbr}
                onChange={(e) => set({ eras: draft.eras.map((x, j) => (j === i ? { ...x, abbr: e.target.value } : x)) })} />
              <input aria-label={t('timeline.world.eraStart')} title={t('timeline.world.eraStart')} type="number" className={num} value={era.startYear}
                onChange={(e) => set({ eras: draft.eras.map((x, j) => (j === i ? { ...x, startYear: Number(e.target.value) } : x)) })} />
              <label className="flex items-center gap-1 text-xs text-text-muted" title={t('timeline.world.countdownHelp')}>
                <input type="checkbox" checked={!!era.countdown}
                  onChange={(e) => set({ eras: draft.eras.map((x, j) => (j === i ? { ...x, countdown: e.target.checked || undefined } : x)) })} />
                {t('timeline.world.countdown')}
              </label>
              <button type="button" className={iconButton} aria-label={t('timeline.world.removeEra')} disabled={draft.eras.length === 1}
                onClick={() => set({ eras: draft.eras.filter((_, j) => j !== i) })}><Trash2 size={14} aria-hidden="true" /></button>
            </div>
          ))}
          <button type="button" className={addButton} onClick={() => set({ eras: [...draft.eras, { name: t('timeline.world.newEra'), abbr: `E${draft.eras.length + 1}`, startYear: Math.max(...draft.eras.map((e) => e.startYear)) + 100 }] })}>
            <Plus size={12} aria-hidden="true" /> {t('timeline.world.addEra')}
          </button>
        </div>

        <div className={section}>
          <p className={heading}>{t('timeline.world.moons')}</p>
          {draft.moons.map((moon, i) => (
            <div key={i} className="flex items-center gap-2">
              <input aria-label={t('timeline.world.moonName')} className={`${input} flex-1`} value={moon.name}
                onChange={(e) => set({ moons: draft.moons.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <input aria-label={t('timeline.world.moonPeriod')} title={t('timeline.world.moonPeriod')} type="number" step="0.01" min={1} className={num} value={moon.periodDays}
                onChange={(e) => set({ moons: draft.moons.map((x, j) => (j === i ? { ...x, periodDays: Number(e.target.value) } : x)) })} />
              <input aria-label={t('timeline.world.moonNewDay')} title={t('timeline.world.moonNewDay')} type="number" className={num} value={moon.newMoonDay ?? 0}
                onChange={(e) => set({ moons: draft.moons.map((x, j) => (j === i ? { ...x, newMoonDay: Number(e.target.value) } : x)) })} />
              <button type="button" className={iconButton} aria-label={t('timeline.world.removeMoon')}
                onClick={() => set({ moons: draft.moons.filter((_, j) => j !== i) })}><Trash2 size={14} aria-hidden="true" /></button>
            </div>
          ))}
          <button type="button" className={addButton} onClick={() => set({ moons: [...draft.moons, { name: t('timeline.world.newMoon'), periodDays: 29.5, newMoonDay: 0 }] })}>
            <Plus size={12} aria-hidden="true" /> {t('timeline.world.addMoon')}
          </button>
        </div>

        <div className={section}>
          <p className={heading}>{t('timeline.world.holidays')}</p>
          {draft.holidays.map((h, i) => (
            <div key={i} className="flex items-center gap-2">
              <input aria-label={t('timeline.world.holidayName')} className={`${input} flex-1`} value={h.name}
                onChange={(e) => set({ holidays: draft.holidays.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <select aria-label={t('timeline.world.holidayMonth')} className={input} value={h.month}
                onChange={(e) => set({ holidays: draft.holidays.map((x, j) => (j === i ? { ...x, month: Number(e.target.value) } : x)) })}>
                {draft.months.map((m, k) => <option key={k} value={k + 1}>{m.name}</option>)}
              </select>
              <input aria-label={t('timeline.world.holidayDay')} type="number" min={1} className={num} value={h.day}
                onChange={(e) => set({ holidays: draft.holidays.map((x, j) => (j === i ? { ...x, day: Number(e.target.value) } : x)) })} />
              <button type="button" className={iconButton} aria-label={t('timeline.world.removeHoliday')}
                onClick={() => set({ holidays: draft.holidays.filter((_, j) => j !== i) })}><Trash2 size={14} aria-hidden="true" /></button>
            </div>
          ))}
          <button type="button" className={addButton} onClick={() => set({ holidays: [...draft.holidays, { name: t('timeline.world.newHoliday'), month: 1, day: 1 }] })}>
            <Plus size={12} aria-hidden="true" /> {t('timeline.world.addHoliday')}
          </button>
        </div>

        <div className={section}>
          <label className="flex items-center gap-2 text-sm text-text-muted">
            <input type="checkbox" checked={!!draft.leap}
              onChange={(e) => set({ leap: e.target.checked ? { every: 4, offset: 0, month: 1, extraDays: 1 } : undefined })} />
            {t('timeline.world.leap')}
          </label>
          {draft.leap && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
              {t('timeline.world.leapEvery')}
              <input aria-label={t('timeline.world.leapEvery')} type="number" min={1} className={num} value={draft.leap.every}
                onChange={(e) => set({ leap: { ...draft.leap!, every: Number(e.target.value) } })} />
              {t('timeline.world.leapAdds')}
              <input aria-label={t('timeline.world.leapAdds')} type="number" min={1} className={num} value={draft.leap.extraDays}
                onChange={(e) => set({ leap: { ...draft.leap!, extraDays: Number(e.target.value) } })} />
              {t('timeline.world.leapTo')}
              <select aria-label={t('timeline.world.leapTo')} className={input} value={draft.leap.month}
                onChange={(e) => set({ leap: { ...draft.leap!, month: Number(e.target.value) } })}>
                {draft.months.map((m, k) => <option key={k} value={k + 1}>{m.name}</option>)}
              </select>
            </div>
          )}
        </div>

        {errors.length > 0 && (
          <ul className="text-xs text-danger space-y-1 bg-danger/10 rounded-md p-2" role="alert" data-testid="world-calendar-errors">
            {errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}

        <div className="flex items-center justify-between pt-2">
          {ownCalendar ? (
            <button type="button" onClick={() => void remove()} className="text-xs text-danger hover:underline">{t('timeline.world.remove')}</button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-text-muted hover:text-text-primary">{t('common.cancel')}</button>
            <button type="button" onClick={() => void save()} data-testid="world-calendar-save"
              className="px-4 py-2 text-sm rounded-lg bg-accent-gold text-deep font-semibold hover:brightness-110">
              {resolved?.inherited ? t('timeline.world.saveOwn') : t('common.save')}
            </button>
          </div>
        </div>
      </fieldset>
    </Modal>
  );
}
