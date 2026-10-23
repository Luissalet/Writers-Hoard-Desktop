import { db } from '@/db';
import type { Project } from '@/types';
import type { CharacterSheet } from '@/engines/character-sheets/types';
import { createSheet, exportSheet, parseSheetImport } from '@/engines/character-sheets/types';
import { sheetPaper } from '@/engines/character-sheets/paper';
import { cocTargets } from '@/engines/character-sheets/mechanics';
import { cocRoll, pushCocRoll } from '@/engines/character-sheets/cocRules';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { buildDocumentImage } from '@/services/documentImage/build';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const P = 'coc-paper-live-comparison';
const plain = (svg: string) => [...new DOMParser().parseFromString(svg, 'image/svg+xml').querySelectorAll('tspan')].map(node => node.textContent ?? '').join(' ').replace(/\s+/g, ' ');
export async function testCocPaper(): Promise<string[]> {
  const passed: string[] = [];
  const project: Project = { id: P, title: 'Investigation QA', description: '', mode: 'custom', type: 'standalone', status: 'draft', color: '#000', enabledEngines: ['character-sheets'], engineOrder: ['character-sheets'], createdAt: 1, updatedAt: 1 };
  await db.projects.put(project);
  const call = async (name: string, args: Record<string, unknown>) => { const result = await runBridgeTool(name, { projectId: P, ...args }); assert(result.ok, `${name}: ${JSON.stringify(result)}`); return result.result as { sheet: CharacterSheet }; };
  try {
    let sheet = (await call('wh_sheet_create', { preset: 'coc7', title: 'Dr. Vale' })).sheet;
    for (const [id, value] of [['con', 70], ['siz', 60], ['str', 85]] as const) sheet.traits.find(row => row.id === id)!.value = value;
    sheet = (await call('wh_sheet_update', { sheetId: sheet.id, revision: sheet.revision, sheet })).sheet;
    sheet = (await call('wh_sheet_coc_action', { sheetId: sheet.id, revision: sheet.revision, action: 'mode', pulp: true, era: 'modern' })).sheet;
    const hp = sheet.resources.find(row => row.id === 'hp')!;
    assert(hp.max === 26 && hp.current === 26 && sheet.numbers.build === 1 && sheet.details.damageBonus === '+1d4' && sheet.numbers.move === 8, 'Observed VVD characteristics/Pulp case differs');
    for (const [value, hard, extreme] of [[85, 42, 17], [70, 35, 14], [60, 30, 12]]) assert(cocTargets(value).hard === hard && cocTargets(value).extreme === extreme, `Half/fifth differs for ${value}`);
    assert(sheet.skills.some(row => row.label === 'Electronics') && sheet.skills.some(row => row.label === 'Computer Use'), 'Modern skills unavailable');
    passed.push('normal registered MCP creates and saves observed CON70/SIZ60/STR85/Pulp26/build1/+1d4/MOV8, exact half/fifth and Modern skills');

    const action = async (action: string, args: Record<string, unknown> = {}) => { sheet = (await call('wh_sheet_coc_action', { sheetId: sheet.id, revision: sheet.revision, action, ...args })).sheet; };
    await action('damage', { amount: 13 });
    await action('sanity-loss', { amount: 5 });
    await action('mark-skill', { subjectId: sheet.skills.find(row => row.label === 'Spot Hidden')!.id, enabled: true });
    await action('override', { key: 'move', value: 6 });
    sheet = cocRoll(sheet, 'STR', 85, { kind: 'trait', difficulty: 'hard' }, () => 90);
    sheet = pushCocRoll(sheet, sheet.rolls[0].id, 'Use a lever <carefully>', () => 23);
    sheet = (await call('wh_sheet_update', { sheetId: sheet.id, revision: sheet.revision, sheet })).sheet;
    const before = JSON.stringify(await db.projects.get(P)), paper = sheetPaper(sheet), text = plain(paper.svg);
    for (const fragment of ['Investigator state', 'Modern', 'Pulp', 'Major wound', 'CON', 'INT', 'Lost today', '5 / 10', 'Spot Hidden', 'manual overrides', 'Movement', 'Use a lever <carefully>', 'Pushed once', '42 / 17']) assert(text.includes(fragment), `Paper lost ${fragment}`);
    assert(!paper.svg.includes('Use a lever <carefully>') && !paper.svg.includes('<script'), 'Paper does not escape authored push context');
    assert(before === JSON.stringify(await db.projects.get(P)), 'Read-only paper modified the project');
    const spanish = plain(sheetPaper(sheet, 'es').svg);
    for (const fragment of ['Estado del investigador', 'Moderna', 'Herida grave', 'Pérdida hoy', 'ajustes manuales', 'Forzada una vez']) assert(spanish.includes(fragment), `Spanish paper lost ${fragment}`);
    const imported = parseSheetImport(exportSheet(sheet));
    assert(JSON.stringify(imported.coc) === JSON.stringify(sheet.coc) && plain(sheetPaper(imported).svg).includes('Use a lever <carefully>'), 'Portable JSON lost paper state');
    const image = await buildDocumentImage({ projectId: P, kind: 'character-sheets', entityId: sheet.id, locale: 'es' });
    assert(image.html.includes('Estado del investigador') && image.html.includes('Herida grave') && image.html.includes('Forzada una vez') && image.sourceVersion, 'Normal image export omitted saved play state');
    passed.push('read-only EN/ES paper preserves saved conditions, pending checks, daily SAN, marks, overrides and escaped linked push context through JSON');
    const annotated = structuredClone(sheet);
    annotated.ink = { version: 1, surface: 'paper-v1', width: 1000, strokes: [{ id: 'far-note', tool: 'pen', color: '#272b2b', width: 3, points: [{ x: 15, y: 20000 }, { x: 30, y: 20001 }] }] };
    const annotatedBefore = JSON.stringify(annotated), annotatedSvg = new DOMParser().parseFromString(sheetPaper(annotated).svg, 'image/svg+xml');
    const stateHeading = [...annotatedSvg.querySelectorAll('text')].find(node => node.textContent === 'Investigator state');
    assert(stateHeading && Number(stateHeading.getAttribute('y')) > 20004 && annotatedSvg.querySelector('[data-sheet-ink-stroke="0"]') && JSON.stringify(annotated) === annotatedBefore, 'Appended state displaced or overlapped existing ink');
    passed.push('normal document-image source includes saved play state; appended state leaves existing ink coordinates untouched');
    const custom = createSheet('custom', 'Legacy custom');
    assert(!plain(sheetPaper(custom).svg).includes('Investigator state') && !custom.coc, 'Non-investigator paper adopted rules state');
    passed.push('custom paper remains outside investigator state projection');
  } finally { await db.projects.delete(P); }
  return passed;
}
