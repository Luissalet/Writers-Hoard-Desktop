import { useWorldEraScope, bindEraOperation } from '@/services/worldEras/hooks';
import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import Modal from '@/components/common/Modal';
import {
  defaultWorldCalendar, formatWorldDate, parseWorldDate, validateWorldCalendar, type WorldCalendar,
} from '../worldCalendar';
import { saveWorldCalendar as saveWorldCalendarScoped, type ResolvedWorldCalendar } from '../worldCalendarStore';
import CalendarPresetControls from './CalendarPresetControls';
import type { Timeline } from '@/types';
import { saveTimelineSettings as saveTimelineSettingsScoped } from '../timelineSettings';
import { applyRedate, projectCalendarEvents, redatePlan, timelineWorldEvents, type RedateChange } from '../redate';

interface WorldCalendarEditorProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
  resolved: ResolvedWorldCalendar | null | undefined;
  timeline?: Timeline;
}

const input = 'px-2 py-1.5 bg-elevated border border-border rounded-md text-sm text-text-primary outline-none focus:border-accent-gold transition';
const num = `${input} w-20`;
const section = 'space-y-2 border-t border-border pt-3';
const heading = 'text-xs font-semibold uppercase tracking-wide text-text-muted';
const iconButton = 'p-1.5 rounded hover:bg-danger/20 text-danger';
const addButton = 'inline-flex items-center gap-1 text-xs text-accent-gold hover:underline';

/** Clone so edits never touch the stored row until saved. */
const copy = (c: WorldCalendar): WorldCalendar => JSON.parse(JSON.stringify(c)) as WorldCalendar;

