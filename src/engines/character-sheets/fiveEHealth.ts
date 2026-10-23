// Hit points at the table on a 5e sheet, as plain functions: damage (temporary
// hit points first), healing, death saves and the conditions they add.
import type { CharacterSheet } from './types';

export const resource = (sheet: CharacterSheet, id: string) => sheet.resources.find(item => item.id === id);
export const withResource = (sheet: CharacterSheet, id: string, current: number) => ({ ...sheet, resources: sheet.resources.map(item => item.id === id ? { ...item, current: Math.max(0, Math.min(item.max || current, current)) } : item) });
export const sheetConditions = (sheet: CharacterSheet) => (sheet.details.conditions ?? '').split(/\s*[,;]\s*/).map(item => item.trim()).filter(Boolean);
export const setConditions = (sheet: CharacterSheet, list: string[]) => ({ ...sheet, details: { ...sheet.details, conditions: [...new Set(list)].join(', ') } });

/** Damage: temporary hit points first, then hit points; reaching 0 adds Unconscious and resets the death saves. */
export function damageSheet(sheet: CharacterSheet, amount: number): CharacterSheet {
  const hp = resource(sheet, 'hp'), temp = resource(sheet, 'tempHp'); if (!hp || amount <= 0) return sheet;
  const absorbed = Math.min(temp?.current ?? 0, amount), rest = amount - absorbed;
  let next = temp ? withResource(sheet, 'tempHp', temp.current - absorbed) : sheet;
  const left = Math.max(0, hp.current - rest);
  next = withResource(next, 'hp', left);
  if (hp.current > 0 && left === 0) { next = setConditions(next, [...sheetConditions(next), 'Unconscious']); next = withResource(withResource(next, 'deathSuccess', 0), 'deathFail', 0); }
  else if (hp.current === 0 && rest > 0) next = withResource(next, 'deathFail', Math.min(3, (resource(next, 'deathFail')?.current ?? 0) + 1));
  return next;
}
export function healSheet(sheet: CharacterSheet, amount: number): CharacterSheet {
  const hp = resource(sheet, 'hp'); if (!hp || amount <= 0) return sheet;
  let next = withResource(sheet, 'hp', Math.min(hp.max, hp.current + amount));
  if (hp.current === 0) { next = setConditions(next, sheetConditions(next).filter(item => item !== 'Unconscious' && item !== 'Stable')); next = withResource(withResource(next, 'deathSuccess', 0), 'deathFail', 0); }
  return next;
}
export function deathSaveSheet(sheet: CharacterSheet, roll: number): { sheet: CharacterSheet; outcome: 'success' | 'failure' | 'stable' | 'dead' | 'revived' } {
  const successes = resource(sheet, 'deathSuccess')?.current ?? 0, failures = resource(sheet, 'deathFail')?.current ?? 0;
  if (roll >= 20) return { sheet: healSheet(sheet, 1), outcome: 'revived' };
  if (roll >= 10) { const next = withResource(sheet, 'deathSuccess', Math.min(3, successes + 1)); return successes + 1 >= 3 ? { sheet: setConditions(next, [...sheetConditions(next), 'Stable']), outcome: 'stable' } : { sheet: next, outcome: 'success' }; }
  const next = withResource(sheet, 'deathFail', Math.min(3, failures + (roll === 1 ? 2 : 1)));
  return { sheet: next, outcome: failures + (roll === 1 ? 2 : 1) >= 3 ? 'dead' : 'failure' };
}
