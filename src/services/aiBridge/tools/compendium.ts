// ============================================
// AI bridge — the SRD 5.2 compendium and the fight at the table
// ============================================
// Search and read the compendium, copy an entry into the world (a Codex card,
// and a stat block for a monster), and run an encounter: add combatants from
// the compendium, the sheets or by hand, roll initiative, move turns, apply
// damage and healing, conditions and death saves. Every encounter change can
// be undone.

import { db } from '@/db';
import { COMPENDIUM_KINDS, SRD_CREDIT, compendiumEntry, searchCompendium, type CompendiumKind } from '@/engines/compendium/srd';
import { addCompendiumEntryToWorld } from '@/engines/compendium/addToWorld';
import { applyDamage, createCombatant, createEncounter, deathSave, heal, nextTurn, previousTurn, rollInitiative, setTempHp, sortByInitiative, toggleCondition, ENCOUNTER_CONDITIONS, type Combatant, type Encounter } from '@/engines/encounters/model';
import { listEncounters, saveEncounter } from '@/engines/encounters/operations';
import { combatantFromMonster, combatantFromSheet } from '@/engines/encounters/fromSources';
import { useLocaleStore } from '@/stores/localeStore';
import { encounterStamp } from '../undoStamp';
import { BridgeError } from './bridgeError';
import { assertEngineEnabled, optNumber, optString, requireString, resolveProjectId, withAudit, type ToolArgs } from './shared';

const kindArg = (args: ToolArgs): CompendiumKind | undefined => {
  const kind = optString(args, 'kind');
  if (kind !== undefined && !COMPENDIUM_KINDS.includes(kind as CompendiumKind)) throw new BridgeError('bad-args', `kind is one of ${COMPENDIUM_KINDS.join(', ')}.`);
  return kind as CompendiumKind | undefined;
};

export async function whCompendiumSearch(args: ToolArgs): Promise<unknown> {
  const filter = { kind: kindArg(args), crMin: optNumber(args, 'crMin'), crMax: optNumber(args, 'crMax'), type: optString(args, 'type'), level: optNumber(args, 'level'), school: optString(args, 'school'), className: optString(args, 'className'), rarity: optString(args, 'rarity') };
  const limit = Math.min(100, Math.max(1, optNumber(args, 'limit') ?? 25));
  const found = await searchCompendium(optString(args, 'query') ?? '', filter, limit);
  return { ...found, credit: SRD_CREDIT };
}

export async function whCompendiumGet(args: ToolArgs): Promise<unknown> {
  const kind = kindArg(args);
  if (!kind) throw new BridgeError('bad-args', 'kind is required.');
  const hit = await compendiumEntry(kind, requireString(args, 'id'));
  if (!hit) throw new BridgeError('not-found', 'No such entry; search with wh_compendium_search.');
  return { kind, entry: hit.entry, credit: SRD_CREDIT };
}

export async function whCompendiumAdd(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  if (optString(args, 'eraId')) throw new BridgeError('bad-args', 'Adding works in the shared base, not inside an era.');
  await assertEngineEnabled(projectId, 'codex');
  const kind = kindArg(args);
  if (!kind) throw new BridgeError('bad-args', 'kind is required.');
  const hit = await compendiumEntry(kind, requireString(args, 'id'));
  if (!hit) throw new BridgeError('not-found', 'No such entry; search with wh_compendium_search.');
  const added = await addCompendiumEntryToWorld(projectId, hit, optString(args, 'locale') ?? useLocaleStore.getState().locale);
  return withAudit({ entryId: added.entry.id, title: added.entry.title, type: added.entry.type, fields: added.entry.fields, ...(added.sheetId ? { sheetId: added.sheetId } : {}) }, { projectId, entityId: added.entry.id, table: 'codexEntries', kind: 'create', summary: `added "${added.entry.title}" from the SRD 5.2 compendium` });
}

