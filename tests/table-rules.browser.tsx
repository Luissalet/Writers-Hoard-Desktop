// Table rules ("Reglas de la mesa"): choose a system, change rules (each marked
// as changed, each with its own reset and one reset for all), keep a reorderable
// list of notes for the evening, survive reload / backup / clone, feed the 5e
// sheet and the dice tray, and answer the bridge (get / set / undo / stale / off).
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { deleteProject, exportProjectData, importProjectData, updateProject } from '@/db/operations';
import CharacterSheetsEngine from '@/engines/character-sheets/CharacterSheetsEngine';
import FiveEPlayPanel from '@/engines/character-sheets/FiveEPlayPanel';
import { createSheet } from '@/engines/character-sheets/types';
import { readTableRules } from '@/engines/character-sheets/tableRulesOperations';
import { RULES, TABLE_SYSTEMS, rulesFor, changedRuleIds } from '@/engines/character-sheets/tableRules';
import DiceTray from '@/engines/dice/DiceTray';
import { BRIDGE_TOOLS } from '@/services/aiBridge/manifest';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { validateToolArgs } from '@/services/aiRuntime/toolPolicy';
import { duplicateProject, previewProjectDuplicate, undoProjectDuplicate } from '@/services/projectDuplicate/service';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import { useLocaleStore } from '@/stores/localeStore';
import type { Project } from '@/types';

const P = 'table-rules-test';
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean | Promise<boolean>, label: string, tries = 100) { for (let i = 0; i < tries; i++) { if (await check()) return; await act(async () => { await pause(50); }); } throw new Error(`Timed out: ${label}`); }
type Reply = { ok: boolean; code?: string; error?: string; result?: any };

