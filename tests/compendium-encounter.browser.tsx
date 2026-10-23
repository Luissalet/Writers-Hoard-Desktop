// The SRD 5.2 compendium (search, filters, entry pages, "add to world" as a
// Codex card plus a stat block) and the fight at the table (initiative, turns
// and rounds, damage with temporary hit points, conditions that wear off,
// death saves, concentration), in the panels and through the bridge.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { db } from '@/db';
import { compendiumCounts, compendiumEntry, searchCompendium } from '@/engines/compendium/srd';
import { compendiumCard, firstDice, monsterStatBlock } from '@/engines/compendium/addToWorld';
import CompendiumPanel from '@/engines/compendium/CompendiumPanel';
import EncounterPanel from '@/engines/encounters/EncounterPanel';
import { addMonsterToFight } from '@/engines/encounters/fromSources';
import { applyDamage, createCombatant, createEncounter, deathSave, heal, nextTurn, previousTurn, rollInitiative, setTempHp, toggleCondition, type Encounter } from '@/engines/encounters/model';
import { guessRulesSlots, rulesFieldNames } from '@/engines/codex/rulesCards';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { useLocaleStore } from '@/stores/localeStore';
import type { Project } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean | Promise<boolean>, label: string, tries = 100) { for (let i = 0; i < tries; i++) { if (await check()) return; await act(async () => { await pause(50); }); } throw new Error(`Timed out: ${label}`); }
const type = async (element: Element | null, value: string) => { assert(element, 'input'); const input = element as HTMLInputElement; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); await pause(40); }); };
const choose = async (element: Element | null, value: string) => { assert(element, 'select'); const select = element as HTMLSelectElement; await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value); select.dispatchEvent(new Event('change', { bubbles: true })); await pause(60); }); };
const click = async (element: Element | null, what: string) => { assert(element, what); await act(async () => { (element as HTMLElement).click(); await pause(150); }); };

