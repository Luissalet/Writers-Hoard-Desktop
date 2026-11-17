import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useWorldCalendar } from '@/engines/timeline/useWorldCalendar';
import { WorldDateField } from '@/engines/timeline/components/WorldDateField';
import { parseWorldDate } from '@/engines/timeline/worldCalendar';
import { validateWeatherDate, type WeatherDate, type WorldWeather as Weather } from '../core/weather';
import { weatherCopy, weatherSummary } from '../weatherCopy';

export function WorldWeatherDate({ projectId, onChange, value, onTextChange }: { projectId: string; onChange: (date: WeatherDate | undefined) => void; value?: string; onTextChange?: (text: string) => void }) {
  const resolved = useWorldCalendar(projectId), { locale } = useTranslation(), copy = weatherCopy(locale);
  const [localText, setLocalText] = useState('');
  const text = value ?? localText;
  const setText = onTextChange ?? setLocalText;
  const calendar = resolved?.calendar;
  const context = useMemo(() => {
    const date = calendar ? parseWorldDate(calendar, text) : null;
    if (!calendar || !date) return undefined;
    try { const value = { calendar, date }; validateWeatherDate(value); return value; } catch { return undefined; }
  }, [calendar, text]);
  useEffect(() => onChange(context), [context, onChange]);
  return <div className="space-y-2 text-xs text-text-secondary" data-testid="map-weather-date">
    {calendar ? <WorldDateField calendar={calendar} value={text} onChange={setText} label={copy.date} testId="map-world-date" /> : <p>{copy.calendarHint}</p>}
    {calendar && !context && <p>{copy.dateHint}</p>}
  </div>;
}

export default function WorldWeather({ weather }: { weather: Weather }) {
  const { locale } = useTranslation(), copy = weatherCopy(locale);
  const time = (hour: number | null) => {
    if (hour === null) return '—';
    const minutes = Math.round(hour * 60);
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
  };
  return <section className="space-y-3" aria-label={copy.weather} data-testid="world-weather">
    <h3 className="font-semibold text-text-primary">{copy.weather}</h3>
    <p className="text-sm text-text-primary">{weatherSummary(weather, locale)}</p>
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs tabular-nums">
      <dt>{copy.precipitation}</dt><dd>{weather.precipitationMm} mm</dd>
      <dt>{copy.wind}</dt><dd>{weather.wind.speedKmh} km/h · {Math.round(weather.wind.fromDegrees)}°</dd>
      <dt>{copy.clouds}</dt><dd>{Math.round(weather.cloudCover * 100)}%</dd>
      <dt>{copy.sunrise}</dt><dd>{time(weather.sun.sunrise)}</dd><dt>{copy.sunset}</dt><dd>{time(weather.sun.sunset)}</dd>
      <dt>{copy.daylight}</dt><dd>{weather.sun.daylightHours} / {weather.sun.hoursPerDay} h</dd>
      <dt>{copy.nightLight}</dt><dd>{Math.round(weather.nightLight * 100)}%</dd>
    </dl>
    {weather.sun.state !== 'normal' && <p>{copy[weather.sun.state]}</p>}
    <p className="text-xs text-text-secondary">{copy.localHours}</p>
    <ul className="space-y-1 text-xs text-text-primary">{weather.moons.map((moon, index) => <li key={index}>{moon.name}: {copy[moon.phase]} · {Math.round(moon.illumination * 100)}%</li>)}</ul>
    {!weather.moons.length && <p className="text-xs">{copy.noMoons}</p>}
  </section>;
}