export async function testTableRules(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es', loaded: true });
  const passed: string[] = [], host = document.getElementById('root')!;
  const root = createRoot(host);
  const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const need = (id: string) => { const node = q(id); assert(node, `Missing ${id}`); return node; };
  const stored = async () => (await db.projects.get(P))!.tableRules;
  const click = async (id: string) => { const node = need(id); await act(async () => { node.click(); await pause(120); }); };
  const choose = async (id: string, value: string) => {
    const node = need(id) as HTMLSelectElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('change', { bubbles: true })); await pause(150); });
  };
  const typeBlur = async (id: string, value: string) => {
    const node = need(id) as HTMLInputElement | HTMLTextAreaElement;
    await act(async () => { node.value = value; node.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); await pause(150); });
  };
  const tool = async (name: string, args: Record<string, unknown>): Promise<Reply> => {
    const manifest = BRIDGE_TOOLS.find(item => item.name === name); assert(manifest, `${name} is in the manifest`);
    const verdict = validateToolArgs(manifest.schema, args); assert(verdict.ok, `${name} args valid: ${JSON.stringify(verdict)}`);
    return await runBridgeTool(name, args) as Reply;
  };
  const mount = async (entry = '/') => { await act(async () => { root.render(<MemoryRouter initialEntries={[entry]}><CharacterSheetsEngine projectId={P} /></MemoryRouter>); await pause(300); }); };
  const unmount = async () => { await act(async () => { root.render(null); await pause(); }); };
  const project: Project = { id: P, title: 'Mesa de los jueves', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['character-sheets'], engineOrder: ['character-sheets'], createdAt: 1, updatedAt: 1 };
  const extra: string[] = [];
  try {
    await db.projects.put(project);

    // Definitions: every system has rules, every rule validates its own default.
    for (const system of TABLE_SYSTEMS) assert(rulesFor(system).length >= 3 && rulesFor(system).some(rule => rule.id === 'houseRules'), `${system} has a rule set`);
    assert(new Set(RULES.map(rule => rule.id)).size === RULES.length, 'rule ids are unique');
    assert(rulesFor('5e-2014').find(r => r.id === 'feats')!.fallback === true && (await readTableRules(P)).revision === 0, 'nothing stored yet reads as revision 0');

    // Opens from a deep link (the project settings button) on the new tab.
    await mount('/project/x/character-sheets?view=rules');
    await until(() => !!q('table-rules'), 'panel via deep link');
    assert(need('sheets-view-rules').getAttribute('aria-selected') === 'true', 'rules tab selected by the link');
    await click('sheets-view-sheets'); assert(!q('table-rules'), 'other tab hides the panel');
    await click('sheets-view-rules'); assert(!!q('table-rules'), 'tab opens the panel');
    assert((need('rules-summary').textContent ?? '').includes('Todo como en el reglamento'), 'starts with everything usual');
    passed.push('Tab "Reglas de la mesa" (sheets-view-rules) opens the panel, also from the ?view=rules link; with nothing stored it says everything is as written');

    // System and defaults per edition.
    assert((need('rules-system') as HTMLSelectElement).value === '5e-2024' && (need('rule-feats') as HTMLInputElement).checked && (need('rule-potionAction') as HTMLSelectElement).value === 'bonus', '2024 defaults: feats on, potion as bonus action');
    await choose('rules-system', '5e-2014');
    await until(() => (need('rule-feats') as HTMLInputElement).checked === false, '2014 feats default');
    assert((need('rule-potionAction') as HTMLSelectElement).value === 'action' && (await stored())!.system === '5e-2014' && (await stored())!.revision === 1, '2014 defaults: feats off, potion is an action; system stored at revision 1');
    const marker = { daggerheart: 'rule-fear', coc7: 'rule-era', free: 'rule-characterCreation' } as const;
    for (const system of ['daggerheart', 'coc7', 'free'] as const) { await choose('rules-system', system); await until(() => !!q(marker[system]), `${system} panel`); assert(!q('rule-hitPoints'), `${system} has no hit-point rule`); }
    await choose('rules-system', 'daggerheart'); await until(() => !!q('rule-fear'), 'Daggerheart panel');
    await choose('rules-system', '5e-2024'); await until(() => !!q('rule-hitPoints'), 'back to 5e');
    passed.push('System choice (5e 2024 / 5e 2014 / Daggerheart / Call of Cthulhu / free) swaps the rule set; per-edition defaults differ (feats, potion action)');

    // Change values and the changed marker.
    assert(!q('rule-changed-hitPoints'), 'no marker on a default');
    await choose('rule-hitPoints', 'rolled');
    await until(() => !!q('rule-changed-hitPoints'), 'changed marker');
    assert(need('rule-row-hitPoints').dataset.changed === 'true' && need('rule-row-restVariant').dataset.changed === 'false', 'row flags');
    await click('rule-flanking'); await choose('rule-restVariant', 'gritty'); await choose('rule-criticalDamage', 'max-plus-roll');
    await typeBlur('rule-startingLevel', '3'); await typeBlur('rule-houseRules', 'Los críticos dan un golpe extra narrado.');
    let now = (await stored())!;
    assert(now.values.hitPoints === 'rolled' && now.values.flanking === true && now.values.restVariant === 'gritty' && now.values.criticalDamage === 'max-plus-roll' && now.values.startingLevel === 3 && now.values.houseRules === 'Los críticos dan un golpe extra narrado.', 'values stored: ' + JSON.stringify(now.values));
    assert((need('rules-summary').textContent ?? '').includes('6 reglas cambiadas') && changedRuleIds(now).length === 6, 'summary counts six changes');
    await choose('rule-hitPoints', 'fixed');
    await until(() => !q('rule-changed-hitPoints'), 'back to default drops the marker');
    assert(!('hitPoints' in (await stored())!.values), 'only differences are stored');
    await typeBlur('rule-startingLevel', '99'); await until(() => !!q('rules-error'), 'range error');
    assert((await stored())!.values.startingLevel === 3, 'an out-of-range level is refused');
    passed.push('Changing six rules marks each "Cambiada" and counts them; setting a rule back to its default drops the mark and the stored value; a level of 99 is refused');

    // Reset one and reset all.
    await choose('rule-hitPoints', 'rolled');
    await click('rule-reset-flanking');
    await until(() => !q('rule-changed-flanking'), 'one reset');
    now = (await stored())!; assert(!('flanking' in now.values) && now.values.restVariant === 'gritty', 'reset one leaves the others');
    await click('rules-reset-all'); assert(!!q('rules-reset-all-confirm'), 'asks first'); await click('rules-reset-all-cancel');
    assert(Object.keys((await stored())!.values).length === 5, 'cancel keeps everything');
    await click('rules-reset-all'); await click('rules-reset-all-confirm');
    await until(() => !q('rules-reset-all'), 'reset all');
    assert(Object.keys((await stored())!.values).length === 0, 'reset all clears the values');
    passed.push('Restablecer on one rule leaves the rest; "Restablecer todas" asks first, cancel keeps everything, confirm puts every rule of the system back');

    // Rules of the other systems survive a system switch.
    await choose('rule-hitPoints', 'rolled'); await choose('rules-system', 'coc7'); await until(() => !q('rule-hitPoints'), 'coc7 panel');
    assert(!q('rule-hitPoints') && !q('rule-changed-hitPoints') && (await stored())!.values.hitPoints === 'rolled', 'hidden but kept');
    await choose('rules-system', '5e-2024'); await until(() => !!q('rule-changed-hitPoints'), 'comes back');
    passed.push('Switching to another system hides a 5e rule without losing it; switching back shows it still changed');

    // Notes for the evening.
    assert(!!q('rules-info-empty'), 'empty list');
    await click('rules-info-suggest-when'); await click('rules-info-suggest-where'); await click('rules-info-suggest-food'); await click('rules-info-add');
    await until(() => (stored() as Promise<any>).then(rules => rules.info.length === 4), 'four sections');
    await typeBlur('rules-info-text-0', 'Jueves, 20:30.'); await typeBlur('rules-info-text-1', 'En casa de Marta; llama al timbre B.'); await typeBlur('rules-info-title-3', 'Código de vestimenta');
    now = (await stored())!; assert(now.info.map(item => item.title).join('|') === 'Cuándo jugamos|Dónde jugamos|Comida y bebida|Código de vestimenta' && now.info[0].text === 'Jueves, 20:30.', 'titles and texts saved: ' + JSON.stringify(now.info));
    const ids = now.info.map(item => item.id);
    await click('rules-info-down-0'); await click('rules-info-up-3'); 
    now = (await stored())!; assert(now.info.map(item => item.id).join() === [ids[1], ids[0], ids[3], ids[2]].join(), 'reordered with the arrows');
    assert((need('rules-info-up-0') as HTMLButtonElement).disabled && (need('rules-info-down-3') as HTMLButtonElement).disabled, 'ends cannot move out');
    await click('rules-info-remove-2');
    now = (await stored())!; assert(now.info.length === 3 && !now.info.some(item => item.id === ids[3]), 'removed');
    assert(!q('rules-info-suggest-when') && !!q('rules-info-suggest-dress'), 'used suggestions disappear');
    passed.push('Notes: suggested starters (when / where / food) and a blank section are added, titles and texts edited, reordered with the arrows (ends are disabled) and removed');

    // Persistence across a reload.
    const revisionBefore = (await stored())!.revision;
    await unmount(); await mount('/?view=rules'); await until(() => !!q('table-rules'), 'remounted');
    assert(need('rule-hitPoints') && (need('rule-hitPoints') as HTMLSelectElement).value === 'rolled' && (need('rules-info-title-0') as HTMLInputElement).value === 'Dónde jugamos' && need('table-rules').dataset.revision === String(revisionBefore), 'panel after reload shows the same');
    passed.push('After unmounting and reopening the panel shows the same rules, notes and revision (stored with the project)');

    // Consumers: 5e sheet and dice tray.
    await unmount();
    const sheet = createSheet('5e-character'), noop = () => undefined;
    const renderSheet = async (rules: Project['tableRules']) => { await act(async () => { root.render(<FiveEPlayPanel sheet={sheet} locale="es" update={noop} confirm={noop} addRoll={noop} report={noop} tableRules={rules} />); await pause(200); }); };
    const pickClass = async () => { const select = host.querySelector<HTMLSelectElement>('select[aria-label="Previsualizar clase"]')!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'fighter'); select.dispatchEvent(new Event('change', { bubbles: true })); await pause(150); }); };
    const rolled = await stored();
    await renderSheet(rolled); await pickClass(); assert(!!q('five-e-preview') && !!q('five-e-hp-rolled-note'), 'rolled hit points: the sheet says its figure is the average');
    await unmount(); await renderSheet({ ...rolled!, values: {} }); await pickClass(); assert(!!q('five-e-preview') && !q('five-e-hp-rolled-note'), 'fixed hit points: no note');
    await unmount(); await renderSheet(undefined); await pickClass(); assert(!!q('five-e-preview') && !q('five-e-hp-rolled-note'), 'no rules stored: no note');
    await unmount();
    const diceNote = async (expectNote: boolean) => { await act(async () => { root.render(<DiceTray projectId={P} locale="es" />); await pause(600); }); assert(!!q('dice-tray'), 'dice tray rendered'); if (expectNote) await until(() => !!q('dice-own-note'), 'own-dice note', 40); const found = !!q('dice-own-note'); await unmount(); return found; };
    assert(!await diceNote(false), 'dice default: no note');
    await db.projects.update(P, { tableRules: { ...(await stored())!, values: { ...(await stored())!.values, dice: 'own' } } });
    assert(await diceNote(true), 'own dice: the tray says so');
    await db.projects.update(P, { tableRules: { ...(await stored())!, values: Object.fromEntries(Object.entries((await stored())!.values).filter(([key]) => key !== 'dice')) } });
    passed.push('Consumers: with hit points "Tirados" the 5e class preview says its figure is the fixed average (none with fixed or no rules); with own dice the dice tray says the table rolls its own');

    // Backup and clone: JSON clone, project duplicate, ZIP round trip.
    const original = (await stored())!;
    const cloneId = await importProjectData(await exportProjectData(P)); extra.push(cloneId);
    const jsonCopy = (await db.projects.get(cloneId))!.tableRules; assert(jsonCopy && JSON.stringify(jsonCopy.values) === JSON.stringify(original.values) && jsonCopy.info.map(item => item.text).join() === original.info.map(item => item.text).join() && jsonCopy.system === original.system, 'JSON export/import keeps the table rules');
    const preview = await previewProjectDuplicate({ projectId: P }), operationId = crypto.randomUUID();
    const duplicate = await duplicateProject({ projectId: P, title: 'Copia de la mesa', operationId, expectedSourceVersion: preview.sourceVersion }); extra.push(duplicate.projectId);
    const dup = (await db.projects.get(duplicate.projectId))!.tableRules; assert(dup && JSON.stringify(dup.values) === JSON.stringify(original.values) && dup.info.length === original.info.length, 'project duplicate keeps the table rules');
    await undoProjectDuplicate(operationId);
    const { blob } = await createProjectZipArchive(P); await deleteProject(P); assert(!await db.projects.get(P), 'project gone before restore');
    await importProjectZip(new File([blob], 'mesa.zip', { type: 'application/zip' }));
    const restored = (await db.projects.get(P))!.tableRules; assert(restored && JSON.stringify(restored.values) === JSON.stringify(original.values) && restored.info.map(item => item.title).join() === original.info.map(item => item.title).join() && restored.revision === original.revision, 'ZIP round trip keeps the table rules');
    passed.push('Backup and clone: JSON export/import, project duplicate and a ZIP round trip (project deleted, then restored) all keep system, changed rules, notes and revision');

    // Bridge.
    const got = await tool('wh_table_rules_get', { projectId: P }); assert(got.ok, 'get ' + JSON.stringify(got));
    const hp = got.result.rules.find((rule: any) => rule.id === 'hitPoints'); assert(got.result.system === '5e-2024' && hp.value === 'rolled' && hp.default === 'fixed' && hp.changed === true && got.result.changed.includes('hitPoints') && got.result.info.length === 3, 'get reports value, default, changed, notes');
    const revision = got.result.revision as number;
    const set = await tool('wh_table_rules_set', { projectId: P, expectedRevision: revision, values: { restVariant: 'heroic', hitPoints: null, flanking: true }, infoOps: [{ op: 'add', title: 'Vestimenta', text: 'Cómoda.', index: 0 }, { op: 'update', match: 'comida', text: 'Cada uno trae algo.' }, { op: 'move', match: 'dónde', to: 0 }, { op: 'remove', match: 'cuándo' }] });
    assert(set.ok, 'set ' + JSON.stringify(set));
    now = (await stored())!; assert(now.revision === revision + 1 && now.values.restVariant === 'heroic' && !('hitPoints' in now.values) && now.values.flanking === true && now.info.map(item => item.title).join('|') === 'Dónde jugamos|Vestimenta|Comida y bebida' && now.info[2].text === 'Cada uno trae algo.', 'set applied: ' + JSON.stringify(now));
    const undone = await undoAuditEntry({ entry: { ...set.result.__audit, tool: 'wh_table_rules_set', kind: 'update' } });
    assert(undone.undone, 'undo reports'); now = (await stored())!; assert(now.values.hitPoints === 'rolled' && !('restVariant' in now.values) && !('flanking' in now.values) && now.info.map(item => item.title).join('|') === 'Dónde jugamos|Cuándo jugamos|Comida y bebida' && now.info[2].text === '', 'undo restored the earlier rules: ' + JSON.stringify(now));
    const afterUndo = (await stored())!.revision;
    const stale = await tool('wh_table_rules_set', { projectId: P, expectedRevision: revision, values: { flanking: true } });
    assert(!stale.ok && stale.code === 'conflict' && (await stored())!.revision === afterUndo, 'stale expectedRevision refused, nothing written');
    const first = await tool('wh_table_rules_set', { projectId: P, system: 'daggerheart', values: { fear: 'hidden' } }); assert(first.ok && first.result.system === 'daggerheart' && first.result.rules.some((rule: any) => rule.id === 'fear' && rule.value === 'hidden'), 'system switch with a Daggerheart rule');
    const second = await tool('wh_table_rules_set', { projectId: P, values: { gold: 'coins' } }); assert(second.ok, 'second change');
    const refusedUndo = await undoAuditEntry({ entry: { ...first.result.__audit, tool: 'wh_table_rules_set', kind: 'update' } }).then(() => 'undone', (error: { code?: string }) => error.code ?? 'error');
    assert(refusedUndo === 'cannot-undo', 'undoing an older change over a newer one is refused: ' + refusedUndo);
    await undoAuditEntry({ entry: { ...second.result.__audit, tool: 'wh_table_rules_set', kind: 'update' } });
    await undoAuditEntry({ entry: { ...first.result.__audit, tool: 'wh_table_rules_set', kind: 'update' } });
    assert((await stored())!.system === '5e-2024', 'undone in order');
    const bad = await tool('wh_table_rules_set', { projectId: P, values: { hitPoints: 'sometimes' } }); assert(!bad.ok && bad.code === 'bad-args', 'a value the rule does not accept is refused');
    const foreign = await tool('wh_table_rules_set', { projectId: P, values: { fear: 'hidden' } }); assert(!foreign.ok && foreign.code === 'bad-args', 'a rule of another system is refused');
    const nothing = await tool('wh_table_rules_set', { projectId: P }); assert(!nothing.ok && nothing.code === 'bad-args', 'a call that changes nothing is refused');
    const missing = await tool('wh_table_rules_set', { projectId: P, infoOps: [{ op: 'remove', match: 'no existe' }] }); assert(!missing.ok && missing.code === 'not-found', 'a missing section is not-found');
    const same = await tool('wh_table_rules_set', { projectId: P, values: { hitPoints: 'rolled' } }); assert(same.ok && same.result.unchanged === true && !same.result.__audit, 'an identical write is a no-op without an audit line');
    const all = await tool('wh_table_rules_set', { projectId: P, resetAll: true }); assert(all.ok && all.result.changed.length === 0 && Object.keys((await stored())!.values).length === 0, 'resetAll clears');
    await updateProject(P, { enabledEngines: [] });
    const off = await runBridgeTool('wh_table_rules_set', { projectId: P }) as Reply; assert(!off.ok && off.code === 'engine-disabled', 'engine off refuses the write before anything else: ' + off.code);
    const offValues = await runBridgeTool('wh_table_rules_set', { projectId: P, values: { flanking: true } }) as Reply; assert(!offValues.ok && offValues.code === 'engine-disabled' && !('flanking' in (await stored())!.values), 'engine off writes nothing');
    const offRead = await tool('wh_table_rules_get', { projectId: P }); assert(offRead.ok, 'reading with the engine off still answers');
    await updateProject(P, { enabledEngines: ['character-sheets'] });
    passed.push('Bridge: wh_table_rules_get reads value/default/changed and the notes; wh_table_rules_set patches rules (null restores), edits notes (add, update, move, remove), switches system and resets all; undo restores, a stale revision is refused, undoing an older change over a newer one is refused, bad values/foreign rules/empty calls are refused, an identical write is a no-op, engine off refuses writes but not reads');
  } finally {
    await act(async () => { try { root.unmount(); } catch { /* gone */ } await pause(); });
    for (const id of [...extra, P]) { try { await deleteProject(id); } catch { /* already gone */ } }
  }
  return passed;
}
