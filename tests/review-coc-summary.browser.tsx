import { db } from '@/db';
import type { Project } from '@/types';
import { createSheet, type CharacterSheet } from '@/engines/character-sheets/types';
import { cocSummary, type CocSummary } from '@/engines/character-sheets/cocSummary';
import { cocSummaryHtml } from '@/engines/character-sheets/cocSummaryMarkup';
import { sheetPaper } from '@/engines/character-sheets/paper';
import { runBridgeTool } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
export async function reviewCocSummary(): Promise<string[]> {
  const P = 'independent-coc-summary';
  const project: Project = { id: P, title: 'Summary independent', description: '', mode: 'custom', type: 'standalone', status: 'draft', color: '#000', enabledEngines: ['character-sheets'], engineOrder: ['character-sheets'], createdAt: 1, updatedAt: 1 };
  const call = async <T,>(name: string, args: Record<string, unknown>) => { const result = await runBridgeTool(name, { projectId: P, ...args }); assert(result.ok, JSON.stringify(result)); return result.result as T; };
  await db.projects.put(project);
  const subscriptions: (() => void)[] = [];
  try {
    let sheet = (await call<{ sheet: CharacterSheet }>('wh_sheet_create', { preset: 'coc7', title: 'Deleted fields' })).sheet;
    const selected = sheet.skills[0].id;
    sheet.coc!.summarySkillIds = [selected];
    sheet.skills = sheet.skills.filter(row => row.id !== selected);
    // A different skill adopts the old name, but cannot adopt the deleted ID.
    sheet.skills[0].label = 'Accounting';
    sheet.resources = sheet.resources.filter(row => !['hp', 'sanity', 'luck'].includes(row.id));
    sheet = (await call<{ sheet: CharacterSheet }>('wh_sheet_update', { sheetId: sheet.id, revision: sheet.revision, sheet })).sheet;
    const before = JSON.stringify(await db.projects.get(P));
    let writes = 0;
    for (const table of db.tables) {
      const count = () => { writes++; };
      table.hook('creating', count); table.hook('updating', count); table.hook('deleting', count);
      subscriptions.push(() => { table.hook('creating').unsubscribe(count); table.hook('updating').unsubscribe(count); table.hook('deleting').unsubscribe(count); });
    }
    const get = await call<{ derived: { summary: CocSummary } }>('wh_sheet_get', { sheetId: sheet.id });
    await call('wh_sheet_list', { includeSummary: true });
    await call('wh_sheet_list', { includeSummary: false });
    const missing = get.derived.summary;
    assert(Object.values(missing.vitals).every(value => value === null), 'Read reconstructed removed vital rows');
    assert(missing.skills[0].missing && missing.skills[0].id === selected, 'Missing skill rebound to a label alias');
    const html = cocSummaryHtml(missing, 'es');
    assert(html.includes('Habilidad no disponible') && html.includes('—'), 'Missing rows were hidden or invented');
    assert(writes === 0 && JSON.stringify(await db.projects.get(P)) === before, 'Read paths performed a database write');
    for (const unsubscribe of subscriptions.splice(0)) unsubscribe();

    const raw = createSheet('coc7', '<img src=x onerror=alert(1)>');
    raw.ink = { version: 1, surface: 'paper-v1', width: 1000, strokes: [{ id: 'old', tool: 'pen', color: '#123456', width: 2, points: [{ x: 7, y: 20000 }, { x: 9, y: 20001 }] }] };
    const input = JSON.stringify(raw), absent = cocSummary(raw)!;
    assert(!absent.skillsConfigured && absent.skills.length === 0 && JSON.stringify(raw) === input, 'Unconfigured read migrated input');
    const priorPaper = sheetPaper(raw).svg.replace(/sheet-ink-mask-[^"\s)]+/g, 'sheet-ink-mask-ID');
    raw.coc!.summarySkillIds = [];
    const empty = cocSummary(raw)!;
    const markup = cocSummaryHtml(empty, 'en');
    assert(empty.skillsConfigured && !empty.skills.length && markup.includes('No skills selected for the summary.'), 'Empty explicit choice collapsed into absence');
    assert(markup.includes('&lt;img') && !new DOMParser().parseFromString(markup, 'text/html').querySelector('img,script,input,button'), 'Readonly markup allowed authored HTML or controls');
    assert(sheetPaper(raw).svg.replace(/sheet-ink-mask-[^"\s)]+/g, 'sheet-ink-mask-ID') === priorPaper, 'Selection changed native paper/ink projection');
    return ['normal MCP reads preserve removed vitals and unavailable skill IDs with zero mutations across every DB table', 'absence versus explicit empty selection, escaped readonly HTML, and unchanged native paper with far-away ink'];
  } finally {
    for (const unsubscribe of subscriptions) unsubscribe();
    await db.projects.delete(P);
  }
}
