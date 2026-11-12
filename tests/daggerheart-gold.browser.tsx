import '@/engines';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { createSheet, exportSheet, parseSheetImport, validateSheet, type CharacterSheet } from '@/engines/character-sheets/types';
import { daggerheartGold, setDaggerheartGold } from '@/engines/character-sheets/daggerheart';
import { applySheetInk } from '@/engines/character-sheets/ink';
import { saveSheet } from '@/engines/character-sheets/operations';
import { sheetPaper } from '@/engines/character-sheets/paper';

function check(condition: unknown, label: string): asserts condition {
  if (!condition) throw Error(label);
}
const goldOf = (sheet: CharacterSheet) => JSON.stringify(daggerheartGold(sheet));
function rejects(run: () => unknown, label: string) {
  try { run(); } catch { return; }
  throw Error(label);
}
function goldY(sheet: CharacterSheet) {
  const { svg } = sheetPaper(sheet, 'es');
  const dom = new DOMParser().parseFromString(svg, 'image/svg+xml');
  return [...dom.querySelectorAll('text')].find(element => element.textContent === 'Oro')?.getAttribute('y');
}

export async function testDaggerheartGold() {
  const projectId = 'qa-contract-daggerheart-gold3044', title = 'Disposable gold contract';
  const initial = createSheet('daggerheart-character', 'Navigator');
  check(!Object.hasOwn(initial, 'daggerheartGold') && goldOf(initial) === '{"handfuls":0,"bags":0,"chest":0}',
    'Legacy sheet did not read as zero without a write');
  check(setDaggerheartGold(initial, 'handfuls', 0) === initial, 'Zero on legacy sheet wrote data');
  const tracked = setDaggerheartGold(setDaggerheartGold(setDaggerheartGold(initial, 'handfuls', 3), 'bags', 2), 'chest', 1);
  check(goldOf(tracked) === '{"handfuls":3,"bags":2,"chest":1}', 'Counter edit altered another counter');
  check(goldOf(parseSheetImport(exportSheet(tracked))) === goldOf(tracked), 'JSON round-trip lost gold');
  for (const [unit, value] of [['handfuls', 11], ['bags', -1], ['bags', 2.5], ['chest', 2], ['constructor', 0]] as const) {
    rejects(() => setDaggerheartGold(tracked, unit, value), 'Invalid counter accepted: ' + unit);
  }
  const tenHandfuls = setDaggerheartGold(initial, 'handfuls', 10);
  check(goldOf(tenHandfuls) === '{"handfuls":0,"bags":1,"chest":0}', 'Ten handfuls did not become a bag');
  const nineBags = setDaggerheartGold(initial, 'bags', 9);
  check(goldOf(setDaggerheartGold(nineBags, 'handfuls', 10)) === '{"handfuls":0,"bags":0,"chest":1}',
    'Handfuls did not carry through bags into the chest');
  const fullChest = setDaggerheartGold(nineBags, 'chest', 1);
  const fullBags = setDaggerheartGold(fullChest, 'bags', 10);
  check(goldOf(fullBags) === '{"handfuls":0,"bags":10,"chest":1}', 'A full chest discarded the bags');
  const overflow = setDaggerheartGold(fullBags, 'handfuls', 10);
  check(goldOf(overflow) === '{"handfuls":10,"bags":10,"chest":1}', 'Full bags discarded the handfuls');
  const freed = setDaggerheartGold(overflow, 'chest', 0);
  check(goldOf(freed) === '{"handfuls":10,"bags":10,"chest":0}', 'Clearing a chest changed other denominations');
  check(goldOf(setDaggerheartGold(freed, 'handfuls', 10)) === '{"handfuls":0,"bags":1,"chest":1}',
    'Carrying a retained handful counter did not conserve the total');
  const preCarry = { ...tracked, daggerheartGold: { handfuls: 3, bags: 10, chest: 0 } };
  check(goldOf(parseSheetImport(exportSheet(preCarry))) === goldOf(preCarry), 'An existing full count changed on import');
  check(goldOf(setDaggerheartGold(preCarry, 'bags', 10)) === '{"handfuls":3,"bags":0,"chest":1}',
    'Carrying a retained bag counter did not preserve the handfuls');

  const rival = createSheet('daggerheart-adversary', 'Rival');
  rejects(() => setDaggerheartGold(rival, 'chest', 1), 'Adversary accepted gold');
  rejects(() => validateSheet({ ...rival, daggerheartGold: tracked.daggerheartGold }), 'Adversary gold imported');
  rejects(() => validateSheet({ ...tracked, daggerheartGold: { handfuls: 3, bags: 2 } }), 'Partial gold imported');
  check(!goldY(initial), 'Legacy paper layout changed on open');
  const y = goldY(tracked);
  const inked = applySheetInk(tracked, { kind: 'stroke', stroke: { id: 'gold-test-ink', tool: 'pen',
    color: '#272b2b', width: 4, points: [{ x: 300, y: 2200 }, { x: 400, y: 2400 }] } });
  check(y && goldY(inked) === y, 'Ink changed the gold section coordinates');

  await db.projects.add({
    id: projectId, title, description: '', mode: 'custom', type: 'standalone', status: 'draft',
    color: '#334455', enabledEngines: ['character-sheets'], createdAt: 1, updatedAt: 1,
    worldEras: [{ id: 'later', name: 'Later', description: '', revision: 0, createdAt: 1, updatedAt: 1 }],
  });
  try {
    const saved = await saveSheet(projectId, tracked, null);
    const scope = { projectId, sheetId: saved.id }, era = { ...scope, eraId: 'later' };
    const action = (revision: number, value: number) =>
      runBridgeTool('wh_sheet_daggerheart_action', { ...era, revision, action: 'gold', goldUnit: 'handfuls', value });
    const write = await action(saved.revision, 7);
    check(write.ok && goldOf((write.result as { sheet: CharacterSheet }).sheet) === '{"handfuls":7,"bags":2,"chest":1}', 'Era tool did not save');
    check(!(await action(saved.revision, 4)).ok, 'Stale gold revision overwrote the era');
    const carried = await action((write.result as { sheet: CharacterSheet }).sheet.revision, 10);
    check(carried.ok && goldOf((carried.result as { sheet: CharacterSheet }).sheet) === '{"handfuls":0,"bags":3,"chest":1}',
      'MCP did not carry into the next counter');
    const base = await runBridgeTool('wh_sheet_get', scope);
    check(base.ok && goldOf((base.result as { sheet: CharacterSheet }).sheet) === goldOf(tracked), 'Era changed Base gold');
    return 'Daggerheart gold validation, old sheet, paper ink coordinates, JSON, carries, overflow, Base/era and CAS';
  } finally {
    if ((await db.projects.get(projectId))?.title === title) await deleteProject(projectId);
  }
}
