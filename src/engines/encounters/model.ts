// ============================================
// Encounters — the fight at the table, as a document
// ============================================
// Who is in the fight, in what order they act, the round and whose turn it
// is, hit points with temporary ones, conditions that wear off after some
// rounds, death saves and the concentration check after damage. Pure rules on
// a plain document; the engine stores it like any other world document.

export const ENCOUNTER_CONDITIONS = ['Blinded', 'Charmed', 'Deafened', 'Exhaustion', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious'] as const;
const CONDITION_ES: Record<string, string> = { Blinded: 'Cegado', Charmed: 'Hechizado', Deafened: 'Ensordecido', Exhaustion: 'Agotamiento', Frightened: 'Asustado', Grappled: 'Agarrado', Incapacitated: 'Incapacitado', Invisible: 'Invisible', Paralyzed: 'Paralizado', Petrified: 'Petrificado', Poisoned: 'Envenenado', Prone: 'Derribado', Restrained: 'Apresado', Stunned: 'Aturdido', Unconscious: 'Inconsciente', Stable: 'Estable' };
/** A condition's name in the reader's language (the stored name stays the rules' English one). */
export const conditionLabel = (name: string, locale: string) => locale === 'es' ? CONDITION_ES[name] ?? name : name;

export interface EncounterCondition { name: string; /** Rounds left; absent: until removed. */ rounds?: number }
export interface Combatant {
  id: string;
  name: string;
  /** Rolled or typed; null until rolled. */
  initiative: number | null;
  initiativeBonus: number;
  ac?: number;
  hp: number;
  maxHp: number;
  tempHp: number;
  conditions: EncounterCondition[];
  deathSaves: { successes: number; failures: number };
  /** A player character (death saves) rather than a monster (goes down at 0). */
  player: boolean;
  dead: boolean;
  concentrating: boolean;
  note?: string;
  /** Where the combatant came from: an SRD monster, a character sheet or a Codex card. */
  source?: { kind: 'monster' | 'sheet' | 'card'; id: string };
}
export interface Encounter {
  id: string;
  title: string;
  round: number;
  /** Index into the order of the combatant whose turn it is. */
  turn: number;
  combatants: Combatant[];
  log: string[];
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export function createEncounter(title: string): Encounter {
  const now = Date.now();
  return { id: crypto.randomUUID(), title, round: 1, turn: 0, combatants: [], log: [], revision: 0, createdAt: now, updatedAt: now };
}

export function createCombatant(input: Partial<Combatant> & { name: string }): Combatant {
  const maxHp = Math.max(0, Math.round(input.maxHp ?? input.hp ?? 10));
  return { id: input.id ?? crypto.randomUUID(), name: input.name.trim().slice(0, 120) || '?', initiative: input.initiative ?? null, initiativeBonus: Math.round(input.initiativeBonus ?? 0), ...(input.ac !== undefined ? { ac: input.ac } : {}), hp: Math.min(maxHp, Math.max(0, Math.round(input.hp ?? maxHp))), maxHp, tempHp: Math.max(0, Math.round(input.tempHp ?? 0)), conditions: input.conditions ?? [], deathSaves: input.deathSaves ?? { successes: 0, failures: 0 }, player: input.player ?? false, dead: input.dead ?? false, concentrating: input.concentrating ?? false, ...(input.note ? { note: input.note } : {}), ...(input.source ? { source: input.source } : {}) };
}

/** A name not yet in the fight: "Goblin", then "Goblin 2", "Goblin 3"… */
export function nextName(encounter: Encounter, base: string): string {
  const taken = new Set(encounter.combatants.map(combatant => combatant.name));
  if (!taken.has(base)) return base;
  let n = 2; while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** Highest initiative first; ties by bonus, then as they were. Unrolled at the end. The current turn stays with the same combatant. */
export function sortByInitiative(encounter: Encounter): Encounter {
  const current = encounter.combatants[encounter.turn]?.id;
  const order = encounter.combatants.map((combatant, index) => ({ combatant, index })).sort((a, b) => {
    const ai = a.combatant.initiative, bi = b.combatant.initiative;
    if (ai === null && bi === null) return a.index - b.index;
    if (ai === null) return 1; if (bi === null) return -1;
    return bi - ai || b.combatant.initiativeBonus - a.combatant.initiativeBonus || a.index - b.index;
  }).map(item => item.combatant);
  return { ...encounter, combatants: order, turn: Math.max(0, order.findIndex(combatant => combatant.id === current)) };
}

/** Roll a d20 + bonus for the chosen combatants (all, or those still without one), then sort. */
export function rollInitiative(encounter: Encounter, which: 'all' | 'missing' | string[], d20: () => number): Encounter {
  const rolled = encounter.combatants.map(combatant => {
    const take = which === 'all' || (which === 'missing' ? combatant.initiative === null : which.includes(combatant.id));
    return take ? { ...combatant, initiative: d20() + combatant.initiativeBonus } : combatant;
  });
  return sortByInitiative({ ...encounter, combatants: rolled });
}

/** The next combatant who is not dead; a full turn of the order starts a new round, and conditions with rounds tick down then. */
export function nextTurn(encounter: Encounter): Encounter {
  const count = encounter.combatants.length;
  if (!count) return encounter;
  let turn = encounter.turn, round = encounter.round, combatants = encounter.combatants;
  for (let step = 0; step < count; step++) {
    turn++;
    if (turn >= count) {
      turn = 0; round++;
      combatants = combatants.map(combatant => ({ ...combatant, conditions: combatant.conditions.flatMap(condition => condition.rounds === undefined ? [condition] : condition.rounds > 1 ? [{ ...condition, rounds: condition.rounds - 1 }] : []) }));
    }
    if (!combatants[turn].dead) break;
  }
  return { ...encounter, turn, round, combatants };
}

export function previousTurn(encounter: Encounter): Encounter {
  const count = encounter.combatants.length;
  if (!count || (encounter.round <= 1 && encounter.turn === 0)) return encounter;
  let turn = encounter.turn - 1, round = encounter.round;
  if (turn < 0) { turn = count - 1; round = Math.max(1, round - 1); }
  return { ...encounter, turn, round };
}

export type DamageEffect = 'down' | 'dead' | 'massive' | 'unconscious' | 'failed-save';
export interface DamageResult { combatant: Combatant; concentrationDc?: number; taken: number; effects: DamageEffect[] }

/** Damage: temporary hit points first, then hit points. A monster at 0 is dead; a character at 0 falls unconscious, and damage at 0 is a failed death save (two on a critical; massive damage kills). */
export function applyDamage(combatant: Combatant, amount: number, critical = false): DamageResult {
  const damage = Math.max(0, Math.round(amount));
  if (!damage || combatant.dead) return { combatant, taken: 0, effects: [] };
  const fromTemp = Math.min(combatant.tempHp, damage), rest = damage - fromTemp;
  const next: Combatant = { ...combatant, tempHp: combatant.tempHp - fromTemp, conditions: [...combatant.conditions], deathSaves: { ...combatant.deathSaves } };
  const effects: DamageEffect[] = [];
  if (combatant.hp === 0 && combatant.player) {
    if (rest >= combatant.maxHp) { next.dead = true; effects.push('massive', 'dead'); }
    else { next.deathSaves.failures = Math.min(3, next.deathSaves.failures + (critical ? 2 : 1)); effects.push('failed-save'); if (next.deathSaves.failures >= 3) { next.dead = true; effects.push('dead'); } }
  } else {
    const overflow = rest - combatant.hp;
    next.hp = Math.max(0, combatant.hp - rest);
    if (next.hp === 0) {
      if (!combatant.player) { next.dead = true; effects.push('down'); }
      else if (overflow >= combatant.maxHp) { next.dead = true; effects.push('massive', 'dead'); }
      else { if (!next.conditions.some(condition => condition.name === 'Unconscious')) next.conditions.push({ name: 'Unconscious' }); effects.push('unconscious'); }
    }
  }
  const concentrationDc = combatant.concentrating && !next.dead ? Math.min(30, Math.max(10, Math.floor(damage / 2))) : undefined;
  if (next.dead) next.concentrating = false;
  return { combatant: next, ...(concentrationDc ? { concentrationDc } : {}), taken: damage, effects };
}

/** Healing: up to the maximum; a character brought back from 0 wakes and forgets the death saves. The dead stay dead. */
export function heal(combatant: Combatant, amount: number): Combatant {
  const value = Math.max(0, Math.round(amount));
  if (!value || combatant.dead) return combatant;
  const hp = Math.min(combatant.maxHp, combatant.hp + value);
  return { ...combatant, hp, ...(combatant.hp === 0 && hp > 0 ? { conditions: combatant.conditions.filter(condition => condition.name !== 'Unconscious'), deathSaves: { successes: 0, failures: 0 } } : {}) };
}

export function setTempHp(combatant: Combatant, amount: number): Combatant {
  // Temporary hit points do not add up: the higher value stays.
  return { ...combatant, tempHp: Math.max(combatant.tempHp, Math.max(0, Math.round(amount))) };
}

/** A death save from a d20: 10+ a success, 1 two failures, 20 back on 1 hit point. Three successes: stable. */
export function deathSave(combatant: Combatant, roll: number): { combatant: Combatant; outcome: 'success' | 'failure' | 'stable' | 'dead' | 'revived' } {
  if (combatant.dead || combatant.hp > 0) return { combatant, outcome: 'success' };
  const saves = { ...combatant.deathSaves };
  if (roll >= 20) return { combatant: { ...combatant, hp: 1, deathSaves: { successes: 0, failures: 0 }, conditions: combatant.conditions.filter(condition => condition.name !== 'Unconscious') }, outcome: 'revived' };
  if (roll >= 10) saves.successes++;
  else saves.failures += roll === 1 ? 2 : 1;
  if (saves.failures >= 3) return { combatant: { ...combatant, deathSaves: { ...saves, failures: 3 }, dead: true, concentrating: false }, outcome: 'dead' };
  if (saves.successes >= 3) return { combatant: { ...combatant, deathSaves: saves, conditions: [...combatant.conditions.filter(condition => condition.name !== 'Stable'), { name: 'Stable' }] }, outcome: 'stable' };
  return { combatant: { ...combatant, deathSaves: saves }, outcome: roll >= 10 ? 'success' : 'failure' };
}

export function toggleCondition(combatant: Combatant, name: string, rounds?: number): Combatant {
  const has = combatant.conditions.some(condition => condition.name === name);
  return { ...combatant, conditions: has ? combatant.conditions.filter(condition => condition.name !== name) : [...combatant.conditions, { name, ...(rounds && rounds > 0 ? { rounds: Math.round(rounds) } : {}) }] };
}

/** A stored encounter made safe. */
export function validateEncounter(value: unknown): asserts value is Encounter {
  const e = value as Encounter;
  if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !e.id || typeof e.title !== 'string' || e.title.length > 300 || !Number.isSafeInteger(e.round) || e.round < 1 || !Number.isSafeInteger(e.turn) || e.turn < 0 || !Array.isArray(e.combatants) || e.combatants.length > 200 || !Array.isArray(e.log)) throw new Error('encounter_invalid');
  for (const c of e.combatants) {
    if (!c || typeof c.id !== 'string' || typeof c.name !== 'string' || !(c.initiative === null || Number.isFinite(c.initiative)) || !Number.isFinite(c.initiativeBonus) || !Number.isFinite(c.hp) || !Number.isFinite(c.maxHp) || !Number.isFinite(c.tempHp) || c.hp < 0 || c.hp > c.maxHp || !Array.isArray(c.conditions) || typeof c.player !== 'boolean' || typeof c.dead !== 'boolean' || typeof c.concentrating !== 'boolean') throw new Error('encounter_combatant_invalid');
    for (const condition of c.conditions) if (!condition || typeof condition.name !== 'string' || condition.name.length > 60 || (condition.rounds !== undefined && (!Number.isSafeInteger(condition.rounds) || condition.rounds < 1))) throw new Error('encounter_condition_invalid');
  }
  if (e.combatants.length && e.turn >= e.combatants.length) throw new Error('encounter_turn_invalid');
}
