import { useId, useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { describeWorldDate, formatWorldDate, parseWorldDate, type WorldCalendar } from '../worldCalendar';

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
  return (
    <div>
      <label htmlFor={inputId} className="block text-[11px] text-text-dim mb-1">
        {label} {optional && <span className="text-text-dim">{t('timeline.endDateOptional')}</span>}
      </label>
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
