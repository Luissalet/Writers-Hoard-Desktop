import {resolveBannerStyle,bannerBackground,bannerPaint} from '../bannerStyles';
import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Calculator } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { Timeline, TimelineEvent } from '@/types';
import { generateId } from '@/utils/idGenerator';
import { earthCalendar } from '../calendarPresets';
import { calendarMonth, calendarStart, daysBetween, stepMonth, type CalendarKind } from '../calendarGrid';
import { addDays, daysInMonth, formatWorldDate, monthsInYear, parseWorldDate, weekdayOf, type WorldCalendar, type WorldDate } from '../worldCalendar';
import { timelineEventLabel } from '../eventClock';
import { calendarLens, earthToWorld, isoDate, toIso, worldToEarth } from '../calendarLens';

/** Today on the Gregorian calendar (read once, when the view opens). */
/** The clock, read when an event is made rather than while drawing. */
const clock = (): number => Date.now();
function currentDate(): WorldDate { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }; }

const MOON = { new: '🌑', waxingCrescent: '🌒', firstQuarter: '🌓', waxingGibbous: '🌔', full: '🌕', waningGibbous: '🌖', lastQuarter: '🌗', waningCrescent: '🌘' } as Record<string, string>;
const button = 'inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-text-primary hover:bg-elevated disabled:opacity-40';
const input = 'rounded-lg border border-border bg-elevated px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-gold';

/**
 * Events on a calendar: a month in weeks (holidays, moon phases, leap days) or
 * the whole year, on the project's world calendar or the Gregorian one, with
 * go-to-date and a small date calculator.
 */
