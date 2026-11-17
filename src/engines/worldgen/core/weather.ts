import { assertValidDate, daysInYear, fromDayNumber, moonsOn, seasonOfDate, toDayNumber, validateWorldCalendar, type MoonState, type WorldCalendar, type WorldDate, type WorldSeason } from '@/engines/timeline/worldCalendar';
import { windAt } from './climate';
import { climateLatDeg } from './geoScale';
import { runtimeGeometry, runtimeLatitude, runtimeU, runtimeV } from './runtimeGeometry';
import type { WorldData } from './types';

export interface WeatherDate { calendar: WorldCalendar; date: WorldDate }
export type WeatherPhenomenon = 'rain' | 'snow' | 'thunder' | 'fog' | 'frost' | 'heat' | 'gale';
export interface WorldWeather {
  model: 'world-weather/1'; dayNumber: number; date: WorldDate;
  latitude: number; season: WorldSeason | null;
  temperatureC: number; minC: number; maxC: number; precipitationMm: number;
  precipitationKind: 'none' | 'rain' | 'snow'; cloudCover: number;
  wind: { speedKmh: number; fromDegrees: number }; phenomena: WeatherPhenomenon[];
  sun: { sunrise: number | null; sunset: number | null; daylightHours: number; state: 'normal' | 'polarDay' | 'polarNight'; hoursPerDay: number };
  moons: MoonState[]; nightLight: number;
}
const mod = (n: number, d: number) => ((n % d) + d) % d;
const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const round = (n: number) => Math.round(n * 100) / 100;

/** Exact dates only: never silently turn an unknown month/day into day one. */
export function validateWeatherDate(context: WeatherDate): void {
  if (!context?.calendar || validateWorldCalendar(context.calendar).length || !context.date
    || context.date.month === undefined || context.date.day === undefined || context.date.approx
    ) throw Error('weather_exact_date_required');
  assertValidDate(context.calendar, context.date);
}

/** Stateless, smoothly varying synoptic field. Absolute carrier coordinates survive finite resizes. */
function field(seed: string, channel: string, u: number, v: number, day: number): number {
  const x = mod(u, 1) * 24, y = v * 12, z = day / 3;
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const smooth = (n: number) => n * n * (3 - 2 * n);
  const tx = smooth(x - ix), ty = smooth(y - iy), tz = smooth(z - iz);
  const value = (a: number, b: number, c: number) => {
    const text = `${seed}|weather-v1|${channel}|${mod(a, 24)},${b},${c}`;
    let h = 2166136261;
    for (let k = 0; k < text.length; k++) h = Math.imul(h ^ text.charCodeAt(k), 16777619);
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  };
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const plane = (k: number) => lerp(lerp(value(ix, iy, k), value(ix + 1, iy, k), tx), lerp(value(ix, iy + 1, k), value(ix + 1, iy + 1, k), tx), ty);
  return lerp(plane(iz), plane(iz + 1), tz);
}

/** A fictional daily atmosphere over the existing climate, not a real-world forecast.
 * Calendar seasons set the annual forcing. Solstitial tilt is fixed at 23.44°.
 * The climate's temperature already includes elevation and SST: do not add either twice.
 */
