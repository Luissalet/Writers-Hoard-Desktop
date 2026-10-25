import { useId, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { calendarMonth, stepMonth } from '../calendarGrid';
import { useTranslation } from '@/i18n/useTranslation';
import { assertValidDate, daysInMonth, describeWorldDate, formatWorldDate, monthsInYear, parseWorldDate, type WorldCalendar, type WorldDate } from '../worldCalendar';
import { calendarLens, earthToWorld, toIso } from '../calendarLens';

interface WorldDateFieldProps {
  calendar: WorldCalendar;
  label: string;
  value: string;
  onChange: (text: string) => void;
  optional?: boolean;
  testId?: string;
}

/**
 * A date typed in the world calendar ("12 Frostfall 431 TE"), with a live
 * reading underneath: weekday, moons, holidays — or why it does not exist.
 */
export function WorldDateField({ calendar, label, value, onChange, optional, testId }: WorldDateFieldProps) {
  const { t } = useTranslation();
  const monthListId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => (value.trim() ? parseWorldDate(calendar, value) : null), [calendar, value]);
  const info = useMemo(() => (parsed ? describeWorldDate(calendar, parsed) : null), [calendar, parsed]);
  const firstYear = Math.min(...calendar.eras.map(era => era.startYear));
  const exampleYear = firstYear + 2;
  const exampleMonth = monthsInYear(calendar, exampleYear)[0];
  const example = formatWorldDate(calendar, { year: exampleYear, ...(exampleMonth === undefined ? {} : { month: exampleMonth, day: Math.min(12, daysInMonth(calendar, exampleYear, exampleMonth)) }) });
  const inputId = testId ? `${testId}-input` : undefined;
  // The picker: a year, a month from the list, a day from the month's grid.
  const [picking, setPicking] = useState(false);
  const [cursor, setCursor] = useState<{ year: number; month: number } | null>(null);
  const [exact, setExact] = useState<{ year: string; month: string; day: string; approx?: boolean } | null>(null);
  const [pickerError, setPickerError] = useState(false);
  const year = parsed?.year ?? firstYear;
  const at = cursor ?? { year, month: parsed?.month ?? monthsInYear(calendar, year)[0] ?? 1 };
  const grid = picking ? (() => { try { return calendarMonth(calendar, 'world', at.year, at.month, []); } catch { return null; } })() : null;
  // A calendar with only a leap month has empty years: keep their cursor
  // navigable without asking stepMonth to search an unbounded number of years.
  const adjacentMonth = (by: number) => {
    const nextYear = { year: at.year + by, month: at.month };
    if (!monthsInYear(calendar, at.year).length) return nextYear;
    const next = stepMonth(calendar, at, by);
    return daysInMonth(calendar, next.year, next.month) ? next : nextYear;
  };
  const previous = picking ? adjacentMonth(-1) : null;
  const lens = useMemo(() => calendar.correlation?.date.month !== undefined && calendar.correlation.date.day !== undefined ? calendarLens(calendar) : null, [calendar]);
  const pick = (patch: Partial<{ year: number; month: number }>) => { setCursor({ ...at, ...patch }); setPickerError(false); };
  const close = () => { setPicking(false); setExact(null); setPickerError(false); inputRef.current?.focus(); };
  const choose = (day?: number) => {
    if (!grid) return;
    onChange(formatWorldDate(calendar, { year: at.year, month: at.month, ...(day ? { day } : {}) }));
    if (day) close();
  };
  const exactDate: WorldDate | null = (() => {
    if (!exact || !exact.year.trim() || !Number.isSafeInteger(Number(exact.year))) return null;
    const date: WorldDate = { year: Number(exact.year), ...(exact.approx ? { approx: true } : {}) };
    if (exact.month) date.month = Number(exact.month);
    if (exact.day.trim()) date.day = Number(exact.day);
    try { assertValidDate(calendar, date); return date; } catch { return null; }
  })();
  const today = () => {
    if (!lens) return;
    try {
      const now = new Date();
      const date = earthToWorld(lens, toIso({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }));
      assertValidDate(calendar, date);
      onChange(formatWorldDate(calendar, date));
      close();
    } catch { setPickerError(true); }
  };
  const action = 'min-h-9 rounded-lg border border-border px-2.5 py-1 text-xs text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-gold disabled:opacity-40';
  const exactInput = 'min-h-9 w-full min-w-0 rounded-lg border border-border bg-elevated px-2 py-1 text-sm text-text-primary outline-none focus:border-accent-gold';
  return (
    <div>
      <label htmlFor={inputId} className="block text-[11px] text-text-dim mb-1">
        {label} {optional && <span className="text-text-dim">{t('timeline.endDateOptional')}</span>}
      </label>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
        <input
          ref={inputRef}
          id={inputId}
          data-testid={testId}
          value={value}
          onChange={(e) => { setPickerError(false); onChange(e.target.value); }}
          placeholder={example}
          list={monthListId}
          aria-invalid={!!value.trim() && !parsed}
          className="w-full min-w-0 pl-4 pr-10 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
        />
        {value && <button type="button" data-testid={testId ? `${testId}-clear` : undefined} aria-label={t('timeline.picker.clear')} title={t('timeline.picker.clear')} onClick={() => { onChange(''); close(); }} className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-text-muted hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold"><X size={14} aria-hidden="true" /></button>}
        </div>
        <button type="button" data-testid={testId ? `${testId}-picker` : undefined} aria-expanded={picking} aria-label={t('timeline.picker.open')} title={t('timeline.picker.open')} onClick={() => { setCursor(null); setExact(null); setPickerError(false); setPicking(open => !open); }}
          className="min-h-9 shrink-0 rounded-lg border border-border px-2.5 text-text-muted hover:text-accent-gold hover:border-accent-gold/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-gold"><CalendarDays size={16} aria-hidden="true" /></button>
      </div>
      {picking && (
        <div className="mt-2 space-y-2 rounded-lg border border-border bg-surface p-2" data-testid={testId ? `${testId}-picker-panel` : undefined}>
          {exact ? <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="min-w-0 space-y-1 text-xs text-text-muted">{t('timeline.picker.year')}
                <input type="number" step="1" value={exact.year} data-testid={testId ? `${testId}-exact-year` : undefined} onChange={e => setExact({ ...exact, year: e.target.value })} className={exactInput} />
              </label>
              <label className="min-w-0 space-y-1 text-xs text-text-muted">{t('timeline.picker.month')}
                <select value={exact.month} data-testid={testId ? `${testId}-exact-month` : undefined} onChange={e => setExact({ ...exact, month: e.target.value })} className={exactInput}>
                  <option value="">{t('timeline.picker.noMonth')}</option>
                  {calendar.months.map((month, index) => <option key={month.name} value={index + 1}>{month.name}</option>)}
                </select>
              </label>
              <label className="min-w-0 space-y-1 text-xs text-text-muted">{t('timeline.picker.day')}
                <input type="number" step="1" min="1" value={exact.day} data-testid={testId ? `${testId}-exact-day` : undefined} onChange={e => setExact({ ...exact, day: e.target.value })} className={exactInput} />
              </label>
            </div>
            {!exactDate && <p role="status" className="text-xs text-danger" data-testid={testId ? `${testId}-exact-error` : undefined}>{t('timeline.picker.invalidExact')}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" data-testid={testId ? `${testId}-exact-cancel` : undefined} className={action} onClick={() => { setExact(null); inputRef.current?.focus(); }}>{t('timeline.picker.cancel')}</button>
              <button type="button" data-testid={testId ? `${testId}-exact-apply` : undefined} className={`${action} border-accent-gold text-accent-gold`} disabled={!exactDate} onClick={() => { if (exactDate) { onChange(formatWorldDate(calendar, exactDate)); close(); } }}>{t('timeline.picker.apply')}</button>
            </div>
          </> : <>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" data-testid={testId ? `${testId}-picker-prev` : undefined} aria-label={t('timeline.picker.previous')} className={action} disabled={calendar.allowNegativeYears === false && !!previous && previous.year < firstYear} onClick={() => { if (previous) pick(previous); }}><ChevronLeft size={14} aria-hidden="true" /></button>
            <label className="flex items-center gap-1 text-[11px] text-text-muted">{t('timeline.picker.year')}
              <input type="number" data-testid={testId ? `${testId}-picker-year` : undefined} value={at.year} onChange={e => { const year = Number(e.target.value); if (Number.isSafeInteger(year)) pick({ year }); }} className="min-h-9 w-24 rounded border border-border bg-elevated px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-gold" />
            </label>
            <button type="button" data-testid={testId ? `${testId}-picker-next` : undefined} aria-label={t('timeline.picker.next')} className={action} onClick={() => pick(adjacentMonth(1))}><ChevronRight size={14} aria-hidden="true" /></button>
            <span className="text-[11px] text-text-dim">{formatWorldDate(calendar, { year: at.year })}</span>
            <button type="button" data-testid={testId ? `${testId}-picker-whole-month` : undefined} className={`${action} ml-auto text-accent-gold`} disabled={!grid} onClick={() => choose()}>{t('timeline.picker.wholeMonth')}</button>
          </div>
          <div className="flex flex-wrap gap-1">
            {calendar.months.map((m, index) => daysInMonth(calendar, at.year, index + 1) === 0 ? null : <button key={m.name} type="button" data-testid={testId ? `${testId}-picker-month-${index + 1}` : undefined} aria-pressed={at.month === index + 1} onClick={() => pick({ month: index + 1 })} className={`min-h-9 rounded px-2 py-0.5 text-[11px] border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-gold ${at.month === index + 1 ? 'border-accent-gold text-accent-gold' : 'border-border text-text-muted'}`}>{m.name}</button>)}
          </div>
          {/* A month that does not exist that year (a leap month), or a year before the calendar starts, has no days to pick. */}
          {!grid ? <p className="text-[11px] text-text-dim" data-testid={testId ? `${testId}-picker-nodays` : undefined}>{t('timeline.picker.noDays')}</p> : <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${grid.intercalary ? 7 : Math.max(1, calendar.weekdays.length)}, minmax(0, 1fr))` }}>
            {!grid.intercalary && calendar.weekdays.map(day => <span key={day} className="truncate text-center text-[9px] text-text-dim">{day.slice(0, 2)}</span>)}
            {Array.from({ length: grid.lead }, (_, i) => <span key={`lead-${i}`} />)}
            {grid.days.map(day => <button key={day.day} type="button" data-testid={testId ? `${testId}-picker-day-${day.day}` : undefined} title={[day.weekday, ...day.holidays].filter(Boolean).join(' · ')} onClick={() => choose(day.day)}
              className={`min-h-9 rounded py-0.5 text-[11px] focus-visible:outline-2 focus-visible:outline-accent-gold ${parsed?.year === at.year && parsed?.month === at.month && parsed?.day === day.day ? 'bg-accent-gold text-deep' : day.holidays.length ? 'text-accent-gold hover:bg-elevated' : 'text-text-primary hover:bg-elevated'}`}>{day.day}</button>)}
          </div>}
          <div className="flex flex-wrap gap-2">
            <button type="button" data-testid={testId ? `${testId}-picker-exact` : undefined} className={action} onClick={() => { setExact(parsed ? { year: String(parsed.year), month: parsed.month === undefined ? '' : String(parsed.month), day: parsed.day === undefined ? '' : String(parsed.day), approx: parsed.approx } : { year: String(at.year), month: String(at.month), day: '' }); setPickerError(false); }}>{t('timeline.picker.exact')}</button>
            {lens && <button type="button" data-testid={testId ? `${testId}-picker-today` : undefined} className={action} onClick={today}>{t('timeline.picker.today')}</button>}
          </div>
          {pickerError && <p role="status" className="text-xs text-danger" data-testid={testId ? `${testId}-picker-error` : undefined}>{t('timeline.picker.todayOutside')}</p>}
          </>}
        </div>
      )}
      <datalist id={monthListId}>
        {calendar.months.map((m, index) => <option key={m.name} value={formatWorldDate(calendar, { year: firstYear, month: index + 1, day: 1 })} />)}
      </datalist>
      {value.trim() && (
        <p className={`text-[11px] mt-1 ${parsed ? 'text-text-muted' : 'text-danger'}`} role="status" data-testid={testId ? `${testId}-reading` : undefined}>
          {info ? [
            info.label,
            info.weekday,
            ...info.moons.map((m) => `${m.name}: ${t(`timeline.world.moon.${m.phase}`)}`),
            ...info.holidays.map((h) => `★ ${h}`),
          ].filter(Boolean).join(' · ') : t('timeline.world.unreadable').replace('{example}', example)}
        </p>
      )}
    </div>
  );
}