export default function CalendarView({ events, timelines, worldCalendar, onAddEvent, onOpenEvent,bannerTimelines }: { events: TimelineEvent[]; timelines: Timeline[];bannerTimelines?:Timeline[]; worldCalendar: WorldCalendar | null; onAddEvent: (event: TimelineEvent) => void | Promise<void>; onOpenEvent?: (event: TimelineEvent, trigger: HTMLButtonElement) => void }) {
  const { t, locale } = useTranslation();
  const lang = locale === 'en' ? 'en' : 'es';
  const [kind, setKind] = useState<CalendarKind>(worldCalendar ? 'world' : 'earth');
  const calendar = useMemo(() => (kind === 'world' && worldCalendar ? worldCalendar : earthCalendar(lang)), [kind, worldCalendar, lang]);
  const [today] = useState(currentDate);
  const [cursor, setCursor] = useState<{ year: number; month: number } | null>(null);
  // A calendar that starts at its first era has no years before it: the view never goes there.
  const firstYear = calendar.allowNegativeYears === false && calendar.eras.length ? Math.min(...calendar.eras.map(era => era.startYear)) : -Infinity;
  const asked = cursor ?? calendarStart(calendar, kind, events, kind === 'earth' ? today : { year: calendar.eras[0]?.startYear ?? 1, month: 1, day: 1 });
  // A leap month in a common year does not exist: show the month after it.
  const wanted = asked.year < firstYear ? { year: firstYear, month: 1 } : asked;
  const at = daysInMonth(calendar, wanted.year, wanted.month) === 0 ? stepMonth(calendar, wanted, 0) : wanted;
  const [scale, setScale] = useState<'month' | 'year'>('month');
  const [picked, setPicked] = useState<number | null>(null);
  const [goTo, setGoTo] = useState(''), [goError, setGoError] = useState(false);
  const [draft, setDraft] = useState('');
  const [calcA, setCalcA] = useState(''), [calcB, setCalcB] = useState(''), [calcN, setCalcN] = useState('');
  const lens = useMemo(() => calendarLens(worldCalendar), [worldCalendar]);
  const month = calendarMonth(calendar, kind, at.year, at.month, events, lens);
  const todayNumber = (() => { if (kind !== 'earth') return null; try { return calendarMonth(calendar, kind, today.year, today.month!, []).days[today.day! - 1]?.dayNumber ?? null; } catch { return null; } })();
  const yearMonths = scale === 'year' ? monthsInYear(calendar, at.year).map(m => calendarMonth(calendar, kind, at.year, m, events, lens)) : [];
  const dayAt = month.days.find(day => day.dayNumber === picked);
  const parse = (text: string): WorldDate | null => { try { const date = parseWorldDate(calendar, text); return date && date.month && date.day ? date : null; } catch { return null; } };
  const label = (date: WorldDate) => { try { return formatWorldDate(calendar, date); } catch { return ''; } };
  const a = parse(calcA), b = parse(calcB), n = Number(calcN);
  const between = a && b ? daysBetween(calendar, a, b) : null;
  const plus = a && calcN.trim() && Number.isInteger(n) ? (() => { try { return addDays(calendar, a, n); } catch { return null; } })() : null;
  const create = async () => {
    if (!dayAt || !draft.trim() || !timelines[0]) return;
    const now = clock(), date = { year: at.year, month: at.month, day: dayAt.day };
    const base = { id: generateId('evt'), projectId: timelines[0].projectId, timelineId: timelines[0].id, title: draft.trim(), description: '', eventType: 'point' as const, order: events.filter(e => e.timelineId === timelines[0].id).reduce((max, e) => Math.max(max, e.order), -1) + 1, lane: '', color: timelines[0].color || '#c4973b', createdAt: now, updatedAt: now };
    const dated = kind === 'world' ? { dateMode: 'world' as const, worldDate: date } : { dateMode: 'calendar' as const, realDate: toIso(date) };
    await onAddEvent({ ...base, ...dated, date: timelineEventLabel({ date: '', ...dated }, calendar, locale) });
    setDraft('');
  };
  const copy = lang === 'es'
    ? { world: worldCalendar?.name ?? 'Calendario del mundo', earth: 'Gregoriano', month: 'Mes', year: 'Año', go: 'Ir a', today: 'Hoy', none: 'Nada este día', add: 'Nuevo suceso este día', calc: 'Calculadora de fechas', from: 'Desde', to: 'Hasta', days: 'días', plus: '+ días', leap: 'día bisiesto', bad: 'Fecha no válida en este calendario', untimed: '{n} sucesos sin fecha en este calendario' }
    : { world: worldCalendar?.name ?? 'World calendar', earth: 'Gregorian', month: 'Month', year: 'Year', go: 'Go to', today: 'Today', none: 'Nothing on this day', add: 'New event on this day', calc: 'Date calculator', from: 'From', to: 'To', days: 'days', plus: '+ days', leap: 'leap day', bad: 'Not a date on this calendar', untimed: '{n} events not dated on this calendar' };
  const unplaced = events.filter(event => !((event.dateMode === 'world' && event.worldDate && (kind === 'world' || lens)) || (event.dateMode === 'calendar' && event.realDate && (kind === 'earth' || lens)))).length;
  // The same day on the other calendar, when the world calendar says how they line up.
  const equivalent = (date: WorldDate): string => { if (!lens) return ''; try { if (kind === 'world') { const day = isoDate(worldToEarth(lens, date))!; return formatWorldDate(earthCalendar(lang), day); } return formatWorldDate(lens.world, earthToWorld(lens, toIso(date))); } catch { return ''; } };
  const dayCell = (day: (typeof month.days)[number], small = false) => <button key={day.dayNumber} type="button" data-testid={small ? undefined : `calendar-day-${day.day}`} onClick={() => { setPicked(day.dayNumber); if (small) { setCursor({ year: at.year, month: yearMonths.find(m => m.days.includes(day))?.month ?? at.month }); setScale('month'); } }}
    title={[...day.holidays, day.leapDay ? copy.leap : '', ...day.events.map(e => e.title)].filter(Boolean).join(' · ')}
    className={`relative flex flex-col items-stretch rounded-md border text-left transition ${small ? 'h-6 min-w-0 justify-center px-0.5 text-[10px]' : 'min-h-[84px] p-1 text-xs'} ${picked === day.dayNumber ? 'border-accent-gold' : 'border-border/60 hover:border-accent-gold/50'} ${day.holidays.length ? 'bg-accent-gold/10' : 'bg-surface'} ${day.leapDay ? 'ring-1 ring-accent-plum/60' : ''}`}>
    <span className="flex items-center justify-between gap-1"><span className={day.dayNumber === todayNumber ? 'rounded bg-accent-gold px-1 font-bold text-deep' : 'text-text-muted'}>{day.day}</span>{day.moon && <span aria-label={day.moon} data-testid="calendar-moon" data-phase={day.moon} style={calendar.moons[0]?.color ? { borderBottom: `2px solid ${calendar.moons[0].color}`, lineHeight: 1 } : undefined}>{MOON[day.moon]}</span>}</span>
    {small ? (day.events.length > 0 && <span className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent-gold" />) : <>
      {day.holidays.map(name => <span key={name} className="truncate text-[10px] italic text-accent-gold">{name}</span>)}
      {day.bars.slice(0, 3).map(({ event, start, end }) => {
        // A run of days reads as one banner: square where it carries on, its title where it starts (or on a week's first day).
        const span = !(start && end);
        const effective=resolveBannerStyle(event,bannerTimelines??timelines).style;
        const paint=bannerPaint(effective);
        const shape = effective.shape === 'ribbon' || effective.shape === 'bunting' || effective.shape === 'scallop' ? effective.shape : 'plain';
        const decorative = shape !== 'plain';
        const silhouette: CSSProperties = shape === 'ribbon'
          ? { clipPath: `polygon(0 0, 100% 0, ${end ? 'calc(100% - 6px)' : '100%'} 50%, 100% 100%, 0 100%, ${start ? '6px' : '0'} 50%)`, paddingLeft: start ? 8 : 4, paddingRight: end ? 8 : 4 }
          : shape === 'bunting' || shape === 'scallop'
            ? { paddingBottom: 4, maskImage: `linear-gradient(#000 0 0), ${shape === 'bunting' ? 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'8\' height=\'4\'%3E%3Cpath fill=\'black\' d=\'M0 0H8L4 4Z\'/%3E%3C/svg%3E")' : 'radial-gradient(ellipse 4px 4px at 50% 0, #000 98%, transparent 100%)'}`, maskSize: '100% calc(100% - 4px), 8px 4px', maskPosition: 'top, bottom', maskRepeat: 'no-repeat, repeat-x' }
            : {};
        const showTitle = !decorative || start || day.day === 1 || (month.lead + day.day - 1) % (calendar.weekdays.length || 7) === 0;
        return <span key={event.id} data-testid="calendar-event" data-banner={span ? (start ? 'start' : end ? 'end' : 'middle') : 'single'} data-pattern={effective.pattern} data-shape={shape} className="relative mt-0.5 truncate px-1 text-[10px] text-white"
          style={{ background: bannerBackground(effective), borderRadius: `${start ? 4 : 0}px ${end ? 4 : 0}px ${end ? 4 : 0}px ${start ? 4 : 0}px`, marginLeft: start || small ? 0 : -5, marginRight: end || small ? 0 : -5, ...(decorative ? { minHeight: 20, lineHeight: '16px', ...silhouette } : {}) }}>{paint?<><span aria-hidden="true" data-testid="calendar-banner-paint" className="pointer-events-none absolute inset-0" style={paint}/><span className="relative">{showTitle ? event.title : <span className="sr-only">{event.title}</span>}</span></>:showTitle?event.title:<span className="sr-only">{event.title}</span>}</span>;
      })}
      {day.events.length > 3 && <span className="text-[10px] text-text-dim">+{day.events.length - 3}</span>}
    </>}
  </button>;
  const grid = (m: typeof month, small = false) => m.intercalary
    ? <div className="flex flex-wrap gap-1">{m.days.map(day => dayCell(day, small))}</div>
    : <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${calendar.weekdays.length}, minmax(0, 1fr))` }}>
      {!small && calendar.weekdays.map(name => <span key={name} className="truncate text-center text-[10px] uppercase tracking-wider text-text-dim">{name}</span>)}
      {Array.from({ length: m.lead }, (_, i) => <span key={`lead-${i}`} />)}
      {m.days.map(day => dayCell(day, small))}
    </div>;
  return <section className="space-y-3" data-testid="timeline-calendar">
    <div className="flex flex-wrap items-center gap-2">
      <CalendarDays size={16} className="text-accent-gold" aria-hidden="true" />
      <select data-testid="calendar-kind" aria-label={t('timeline.world.openEditor')} value={kind} onChange={event => { setKind(event.target.value as CalendarKind); setCursor(null); setPicked(null); }} className={input}>
        {worldCalendar && <option value="world">{copy.world}</option>}
        <option value="earth">{copy.earth}</option>
      </select>
      <div className="flex rounded-lg border border-border p-0.5">{(['month', 'year'] as const).map(value => <button key={value} type="button" data-testid={`calendar-scale-${value}`} aria-pressed={scale === value} onClick={() => setScale(value)} className={`rounded-md px-2.5 py-1 text-xs ${scale === value ? 'bg-accent-gold/20 text-accent-gold font-semibold' : 'text-text-muted'}`}>{copy[value]}</button>)}</div>
      <button type="button" className={button} data-testid="calendar-prev" aria-label="prev" onClick={() => setCursor(scale === 'year' ? { year: at.year - 1, month: at.month } : stepMonth(calendar, at, -1))}><ChevronLeft size={14} /></button>
      <h3 className="min-w-40 text-center font-serif text-lg text-text-primary" data-testid="calendar-title">{scale === 'year' ? label({ year: at.year }) : `${month.name} · ${label({ year: at.year })}`}</h3>
      <button type="button" className={button} data-testid="calendar-next" aria-label="next" onClick={() => setCursor(scale === 'year' ? { year: at.year + 1, month: at.month } : stepMonth(calendar, at, 1))}><ChevronRight size={14} /></button>
      {kind === 'earth' && <button type="button" className={button} onClick={() => { setCursor({ year: today.year, month: today.month! }); setScale('month'); }}>{copy.today}</button>}
      <form className="flex items-center gap-1" onSubmit={event => { event.preventDefault(); const date = (() => { try { return parseWorldDate(calendar, goTo); } catch { return null; } })(); if (!date) { setGoError(true); return; } setGoError(false); setCursor({ year: date.year, month: date.month ?? 1 }); setScale(date.month ? 'month' : 'year'); }}>
        <input data-testid="calendar-goto" className={`${input} w-40`} value={goTo} placeholder={label({ year: at.year, month: at.month, day: 1 })} onChange={event => setGoTo(event.target.value)} aria-label={copy.go} />
        <button type="submit" className={button}>{copy.go}</button>
      </form>
      {goError && <span role="alert" className="text-xs text-danger">{copy.bad}</span>}
      {lens && <span data-testid="calendar-lens-note" className="text-[11px] text-text-dim">{lang === 'es' ? `Correlación: ${lens.world.name} ↔ gregoriano; se ven los sucesos de ambos calendarios` : `Correlation: ${lens.world.name} ↔ Gregorian; events from both calendars show`}</span>}
      {unplaced > 0 && <span className="text-[11px] text-text-dim">{copy.untimed.replace('{n}', String(unplaced))}</span>}
    </div>
    {scale === 'month' ? grid(month) : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{yearMonths.map(m => <div key={m.month} className="rounded-lg border border-border p-2"><button type="button" className="mb-1 text-sm font-semibold text-text-primary hover:text-accent-gold" onClick={() => { setCursor({ year: m.year, month: m.month }); setScale('month'); }}>{m.name}</button>{grid(m, true)}</div>)}</div>}
    {scale === 'month' && dayAt && <div className="space-y-2 rounded-lg border border-border bg-surface p-3" data-testid="calendar-day-detail">
      <p className="text-sm font-semibold text-text-primary">{label({ year: at.year, month: at.month, day: dayAt.day })}{dayAt.weekday ? ` · ${dayAt.weekday}` : ''}{dayAt.holidays.length ? ` · ${dayAt.holidays.join(', ')}` : ''}</p>
      {lens && equivalent({ year: at.year, month: at.month, day: dayAt.day }) && <p data-testid="calendar-equivalent" className="text-xs text-text-muted">{lang === 'es' ? 'En el otro calendario' : 'On the other calendar'}: {equivalent({ year: at.year, month: at.month, day: dayAt.day })}</p>}
      {dayAt.events.length ? dayAt.events.map(event => <div key={event.id} className="border-l-2 pl-2" style={{ borderColor: event.color }}>{onOpenEvent ? <button type="button" data-testid={`calendar-open-event-${event.id}`} onClick={click => onOpenEvent(event, click.currentTarget)} className="min-h-9 text-left text-sm text-accent-gold hover:underline">{event.title}</button> : <p className="text-sm text-text-primary">{event.title}</p>}{event.description && <p className="text-xs text-text-muted">{event.description}</p>}</div>) : <p className="text-xs text-text-dim">{copy.none}</p>}
      {timelines.length > 0 && <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void create(); }}><input data-testid="calendar-new-title" className={`${input} flex-1`} value={draft} onChange={event => setDraft(event.target.value)} placeholder={copy.add} /><button type="submit" className={button} data-testid="calendar-new" disabled={!draft.trim()}><Plus size={12} />{copy.add}</button></form>}
    </div>}
    <details className="rounded-lg border border-border p-3 text-xs" data-testid="calendar-calculator">
      <summary className="flex cursor-pointer items-center gap-1.5 text-text-primary"><Calculator size={13} />{copy.calc}</summary>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">{copy.from}<input data-testid="calc-a" className={input} value={calcA} onChange={event => setCalcA(event.target.value)} placeholder={label({ year: at.year, month: at.month, day: 1 })} /></label>
        <label className="flex items-center gap-1">{copy.to}<input data-testid="calc-b" className={input} value={calcB} onChange={event => setCalcB(event.target.value)} /></label>
        <span data-testid="calc-between" className="font-semibold text-accent-gold">{between !== null ? `${between} ${copy.days}` : ''}</span>
        <label className="flex items-center gap-1">{copy.plus}<input data-testid="calc-n" className={`${input} w-20`} inputMode="numeric" value={calcN} onChange={event => setCalcN(event.target.value)} /></label>
        <span data-testid="calc-plus" className="font-semibold text-accent-gold">{plus ? `${label(plus)}${weekdayOf(calendar, plus) ? ` · ${weekdayOf(calendar, plus)}` : ''}` : ''}</span>
      </div>
      {(calcA.trim() && !a) || (calcB.trim() && !b) ? <p role="alert" className="mt-1 text-danger">{copy.bad}</p> : null}
    </details>
  </section>;
}
