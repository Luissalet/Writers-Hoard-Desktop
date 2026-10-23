// Workspace theme library: built-in style swatches, the accent hue slider, named saved themes
// (save, apply to Base or an era, rename, delete with confirmation, export/import as .json) and
// the four bridge tools with undo. Themes are app-wide: one `settings` row, carried by full backups.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import { db } from '@/db';
import { getSetting } from '@/db/operations';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { BRIDGE_TOOLS } from '@/services/aiBridge/manifest';
import { createFullZipArchive } from '@/services/zipBackup';
import WorkspaceAppearance from '@/services/workspaceAppearance/WorkspaceAppearance';
import { getWorkspaceAppearance, saveWorkspaceAppearance } from '@/services/workspaceAppearance/store';
import { THEME_LIBRARY_KEY, addTheme, deleteTheme, readThemeLibrary, themesFromJson } from '@/services/workspaceAppearance/themeLibrary';
import { THEME_PRESETS, accentWithHue, hexToHsl } from '@/services/workspaceAppearance/themePresets';
import { saveWorldEra } from '@/services/worldEras/store';
import { useLocaleStore } from '@/stores/localeStore';
import type { Project } from '@/types';

const P = 'synthetic-theme-library', ERA = 'synthetic-theme-era';
const fixture: Project = { id: P, title: 'Synthetic themes QA', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: [], engineOrder: [], createdAt: 1, updatedAt: 1 };
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const pause = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms));
const raster = () => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32; const context = canvas.getContext('2d')!; context.fillStyle = '#44606a'; context.fillRect(0, 0, 32, 32); context.fillStyle = '#c9b06b'; context.fillRect(16, 0, 16, 32); return canvas.toDataURL('image/png'); };
const refused = async (run: () => Promise<unknown>, label: string) => { let failed = false; try { await run(); } catch { failed = true; } assert(failed, `Expected refusal: ${label}`); };
type Audited = { result?: { __audit?: Record<string, unknown> } & Record<string, unknown>; ok: boolean; error?: string; code?: string };
const audit = (reply: Audited, tool: string) => ({ ...reply.result!.__audit!, tool });

