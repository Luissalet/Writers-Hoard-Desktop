/** Format a Date as a local-calendar YYYY-MM-DD key without a UTC conversion. */
export function toLocalDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Format a Date as a local "YYYY-MM-DDTHH:mm" stamp, the shape `datetime-local` reads. */
export function toLocalDateTimeStamp(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${toLocalDateKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Shift a local-calendar date key without crossing through UTC. */
export function shiftLocalDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  date.setDate(date.getDate() + days);
  return toLocalDateKey(date);
}
