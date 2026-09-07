export function validWordTarget(value: string): boolean {
  const words = Number(value);
  return value.trim() !== '' && Number.isSafeInteger(words) && words > 0;
}

export function validGoalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