export default function WorldCalendarEditor({ projectId, open, onClose, resolved, timeline }: WorldCalendarEditorProps) {
  const { t } = useTranslation();
  const scope = useWorldEraScope(projectId);
  const saveWorldCalendar = bindEraOperation(saveWorldCalendarScoped, scope.eraId, 2);
  const saveTimelineSettings = bindEraOperation(saveTimelineSettingsScoped, scope.eraId, 3);
  const [draft, setDraft] = useState<WorldCalendar>(() => defaultWorldCalendar(t('timeline.world.defaultName')));
  const [weekdaysText, setWeekdaysText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  // Events the new calendar no longer has a date for, waiting for "Aplicar y re-fechar".
  const [pendingRedate, setPendingRedate] = useState<RedateChange[] | null>(null);
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [precision, setPrecision] = useState<Timeline['displayPrecision']>('hour');
  const [useOwnCalendar, setUseOwnCalendar] = useState(false);
  const [corrWorld, setCorrWorld] = useState(''), [corrEarth, setCorrEarth] = useState('');

  // Load the draft once per opening. `t` is a new function on every render and
  // `resolved` is re-read live, so depending on them would wipe what is typed.
  const defaultName = t('timeline.world.defaultName');
  const loadedRef = useRef(false);
  useEffect(() => {
    if (!open) { loadedRef.current = false; return; }
    if (loadedRef.current || resolved === undefined) return;
    loadedRef.current = true;
    const start = resolved ? copy(resolved.calendar) : defaultWorldCalendar(defaultName);
    setDraft(start);
    setWeekdaysText(start.weekdays.join(', '));
    setCorrWorld((() => { try { return start.correlation ? formatWorldDate(start, start.correlation.date) : ''; } catch { return ''; } })());
    setCorrEarth(start.correlation?.earth ?? '');
    setErrors([]);
    setRangeStart(timeline?.yearRange ? String(timeline.yearRange.start) : '');
    setRangeEnd(timeline?.yearRange ? String(timeline.yearRange.end) : '');
    setPrecision(timeline?.displayPrecision ?? 'hour');
    setUseOwnCalendar(!!timeline?.worldCalendar);
    setPendingRedate(null);
  }, [open, resolved, defaultName, timeline]);

  const set = (patch: Partial<WorldCalendar>) => setDraft((d) => ({ ...d, ...patch }));
  const withWeekdays = (): WorldCalendar => {
    const calendar: WorldCalendar = { ...draft, weekdays: weekdaysText.split(',').map((w) => w.trim()).filter(Boolean) };
    // The correlation with the Earth calendar: both halves, or neither.
    delete calendar.correlation;
    if (corrWorld.trim() || corrEarth.trim()) {
      const date = (() => { try { return parseWorldDate(calendar, corrWorld); } catch { return null; } })();
      calendar.correlation = { date: date?.month && date.day ? date : { year: NaN }, earth: corrEarth.trim() } as WorldCalendar['correlation'];
    }
    return calendar;
  };

  const save = async (redate = false, keepDates = false) => {
    const calendar = withWeekdays();
    const problems = validateWorldCalendar(calendar);
    setErrors(problems.map(problem => problem.startsWith('hoursPerDay') ? t('timeline.details.invalidHours') : /^leap\.(exceptEvery|restoreEvery)/.test(problem) ? t('timeline.details.invalidLeap') : problem));
    if (problems.length) return;
    setSaving(true);
    try {
      if (timeline) {
        if (!!rangeStart !== !!rangeEnd) throw new Error('timeline.settings.invalidRange');
        const changes = { worldCalendar: useOwnCalendar ? calendar : undefined, yearRange: rangeStart && rangeEnd ? { start: Number(rangeStart), end: Number(rangeEnd) } : undefined, displayPrecision: precision };
        if (!redate && useOwnCalendar) {
          const plan = redatePlan(await timelineWorldEvents(projectId, timeline.id, scope.eraId), calendar);
          if (plan.length) { setPendingRedate(plan); return; }
        }
        if (redate) await saveTimelineSettingsScoped(projectId, timeline.id, changes, scope.eraId, { redate: true });
        else await saveTimelineSettings(projectId, timeline.id, changes);
      } else {
        const plan = redatePlan(await projectCalendarEvents(projectId, scope.eraId), calendar);
        if (plan.length && !redate && !keepDates) { setPendingRedate(plan); return; }
        await saveWorldCalendar(projectId, calendar);
        // "Save without moving them": the events keep their label and leave the date axis, as before re-dating existed.
        if (redate) await applyRedate(projectId, plan, scope.eraId);
      }
      setPendingRedate(null);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrors([message.startsWith('timeline.settings.invalidExisting:') ? t('timeline.settings.invalidExisting').replace('{event}', message.split(':').slice(1).join(':')) : message.startsWith('timeline.settings.') ? t(message) : message]);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      if (timeline) await saveTimelineSettings(projectId, timeline.id, { worldCalendar: undefined });
      else await saveWorldCalendar(projectId, null);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrors([message.startsWith('timeline.settings.invalidExisting:') ? t('timeline.settings.invalidExisting').replace('{event}', message.split(':').slice(1).join(':')) : message]);
    } finally {
      setSaving(false);
    }
  };

  const ownCalendar = timeline ? resolved?.ownerTimelineId === timeline.id : resolved && !resolved.inherited;
  return (
    <Modal open={open} onClose={() => { if (!saving) onClose(); }} title={t(timeline ? 'timeline.settings.open' : 'timeline.world.editorTitle')} wide busy={saving}>
      <fieldset disabled={saving} className="space-y-4 min-w-0" data-testid="world-calendar-editor">
        {timeline && <div className="space-y-3 rounded-lg bg-elevated p-3"><p className="text-sm font-semibold text-accent-gold">{timeline.title}</p><p className="text-xs text-text-muted">{t('timeline.settings.scopeHelp')}</p><div className="flex flex-wrap gap-3"><label className="text-xs text-text-muted">{t('timeline.settings.fromYear')}<input aria-label={t('timeline.settings.fromYear')} type="number" className={`${input} block w-28 mt-1`} value={rangeStart} onChange={event => setRangeStart(event.target.value)} /></label><label className="text-xs text-text-muted">{t('timeline.settings.toYear')}<input aria-label={t('timeline.settings.toYear')} type="number" className={`${input} block w-28 mt-1`} value={rangeEnd} onChange={event => setRangeEnd(event.target.value)} /></label><button type="button" className={addButton} onClick={() => { setRangeStart(''); setRangeEnd(''); }}>{t('timeline.settings.allYears')}</button><label className="text-xs text-text-muted">{t('timeline.settings.precision')}<select aria-label={t('timeline.settings.precision')} className={`${input} block mt-1`} value={precision} onChange={event => setPrecision(event.target.value as Timeline['displayPrecision'])}>{(['year', 'month', 'day', 'hour'] as const).map(value => <option key={value} value={value}>{t(`timeline.settings.${value}`)}</option>)}</select></label></div><p className="text-xs text-text-muted">{t('timeline.settings.rangeHelp')}</p></div>}
        {resolved?.inherited && (
          <p className="text-xs text-text-muted bg-elevated rounded-md p-2">{t('timeline.world.inheritedNote')}</p>
        )}
        {timeline && <label className="flex items-center gap-2 text-sm text-accent-gold"><input type="checkbox" checked={useOwnCalendar} onChange={event => setUseOwnCalendar(event.target.checked)} />{t('timeline.settings.independent')}</label>}
        <fieldset className="space-y-4 disabled:opacity-50" disabled={!!timeline && !useOwnCalendar}>
        <CalendarPresetControls calendar={withWeekdays()} onLoad={calendar => { setDraft(calendar); setWeekdaysText(calendar.weekdays.join(', ')); setErrors([]); }} />
        <div>
          <label htmlFor="wc-name" className="block text-sm text-text-muted mb-1">{t('timeline.world.name')}</label>
          <input id="wc-name" className={`${input} w-full`} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div>
          <label htmlFor="wc-hours" className="block text-sm text-text-muted mb-1">{t('timeline.details.hours')}</label>
          <input id="wc-hours" type="number" min={1} max={1000} className={num} value={draft.hoursPerDay ?? 24} onChange={event => set({ hoursPerDay: Number(event.target.value) })} />
        </div>

        <div className={section}>
          <p className={heading}>{t('timeline.world.months')}</p>
          {draft.months.map((m, i) => (
            <div key={i} className="flex items-center gap-2">
              <input aria-label={t('timeline.world.monthName').replace('{n}', String(i + 1))} className={`${input} flex-1`} value={m.name}
                onChange={(e) => set({ months: draft.months.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <input aria-label={t('timeline.world.monthDays').replace('{n}', String(i + 1))} type="number" min={draft.leap?.month === i + 1 ? 0 : 1} className={num} value={m.days}
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
          <label className="flex flex-wrap items-center gap-2 text-xs text-text-muted">{t('timeline.world.weekMode')}
            <select data-testid="world-calendar-week-mode" className={input} value={draft.weekMode ?? 'continuous'} onChange={(e) => set({ weekMode: e.target.value === 'monthStart' ? 'monthStart' : undefined })}>
              <option value="continuous">{t('timeline.world.weekContinuous')}</option>
              <option value="monthStart">{t('timeline.world.weekMonthStart')}</option>
            </select>
          </label>
        </div>

        <div className={section}>
          <p className={heading}>{t('timeline.world.eras')}</p>
          <p className="text-xs text-text-muted">{t('timeline.settings.erasHelp')}</p>
          <label className="flex gap-2 text-xs text-text-muted"><input type="checkbox" checked={draft.allowNegativeYears !== false} onChange={event => set({ allowNegativeYears: event.target.checked })} />{t('timeline.settings.negativeYears')}</label>
          {draft.eras.map((era, i) => (
            <div key={i} className="flex items-center flex-wrap gap-2">
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
              <label className="flex gap-1 text-xs text-text-muted"><input type="checkbox" checked={!!era.yearZero} disabled={era.countdown} onChange={event => set({ eras: draft.eras.map((item, index) => index === i ? { ...item, yearZero: event.target.checked || undefined } : item) })} />{t('timeline.settings.yearZero')}</label>
              {i < draft.eras.length - 1 && <label className="flex items-center gap-1 text-xs text-text-muted">{t('timeline.settings.duration')}<input type="number" min={1} className={num} value={draft.eras[i + 1].startYear - era.startYear} onChange={event => { const length = Number(event.target.value); const delta = length - (draft.eras[i + 1].startYear - era.startYear); set({ eras: draft.eras.map((item, index) => index > i ? { ...item, startYear: item.startYear + delta } : item) }); }} /></label>}
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
              <input data-testid={`world-calendar-moon-color-${i}`} aria-label={t('timeline.world.moonColor')} title={t('timeline.world.moonColor')} type="color" className="h-8 w-9 rounded border border-border bg-elevated" value={moon.color ?? '#c8c8d0'}
                onChange={(e) => set({ moons: draft.moons.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })} />
              <button type="button" className={iconButton} aria-label={t('timeline.world.removeMoon')}
                onClick={() => set({ moons: draft.moons.filter((_, j) => j !== i) })}><Trash2 size={14} aria-hidden="true" /></button>
            </div>
          ))}
          <label className="flex flex-wrap items-center gap-2 text-xs text-text-muted">{t('timeline.world.moonDisplay')}
            <select data-testid="world-calendar-moon-display" className={input} value={draft.moonDisplay ?? 'quarters'} onChange={(e) => set({ moonDisplay: e.target.value === 'quarters' ? undefined : e.target.value as WorldCalendar['moonDisplay'] })}>
              {(['quarters', 'every', 'full', 'none'] as const).map(mode => <option key={mode} value={mode}>{t(`timeline.world.moonDisplay.${mode}`)}</option>)}
            </select>
          </label>
          <button type="button" className={addButton} onClick={() => set({ moons: [...draft.moons, { name: `${t('timeline.world.newMoon')} ${draft.moons.length + 1}`, periodDays: 29.5, newMoonDay: 0 }] })}>
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
              {draft.months[draft.leap.month - 1]?.days === 0 && <p data-testid="world-calendar-leap-month-note" className="w-full text-[11px] text-text-dim">{t('timeline.world.leapMonthNote').replace('{name}', draft.months[draft.leap.month - 1].name).replace('{days}', String(draft.leap.extraDays))}</p>}
              <label>{t('timeline.details.leapExcept')} <input aria-label={t('timeline.details.leapExcept')} type="number" min={1} className={num} value={draft.leap.exceptEvery ?? ''} onChange={event => set({ leap: { ...draft.leap!, exceptEvery: event.target.value ? Number(event.target.value) : undefined, ...(!event.target.value ? { restoreEvery: undefined } : {}) } })} /></label>
              <label>{t('timeline.details.leapRestore')} <input aria-label={t('timeline.details.leapRestore')} type="number" min={1} className={num} disabled={!draft.leap.exceptEvery} value={draft.leap.restoreEvery ?? ''} onChange={event => set({ leap: { ...draft.leap!, restoreEvery: event.target.value ? Number(event.target.value) : undefined } })} /></label>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted" data-testid="world-calendar-correlation">
            <span>{t('timeline.world.correlation')}</span>
            <input data-testid="world-calendar-correlation-world" aria-label={t('timeline.world.correlationWorld')} placeholder={t('timeline.world.correlationWorld')} className={`${input} w-40`} value={corrWorld} onChange={event => setCorrWorld(event.target.value)} />
            <span>=</span>
            <input data-testid="world-calendar-correlation-earth" aria-label={t('timeline.world.correlationEarth')} type="date" className={input} value={corrEarth} onChange={event => setCorrEarth(event.target.value)} />
            <p className="w-full text-[11px] text-text-dim">{t('timeline.world.correlationHelp')}</p>
          </div>
          <button type="button" data-testid="world-calendar-add-leap-month" className={addButton} onClick={() => {
            // A month with no days of its own that the leap rule fills: it exists only in leap years.
            const months = [...draft.months, { name: t('timeline.world.leapMonthName'), days: 0 }];
            set({ months, leap: { ...(draft.leap ?? { every: 4, offset: 0 }), month: months.length, extraDays: 30 } });
          }}>
            <Plus size={12} aria-hidden="true" /> {t('timeline.world.addLeapMonth')}
          </button>
        </div>

        </fieldset>
        {pendingRedate && (
          <div className="space-y-2 rounded-md border border-accent-gold/40 bg-accent-gold/10 p-3 text-xs" data-testid="world-calendar-redate-plan">
            <p className="font-semibold text-text-primary">{t('timeline.settings.redateTitle').replace('{count}', String(pendingRedate.length))}</p>
            <ul className="space-y-0.5 text-text-muted">{pendingRedate.slice(0, 8).map(change => <li key={change.id}>«{change.title}»: {change.before} → <span className="text-text-primary">{change.after}</span></li>)}{pendingRedate.length > 8 && <li>…</li>}</ul>
            <div className="flex gap-2"><button type="button" data-testid="world-calendar-redate" onClick={() => void save(true)} className="rounded-lg bg-accent-gold px-3 py-1.5 font-semibold text-deep">{t('timeline.settings.redateApply')}</button>{!timeline && <button type="button" data-testid="world-calendar-keep-dates" onClick={() => void save(false, true)} className="rounded-lg border border-border px-3 py-1.5 text-text-primary">{t('timeline.settings.redateKeep')}</button>}<button type="button" onClick={() => setPendingRedate(null)} className="rounded-lg border border-border px-3 py-1.5 text-text-muted">{t('common.cancel')}</button></div>
          </div>
        )}
        {errors.length > 0 && (
          <ul className="text-xs text-danger space-y-1 bg-danger/10 rounded-md p-2" role="alert" data-testid="world-calendar-errors">
            {errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}

        <div className="flex items-center justify-between pt-2">
          {ownCalendar ? (
            <button type="button" onClick={() => void remove()} className="text-xs text-danger hover:underline">{t(timeline ? 'timeline.settings.useProject' : 'timeline.world.remove')}</button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-text-muted hover:text-text-primary">{t('common.cancel')}</button>
            <button type="button" onClick={() => void save()} data-testid="world-calendar-save"
              className="px-4 py-2 text-sm rounded-lg bg-accent-gold text-deep font-semibold hover:brightness-110">
              {!timeline && resolved?.inherited ? t('timeline.world.saveOwn') : t('common.save')}
            </button>
          </div>
        </div>
      </fieldset>
    </Modal>
  );
}
