import type { CharacterSheet } from './types';
import { cocConditionKeys, type CocCondition } from './cocTypes';
import { cocTargets } from './mechanics';
import { resolveCocSheet } from './cocRules';

export interface CocSummaryRating { id: string; label: string; regular: number; hard: number; extreme: number }
export interface CocSummaryVital { label: string; current: number; max: number }
export interface CocSummary {
  id: string; title: string; revision: number; era: '1920s' | 'modern'; pulp: boolean;
  vitals: Record<'hp' | 'sanity' | 'luck', CocSummaryVital | null>;
  conditions: CocCondition[]; traits: CocSummaryRating[]; skillsConfigured: boolean;
  skills: ({ id: string; missing: true } | (CocSummaryRating & { missing: false }))[];
}
/** Read-only projection of saved or explicitly supplied draft data. Never initializes selection. */
export function cocSummary(source: CharacterSheet): CocSummary | null {
  if (source.preset !== 'coc7') return null;
  const sheet = resolveCocSheet(source), state = sheet.coc!;
  const vital = (id: string): CocSummaryVital | null => {
    const row = sheet.resources.find(item => item.id === id);
    return row ? { label: row.label, current: row.current, max: row.max } : null;
  };
  return {
    id: sheet.id, title: sheet.title, revision: sheet.revision, era: state.era, pulp: state.pulp,
    vitals: { hp: vital('hp'), sanity: vital('sanity'), luck: vital('luck') },
    conditions: cocConditionKeys.filter(key => state.conditions[key]),
    traits: sheet.traits.map(row => ({ id: row.id, label: row.label, ...cocTargets(row.value) })),
    skillsConfigured: state.summarySkillIds !== undefined,
    skills: (state.summarySkillIds ?? []).map(id => {
      const skill = sheet.skills.find(row => row.id === id);
      return skill ? { id, label: skill.label, ...cocTargets(skill.value + skill.bonus), missing: false } : { id, missing: true };
    }),
  };
}
