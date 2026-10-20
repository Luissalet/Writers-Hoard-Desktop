/** Calendar inputs may omit both dates, but an end needs a valid earlier start. */
export function validateTimelineDates(start: string, end: string): string | null {
  if (!start && !end) return null;
  const startTime = Date.parse(`${start}T00:00:00Z`);
  const endTime = end ? Date.parse(`${end}T00:00:00Z`) : startTime;
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return 'timeline.dateInvalid';
  if (new Date(startTime).toISOString().split('T')[0] !== start || (end && new Date(endTime).toISOString().split('T')[0] !== end)) return 'timeline.dateInvalid';
  return endTime < startTime ? 'timeline.dateEndBeforeStart' : null;
}