export async function testWorkspaceThemes(): Promise<string[]> {
  const passed: string[] = [], host = document.getElementById('root')!;
  let root = createRoot(host);
  const originalCreate = URL.createObjectURL, originalClick = HTMLAnchorElement.prototype.click, exported: Blob[] = [];
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) { if (this.download) return; originalClick.call(this); };
  URL.createObjectURL = (blob: Blob | MediaSource) => { exported.push(blob as Blob); return 'blob:synthetic'; };
  const cleanup = async () => { await db.settings.where('key').equals(THEME_LIBRARY_KEY).delete(); await db.projects.delete(P); };
  const form = () => host.querySelector<HTMLDetailsElement>('[data-testid="workspace-appearance"]')!;
  const id = (value: string) => host.querySelector<HTMLElement>(`[data-testid="${value}"]`);
  const byLabel = (label: string) => form().querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)!;
  const button = (label: string) => [...form().querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent?.trim() === label)!;
  const click = async (element: Element | null, label: string, wait = 200) => { assert(element, label); await act(async () => { (element as HTMLElement).click(); await pause(wait); }); };
  const setValue = async (element: Element | null, value: string, event = 'input') => { assert(element, 'control'); await act(async () => { const control = element as HTMLInputElement | HTMLSelectElement; Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), 'value')!.set!.call(control, value); control.dispatchEvent(new Event(event, { bubbles: true })); await pause(); }); };
  const mount = async (eraId?: string) => {
    await act(async () => root.unmount()); root = createRoot(host);
    await act(async () => { root.render(<WorkspaceAppearance projectId={P} eraId={eraId} />); await pause(200); });
    await act(async () => { form().open = true; form().dispatchEvent(new Event('toggle')); await pause(); });
  };
  const rows = () => [...host.querySelectorAll<HTMLElement>('[data-testid^="theme-row-"]')];
  const names = () => rows().map(row => row.querySelector('[data-testid^="theme-name-"]')?.textContent?.replace('with picture', '').trim());
  const rowByName = (name: string) => { const found = rows().find(row => row.querySelector('[data-testid^="theme-name-"]')?.textContent?.startsWith(name)); assert(found, `No theme row "${name}" in: ${names().join()} / ${host.textContent?.slice(0, 300)}`); return found; };
  const inRow = (name: string, kind: string) => rowByName(name).querySelector<HTMLElement>(`[data-testid^="theme-${kind}-"]`);
  try {
    useLocaleStore.setState({ locale: 'en' }); await cleanup(); await db.projects.put(fixture);
    await saveWorldEra(P, { id: ERA, name: 'Synthetic era', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    await mount();

    // 1. Built-in style swatches.
    assert(THEME_PRESETS.length === 8 && host.querySelectorAll('[data-testid^="theme-preset-"]').length === 8, 'Expected eight preset swatches');
    for (const name of ['Parchment', 'Midnight', 'Forest', 'Ember', 'Ocean', 'Slate', 'Dusty rose', 'High contrast']) assert(form().querySelector(`[data-testid^="theme-preset-"][title="${name}"]`), `Missing preset ${name}`);
    await click(id('theme-preset-midnight'), 'midnight preset');
    assert(byLabel('Workspace background').value === '#0f1424' && byLabel('Workspace theme').value === 'dark', 'Preset did not fill the form');
    assert((await getWorkspaceAppearance({ projectId: P })).revision === 0, 'A preset must not save before the person saves');
    await click(button('Save appearance'), 'save preset', 300);
    const midnight = await getWorkspaceAppearance({ projectId: P });
    assert(midnight.own.background === '#0f1424' && midnight.own.accent === '#8aa4e6' && midnight.own.uiFont === 'incumbent' && midnight.revision === 1, `Preset not saved ${JSON.stringify(midnight.own)}`);
    await click(id('theme-preset-parchment'), 'parchment preset'); await click(button('Save appearance'), 'save parchment', 300);
    const parchment = await getWorkspaceAppearance({ projectId: P });
    assert(parchment.own.mode === 'light' && parchment.own.proseFont === 'classic' && parchment.revision === 2, 'Second preset did not replace the first look');
    passed.push('Eight named preset swatches fill the whole look into the draft and only the revision-checked Save writes it; a later preset replaces the earlier fonts');

    // 2. Hue slider.
    const before = byLabel('Workspace accent').value, beforeHue = hexToHsl(before)[0];
    await setValue(byLabel('Accent hue'), String((beforeHue + 150) % 360));
    const after = byLabel('Workspace accent').value, [hue, saturation] = hexToHsl(after), [, beforeSaturation] = hexToHsl(before);
    assert(after !== before && Math.abs(((hue - (beforeHue + 150) % 360) + 540) % 360 - 180) <= 3 && Math.abs(saturation - beforeSaturation) < .06, `Hue slider did not move the accent ${before} -> ${after}`);
    assert(accentWithHue('#808080', 200) !== '#808080' && hexToHsl(accentWithHue('#808080', 200))[0] >= 198 && hexToHsl(accentWithHue('#808080', 200))[0] <= 202, 'Grey accent gains the requested hue');
    await click(button('Save appearance'), 'save hue', 300);
    assert((await getWorkspaceAppearance({ projectId: P })).own.accent === after, 'Hue accent not saved');
    passed.push('Hue slider moves only the accent hue, keeps its saturation, and is saved through the normal Save');

    // 3. Save as theme (with an embedded picture), refusals.
    assert((id('theme-save') as HTMLButtonElement).disabled, 'Save-as-theme must wait for a name');
    await setValue(id('theme-name'), 'Night draft'); await click(id('theme-save'), 'save theme', 300);
    assert(names().join() === 'Night draft' && id('theme-status')?.textContent?.includes('Night draft'), 'Theme not listed');
    let library = await readThemeLibrary();
    assert(library.revision === 1 && library.themes[0].values.mode === 'light' && library.themes[0].values.accent === after && !library.themes[0].values.backgroundImage, 'Theme did not capture the current look');
    assert((await db.settings.where('key').equals(THEME_LIBRARY_KEY).count()) === 1, 'Library should be one settings row');
    await setValue(id('theme-name'), 'night DRAFT'); await click(id('theme-save'), 'save duplicate', 200);
    assert(id('theme-error')?.textContent?.includes('already exists') && names().length === 1, 'Duplicate name must be refused in plain words');
    await refused(() => addTheme({ name: '   ', values: {} }), 'blank name'); await refused(() => addTheme({ name: 'x'.repeat(61), values: {} }), 'long name');
    await refused(() => addTheme({ name: 'Bad picture', values: { backgroundImage: 'data:image/svg+xml;base64,PHN2Zz4=' } }), 'svg picture');
    await refused(() => addTheme({ name: 'Bad accent', values: { accent: 'red' } as never }), 'bad accent');
    const picture = raster();
    await addTheme({ name: 'With picture', values: { mode: 'dark', background: '#10202a', accent: '#c9b06b', backgroundImage: picture, grain: 30 } });
    await act(async () => { await pause(300); });
    assert(names().join() === 'Night draft,With picture', `List did not follow the library: ${names().join()}`);
    passed.push('Save as theme stores the effective look under a unique name in one app-wide settings row; blank, long, duplicate, bad-colour and non-raster pictures are refused');

    // 4. Apply to Base and to an era (through the revision-checked save).
    await saveWorkspaceAppearance({ projectId: P }, { mode: 'dark', background: '#222222', grain: 80 }, 3);
    await act(async () => { await pause(300); });
    await click(button('Reload saved values'), 'reload');
    await click(inRow('With picture', 'apply'), 'apply to base', 400);
    const applied = await getWorkspaceAppearance({ projectId: P });
    assert(applied.revision === 5 && applied.own.background === '#10202a' && applied.own.backgroundImage === picture && applied.own.grain === 30 && !('uiFont' in applied.own) && !('proseFont' in applied.own), `Apply to Base should replace the look ${JSON.stringify({ ...applied.own, backgroundImage: '…' })}`);
    assert(byLabel('Workspace background').value === '#10202a' && form().querySelector('img'), 'Form did not follow the applied theme');
    await saveWorkspaceAppearance({ projectId: P }, { grain: 5 }, 5);
    await click(inRow('Night draft', 'apply'), 'stale apply', 300);
    assert(form().querySelector('[role="alert"]') && (await getWorkspaceAppearance({ projectId: P })).own.grain === 5, 'A stale draft must not overwrite a newer appearance');
    await mount(ERA);
    assert(host.querySelectorAll('[data-testid^="theme-apply-base-"]').length === 2, 'Era form offers Apply to Base as well');
    await click(inRow('Night draft', 'apply'), 'apply to era', 400);
    const era = await getWorkspaceAppearance({ projectId: P, eraId: ERA }), base = await getWorkspaceAppearance({ projectId: P });
    assert(era.revision === 1 && era.own.accent === after && era.own.mode === 'light' && base.own.grain === 5 && base.own.background === '#10202a', 'Era apply changed Base or lost values');
    const baseRevision = base.revision;
    await click(host.querySelector(`[data-testid="theme-apply-base-${rowByName('Night draft').dataset.testid!.slice('theme-row-'.length)}"]`), 'apply to base from era', 500);
    const rebased = await getWorkspaceAppearance({ projectId: P });
    assert(rebased.revision === baseRevision + 1 && rebased.own.mode === 'light' && !rebased.own.backgroundImage, 'Apply to Base from an era did not go through the Base revision');
    assert(byLabel('Workspace theme').value === 'light', 'Era form did not reload');
    passed.push('Apply replaces the Base or era look through saveWorkspaceAppearance (revision +1, no leftover fields), a stale draft is refused, and applying to Base from an era leaves the era untouched');

    // 5. Rename and delete with confirmation.
    await mount();
    const pictureThemeId = rowByName('With picture').dataset.testid!.slice(10);
    await click(inRow('With picture', 'rename'), 'rename');
    await setValue(id(`theme-rename-input-${pictureThemeId}`), 'night draft'); await click(host.querySelector('[data-testid^="theme-rename-ok-"]'), 'rename taken');
    assert(id('theme-error')?.textContent?.includes('already exists'), 'Rename to a taken name must be refused');
    await setValue(host.querySelector('[data-testid^="theme-rename-input-"]'), '  Deep   sea '); await click(host.querySelector('[data-testid^="theme-rename-ok-"]'), 'rename ok');
    assert(names().join() === 'Night draft,Deep sea', `Rename failed: ${names().join()}`);
    const seaId = (await readThemeLibrary()).themes[1].id;
    await click(inRow('Deep sea', 'delete'), 'delete asks');
    assert(host.querySelector('[role="group"][aria-label="Confirm deletion"]')?.textContent?.includes('Delete “Deep sea”?') && names().length === 2, 'Delete must ask first');
    await click(id(`theme-delete-cancel-${seaId}`), 'cancel delete'); assert(names().length === 2 && !host.querySelector('[role="group"][aria-label="Confirm deletion"]'), 'Cancel kept the theme');
    await click(inRow('Deep sea', 'delete'), 'delete again'); await click(id(`theme-delete-confirm-${seaId}`), 'confirm delete');
    assert(names().join() === 'Night draft' && (await readThemeLibrary()).themes.length === 1, 'Delete not applied');
    passed.push('Rename (trimmed, unique) and delete (asks first, cancel keeps) work from the list and update the stored library');

    // 6. Export and import round trip, bad files.
    await addTheme({ name: 'Picture trip', values: { mode: 'light', background: '#eee8dc', accent: '#7a4b1a', backgroundImage: picture } });
    await act(async () => { await pause(300); });
    exported.length = 0; await click(inRow('Picture trip', 'export'), 'export', 400);
    assert(exported.length === 1, 'Export did not download a file');
    const text = await exported[0].text(), file = JSON.parse(text);
    assert(file.kind === 'writer-workspace-themes' && file.version === 1 && file.themes.length === 1 && file.themes[0].name === 'Picture trip' && file.themes[0].values.backgroundImage === picture, 'Export file shape');
    exported.length = 0; await click(id('theme-export-all'), 'export all', 400);
    assert(JSON.parse(await exported[0].text()).themes.length === 2, 'Export all should carry every theme');
    const upload = async (content: string, name = 'themes.json') => act(async () => { const transfer = new DataTransfer(); transfer.items.add(new File([content], name, { type: 'application/json' })); const input = id('theme-import') as HTMLInputElement; input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); await pause(400); });
    const pictureId = (await readThemeLibrary()).themes.find(theme => theme.name === 'Picture trip')!.id;
    await deleteTheme(pictureId); await act(async () => { await pause(300); }); assert(!names().includes('Picture trip'), 'Setup: theme deleted');
    await upload(text);
    const back = (await readThemeLibrary()).themes.find(theme => theme.name === 'Picture trip');
    assert(back && back.id !== pictureId && back.values.backgroundImage === picture && back.values.accent === '#7a4b1a' && id('theme-status')?.textContent?.includes('1 theme imported'), 'Import lost the theme or its picture');
    await upload(text); assert(names().includes('Picture trip (2)'), `Import must never overwrite: ${names().join()}`);
    const count = (await readThemeLibrary()).themes.length;
    const validValues = { mode: 'dark' };
    const bad: [string, string][] = [
      ['not json', '{ nope'], ['wrong kind', JSON.stringify({ kind: 'something-else', version: 1, themes: [{ name: 'x', values: validValues }] })],
      ['wrong version', JSON.stringify({ kind: 'writer-workspace-themes', version: 2, themes: [{ name: 'x', values: validValues }] })],
      ['empty', JSON.stringify({ kind: 'writer-workspace-themes', version: 1, themes: [] })],
      ['bad colour', JSON.stringify({ kind: 'writer-workspace-themes', version: 1, themes: [{ name: 'x', values: { accent: 'red' } }] })],
      ['unknown field', JSON.stringify({ kind: 'writer-workspace-themes', version: 1, themes: [{ name: 'x', values: { script: '<b>' } }] })],
      ['extra theme field', JSON.stringify({ kind: 'writer-workspace-themes', version: 1, themes: [{ name: 'x', values: validValues, extra: 1 }] })],
      ['blank name', JSON.stringify({ kind: 'writer-workspace-themes', version: 1, themes: [{ name: ' ', values: validValues }] })],
      ['svg picture', JSON.stringify({ kind: 'writer-workspace-themes', version: 1, themes: [{ name: 'x', values: { backgroundImage: 'data:image/svg+xml;base64,PHN2Zz4=' } }] })],
      ['fake png', JSON.stringify({ kind: 'writer-workspace-themes', version: 1, themes: [{ name: 'x', values: { backgroundImage: 'data:image/png;base64,AAAA' } }] })],
      ['one good one bad', JSON.stringify({ kind: 'writer-workspace-themes', version: 1, themes: [{ name: 'good', values: validValues }, { name: 'bad', values: { grain: 500 } }] })],
    ];
    for (const [label, content] of bad) {
      await upload(content);
      assert(id('theme-error')?.textContent?.includes('not a valid theme') && (await readThemeLibrary()).themes.length === count, `Bad file accepted or silent: ${label}`);
      await refused(() => themesFromJson(content), label);
    }
    assert(!names().includes('good'), 'A file with one bad theme must import nothing');
    passed.push('Export writes a versioned .json (single or all), import restores it with the embedded picture and never overwrites a name, and eleven kinds of bad file are refused with a plain message leaving the library untouched');

    // 7. Bridge tools.
    for (const name of ['wh_workspace_theme_list', 'wh_workspace_theme_save', 'wh_workspace_theme_apply', 'wh_workspace_theme_delete']) assert(BRIDGE_TOOLS.some(tool => tool.name === name && tool.writes === (name !== 'wh_workspace_theme_list')), `Manifest: ${name}`);
    const list = await runBridgeTool('wh_workspace_theme_list', {}) as Audited & { result: { revision: number; themes: { id: string; name: string; values: Record<string, unknown> }[]; presets: unknown[] } };
    assert(list.ok && list.result.presets.length === 8 && list.result.themes.length === count && list.result.themes.every(theme => !('backgroundImage' in theme.values)) && list.result.themes.some(theme => theme.values.hasBackgroundImage === true), 'List shape');
    let revision = list.result.revision;
    const saved = await runBridgeTool('wh_workspace_theme_save', { name: 'Bridge ember', values: { mode: 'dark', background: '#221412', accent: '#ee8a4f' }, expectedRevision: revision }) as Audited & { result: { revision: number; theme: { id: string } } };
    assert(saved.ok && saved.result.revision === revision + 1, JSON.stringify(saved));
    const emberId = saved.result.theme.id;
    assert(!(await runBridgeTool('wh_workspace_theme_save', { name: 'bridge EMBER', values: {} })).ok, 'Duplicate name must be refused');
    assert(!(await runBridgeTool('wh_workspace_theme_save', { name: 'Stale', values: {}, expectedRevision: revision })).ok, 'Stale library revision must be refused');
    assert(!(await runBridgeTool('wh_workspace_theme_save', { name: 'Bad', values: { accent: 'nope' } })).ok && !(await runBridgeTool('wh_workspace_theme_save', { name: 'Bad pic', values: { backgroundImage: 'data:image/png;base64,AAAA' } })).ok, 'Bad values must be refused');
    const fromScope = await runBridgeTool('wh_workspace_theme_save', { name: 'From Base', projectId: P }) as Audited & { result: { theme: { values: Record<string, unknown> } } };
    assert(fromScope.ok && fromScope.result.theme.values.mode === 'light', 'Save without values captures the effective look of the scope');
    // Undo of a save removes it; refused when the library changed after.
    await undoAuditEntry({ entry: audit(saved, 'wh_workspace_theme_save') }).then(() => assert(false, 'Undo must refuse: library changed after the save'), () => undefined);
    await undoAuditEntry({ entry: audit(fromScope, 'wh_workspace_theme_save') });
    assert(!(await readThemeLibrary()).themes.some(theme => theme.name === 'From Base') && (await readThemeLibrary()).themes.some(theme => theme.id === emberId), 'Undo of the latest save');
    // Apply: stale refused, good applied, undoable, refused when changed after.
    const current = await getWorkspaceAppearance({ projectId: P, eraId: ERA });
    assert(!(await runBridgeTool('wh_workspace_theme_apply', { themeId: emberId, projectId: P, eraId: ERA, expectedRevision: current.revision + 3 })).ok, 'Stale appearance revision must be refused');
    assert(!(await runBridgeTool('wh_workspace_theme_apply', { themeId: 'nope', projectId: P, expectedRevision: 0 })).ok && !(await runBridgeTool('wh_workspace_theme_apply', { themeId: emberId, projectId: P, eraId: 'missing', expectedRevision: 0 })).ok, 'Unknown theme or era');
    const apply = await runBridgeTool('wh_workspace_theme_apply', { themeId: emberId, projectId: P, eraId: ERA, expectedRevision: current.revision }) as Audited;
    const ember = await getWorkspaceAppearance({ projectId: P, eraId: ERA });
    assert(apply.ok && ember.own.background === '#221412' && ember.revision === current.revision + 1 && JSON.stringify(ember.own) === JSON.stringify({ mode: 'dark', background: '#221412', accent: '#ee8a4f' }), 'Bridge apply to an era');
    await undoAuditEntry({ entry: audit(apply, 'wh_workspace_theme_apply') });
    const undone = await getWorkspaceAppearance({ projectId: P, eraId: ERA });
    assert(JSON.stringify(undone.own) === JSON.stringify(current.own) && undone.revision === current.revision + 2, 'Undo of apply restores the previous own look');
    const baseBefore = await getWorkspaceAppearance({ projectId: P });
    const applyBase = await runBridgeTool('wh_workspace_theme_apply', { themeId: emberId, projectId: P, expectedRevision: baseBefore.revision }) as Audited;
    assert(applyBase.ok && (await getWorkspaceAppearance({ projectId: P })).own.accent === '#ee8a4f', 'Bridge apply to Base');
    await saveWorkspaceAppearance({ projectId: P }, { grain: 9 }, baseBefore.revision + 1);
    await refused(() => undoAuditEntry({ entry: audit(applyBase, 'wh_workspace_theme_apply') }), 'undo apply after a later save');
    assert((await getWorkspaceAppearance({ projectId: P })).own.grain === 9, 'Refused undo must keep the newer appearance');
    // Delete: stale refused, good deleted, undo restores, refused when changed after.
    library = await readThemeLibrary();
    assert(!(await runBridgeTool('wh_workspace_theme_delete', { themeId: emberId, expectedRevision: library.revision - 1 })).ok && (await readThemeLibrary()).themes.some(theme => theme.id === emberId), 'Stale delete');
    const removed = await runBridgeTool('wh_workspace_theme_delete', { themeId: emberId, expectedRevision: library.revision }) as Audited;
    assert(removed.ok && !(await readThemeLibrary()).themes.some(theme => theme.id === emberId), 'Bridge delete');
    await undoAuditEntry({ entry: audit(removed, 'wh_workspace_theme_delete') });
    const restored = (await readThemeLibrary()).themes.find(theme => theme.id === emberId);
    assert(restored && restored.name === 'Bridge ember' && restored.values.accent === '#ee8a4f', 'Undo of delete brings the theme back as it was');
    library = await readThemeLibrary();
    const removed2 = await runBridgeTool('wh_workspace_theme_delete', { themeId: emberId, expectedRevision: library.revision }) as Audited;
    await addTheme({ name: 'Later work', values: {} });
    await refused(() => undoAuditEntry({ entry: audit(removed2, 'wh_workspace_theme_delete') }), 'undo delete after a later change');
    assert((await readThemeLibrary()).themes.some(theme => theme.name === 'Later work') && !(await readThemeLibrary()).themes.some(theme => theme.id === emberId), 'Refused undo keeps later work');
    passed.push('Bridge: list (no picture bytes, eight presets), save (explicit values or a scope\'s effective look; duplicates, stale revisions and bad values refused), apply to Base/era with stale/unknown refusals, delete; every write undoes exactly and refuses when changed since');

    // 8. Robustness and backups.
    await db.settings.where('key').equals(THEME_LIBRARY_KEY).modify({ value: '{ damaged' });
    assert((await readThemeLibrary()).themes.length === 0 && (await runBridgeTool('wh_workspace_theme_list', {})).ok, 'A damaged library row must read as empty');
    await db.settings.where('key').equals(THEME_LIBRARY_KEY).modify({ value: JSON.stringify({ revision: 4, themes: [{ id: 'ok', name: 'Fine', values: { mode: 'dark' }, createdAt: 1, updatedAt: 1 }, { id: 'bad', name: 'Broken', values: { accent: 'x' } }, 7] }) });
    assert((await readThemeLibrary()).themes.map(theme => theme.name).join() === 'Fine', 'Damaged entries are skipped, good ones kept');
    await addTheme({ name: 'Backed up', values: { mode: 'light', accent: '#725221' } });
    const archive = await createFullZipArchive(), zip = await JSZip.loadAsync(archive.blob), settings = JSON.parse(await zip.file('settings.json')!.async('string')) as { key: string; value: string }[];
    assert(settings.some(row => row.key === THEME_LIBRARY_KEY && row.value.includes('Backed up')), 'The full backup must carry the theme library');
    assert((await getSetting(THEME_LIBRARY_KEY))?.includes('Backed up'), 'Library readable through getSetting');
    passed.push('A damaged library row reads as empty, damaged entries are skipped, and the full-database backup carries the library (themes are device-level, not part of a single-project export)');
    return passed;
  } finally {
    URL.createObjectURL = originalCreate; HTMLAnchorElement.prototype.click = originalClick;
    await act(async () => root.unmount()); await cleanup(); localStorage.clear();
  }
}
