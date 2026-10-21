import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Palette } from 'lucide-react';
import { MemoryRouter } from 'react-router-dom';
import JSZip from 'jszip';
import { db } from '@/db';
import { exportProjectData, importProjectData } from '@/db/operations';
import type { Project } from '@/types';
import ProjectWorkspace from '@/components/project/workspace/ProjectWorkspace';
import { useLocaleStore } from '@/stores/localeStore';
import { getWorkspaceAppearance, saveWorkspaceAppearance, resetWorkspaceAppearance } from '@/services/workspaceAppearance/store';
import { workspaceAppearanceStyle, appearanceContrast } from '@/services/workspaceAppearance/style';
import { saveWorldEra } from '@/services/worldEras/store';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { WORKSPACE_APPEARANCE_TOOLS } from '@/services/workspaceAppearance/bridgeManifest';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import { validateRaster } from '@/services/workspaceAppearance/validation';
import type { EngineDefinition } from '@/engines/_types';
const P = 'synthetic-workspace-appearance';
const base = { projectId: P }, eraScope = { projectId: P, eraId: 'synthetic-era' };
const fixture: Project = { id: P, title: 'Synthetic appearance QA', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: [], engineOrder: [], createdAt: 1, updatedAt: 1 };
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const pause = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms));
const reject = async (run: () => Promise<unknown>) => { let rejected = false; try { await run(); } catch { rejected = true; } assert(rejected, 'Expected rejected stale/invalid change'); };
const raster = () => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64; const context = canvas.getContext('2d')!; context.fillStyle = '#626f73'; context.fillRect(0, 0, 64, 64); context.fillStyle = '#aa985f'; context.fillRect(32, 0, 32, 64); return canvas.toDataURL('image/png'); };
export async function testWorkspaceAppearance(): Promise<string[]> {
  const passed: string[] = []; let clone: string | undefined;
  try {
    await db.projects.put(fixture); await saveWorldEra(P, { id: eraScope.eraId, name: 'Synthetic era', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    assert((await getWorkspaceAppearance(base)).revision === 0 && Object.keys(workspaceAppearanceStyle({})).join() === '--workspace-grain-opacity', 'Default appearance replaced incumbent tokens');
    await saveWorkspaceAppearance(base, { mode: 'light', background: '#F3EFE6', accent: '#725221', backgroundImage: raster(), grain: 35, uiFont: 'system', proseFont: 'serif' }, 0);
    await db.projects.update(P, { description: 'Concurrent metadata', wikiOptions: { title: 'Preserved' } as Project['wikiOptions'] });
    await saveWorkspaceAppearance(base, { performance: true }, 1);
    const results = await Promise.allSettled([saveWorkspaceAppearance(base, { grain: 45 }, 2), saveWorkspaceAppearance(base, { grain: 55 }, 2)]);
    assert(results.filter(result => result.status === 'fulfilled').length === 1 && (await db.projects.get(P))?.description === 'Concurrent metadata', 'CAS or field merge lost concurrent metadata');
    await reject(() => saveWorkspaceAppearance(base, { grain: 1000 }, 3)); await reject(() => saveWorkspaceAppearance({ projectId: P, eraId: 'missing' }, {}, 0));
    await reject(async () => validateRaster('data:image/svg+xml;base64,PHN2Zz4='));
    passed.push('Default token identity, normalization, own revision CAS, concurrent writer winner, metadata merge and invalid raster/scope preservation');
    let era = (await db.projects.get(P))!.worldEras![0]; const draft = structuredClone(era);
    await saveWorkspaceAppearance(eraScope, { mode: 'dark', background: '#17191a', accent: '#d5b575', backgroundImage: null, performance: false }, 0);
    await reject(() => saveWorldEra(P, draft, draft.revision));
    era = (await db.projects.get(P))!.worldEras![0];
    await saveWorldEra(P, { ...era, workspaceAppearance: undefined, name: 'Renamed era' }, era.revision);
    assert((await getWorkspaceAppearance(eraScope)).own.mode === 'dark' && (await getWorkspaceAppearance(base)).effective.mode === 'light', 'Era rename lost profile or era changed Base');
    const json = await exportProjectData(P); clone = await importProjectData(JSON.parse(JSON.stringify(json)));
    const cloned = (await db.projects.get(clone))!;
    assert(cloned.workspaceAppearance?.values.backgroundImage === raster() && cloned.worldEras?.[0].workspaceAppearance?.values.mode === 'dark', 'Normal JSON clone lost embedded image/era profile');
    const archive = await createProjectZipArchive(P), file = new File([archive.blob], archive.fileName, { type: 'application/zip' }), reopened = await JSZip.loadAsync(archive.blob);
    const metadataFile = Object.values(reopened.files).find(entry => entry.name.endsWith('/project.json'))!;
    const portable = JSON.parse(await metadataFile.async('string')); assert(portable.workspaceAppearance.values.backgroundImage === raster() && portable.worldEras[0].workspaceAppearance.revision === 1, 'Native ZIP export lost appearance');
    await db.projects.delete(P); await importProjectZip(file);
    assert((await db.projects.get(P))?.workspaceAppearance?.values.backgroundImage === raster() && (await getWorkspaceAppearance(eraScope)).own.mode === 'dark', 'Native ZIP restore lost appearance');
    await resetWorkspaceAppearance(eraScope, 1); assert((await getWorkspaceAppearance(eraScope)).inherited && (await getWorkspaceAppearance(eraScope)).effective.mode === 'light', 'Reset did not reinherit Base');
    await reject(() => saveWorkspaceAppearance(eraScope, { mode: 'dark' }, 1));
    passed.push('Independent era/Base inheritance, era metadata CAS, rename preservation, ordinary project JSON clone and ZIP byte roundtrip with embedded raster, reset rejects stale resurrection');
    for (const tool of WORKSPACE_APPEARANCE_TOOLS) assert(tool.name.startsWith('wh_workspace_appearance_'), 'Manifest mismatch');
    const get = await runBridgeTool('wh_workspace_appearance_get', eraScope); assert(get.ok && (get.result as { revision: number }).revision === 2, JSON.stringify(get));
    const save = await runBridgeTool('wh_workspace_appearance_save', { ...eraScope, expectedRevision: 2, patch: { uiFont: 'mono', grain: 20 } }); assert(save.ok, JSON.stringify(save));
    const reset = await runBridgeTool('wh_workspace_appearance_reset', { ...eraScope, expectedRevision: 3 }); assert(reset.ok, JSON.stringify(reset));
    const absent = await runBridgeTool('wh_workspace_appearance_get', { ...eraScope, eraId: 'absent' }); assert(!absent.ok, 'Dispatch accepted absent era');
    passed.push('Registered MCP dispatch get/save/reset uses same store and explicit scope; absent era rejected');
    for (const background of ['#000000', '#ffffff', '#f3efe6', '#17191a', '#777777', '#999999', '#cc3366', '#006677', '#c4dc31']) {
      const style = workspaceAppearanceStyle({ background, accent: background }) as Record<string, string>;
      for (const ink of ['--color-text-primary', '--color-text-muted', '--color-text-secondary', '--color-text-dim', '--color-accent-gold', '--color-accent-amber', '--color-success', '--color-warning', '--color-danger']) for (const surface of ['--color-deep', '--color-surface', '--color-elevated']) assert(appearanceContrast(style[ink], style[surface]) >= 4.5, `Contrast ${ink}/${surface} ${background}`);
    }
    passed.push('Derived primary, secondary, dim and accent text meet 4.5:1 on all three surfaces across nine neutral/saturated backgrounds');
    return passed;
  } finally { await db.projects.delete(P); if (clone) await db.projects.delete(clone); }
}
const globals = window as unknown as { __want: { w: number; h: number; n: number } | null; __sizeAck: number; __shot: { name: string } | null; __shotDone: string };
async function size(w: number, h: number) { globals.__want = { w, h, n: w + h }; for (let i = 0; i < 100 && globals.__sizeAck !== w + h; i++) await pause(30); }
async function shot(name: string) { globals.__shot = { name }; for (let i = 0; i < 100 && globals.__shotDone !== name; i++) await pause(30); }
export async function testWorkspaceAppearanceUi(): Promise<string[]> {
  const root = createRoot(document.getElementById('root')!); const node = () => document.querySelector<HTMLElement>('[data-testid="workspace-primary"]')!;
  const details = () => node().querySelector<HTMLDetailsElement>('[data-testid="workspace-appearance"]')!;
  const button = (label: string) => [...details().querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent?.trim() === label)!;
  const choose = (label: string, value: string) => { const select = details().querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value); select.dispatchEvent(new Event('change', { bubbles: true })); };
  try {
    useLocaleStore.setState({ locale: 'en' }); await db.projects.put(fixture);
    await saveWorldEra(P, { id: eraScope.eraId, name: 'Synthetic era', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    await size(1440, 1000);
    await act(async () => { root.render(<MemoryRouter initialEntries={[`/project/${P}/overview`]}><ProjectWorkspace projectId={P} engines={[]}><section className="space-y-4"><h1 className="font-serif text-xl text-accent-gold">Synthetic chapter · appearance QA</h1><p className="max-w-prose text-text-muted">A synthetic scene for checking the working canvas. The project keeps its documents and reading preferences independent.</p><div className="tiptap-editor rounded-lg border border-border bg-surface"><div className="ProseMirror" contentEditable suppressContentEditableWarning>A short synthetic manuscript paragraph, with an independent reading font.</div></div><div className="tiptap-editor"><div className="ProseMirror" data-testid="reader-prose">Reader sample keeps its reading preference.</div></div><button className="min-h-9 rounded-lg border border-border bg-elevated px-3 text-text-primary" data-testid="sample-focus">Open document</button><div data-testid="sample-blur" className="bg-surface/50 backdrop-blur-sm">Synthetic translucent surface</div></section></ProjectWorkspace></MemoryRouter>); await pause(200); });
    await act(async () => { details().open = true; details().dispatchEvent(new Event('toggle')); await pause(); });
    assert(details().querySelector('fieldset'), 'Appearance did not open in normal workspace');
    await act(async () => { choose('Workspace theme', 'light'); choose('Interface font', 'system'); choose('Editor prose font', 'mono'); await pause(); });
    await act(async () => { button('Save appearance').click(); await pause(250); });
    assert(getComputedStyle(node()).color === 'rgb(25, 27, 27)' && getComputedStyle(node().querySelector('[contenteditable]')!).fontFamily.includes('monospace') && !getComputedStyle(node().querySelector('[data-testid="reader-prose"]')!).fontFamily.includes('Consolas'), 'Light palette/editor font/Reader isolation failed');
    const focus = details().querySelector<HTMLSelectElement>('[aria-label="Workspace theme"]')!; focus.focus(); assert(document.activeElement === focus, 'Control focus failed');
    await shot('appearance-light-1440'); await size(640, 1000); assert(document.documentElement.scrollWidth <= innerWidth + 1, 'Light narrow overflow'); await shot('appearance-light-640');
    // The same normal form must preserve its stale draft and recover explicitly.
    await act(async () => { choose('Interface font', 'humanist'); await pause(); });
    await act(async () => { await saveWorkspaceAppearance(base, { grain: 10 }, 1); await pause(120); });
    await act(async () => { button('Save appearance').click(); await pause(200); });
    assert(details().querySelector('[role="alert"]') && details().querySelector<HTMLSelectElement>('[aria-label="Interface font"]')?.value === 'humanist', 'Conflicting save lost UI draft');
    await act(async () => { button('Reload saved values').click(); await pause(); choose('Workspace theme', 'dark'); await pause(); });
    await act(async () => { button('Save appearance').click(); await pause(200); });
    await act(async () => {
      const transfer = new DataTransfer(); transfer.items.add(new File([Uint8Array.from(atob(raster().split(',')[1]), character => character.charCodeAt(0))], 'synthetic-background.png', { type: 'image/png' }));
      const input = details().querySelector<HTMLInputElement>('input[type="file"]')!; input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); await pause(200);
    });
    await act(async () => { button('Save appearance').click(); await pause(200); });
    await shot('appearance-dark-image-640'); await size(1440, 1000); await shot('appearance-dark-image-1440');
    const remove = button('Remove image'); assert(!remove.disabled && details().querySelector('img'), 'Embedded raster not available in normal form');
    await act(async () => { details().querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); await pause(); button('Save appearance').click(); await pause(200); });
    assert(node().hasAttribute('data-workspace-performance') && getComputedStyle(node().querySelector('[data-testid="sample-blur"]')!).backdropFilter === 'none' && getComputedStyle(node().querySelector('.workspace-decoration')!).display === 'none', 'Performance did not remove blur/decoration');
    await shot('appearance-performance-1440'); await size(640, 1000); assert(document.documentElement.scrollWidth <= innerWidth + 1, 'Performance narrow overflow'); await shot('appearance-performance-640');
    await act(async () => { remove.click(); await pause(); button('Save appearance').click(); await pause(200); });
    assert((await getWorkspaceAppearance(base)).own.backgroundImage === null, 'Remove image not saved');
    await act(async () => { button('Restore original').click(); await pause(200); });
    assert(!(await getWorkspaceAppearance(base)).effective.uiFont, 'Restore original did not clear own choices');
    return ['Normal workspace Appearance form saves light/theme/fonts, isolates Reader font, preserves CAS conflict draft, reloads explicitly, displays/removes local raster, disables blur/translucency/texture in performance, restores original; six actual CSS desktop/narrow captures'];
  } finally { await act(async () => root.unmount()); await db.projects.delete(P); localStorage.clear(); }
}
export async function testWorkspaceAppearanceScopeUi(): Promise<string[]> {
  const root = createRoot(document.getElementById('root')!);
  const engine: EngineDefinition = { id: 'codex', name: 'Synthetic pane', description: 'Synthetic scope test', icon: Palette, category: 'core', tables: {}, component: () => <p>Synthetic companion document</p> };
  const primary = () => document.querySelector<HTMLElement>('[data-testid="workspace-primary"]')!;
  const companion = () => document.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
  const form = (pane: HTMLElement) => pane.querySelector<HTMLDetailsElement>('[data-testid="workspace-appearance"]')!;
  const choose = (pane: HTMLElement, label: string, value: string) => { const select = pane.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value); select.dispatchEvent(new Event('change', { bubbles: true })); };
  const click = (pane: HTMLElement, label: string) => [...pane.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === label)!.click();
  try {
    useLocaleStore.setState({ locale: 'en' }); await db.projects.put(fixture);
    await saveWorldEra(P, { id: eraScope.eraId, name: 'Synthetic era', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    await act(async () => { root.render(<MemoryRouter initialEntries={[`/project/${P}/codex`]}><ProjectWorkspace projectId={P} engines={[engine]}><p>Synthetic primary document</p></ProjectWorkspace></MemoryRouter>); await pause(200); });
    await act(async () => { form(primary()).open = true; form(primary()).dispatchEvent(new Event('toggle')); await pause(); choose(primary(), 'Workspace theme', 'light'); await pause(); });
    await act(async () => { click(form(primary()), 'Save appearance'); await pause(200); document.querySelector<HTMLButtonElement>('[data-testid="workspace-open"]')!.click(); await pause(250); });
    await act(async () => { choose(companion(), 'Era in this pane', eraScope.eraId); await pause(200); });
    await act(async () => { form(companion()).open = true; form(companion()).dispatchEvent(new Event('toggle')); await pause(); choose(companion(), 'Workspace theme', 'dark'); await pause(); });
    await act(async () => { click(form(companion()), 'Save appearance'); await pause(200); choose(primary(), 'Interface font', 'humanist'); await pause(); });
    assert(primary().style.getPropertyValue('--color-deep') === '#f3efe6' && companion().style.getPropertyValue('--color-deep') === '#17191a', `Normal companion did not keep era style independent ${primary().style.cssText} / ${companion().style.cssText} / ${JSON.stringify((await db.projects.get(P))?.worldEras)} / ${form(companion()).textContent}`);
    await act(async () => { await saveWorkspaceAppearance(base, { grain: 15 }, 1); await pause(120); click(form(primary()), 'Save appearance'); await pause(150); });
    assert(form(primary()).querySelector('[role="alert"]'), 'Missing conflict notice');
    await act(async () => { choose(primary(), 'Era in this pane', eraScope.eraId); await pause(180); });
    assert(primary().style.getPropertyValue('--color-deep') === '#17191a' && !form(primary()).querySelector('[role="alert"]'), 'Switch failed to scope errors');
    await act(async () => { choose(primary(), 'Era in this pane', ''); await pause(180); });
    assert(form(primary()).querySelector('[role="alert"]') && form(primary()).querySelector<HTMLSelectElement>('[aria-label="Interface font"]')?.value === 'humanist', 'Returning Base lost conflict draft');
    assert(companion().querySelector<HTMLSelectElement>('[aria-label="Era in this pane"]')?.value === eraScope.eraId && (await getWorkspaceAppearance(eraScope)).own.mode === 'dark', 'Primary switch changed companion scope');
    return ['Normal two-pane workspace saves independent Base/era appearances and returns Base/era with its original conflict and unsaved font draft intact'];
  } finally { await act(async () => root.unmount()); await db.projects.delete(P); localStorage.clear(); }
}
