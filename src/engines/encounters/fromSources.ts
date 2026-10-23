// Combatants from what the world already has: an SRD monster from the
// compendium, a 5e character sheet, and "add to fight" for the open fight.
import type { CharacterSheet } from '@/engines/character-sheets/types';
import type { SrdMonster } from '@/engines/compendium/srd';
import { createCombatant, createEncounter, nextName, type Combatant, type Encounter } from './model';
import { EncounterConflict, listEncounters, saveEncounter } from './operations';

const mod = (score: number) => Math.floor((score - 10) / 2);

export function combatantFromMonster(monster: SrdMonster, encounter: Encounter): Combatant {
  return createCombatant({ name: nextName(encounter, monster.n), initiativeBonus: mod(monster.ab[1] ?? 10), ac: monster.ac, hp: monster.hp, maxHp: monster.hp, player: false, source: { kind: 'monster', id: monster.id } });
}

export function combatantFromSheet(sheet: CharacterSheet, encounter: Encounter): Combatant {
  const hp = sheet.resources.find(resource => resource.id === 'hp'), temp = sheet.resources.find(resource => resource.id === 'tempHp');
  const dex = sheet.traits.find(trait => trait.id === 'dexterity')?.value ?? 10;
  const player = sheet.preset !== '5e-stat-block' && sheet.preset !== 'daggerheart-adversary';
  return createCombatant({ name: nextName(encounter, sheet.title || '?'), initiativeBonus: mod(dex) + (sheet.numbers.initiativeBonus ?? 0), ac: sheet.numbers.armorClass, hp: hp?.current ?? 10, maxHp: hp?.max ?? 10, tempHp: temp?.current ?? 0, player, source: { kind: 'sheet', id: sheet.id } });
}

/** The fight being run: the most recently changed one, or a new "Combate" when there is none. */
export async function currentEncounter(projectId: string, title: string): Promise<{ encounter: Encounter; revision: number | null }> {
  const list = await listEncounters(projectId);
  const latest = [...list].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return latest ? { encounter: latest, revision: latest.revision } : { encounter: createEncounter(title), revision: null };
}

/** Add monsters to the fight being run (made if needed); retried once if another window saved in between. */
export async function addMonsterToFight(projectId: string, monster: SrdMonster, count: number, newTitle: string): Promise<Encounter> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { encounter, revision } = await currentEncounter(projectId, newTitle);
    let next = encounter;
    for (let i = 0; i < Math.max(1, Math.min(20, Math.round(count))); i++) next = { ...next, combatants: [...next.combatants, combatantFromMonster(monster, next)] };
    next = { ...next, log: [...next.log, `+ ${count > 1 ? `${count}× ` : ''}${monster.n}`] };
    try { return await saveEncounter(projectId, next, revision); } catch (error) { if (!(error instanceof EncounterConflict) || attempt) throw error; }
  }
  throw new Error('encounter_conflict');
}
