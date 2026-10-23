export const cocDerivedKeys = ['hp', 'mp', 'sanityStart', 'sanityMax', 'dodge', 'ownLanguage', 'move', 'build', 'damageBonus'] as const;
export type CocDerivedKey = typeof cocDerivedKeys[number];
export const cocConditionKeys = ['majorWound', 'unconscious', 'dying', 'dead', 'temporaryInsanity', 'indefiniteInsanity', 'permanentInsanity'] as const;
export type CocCondition = typeof cocConditionKeys[number];
/** Five visible slots in the optional summary; the full skill list is unchanged. */
export const COC_SUMMARY_SKILL_SLOTS = 5;
export interface CocState {
  version: 1; era: '1920s' | 'modern'; pulp: boolean;
  overrides: Partial<Record<CocDerivedKey, number | string>>;
  conditions: Partial<Record<CocCondition, boolean>>;
  checkedSkills: string[]; dayStartSanity: number; daySanityLoss: number;
  summarySkillIds?: string[];
  pendingCon?: 'wound' | 'dying'; pendingInt?: boolean; temporaryHours?: number;
}
export interface CocRollData {
  kind: 'trait' | 'skill' | 'combat' | 'sanity' | 'luck' | 'constitution' | 'intelligence' | 'improvement';
  rating: number; skillId?: string; pushedFrom?: string; pushedBy?: string; justification?: string;
}
export function validCocState(value: unknown): value is CocState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (row.version !== 1 || !['1920s', 'modern'].includes(String(row.era)) || typeof row.pulp !== 'boolean') return false;
  if (!row.overrides || typeof row.overrides !== 'object' || Array.isArray(row.overrides) || !row.conditions || typeof row.conditions !== 'object' || Array.isArray(row.conditions)) return false;
  for (const [key, item] of Object.entries(row.overrides)) if (!cocDerivedKeys.includes(key as CocDerivedKey) || (key === 'damageBonus' ? typeof item !== 'string' || item.length > 100000 : typeof item !== 'number' || !Number.isFinite(item) || Math.abs(item) > 1000000 || key !== 'build' && item < 0)) return false;
  for (const [key, item] of Object.entries(row.conditions)) if (!cocConditionKeys.includes(key as CocCondition) || typeof item !== 'boolean') return false;
  if (!Array.isArray(row.checkedSkills) || row.checkedSkills.length > 500 || row.checkedSkills.some(item => typeof item !== 'string') || new Set(row.checkedSkills).size !== row.checkedSkills.length) return false;
  if (row.summarySkillIds !== undefined && (!Array.isArray(row.summarySkillIds) || row.summarySkillIds.length > COC_SUMMARY_SKILL_SLOTS || row.summarySkillIds.some(item => typeof item !== 'string' || !item) || new Set(row.summarySkillIds).size !== row.summarySkillIds.length)) return false;
  if (!['dayStartSanity', 'daySanityLoss'].every(key => typeof row[key] === 'number' && Number.isFinite(row[key]) && (row[key] as number) >= 0 && (row[key] as number) <= 1000000)) return false;
  return (row.pendingCon === undefined || row.pendingCon === 'wound' || row.pendingCon === 'dying') && (row.pendingInt === undefined || typeof row.pendingInt === 'boolean') && (row.temporaryHours === undefined || Number.isInteger(row.temporaryHours) && (row.temporaryHours as number) >= 1 && (row.temporaryHours as number) <= 10);
}