export async function whEncounterList(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const list = await listEncounters(projectId);
  const id = optString(args, 'encounterId');
  if (id) { const one = list.find(item => item.id === id); if (!one) throw new BridgeError('not-found', 'No encounter with that id.'); return { encounter: one }; }
  return { encounters: list.map(item => ({ id: item.id, title: item.title, round: item.round, turnOf: item.combatants[item.turn]?.name ?? null, combatants: item.combatants.length, revision: item.revision })) };
}

const ACTIONS = ['create', 'rename', 'add', 'add-monster', 'add-sheet', 'remove', 'roll-initiative', 'set-initiative', 'sort', 'next', 'previous', 'damage', 'heal', 'temp-hp', 'condition', 'death-save', 'concentrating', 'end'] as const;

/** One change to an encounter, as the fight panel makes it; returns the new state and an undo entry. */
export async function whEncounterAction(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  if (!await db.projects.get(projectId)) throw new BridgeError('not-found', 'Project not found.');
  const action = requireString(args, 'action') as typeof ACTIONS[number];
  if (!ACTIONS.includes(action)) throw new BridgeError('bad-args', `action is one of ${ACTIONS.join(', ')}.`);
  const list = await listEncounters(projectId);
  let current: Encounter | null = null;
  if (action !== 'create') {
    const id = requireString(args, 'encounterId');
    current = list.find(item => item.id === id) ?? null;
    if (!current) throw new BridgeError('not-found', 'No encounter with that id; list them with wh_encounter_list.');
    const expected = optNumber(args, 'expectedRevision');
    if (expected !== undefined && expected !== current.revision) throw new BridgeError('conflict', `The encounter is at revision ${current.revision}; read it again.`);
  }
  const lang = (optString(args, 'locale') ?? useLocaleStore.getState().locale).startsWith('en') ? 'en' : 'es';
  const who = (encounter: Encounter): Combatant => {
    const id = optString(args, 'combatantId'), name = optString(args, 'name');
    const found = encounter.combatants.find(combatant => (id && combatant.id === id) || (!id && name && combatant.name.toLocaleLowerCase() === name.toLocaleLowerCase()));
    if (!found) throw new BridgeError('not-found', `No combatant ${id ?? name ?? ''}; combatants: ${encounter.combatants.map(combatant => combatant.name).join(', ') || 'none'}.`);
    return found;
  };
  const amount = () => { const value = optNumber(args, 'amount'); if (value === undefined || !Number.isFinite(value) || value < 0) throw new BridgeError('bad-args', 'amount is a number ≥ 0.'); return value; };
  const replace = (encounter: Encounter, next: Combatant, line?: string): Encounter => ({ ...encounter, combatants: encounter.combatants.map(combatant => combatant.id === next.id ? next : combatant), log: line ? [...encounter.log, line] : encounter.log });
  const roll = () => { const fixed = optNumber(args, 'roll'); if (fixed !== undefined) { if (!Number.isInteger(fixed) || fixed < 1 || fixed > 20) throw new BridgeError('bad-args', 'roll is 1 to 20.'); return fixed; } const value = new Uint32Array(1); crypto.getRandomValues(value); return (value[0] % 20) + 1; };
  let next: Encounter, detail: Record<string, unknown> = {};
  switch (action) {
    case 'create': next = createEncounter(optString(args, 'title') ?? (lang === 'es' ? 'Combate' : 'Fight')); break;
    case 'rename': next = { ...current!, title: requireString(args, 'title') }; break;
    case 'add': {
      const combatant = createCombatant({ name: requireString(args, 'name'), hp: optNumber(args, 'hp') ?? 10, maxHp: optNumber(args, 'maxHp') ?? optNumber(args, 'hp') ?? 10, initiativeBonus: optNumber(args, 'initiativeBonus') ?? 0, ...(optNumber(args, 'ac') !== undefined ? { ac: optNumber(args, 'ac') } : {}), player: args.player === true });
      next = { ...current!, combatants: [...current!.combatants, combatant] }; detail = { combatantId: combatant.id }; break;
    }
    case 'add-monster': {
      const hit = await compendiumEntry('monster', requireString(args, 'monsterId'));
      if (!hit || hit.kind !== 'monster') throw new BridgeError('not-found', 'No such monster; search with wh_compendium_search kind "monster".');
      let built = current!; const count = Math.max(1, Math.min(20, Math.round(optNumber(args, 'count') ?? 1)));
      for (let i = 0; i < count; i++) built = { ...built, combatants: [...built.combatants, combatantFromMonster(hit.entry, built)] };
      next = { ...built, log: [...built.log, `+ ${count > 1 ? `${count}× ` : ''}${hit.entry.n}`] }; break;
    }
    case 'add-sheet': {
      const sheet = (await db.projects.get(projectId))?.characterSheets?.find(item => item.id === requireString(args, 'sheetId'));
      if (!sheet) throw new BridgeError('not-found', 'No character sheet with that id in this project.');
      const combatant = combatantFromSheet(sheet, current!);
      next = { ...current!, combatants: [...current!.combatants, combatant] }; detail = { combatantId: combatant.id }; break;
    }
    case 'remove': { const target = who(current!); const at = current!.combatants.indexOf(target), combatants = current!.combatants.filter(item => item !== target); next = { ...current!, combatants, turn: Math.min(Math.max(0, at < current!.turn ? current!.turn - 1 : current!.turn), Math.max(0, combatants.length - 1)) }; break; }
    case 'roll-initiative': { const which = args.which === 'missing' ? 'missing' : 'all'; next = rollInitiative(current!, which, roll); break; }
    case 'set-initiative': { const target = who(current!); const value = optNumber(args, 'initiative'); if (value === undefined) throw new BridgeError('bad-args', 'initiative is required.'); next = sortByInitiative(replace(current!, { ...target, initiative: value })); break; }
    case 'sort': next = sortByInitiative(current!); break;
    case 'next': next = nextTurn(current!); break;
    case 'previous': next = previousTurn(current!); break;
    case 'damage': { const target = who(current!); const result = applyDamage(target, amount(), args.critical === true); next = replace(current!, result.combatant, `${target.name} −${result.taken}${result.effects.length ? ` (${result.effects.join(', ')})` : ''}`); detail = { effects: result.effects, ...(result.concentrationDc ? { concentrationDc: result.concentrationDc } : {}) }; break; }
    case 'heal': { const target = who(current!); next = replace(current!, heal(target, amount()), `${target.name} +${amount()}`); break; }
    case 'temp-hp': { const target = who(current!); next = replace(current!, setTempHp(target, amount())); break; }
    case 'condition': {
      const target = who(current!), condition = requireString(args, 'condition');
      if (!(ENCOUNTER_CONDITIONS as readonly string[]).includes(condition) && condition.length > 60) throw new BridgeError('bad-args', 'condition is a name up to 60 characters.');
      next = replace(current!, toggleCondition(target, condition, optNumber(args, 'rounds'))); break;
    }
    case 'death-save': { const target = who(current!); const value = roll(); const result = deathSave(target, value); next = replace(current!, result.combatant, `${target.name}: death save ${value} → ${result.outcome}`); detail = { roll: value, outcome: result.outcome }; break; }
    case 'concentrating': { const target = who(current!); next = replace(current!, { ...target, concentrating: args.value !== false }); break; }
    case 'end': next = { ...current!, round: 1, turn: 0, combatants: current!.combatants.filter(combatant => combatant.player).map(combatant => ({ ...combatant, initiative: null, conditions: [], concentrating: false })) }; break;
  }
  let saved: Encounter;
  try { saved = await saveEncounter(projectId, next!, current ? current.revision : null); }
  catch (error) { throw new BridgeError('bad-args', error instanceof Error ? error.message : String(error)); }
  return withAudit({ encounter: saved, ...detail }, { projectId, entityId: saved.id, kind: 'update', summary: `${action} in the encounter "${saved.title}"`, before: { __encounter: current, __encounterId: saved.id, __after: encounterStamp(saved), __afterRevision: saved.revision } });
}