export async function testCompendiumEncounter(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const passed: string[] = [];

  // The compendium.
  const counts = await compendiumCounts();
  assert(counts.monster === 341 && counts.spell === 339 && counts.item === 262 && counts.condition === 15, `Counts: ${JSON.stringify(counts)}`);
  const goblins = await searchCompendium('goblin');
  assert(goblins.hits[0]?.name.startsWith('Goblin') && goblins.hits.some(hit => hit.id === 'goblin-warrior'), `Goblin first: ${goblins.hits.slice(0, 3).map(hit => hit.name)}`);
  const undead = await searchCompendium('', { kind: 'monster', type: 'undead', crMax: 0.25 });
  assert(undead.hits.some(hit => hit.id === 'zombie') && undead.hits.every(hit => hit.kind === 'monster'), 'Undead up to CR 1/4');
  const fire = await searchCompendium('', { kind: 'spell', level: 3, school: 'Evocation' });
  assert(fire.hits.map(hit => hit.name).join() === 'Daylight,Fireball,Lightning Bolt,Tiny Hut,Wind Wall', `Level 3 evocation: ${fire.hits.map(hit => hit.name)}`);
  assert((await searchCompendium('', { kind: 'item', rarity: 'Legendary' })).total === 32, 'Legendary items');
  passed.push(`Compendium: ${counts.monster} monsters, ${counts.spell} spells, ${counts.item} magic items, ${counts.condition} conditions offline; "goblin" finds the goblins first; filters by type and CR, by level and school (Fireball among the level-3 evocations), by rarity`);

  const warrior = await compendiumEntry('monster', 'goblin-warrior');
  assert(warrior?.kind === 'monster', 'Goblin warrior');
  const card = compendiumCard(warrior, 'es');
  assert(card.type === 'character' && card.fields.CA === '15' && card.fields.PG.startsWith('10 (') && card.fields.DES === '15' && card.fields['Desafío'] === `1/4 (${warrior.entry.xp} XP)` && card.content.includes('Scimitar') && card.content.includes('Creative Commons Attribution 4.0'), `Card: ${JSON.stringify(card.fields)}`);
  const slots = guessRulesSlots('creature', rulesFieldNames({ fields: card.fields }));
  assert(slots.armor === 'CA' && slots.hp === 'PG' && slots.dex === 'DES' && slots.challenge === 'Desafío', `A rules card reads the card: ${JSON.stringify(slots)}`);
  const block = monsterStatBlock(warrior.entry, 'card-1');
  assert(block.preset === '5e-stat-block' && block.linkedEntryId === 'card-1' && block.resources.find(r => r.id === 'hp')?.max === 10 && block.numbers.armorClass === 15 && block.traits.find(t => t.id === 'dexterity')?.value === 15 && block.rows.some(row => row.name === 'Scimitar' && row.expression === '1d6+2'), `Stat block: ${JSON.stringify(block.rows.slice(0, 2))}`);
  assert(firstDice('Hit: 13 (2d8 + 4) Slashing') === '2d8+4' && firstDice('no dice') === '', 'Dice from text');
  passed.push('Entries: the Goblin Warrior becomes a Codex card (CA 15, PG 10, DES 15, Desafío 1/4, actions and the CC BY 4.0 credit in its text) that a rules card reads directly, and a 5e stat block (HP 10, AC 15, DEX 15, Scimitar rolling 1d6+2)');

  // Encounter rules.
  let fight = createEncounter('Emboscada');
  const ilse = createCombatant({ name: 'Ilse', hp: 12, initiativeBonus: 2, player: true });
  const goblin = createCombatant({ name: 'Goblin', hp: 7, initiativeBonus: 2 });
  fight = { ...fight, combatants: [goblin, ilse] };
  const rolls = [10, 10];
  fight = rollInitiative(fight, 'all', () => rolls.shift()!);
  assert(fight.combatants.every(c => c.initiative === 12) && fight.combatants[0].name === 'Goblin', 'Ties keep their order');
  const shielded = setTempHp(ilse, 5);
  const hit = applyDamage(shielded, 8);
  assert(hit.combatant.tempHp === 0 && hit.combatant.hp === 9, 'Temporary hit points first');
  const down = applyDamage(hit.combatant, 9);
  assert(down.combatant.hp === 0 && !down.combatant.dead && down.combatant.conditions.some(c => c.name === 'Unconscious') && down.effects.includes('unconscious'), 'A character falls unconscious');
  const failed = applyDamage(down.combatant, 2);
  assert(failed.combatant.deathSaves.failures === 1 && failed.effects.includes('failed-save'), 'Damage at 0 fails a death save');
  assert(deathSave(failed.combatant, 1).combatant.deathSaves.failures === 3 && deathSave(failed.combatant, 1).outcome === 'dead', 'A natural 1 is two failures');
  assert(deathSave(failed.combatant, 20).combatant.hp === 1 && deathSave(failed.combatant, 20).outcome === 'revived', 'A natural 20 brings back 1 HP');
  assert(heal(failed.combatant, 4).hp === 4 && heal(failed.combatant, 4).deathSaves.failures === 0 && !heal(failed.combatant, 4).conditions.some(c => c.name === 'Unconscious'), 'Healing wakes and clears saves');
  assert(applyDamage(createCombatant({ name: 'Ilse', hp: 0, maxHp: 12, player: true }), 12).combatant.dead, 'Massive damage at 0 kills');
  assert(applyDamage(goblin, 7).combatant.dead && applyDamage(goblin, 7).effects.includes('down'), 'A monster at 0 is down');
  assert(applyDamage({ ...ilse, hp: 80, maxHp: 80, concentrating: true }, 30).concentrationDc === 15 && applyDamage({ ...ilse, concentrating: true }, 4).concentrationDc === 10, 'Concentration DC is half the damage, at least 10');
  fight = { ...fight, combatants: fight.combatants.map(c => c.name === 'Goblin' ? toggleCondition(c, 'Frightened', 1) : c) };
  fight = nextTurn(fight);
  assert(fight.turn === 1 && fight.round === 1 && fight.combatants[0].conditions.length === 1, 'Next turn');
  fight = nextTurn(fight);
  assert(fight.turn === 0 && fight.round === 2 && fight.combatants[0].conditions.length === 0, 'A new round, and a 1-round condition wears off');
  assert(previousTurn(fight).round === 1 && previousTurn(fight).turn === 1, 'Previous turn goes back across the round');
  passed.push('Fight rules: temporary hit points absorb first; a character at 0 falls unconscious, more damage fails death saves, massive damage kills; a natural 1 counts twice, a 20 brings back 1 HP, healing wakes; a monster at 0 is down; concentration DC = half the damage (at least 10); turns and rounds advance and a 1-round Frightened wears off');

  // Panels.
  const P = 'compendium-encounter';
  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  try {
    await db.projects.put({ id: P, title: 'Mesa', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['codex', 'character-sheets'], createdAt: 1, updatedAt: 1 } as Project);
    await act(async () => { root = createRoot(host); root.render(<CompendiumPanel projectId={P} locale="es" onAddToFight={monster => { void addMonsterToFight(P, monster, 1, 'Combate'); }} />); await pause(300); });
    await until(() => /341/.test(document.querySelector('[data-testid="compendium-shelf-monster"]')?.textContent ?? ''), 'shelves counted');
    await type(document.querySelector('[data-testid="compendium-search"]'), 'goblin warrior');
    await until(() => !!document.querySelector('[data-testid="compendium-hit-monster-goblin-warrior"]'), 'hit');
    await click(document.querySelector('[data-testid="compendium-hit-monster-goblin-warrior"]'), 'open');
    await until(() => !!document.querySelector('[data-testid="compendium-statblock"]'), 'stat block');
    assert(/FUE.*DES.*CON/s.test(document.querySelector('[data-testid="compendium-statblock"]')?.textContent ?? '') && /15 \(\+2\)/.test(document.querySelector('[data-testid="compendium-statblock"]')!.textContent!) && /Creative Commons Attribution 4\.0/.test(document.querySelector('[data-testid="compendium-credit"]')?.textContent ?? ''), 'Stat block and credit');
    await click(document.querySelector('[data-testid="compendium-add"]'), 'add to world');
    await until(() => /está ahora en el Códice/.test(document.querySelector('[data-testid="compendium-status"]')?.textContent ?? ''), 'added');
    const cards = await db.codexEntries.where('projectId').equals(P).toArray();
    const project = await db.projects.get(P);
    assert(cards.length === 1 && cards[0].title === 'Goblin Warrior' && project?.characterSheets?.[0]?.linkedEntryId === cards[0].id, 'Card and linked stat block');
    await click(document.querySelector('[data-testid="compendium-fight"]'), 'add to fight');
    await until(async () => ((await db.projects.get(P))?.encounters?.[0]?.combatants.length ?? 0) === 1, 'in a fight');
    await click(document.querySelector('[data-testid="compendium-shelf-spell"]'), 'spells');
    await choose(document.querySelector('[data-testid="compendium-level"]'), '3');
    await type(document.querySelector('[data-testid="compendium-search"]'), 'fireball');
    await until(() => !!document.querySelector('[data-testid="compendium-hit-spell-fireball"]'), 'fireball');
    await click(document.querySelector('[data-testid="compendium-hit-spell-fireball"]'), 'open spell');
    assert(/Nivel 3 · Evocation/.test(document.querySelector('[data-testid="compendium-spell"]')?.textContent ?? ''), 'Spell page');
    passed.push('Compendium panel: shelves with their counts; "goblin warrior" → its stat block (FUE…CAR with modifiers) and the CC BY 4.0 credit; "Añadir al mundo" makes the card and its stat block; "Añadir al combate" starts a fight with it; Conjuros → Nivel 3 → Fireball');

    const sheets = (await db.projects.get(P))!.characterSheets ?? [];
    await act(async () => { root!.render(<EncounterPanel projectId={P} locale="es" sheets={sheets} />); await pause(300); });
    await until(() => !!document.querySelector('[data-testid="enc-row-0"]'), 'fight shown');
    await type(document.querySelector('[data-testid="enc-add-name"]'), 'Ilse');
    await type(document.querySelector('[data-testid="enc-add-hp"]'), '12');
    await act(async () => { (document.querySelector('[data-testid="enc-add-player"]') as HTMLInputElement).click(); await pause(40); });
    await click(document.querySelector('[data-testid="enc-add"]'), 'add Ilse');
    await until(() => !!document.querySelector('[data-testid="enc-row-1"]'), 'Ilse in');
    await click(document.querySelector('[data-testid="enc-roll-all"]'), 'roll');
    await until(async () => ((await db.projects.get(P))?.encounters?.[0]?.combatants.every(c => c.initiative !== null)) ?? false, 'rolled');
    const order = () => [...document.querySelectorAll('[data-testid^="enc-row-"]')].map(row => row.textContent ?? '');
    const ilseRow = order().findIndex(text => text.includes('Ilse'));
    await type(document.querySelector(`[data-testid="enc-amount-${ilseRow}"]`), '12');
    await click(document.querySelector(`[data-testid="enc-damage-${ilseRow}"]`), 'damage Ilse');
    await until(() => /0\/12/.test(document.querySelector(`[data-testid="enc-hp-${ilseRow}"]`)?.textContent ?? '') && !!document.querySelector(`[data-testid="enc-deathsave-${ilseRow}"]`), 'Ilse at 0 with death saves');
    await choose(document.querySelector(`[data-testid="enc-condition-${ilseRow}"]`), 'Poisoned');
    await until(() => !!document.querySelector(`[data-testid="enc-chip-${ilseRow}-Poisoned"]`), 'condition chip');
    assert(document.querySelector(`[data-testid="enc-chip-${ilseRow}-Poisoned"]`)?.textContent?.startsWith('Envenenado'), 'The condition reads in Spanish');
    await click(document.querySelector('[data-testid="enc-next"]'), 'next');
    await click(document.querySelector('[data-testid="enc-next"]'), 'next');
    await until(() => /Ronda 2/.test(document.querySelector('[data-testid="enc-round"]')?.textContent ?? ''), 'round 2');
    assert(document.querySelector('[aria-current="step"]'), 'The current turn is marked');
    passed.push('Fight panel: the goblin from the compendium and Ilse added by hand; "Tirar iniciativa" orders them; 12 damage leaves Ilse at 0/12 with death saves to roll; Poisoned shows as a chip "Envenenado"; two "Siguiente turno" reach round 2 with the turn marked');
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
  }

  // Bridge.
  try {
    const search = await runBridgeTool('wh_compendium_search', { query: 'zombie', kind: 'monster' });
    assert(search.ok && (search.result as { hits: { id: string }[] }).hits[0].id === 'zombie' && /Creative Commons Attribution 4\.0/.test(JSON.stringify(search.result)), 'Bridge search');
    const got = await runBridgeTool('wh_compendium_get', { kind: 'spell', id: 'fireball' });
    assert(got.ok && (got.result as { entry: { lv: number } }).entry.lv === 3, 'Bridge get');
    const added = await runBridgeTool('wh_compendium_add', { projectId: P, kind: 'item', id: (await searchCompendium('', { kind: 'item', rarity: 'Legendary' }, 1)).hits[0].id, locale: 'es' });
    const itemId = (added.result as { entryId: string }).entryId;
    assert(added.ok && (await db.codexEntries.get(itemId))?.type === 'item', 'Bridge add item');
    await undoAuditEntry({ entry: { ...(added.result as { __audit: Record<string, unknown> }).__audit, tool: 'wh_compendium_add' } });
    assert(!(await db.codexEntries.get(itemId)), 'Undo removes the added card');
    const made = await runBridgeTool('wh_encounter_action', { projectId: P, action: 'create', title: 'Cripta' });
    const encounterId = (made.result as { encounter: Encounter }).encounter.id;
    const zombies = await runBridgeTool('wh_encounter_action', { projectId: P, encounterId, action: 'add-monster', monsterId: 'zombie', count: 2 });
    assert(zombies.ok && (zombies.result as { encounter: Encounter }).encounter.combatants.map(c => c.name).join() === 'Zombie,Zombie 2', 'Two zombies, numbered');
    await runBridgeTool('wh_encounter_action', { projectId: P, encounterId, action: 'roll-initiative', roll: 10 });
    const hurt = await runBridgeTool('wh_encounter_action', { projectId: P, encounterId, action: 'damage', name: 'Zombie 2', amount: 15 });
    const after = (hurt.result as { encounter: Encounter }).encounter.combatants.find(c => c.name === 'Zombie 2')!;
    assert(hurt.ok && after.dead && after.hp === 0, 'A zombie at 0 is down');
    await undoAuditEntry({ entry: { ...(hurt.result as { __audit: Record<string, unknown> }).__audit, tool: 'wh_encounter_action', kind: 'update' } });
    const restored = (await db.projects.get(P))!.encounters!.find(e => e.id === encounterId)!.combatants.find(c => c.name === 'Zombie 2')!;
    assert(restored.hp === 15 && !restored.dead, 'Undo brings it back');
    const stale = await runBridgeTool('wh_encounter_action', { projectId: P, encounterId, action: 'next', expectedRevision: 1 });
    assert(!stale.ok, 'A stale revision is refused');
    const listed = await runBridgeTool('wh_encounter_list', { projectId: P });
    assert(listed.ok && (listed.result as { encounters: { title: string }[] }).encounters.some(e => e.title === 'Cripta'), 'Listed');
    passed.push('Bridge: wh_compendium_search/get read the SRD with its credit; wh_compendium_add copies a legendary item as a card (undo removes it); wh_encounter_action creates "Cripta", adds two numbered zombies, rolls initiative, drops Zombie 2 with 15 damage (undo brings it back) and refuses a stale revision; wh_encounter_list lists the fights');
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