export function weatherAt(world: WorldData, point: { x: number; y: number }, context: WeatherDate): WorldWeather {
  validateWeatherDate(context);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.y < 0 || point.y >= world.height
    || world.domain?.topology === 'finite' && (point.x < 0 || point.x >= world.width)) throw Error('weather_point_outside_world');
  const x = world.domain?.topology === 'finite' ? Math.floor(point.x) : Math.floor(mod(point.x, world.width));
  const y = Math.floor(point.y), i = y * world.width + x;
  const geometry = runtimeGeometry(world);
  const u = geometry ? runtimeU(world.params, geometry, x + 0.5) : (x + 0.5) / world.width;
  const v = geometry ? runtimeV(world.params, geometry, y + 0.5) : (y + 0.5) / world.height;
  const latitude = geometry ? runtimeLatitude(world.params, geometry, y + 0.5) : climateLatDeg(v, world.params);
  const { calendar, date } = context, dayNumber = toDayNumber(calendar, date);
  const season = seasonOfDate(calendar, date);
  const tilt = season === 'summer' ? 1 : season === 'winter' ? -1 : 0;
  const lat = latitude * Math.PI / 180;
  const seasonal = tilt * Math.sin(lat);
  const water = world.elevation[i] <= 0 || !!world.lake[i];
  const maritime = water ? 0.35 : clamp(Math.abs(world.sst[i] ?? 0) / 8, 0, 0.45);
  const amplitude = (3 + Math.abs(latitude) * 0.2) * (1 - maritime);
  const anomaly = field(world.params.seed, 'temperature', u, v, dayNumber) * 2 - 1;
  const temperatureC = world.temperature[i] + seasonal * amplitude + anomaly * 7;
  const annualRain = Math.max(0, world.precipitation[i]);
  const wetness = field(world.params.seed, 'front', u, v, dayNumber);
  const rainChance = clamp(annualRain / 3500, 0.015, 0.88);
  const monsoon = season && Math.abs(latitude) < 30 ? 0.65 + 0.7 * Math.max(0, seasonal) : 1;
  const precipitationMm = wetness > 1 - rainChance * monsoon
    ? annualRain / daysInYear(calendar, date.year) / rainChance * (0.5 + wetness) * monsoon : 0;
  const fog = precipitationMm === 0 && (world.sst[i] < -1 || annualRain > 1500 || water) && wetness > 0.6;
  const cloudCover = clamp(precipitationMm > 0 ? 0.75 + wetness * 0.25 : 0.08 + wetness * 0.65 + (fog ? 0.2 : 0));
  const [wx, wy] = windAt(latitude);
  const gust = field(world.params.seed, 'wind', u, v, dayNumber);
  const speedKmh = 3 + gust * 32 + (precipitationMm > 12 ? 15 : 0) + (water ? Math.hypot(world.currentU[i], world.currentV[i]) * 4 : 0);
  const fromDegrees = mod(Math.atan2(-wx, wy) * 180 / Math.PI + (gust - 0.5) * 80, 360);
  const snow = precipitationMm > 0 && temperatureC <= 1;
  const phenomena: WeatherPhenomenon[] = [];
  if (precipitationMm > 0) phenomena.push(snow ? 'snow' : 'rain');
  if (!snow && precipitationMm > 12 && temperatureC > 18) phenomena.push('thunder');
  if (fog) phenomena.push('fog');
  if (temperatureC < 0 && precipitationMm === 0) phenomena.push('frost');
  if (temperatureC > 35) phenomena.push('heat');
  if (speedKmh > 40) phenomena.push('gale');
  const declination = 23.44 * Math.PI / 180 * tilt;
  const cosHour = -Math.tan(lat) * Math.tan(declination);
  const hoursPerDay = calendar.hoursPerDay ?? 24;
  const daylightHours = cosHour <= -1 ? hoursPerDay : cosHour >= 1 ? 0 : Math.acos(cosHour) / Math.PI * hoursPerDay;
  const state = daylightHours === hoursPerDay ? 'polarDay' : daylightHours === 0 ? 'polarNight' : 'normal';
  const moons = moonsOn(calendar, dayNumber);
  const nightLight = clamp(moons.reduce((sum, moon) => sum + moon.illumination * 0.25, 0)) * (1 - cloudCover * 0.9);
  const range = (water ? 3 : 6 + 6 * (1 - clamp(annualRain / 2000))) * (1 - cloudCover * 0.5);
  return {
    model: 'world-weather/1', dayNumber, date: { ...date }, latitude: round(latitude),
    season,
    temperatureC: round(temperatureC), minC: round(temperatureC - range / 2), maxC: round(temperatureC + range / 2), precipitationMm: round(precipitationMm),
    precipitationKind: precipitationMm === 0 ? 'none' : snow ? 'snow' : 'rain', cloudCover: round(cloudCover),
    wind: { speedKmh: round(speedKmh), fromDegrees: round(fromDegrees) }, phenomena,
    sun: { sunrise: state === 'normal' ? round((hoursPerDay - daylightHours) / 2) : null, sunset: state === 'normal' ? round((hoursPerDay + daylightHours) / 2) : null, daylightHours: round(daylightHours), state, hoursPerDay },
    moons, nightLight: round(nightLight),
  };
}

/** Weather changes duration on an existing itinerary; it never silently reroutes it. */
export function weatherTravelFactor(weather: WorldWeather, mode: string, flies = false): number {
  const wind = Math.max(0, weather.wind.speedKmh - 20) / 70;
  if (flies || mode === 'ship' || mode === 'boat') return 1 + wind + (weather.phenomena.includes('thunder') ? 0.5 : 0);
  return 1 + Math.min(1, weather.precipitationMm / 35) * (mode === 'cart' ? 0.9 : 0.4)
    + (weather.precipitationKind === 'snow' ? 0.45 : 0) + (weather.temperatureC < -10 || weather.temperatureC > 35 ? 0.2 : 0) + wind * 0.2;
}

export function weatherOnDay(world: WorldData, point: { x: number; y: number }, context: WeatherDate, offset: number): WorldWeather {
  return weatherAt(world, point, { calendar: context.calendar, date: fromDayNumber(context.calendar, toDayNumber(context.calendar, context.date) + Math.floor(offset)) });
}
