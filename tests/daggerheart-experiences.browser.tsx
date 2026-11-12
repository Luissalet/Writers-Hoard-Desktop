import '@/engines';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { createSheet, exportSheet, parseSheetImport, validateSheet, type CharacterSheet } from '@/engines/character-sheets/types';
import { daggerheartExperienceRows, editDaggerheartExperience, setDaggerheartGold } from '@/engines/character-sheets/daggerheart';
import { saveSheet } from '@/engines/character-sheets/operations';
import { sheetPaper } from '@/engines/character-sheets/paper';

function check(condition: unknown, label: string): asserts condition {
  if (!condition) throw Error(label);
}
function rejects(run: () => unknown, label: string) {
  try { run(); } catch { return; }
  throw Error(label);
}
function paper(sheet: CharacterSheet) {
  return new DOMParser().parseFromString(sheetPaper(sheet, 'es').svg, 'image/svg+xml');
}

export async function testDaggerheartExperiences() {
  const projectId = 'qa-contract-daggerheart-experiences3053', title = 'Disposable experiences contract';
  const initial = setDaggerheartGold(createSheet('daggerheart-character', 'Navigator'), 'bags', 2);
  const legacy = { id: 'legacy', section: 'Experiencias', name: 'Lookout', detail: 'Keep it', expression: '1d4', quantity: 2 };
  const unrelated = { id: 'other', section: 'Inventory', name: 'Lantern', detail: 'Unrelated', expression: '', quantity: 1 };
  initial.rows.push(legacy, unrelated);
  check(daggerheartExperienceRows(initial).length === 1 && !Object.hasOwn(legacy, 'daggerheartExperience'), 'Legacy read wrote or hid a row');
  const adopted = editDaggerheartExperience(initial, { action: 'save-experience', rowId: legacy.id, name: legacy.name, modifier: 2 });
  const row = adopted.rows[0];
  check(row.id === legacy.id && row.detail === legacy.detail && row.expression === legacy.expression &&
    row.quantity === legacy.quantity && row.section === legacy.section && row.daggerheartExperience === 2,
  'Adopting the legacy row lost authored data');
  check(JSON.stringify(adopted.rows[1]) === JSON.stringify(unrelated), 'Adoption changed an unrelated row');
  check(editDaggerheartExperience(adopted, { action: 'save-experience', rowId: legacy.id, name: legacy.name, modifier: 2 }) === adopted,
    'Repeated edit created a new sheet state');
  const extended = editDaggerheartExperience(adopted, { action: 'save-experience', name: '  River reader  ', modifier: -1 });
  check(daggerheartExperienceRows(extended).length === 2 && extended.rows[2].name === 'River reader', 'New structured experience lost its name');
  check(parseSheetImport(exportSheet(extended)).rows[2].daggerheartExperience === -1, 'JSON lost a negative modifier');
  const coordinates = (sheet: CharacterSheet) => [...paper(sheet).querySelectorAll('text')].find(element => element.textContent === 'Oro')?.getAttribute('y');
  check(coordinates(initial) && coordinates(initial) === coordinates(adopted), 'Adopting legacy data moved the existing gold section');
  const labels = [...paper(extended).querySelectorAll('text')].map(element => element.textContent);
  check(['Experiencias', 'Modificador', '+2', '-1', legacy.detail].every(label => labels.includes(label)), 'Paper lost a modifier or authored detail');
  rejects(() => editDaggerheartExperience(extended, { action: 'save-experience', name: 'Fraction', modifier: 0.5 }), 'Fraction accepted');
  rejects(() => editDaggerheartExperience(extended, { action: 'delete-experience', rowId: unrelated.id }), 'Removed a non-experience row');
  rejects(() => validateSheet({ ...extended, preset: 'daggerheart-adversary', daggerheartGold: undefined }), 'Adversary accepted PC metadata');
  const full = { ...extended, rows: Array.from({ length: 500 }, (_, index) => ({ ...unrelated, id: String(index) })) };
  rejects(() => editDaggerheartExperience(full, { action: 'save-experience', name: 'Overflow', modifier: 2 }), 'Exceeded existing sheet row limit');

  await db.projects.add({
    id: projectId, title, description: '', mode: 'custom', type: 'standalone', status: 'draft',
    color: '#334455', enabledEngines: ['character-sheets'], createdAt: 1, updatedAt: 1,
    worldEras: [{ id: 'later', name: 'Later', description: '', revision: 0, createdAt: 1, updatedAt: 1 }],
  });
  try {
    const saved = await saveSheet(projectId, {
      ...extended, rows: [...extended.rows, { ...legacy, id: ' ', name: 'Literal identity' }],
    }, null);
    const scope = { projectId, sheetId: saved.id }, era = { ...scope, eraId: 'later' };
    const edit = (revision: number, modifier: number) => runBridgeTool('wh_sheet_daggerheart_action', {
      ...era, revision, action: 'save-experience', rowId: legacy.id, name: legacy.name, modifier,
    });
    check(!(await runBridgeTool('wh_sheet_daggerheart_action', {
      ...era, revision: saved.revision, action: 'save-experience', rowId: '', name: 'Blank identity', modifier: 3,
    })).ok, 'Empty explicit row ID created a different experience');
    const written = await edit(saved.revision, 4);
    check(written.ok && (written.result as { sheet: CharacterSheet }).sheet.rows[0].daggerheartExperience === 4, 'Era did not save modifier');
    check(!(await edit(saved.revision, 8)).ok, 'Stale revision overwrote an experience');
    const base = await runBridgeTool('wh_sheet_get', scope);
    check(base.ok && (base.result as { sheet: CharacterSheet }).sheet.rows[0].daggerheartExperience === 2, 'Era changed Base experience');
    const removed = await runBridgeTool('wh_sheet_daggerheart_action', {
      ...era, revision: (written.result as { sheet: CharacterSheet }).sheet.revision, action: 'delete-experience', rowId: legacy.id,
    });
    check(removed.ok && !(removed.result as { sheet: CharacterSheet }).sheet.rows.some(item => item.id === legacy.id), 'Scoped removal failed');
    const literal = await runBridgeTool('wh_sheet_daggerheart_action', {
      ...era, revision: (removed.result as { sheet: CharacterSheet }).sheet.revision,
      action: 'save-experience', rowId: ' ', name: 'Literal identity', modifier: 1,
    });
    check(literal.ok && (literal.result as { sheet: CharacterSheet }).sheet.rows.find(item => item.id === ' ')?.daggerheartExperience === 1,
      'A nonempty literal ID was not preserved');
    const literalRemoval = await runBridgeTool('wh_sheet_daggerheart_action', {
      ...era, revision: (literal.result as { sheet: CharacterSheet }).sheet.revision, action: 'delete-experience', rowId: ' ',
    });
    check(literalRemoval.ok && !(literalRemoval.result as { sheet: CharacterSheet }).sheet.rows.some(item => item.id === ' '),
      'Literal identity could not be removed');
    return 'Daggerheart experiences preserve legacy rows, signed modifiers, Paper, JSON, CAS and Base/era';
  } finally {
    if ((await db.projects.get(projectId))?.title === title) await deleteProject(projectId);
  }
}
