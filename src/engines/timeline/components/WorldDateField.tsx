import { useId, useMemo, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { calendarMonth } from '../calendarGrid';
import { useTranslation } from '@/i18n/useTranslation';
import { daysInMonth, describeWorldDate, formatWorldDate, parseWorldDate, type WorldCalendar } from '../worldCalendar';

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
  const parsed = useMemo(() => (value.trim() ? parseWorldDate(calendar, value) : null), [calendar, value]);
  const info = useMemo(() => (parsed ? describeWorldDate(calendar, parsed) : null), [calendar, parsed]);
  const firstYear = Math.min(...calendar.eras.map(era => era.startYear));
  const example = formatWorldDate(calendar, { year: firstYear + 2, month: 1, day: Math.min(12, calendar.months[0].days) });
  const inputId = testId ? `${testId}-input` : undefined;
  // The picker: a year, a month from the list, a day from the month's grid.
  const [picking, setPicking] = useState(false);
  const [cursor, setCursor] = useState<{ year: number; month: number } | null>(null);
  const at = cursor ?? { year: parsed?.year ?? firstYear, month: parsed?.month ?? 1 };
  const grid = picking ? (() => { try { return calendarMonth(calendar, 'world', at.year, at.month, []); } catch { return null; } })() : null;
  const pick = (patch: Partial<{ year: number; month: number }>) => setCursor({ ...at, ...patch });
  const choose = (day?: number) => { onChange(formatWorldDate(calendar, { year: at.year, month: at.month, ...(day ? { day } : {}) })); if (day) setPicking(false); };
  return (
    <div>
      <label htmlFor={inputId} className="block text-[11px] text-text-dim mb-1">
        {label} {optional && <span className="text-text-dim">{t('timeline.endDateOptional')}</span>}
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          data-testid={testId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={example}
          list={monthListId}
          aria-invalid={!!value.trim() && !parsed}
          className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
        />
        <button type="button" data-testid={testId ? `${testId}-picker` : undefined} aria-expanded={picking} aria-label={t('timeline.picker.open')} title={t('timeline.picker.open')} onClick={() => { setCursor(null); setPicking(open => !open); }}
          className="shrink-0 rounded-lg border border-border px-2.5 text-text-muted hover:text-accent-gold hover:border-accent-gold/60"><CalendarDays size={16} aria-hidden="true" /></button>
      </div>
      {picking && (
        <div className="mt-2 space-y-2 rounded-lg border border-border bg-surface p-2" data-testid={testId ? `${testId}-picker-panel` : undefined}>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-[11px] text-text-muted">{t('timeline.picker.year')}
              <input type="number" data-testid={testId ? `${testId}-picker-year` : undefined} value={at.year} onChange={e => { const year = Number(e.target.value); if (Number.isSafeInteger(year)) pick({ year }); }} className="w-24 rounded border border-border bg-elevated px-2 py-1 text-xs text-text-primary" />
            </label>
            <span className="text-[11px] text-text-dim">{formatWorldDate(calendar, { year: at.year })}</span>
            <button type="button" className="ml-auto text-[11px] text-accent-gold underline" onClick={() => choose()}>{t('timeline.picker.wholeMonth')}</button>
          </div>
          <div className="flex flex-wrap gap-1">
            {calendar.months.map((m, index) => daysInMonth(calendar, at.year, index + 1) === 0 ? null : <button key={m.name} type="button" data-testid={testId ? `${testId}-picker-month-${index + 1}` : undefined} onClick={() => pick({ month: index + 1 })} className={`rounded px-2 py-0.5 text-[11px] border ${at.month === index + 1 ? 'border-accent-gold text-accent-gold' : 'border-border text-text-muted'}`}>{m.name}</button>)}
          </div>
          {/* A month that does not exist that year (a leap month), or a year before the calendar starts, has no days to pick. */}
          {!grid ? <p className="text-[11px] text-text-dim" data-testid={testId ? `${testId}-picker-nodays` : undefined}>{t('timeline.picker.noDays')}</p> : <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${grid.intercalary ? 7 : Math.max(1, calendar.weekdays.length)}, minmax(0, 1fr))` }}>
            {!grid.intercalary && calendar.weekdays.map(day => <span key={day} className="truncate text-center text-[9px] text-text-dim">{day.slice(0, 2)}</span>)}
            {Array.from({ length: grid.lead }, (_, i) => <span key={`lead-${i}`} />)}
            {grid.days.map(day => <button key={day.day} type="button" data-testid={testId ? `${testId}-picker-day-${day.day}` : undefined} title={[day.weekday, ...day.holidays].filter(Boolean).join(' · ')} onClick={() => choose(day.day)}
              className={`rounded py-0.5 text-[11px] ${parsed?.year === at.year && parsed?.month === at.month && parsed?.day === day.day ? 'bg-accent-gold text-deep' : day.holidays.length ? 'text-accent-gold hover:bg-elevated' : 'text-text-primary hover:bg-elevated'}`}>{day.day}</button>)}
          </div>}
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
