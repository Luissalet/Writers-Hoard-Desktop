import type { CharacterSheet, SheetRoll, SheetSkill } from './types';
import type { CocCondition, CocDerivedKey, CocRollData, CocState } from './cocTypes';
import { cocCheck, randomDie } from './mechanics';

const trait = (sheet: CharacterSheet, id: string) => sheet.traits.find(item => item.id === id)?.value ?? 0;
const resource = (sheet: CharacterSheet, id: string) => sheet.resources.find(item => item.id === id);
const skillNamed = (sheet: CharacterSheet, label: string) => sheet.skills.find(item => item.label === label);
export function cocCalculated(sheet: CharacterSheet): Record<CocDerivedKey, number | string> {
  const str = trait(sheet, 'str'), siz = trait(sheet, 'siz'), dex = trait(sheet, 'dex'), pow = trait(sheet, 'pow');
  const sum = str + siz;
  const band = sum <= 64 ? 0 : sum <= 84 ? 1 : sum <= 124 ? 2 : sum <= 164 ? 3 : sum <= 204 ? 4 : 5 + Math.floor((sum - 205) / 80);
  const build = band - 2;
  const baseMove = dex < siz && str < siz ? 7 : dex > siz && str > siz ? 9 : 8;
  const ageReduction = sheet.coc?.pulp ? 0 : Math.min(5, Math.max(0, Math.floor((sheet.numbers.age ?? 30) / 10) - 3));
  return { hp: Math.max(0, Math.floor((trait(sheet, 'con') + siz) / (sheet.coc?.pulp ? 5 : 10))), mp: Math.max(0, Math.floor(pow / 5)), sanityStart: Math.max(0, pow), sanityMax: Math.max(0, 99 - (skillNamed(sheet, 'Cthulhu Mythos')?.value ?? 0)), dodge: Math.floor(dex / 2), ownLanguage: trait(sheet, 'edu'), move: Math.max(0,baseMove-ageReduction), build, damageBonus: ['−2', '−1', '0', '+1d4', '+1d6'][band] ?? `+${build - 1}d6` };
}
function storedDerived(sheet: CharacterSheet, key: CocDerivedKey): number | string | undefined {
  if (key === 'hp' || key === 'mp') return resource(sheet, key)?.max;
  if (key === 'sanityMax') return resource(sheet, 'sanity')?.max;
  if (key === 'sanityStart') return undefined;
  if (key === 'dodge' || key === 'ownLanguage') return skillNamed(sheet, key === 'dodge' ? 'Dodge' : 'Language (Own)')?.value;
  if (key === 'damageBonus') return sheet.details.damageBonus;
  return sheet.numbers[key];
}
/** Legacy sheets adopt automation only where their stored value already matches the rules. */
export function cocState(sheet: CharacterSheet): CocState {
  if (sheet.coc) return structuredClone(sheet.coc);
  const calculated = cocCalculated(sheet), overrides: CocState['overrides'] = {};
  for (const key of Object.keys(calculated) as CocDerivedKey[]) { const value = storedDerived(sheet, key); if (value !== undefined && value !== calculated[key]) overrides[key] = value; }
  return { version: 1, era: sheet.details.era === 'modern' ? 'modern' : '1920s', pulp: false, overrides, conditions: {}, checkedSkills: [], dayStartSanity: resource(sheet, 'sanity')?.current ?? Number(calculated.sanityStart), daySanityLoss: 0 };
}
/** Pure projection: never writes a database record or heals an investigator on read. */
export function resolveCocSheet(source: CharacterSheet): CharacterSheet {
  if (source.preset !== 'coc7') return source;
  const sheet = structuredClone(source); sheet.coc = cocState(source);
  const calculated = cocCalculated(sheet), values = { ...calculated, ...sheet.coc.overrides };
  sheet.details.damageBonus = String(values.damageBonus);
  sheet.numbers.move = Number(values.move); sheet.numbers.build = Number(values.build);
  for (const [id, key] of [['hp', 'hp'], ['mp', 'mp'], ['sanity', 'sanityMax']] as const) {
    const row = resource(sheet, id); if (row) { row.max = Math.max(0, Number(values[key])); row.current = Math.min(row.current, row.max); }
  }
  for (const [label, key] of [['Dodge', 'dodge'], ['Language (Own)', 'ownLanguage']] as const) { const row = skillNamed(sheet, label); if (row) row.value = Number(values[key]); }
  return sheet;
}
/** Capture explicit manual edits, then update automatic values without losing spent resources. */
export function reconcileCocSheet(next: CharacterSheet, previous?: CharacterSheet): CharacterSheet {
  if (next.preset !== 'coc7') return next;
  const prior = previous?.preset === 'coc7' ? resolveCocSheet(previous) : undefined;
  const sheet = structuredClone(next); sheet.coc = cocState(next);
  if(prior&&next.details.era!==prior.details.era&&['1920s','modern'].includes(next.details.era))sheet.coc.era=next.details.era as '1920s'|'modern';
  if (prior) for (const key of ['hp', 'mp', 'sanityMax', 'dodge', 'ownLanguage', 'move', 'build', 'damageBonus'] as CocDerivedKey[]) {
    const value = storedDerived(next, key), old = storedDerived(prior, key);
    // A rule action changes overrides itself; do not reinterpret its projection as a manual edit.
    const overrideChanged = next.coc?.overrides[key] !== prior.coc?.overrides[key];
    if (!overrideChanged && value !== undefined && value !== old) { if (value === cocCalculated(sheet)[key]) delete sheet.coc.overrides[key]; else sheet.coc.overrides[key] = value; }
  }
  const result = resolveCocSheet(sheet);
  if (prior) for (const id of ['hp', 'mp']) {
    const before = resource(prior, id), raw = resource(next, id), after = resource(result, id);
    if (before && raw && after && raw.current === before.current && before.current === before.max && after.max > before.max) after.current = after.max;
  }
  return result;
}
export function setCocOverride(source: CharacterSheet, key: CocDerivedKey, value?: number | string): CharacterSheet {
  const sheet = resolveCocSheet(source); if (!sheet.coc) throw new Error('coc_required');
  if(value!==undefined&&(key==='damageBonus'?typeof value!=='string':typeof value!=='number'||!Number.isFinite(value)||key!=='build'&&value<0))throw new Error('invalid_override');
  if (value === undefined) delete sheet.coc.overrides[key]; else sheet.coc.overrides[key] = value;
  return resolveCocSheet(sheet);
}
export function setCocCondition(source:CharacterSheet,key:CocCondition,enabled:boolean):CharacterSheet{
  const sheet=resolveCocSheet(source);if(!sheet.coc)throw new Error('coc_required');const state=sheet.coc;state.conditions[key]=enabled;
  if(key==='dying'){if(enabled){state.conditions.unconscious=true;state.pendingCon='dying';}else if(state.pendingCon==='dying')state.pendingCon=undefined;}
  if(key==='majorWound'&&!enabled&&state.pendingCon==='wound')state.pendingCon=undefined;
  if(key==='dead'&&enabled){state.conditions.unconscious=true;state.conditions.dying=false;state.pendingCon=undefined;}
  if(key==='temporaryInsanity'&&!enabled)state.temporaryHours=undefined;
  return sheet;
}
function integer(value: number) { if (!Number.isSafeInteger(value) || value < 0) throw new Error('nonnegative_integer_required'); }
function append(sheet: CharacterSheet, roll: SheetRoll) { sheet.rolls = [roll, ...sheet.rolls].slice(0, 200); return sheet; }
export function cocSkillCanImprove(skill: SheetSkill) { return !['Cthulhu Mythos', 'Credit Rating'].includes(skill.label); }
export function cocRoll(source: CharacterSheet, label: string, rating: number, options: { difficulty?: 'regular' | 'hard' | 'extreme'; kind?: CocRollData['kind']; skillId?: string } = {}, die = randomDie): CharacterSheet {
  const sheet = resolveCocSheet(source), roll = cocCheck(label, rating, die, options.difficulty);
  roll.coc = { kind: options.kind ?? 'trait', rating, skillId: options.skillId };
  if (roll.passed && options.skillId && sheet.coc && sheet.skills.some(skill => skill.id === options.skillId && cocSkillCanImprove(skill)) && !sheet.coc.checkedSkills.includes(options.skillId)) sheet.coc.checkedSkills.push(options.skillId);
  return append(sheet, roll);
}
export function cocCanPush(roll: SheetRoll) { return !!roll.coc && ['trait', 'skill'].includes(roll.coc.kind) && roll.passed === false && !roll.coc.pushedFrom && !roll.coc.pushedBy; }
export function pushCocRoll(source: CharacterSheet, id: string, justification: string, die = randomDie): CharacterSheet {
  const sheet = resolveCocSheet(source), original = sheet.rolls.find(item => item.id === id);
  if (!original || !cocCanPush(original) || !justification.trim()) throw new Error('push_not_allowed');
  const result = cocRoll(sheet, original.label, original.coc!.rating, { difficulty: original.difficulty, kind: original.coc!.kind, skillId: original.coc!.skillId }, die);
  if(!result.rolls.some(item=>item.id===id))result.rolls=[...result.rolls.slice(0,199),structuredClone(original)];
  result.rolls[0].coc = { ...result.rolls[0].coc!, pushedFrom: id, justification: justification.trim() };
  result.rolls.find(item => item.id === id)!.coc!.pushedBy = result.rolls[0].id;
  return result;
}
export function applyCocDamage(source: CharacterSheet, amount: number): CharacterSheet {
  integer(amount); const sheet = resolveCocSheet(source), hp = resource(sheet, 'hp'); if (!hp || !sheet.coc || amount === 0) return sheet;
  hp.current = Math.max(0, hp.current - amount); const state = sheet.coc;
  if (amount >= hp.max) { state.conditions.dead = true; state.conditions.dying=false;state.conditions.unconscious = true; state.pendingCon = undefined; }
  else if (amount * 2 >= hp.max) { state.conditions.majorWound = true; state.pendingCon = 'wound'; }
  if (hp.current === 0) { state.conditions.unconscious = true; if (state.conditions.majorWound && !state.conditions.dead) { state.conditions.dying = true; state.pendingCon = 'dying'; } }
  return sheet;
}
export function healCoc(source: CharacterSheet, amount: number): CharacterSheet {
  integer(amount); const sheet = resolveCocSheet(source), hp = resource(sheet, 'hp'); if (hp && sheet.coc && amount>0) { const before=hp.current;hp.current = Math.min(hp.max, hp.current + amount); if (hp.current>before&&hp.current * 2 >= hp.max){sheet.coc.conditions.majorWound = false;if(sheet.coc.pendingCon==='wound')sheet.coc.pendingCon=undefined;} }
  return sheet;
}
export function applyCocSanityLoss(source: CharacterSheet, amount: number): CharacterSheet {
  integer(amount); const sheet = resolveCocSheet(source), san = resource(sheet, 'sanity'); if (!san || !sheet.coc) return sheet;
  const lost = Math.min(san.current, amount); san.current -= lost; sheet.coc.daySanityLoss += lost;
  if (lost >= 5) sheet.coc.pendingInt = true;
  if (sheet.coc.dayStartSanity > 0 && sheet.coc.daySanityLoss * 5 >= sheet.coc.dayStartSanity) { sheet.coc.conditions.indefiniteInsanity = true; sheet.coc.pendingInt = false; }
  if (san.current === 0) { sheet.coc.conditions.permanentInsanity = true; sheet.coc.pendingInt = false; }
  return sheet;
}
export function cocConstitution(source: CharacterSheet, die = randomDie): CharacterSheet {
  const before = resolveCocSheet(source), reason = before.coc?.pendingCon; if (!reason) throw new Error('no_con_check');
  const sheet = cocRoll(before, reason === 'dying' ? 'Dying · CON' : 'Major wound · CON', trait(before, 'con'), { kind: 'constitution' }, die);
  if (!sheet.rolls[0].passed) { sheet.coc!.conditions.unconscious = true; if (reason === 'dying') {sheet.coc!.conditions.dead = true;sheet.coc!.conditions.dying=false;} }
  sheet.coc!.pendingCon = reason === 'dying' && !sheet.coc!.conditions.dead ? 'dying' : undefined;
  return sheet;
}
export function cocIntelligence(source: CharacterSheet, die = randomDie): CharacterSheet {
  const before = resolveCocSheet(source); if (!before.coc?.pendingInt) throw new Error('no_int_check');
  const sheet = cocRoll(before, 'Sanity shock · INT', trait(before, 'int'), { kind: 'intelligence' }, die); sheet.coc!.pendingInt = false;
  if (sheet.rolls[0].passed) { sheet.coc!.conditions.temporaryInsanity = true; sheet.coc!.temporaryHours = die(10); }
  return sheet;
}
export function startCocDay(source: CharacterSheet): CharacterSheet {
  const sheet = resolveCocSheet(source); if (!sheet.coc) throw new Error('coc_required'); sheet.coc.dayStartSanity = resource(sheet, 'sanity')?.current ?? 0; sheet.coc.daySanityLoss = 0; return sheet;
}
export function improveCocSkill(source: CharacterSheet, id: string, die = randomDie): CharacterSheet {
  const sheet = resolveCocSheet(source), skill = sheet.skills.find(item => item.id === id);
  if (!sheet.coc || !skill || !cocSkillCanImprove(skill) || !sheet.coc.checkedSkills.includes(id)) throw new Error('skill_not_marked');
  const check = die(100), gain = check > skill.value || check >= 96 ? die(10) : 0;
  const roll: SheetRoll = { id: crypto.randomUUID(), at: Date.now(), label: `Development · ${skill.label}`, expression: 'd100 > skill; +1d10', dice: gain ? [check, gain] : [check], total: gain, outcome: gain ? 'improved' : 'unchanged', target: skill.value, coc: { kind: 'improvement', rating: skill.value, skillId: id } };
  skill.value += gain; sheet.coc.checkedSkills = sheet.coc.checkedSkills.filter(item => item !== id);
  if (skill.label === 'Dodge') sheet.coc.overrides.dodge = skill.value;
  if (skill.label === 'Language (Own)') sheet.coc.overrides.ownLanguage = skill.value;
  return append(sheet, roll);
}
