import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import type { Project } from '@/types';
import { createSheet, exportSheet, parseSheetImport, presets, validateSheet, type CharacterSheet } from '@/engines/character-sheets/types';
import { cocSummary, type CocSummary } from '@/engines/character-sheets/cocSummary';
import { cocSummaryHtml } from '@/engines/character-sheets/cocSummaryMarkup';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { exportProjectData, importProjectData } from '@/db/operations';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import { useLocaleStore } from '@/stores/localeStore';
import CharacterSheetsEngine from '@/engines/character-sheets/CharacterSheetsEngine';
import { sheetDraftStore } from '@/engines/character-sheets/drafts';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const pause = () => new Promise(done => setTimeout(done, 45));
const P = 'coc-summary-native';
const project = (id: string): Project => ({ id, title: 'Summary QA', description: '', mode: 'custom', type: 'standalone', status: 'draft', color: '#000', enabledEngines: ['character-sheets'], engineOrder: ['character-sheets'], worldEras: [{ id: 'past', name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1 }], createdAt: 1, updatedAt: 1 });
async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await runBridgeTool(name, args); assert(result.ok, `${name}: ${JSON.stringify(result)}`); return result.result as T;
}
export async function testCocSummary(): Promise<string[]> {
  const passed: string[] = [], clones: string[] = [];
  for (const preset of presets) {
    const sheet = createSheet(preset, 'Unconfigured'), before = JSON.stringify(sheet), summary = cocSummary(sheet);
    assert(JSON.stringify(sheet) === before && (preset === 'coc7' ? summary?.skillsConfigured === false && summary.skills.length === 0 : summary === null), 'Projection changed a default or adopted another preset');
  }
  passed.push('pure summary leaves all six presets/default selection byte-identical and does not invent skill IDs');
  await db.projects.put(project(P));
  try {
    let sheet = (await call<{ sheet: CharacterSheet }>('wh_sheet_create', { projectId: P, title: 'Dr. Summary', preset: 'coc7' })).sheet;
    await call('wh_sheet_create', { projectId: P, title: 'Unrelated custom', preset: 'custom' });
    for (const [id, value] of [['str', 85], ['con', 70], ['siz', 60]] as const) sheet.traits.find(row => row.id === id)!.value = value;
    sheet = (await call<{ sheet: CharacterSheet }>('wh_sheet_update', { projectId: P, sheetId: sheet.id, revision: sheet.revision, sheet })).sheet;
    sheet = (await call<{ sheet: CharacterSheet }>('wh_sheet_coc_action', { projectId: P, sheetId: sheet.id, revision: sheet.revision, action: 'mode', pulp: true })).sheet;
    sheet = (await call<{ sheet: CharacterSheet }>('wh_sheet_coc_action', { projectId: P, sheetId: sheet.id, revision: sheet.revision, action: 'damage', amount: 13 })).sheet;
    const ids = ['Spot Hidden', 'Library Use', 'Occult', 'Listen', 'Fighting (Brawl)'].map(label => sheet.skills.find(row => row.label === label)!.id);
    sheet.coc!.checkedSkills = [ids[0]]; sheet.coc!.summarySkillIds = [ids[2], ids[0], ids[4], ids[1], ids[3]];
    sheet = (await call<{ sheet: CharacterSheet }>('wh_sheet_update', { projectId: P, sheetId: sheet.id, revision: sheet.revision, sheet })).sheet;
    const dbBeforeReads = JSON.stringify(await db.projects.get(P));
    const read = await call<{ sheet: CharacterSheet; derived: { summary: CocSummary } }>('wh_sheet_get', { projectId: P, sheetId: sheet.id });
    const summary = read.derived.summary;
    assert(summary.vitals.hp?.current === 13 && summary.vitals.hp.max === 26 && summary.vitals.sanity?.current === 50 && summary.vitals.luck?.current === 50 && !('mp' in summary.vitals), 'Summary did not use observed HP/SAN/Luck or preserved damage');
    assert(summary.conditions.includes('majorWound') && summary.traits.find(row => row.id === 'str')?.hard === 42 && summary.skills.map(row => row.id).join(',') === sheet.coc!.summarySkillIds!.join(','), 'Summary lost conditions, targets or chosen order');
    const htmlSource = structuredClone(sheet); htmlSource.title = 'Summary <private>'; htmlSource.details.notes = 'DM_ONLY_PROSE';
    const html = cocSummaryHtml(cocSummary(htmlSource)!, 'es');
    assert(html.includes('Summary &lt;private&gt;') && html.includes('Herida grave') && html.includes('13 / 26') && !html.includes('DM_ONLY_PROSE') && !/<(?:input|button)\b/.test(html), 'Shared static card lost escaped state or gained private prose/interactive controls');
    const ordinary = await call<{ sheets: Record<string, unknown>[] }>('wh_sheet_list', { projectId: P });
    assert(ordinary.sheets.every(row => !('summary' in row)), 'Ordinary metadata list changed its response shape');
    const roster = await call<{ sheets: { preset: string; summary?: CocSummary }[] }>('wh_sheet_list', { projectId: P, includeSummary: true });
    assert(roster.sheets.find(row => row.preset === 'coc7')?.summary?.id === sheet.id && !roster.sheets.find(row => row.preset === 'custom')?.summary && JSON.stringify(await db.projects.get(P)) === dbBeforeReads, 'Roster read wrote data or adopted custom sheets');
    passed.push('registered MCP get/list resolve saved HP26/13, SAN/Luck, conditions, targets and ordered skill IDs without reads writing revisions or changing legacy list shape');

    const stale = structuredClone(sheet); sheet.skills.find(row => row.id === ids[0])!.label = 'Renamed skill'; sheet.skills.find(row => row.id === ids[0])!.value = 63; sheet.skills.find(row => row.id === ids[0])!.bonus = 4;
    sheet = (await call<{ sheet: CharacterSheet }>('wh_sheet_update', { projectId: P, sheetId: sheet.id, revision: sheet.revision, sheet })).sheet;
    const renamed = cocSummary(sheet)!.skills.find(row => row.id === ids[0]);
    assert(renamed && !renamed.missing && renamed.label === 'Renamed skill' && renamed.regular === 67 && renamed.hard === 33 && renamed.extreme === 13 && sheet.coc!.checkedSkills.join(',') === ids[0], 'Selection used a label/index or altered development marks');
    const staleResult = await runBridgeTool('wh_sheet_update', { projectId: P, sheetId: sheet.id, revision: stale.revision, sheet: stale }); assert(!staleResult.ok, 'Stale selection overwrote a newer sheet');
    for (const invalid of [[ids[0], ids[0]], [...ids, 'sixth'], [42], ['']]) {
      const bad = structuredClone(sheet); bad.coc!.summarySkillIds = invalid as string[];
      let rejected = false; try { validateSheet(bad); } catch { rejected = true; } assert(rejected, 'Invalid summary slots accepted');
    }
    const wrongType = await runBridgeTool('wh_sheet_list', { projectId: P, includeSummary: 'yes' }); assert(!wrongType.ok, 'Non-boolean summary flag accepted');
    const missing = structuredClone(sheet); missing.skills = missing.skills.filter(row => row.id !== ids[2]); validateSheet(missing);
    assert(cocSummary(missing)!.skills[0].missing, 'Deleted selected skill silently rebound to another skill');
    assert(JSON.stringify(parseSheetImport(exportSheet(sheet)).coc) === JSON.stringify(sheet.coc), 'Sheet JSON lost explicit selection');
    passed.push('stable IDs survive rename/bonuses; CAS rejects stale writes, validation rejects malformed/five-slot overflow, deleted skills stay unavailable and development marks remain separate');

    const base = JSON.stringify((await db.projects.get(P))!.characterSheets!.find(row => row.id === sheet.id));
    const era = structuredClone(sheet); era.coc!.summarySkillIds = [ids[1]];
    const eraSaved = await call<{ sheet: CharacterSheet }>('wh_sheet_update', { projectId: P, eraId: 'past', sheetId: sheet.id, revision: sheet.revision, sheet: era });
    const eraRead = await call<{ derived: { summary: CocSummary } }>('wh_sheet_get', { projectId: P, eraId: 'past', sheetId: sheet.id });
    assert(eraRead.derived.summary.skills.length === 1 && eraSaved.sheet.coc!.summarySkillIds![0] === ids[1] && JSON.stringify((await db.projects.get(P))!.characterSheets!.find(row => row.id === sheet.id)) === base, 'Era selection altered Base');
    const cloned = await importProjectData(await exportProjectData(P)); clones.push(cloned);
    const cloneSheet = (await db.projects.get(cloned))!.characterSheets!.find(row => row.preset === 'coc7')!;
    assert(cloneSheet.id !== sheet.id && JSON.stringify(cloneSheet.coc?.summarySkillIds) === JSON.stringify(sheet.coc!.summarySkillIds), 'Project clone lost selected internal skill IDs');
    const zip = await createProjectZipArchive(P); const zipped = await importProjectZip(new File([zip.blob], zip.fileName, { type: 'application/zip' }), { replaceProjectIds: [P] }); clones.push(...zipped);
    const zipSheet = (await db.projects.get(zipped[0]))!.characterSheets!.find(row => row.preset === 'coc7')!;
    assert(JSON.stringify(zipSheet.coc?.summarySkillIds) === JSON.stringify(sheet.coc!.summarySkillIds), 'ZIP archive lost selection');
    passed.push('explicit summary selection survives sheet JSON/project clone/ZIP and an era-specific update preserves Base');
  } finally { for (const id of [...clones, P]) await db.projects.delete(id); }
  return passed;
}

export async function testCocSummaryUi(): Promise<string[]> {
  const passed: string[] = [];
  for (const locale of ['en', 'es'] as const) {
    const es = locale === 'es', id = `coc-summary-ui-${locale}`, host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host), sheet = createSheet('coc7', 'Saved investigator'); sheet.revision = 1;
    const state = project(id); state.characterSheets = [sheet, createSheet('5e-character', 'Other character')];
    const click = async (node: HTMLElement | null | undefined) => { assert(node, 'Missing UI control'); await act(async () => { node.click(); await pause(); }); await act(async () => { await pause(); }); };
    const button = (label: string, scope: ParentNode = host) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find(row => row.textContent?.trim() === label);
    const render = async (open = true) => { await act(async () => { root.render(<MemoryRouter>{open && <CharacterSheetsEngine projectId={id}/>}</MemoryRouter>); await pause(); }); await act(async () => { await pause(); }); };
    try {
      await db.projects.put(state); sheetDraftStore(id).clear(); useLocaleStore.setState({ locale, loaded: true }); await render();
      const selector = host.querySelector<HTMLElement>('[data-testid="coc-summary-skills"] summary'); await click(selector);
      const boxes = [...host.querySelectorAll<HTMLInputElement>('[data-testid="coc-summary-skills"] input[type="checkbox"]')];
      for (const checkbox of boxes.slice(0, 5)) await click(checkbox);
      assert(boxes[5].disabled && (await db.projects.get(id))!.characterSheets![0].coc?.summarySkillIds === undefined, 'Five summary slots changed saved data without Save');
      await click(host.querySelector('[data-testid="sheets-view-roster"]'));
      assert(host.querySelectorAll('[data-coc-summary]').length === 1 && host.textContent?.includes(es ? 'Elige las habilidades destacadas' : 'Choose featured skills'), 'Roster showed an unsaved draft or non-CoC character');
      await click(button(es ? 'Abrir ficha' : 'Open sheet')); await click(button(es ? 'Guardar ficha' : 'Save sheet'));
      const saved = (await db.projects.get(id))!.characterSheets![0]; assert(saved.coc?.summarySkillIds?.length === 5 && saved.coc.checkedSkills.length === 0, 'UI Save lost selection or created development marks');
      await render(false); await render(); await click(host.querySelector('[data-testid="sheets-view-roster"]'));
      assert(host.querySelector('[data-coc-summary]')?.querySelectorAll('li').length === 5 && !host.querySelector('[data-coc-summary] input'), 'Reopened roster lost selected skills or has editable inputs');
      const before = JSON.stringify(await db.projects.get(id)); await click(host.querySelector('[data-testid="sheets-view-roster"]')); assert(JSON.stringify(await db.projects.get(id)) === before, 'Readonly roster wrote a sheet');
      await click(button(es ? 'Abrir ficha' : 'Open sheet'));
      await click(button(es ? 'Restablecer selección sin configurar' : 'Reset to unconfigured selection')); await click(button(es ? 'Guardar ficha' : 'Save sheet'));
      assert((await db.projects.get(id))!.characterSheets![0].coc?.summarySkillIds === undefined, 'Reset did not preserve absent optional field');
      passed.push(`${locale}: real Play selection saves/reopens five ordered slots separately from development; saved-only readonly roster opens the existing sheet and explicit reset restores absence`);
    } finally { await act(async () => { root.unmount(); }); host.remove(); sheetDraftStore(id).clear(); await db.projects.delete(id); }
  }
  return passed;
}
