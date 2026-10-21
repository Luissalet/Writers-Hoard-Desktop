import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import type { CodexEntry, Project } from '@/types';
import { bindPropertyFormulas, displayPropertyFormula, projectCodexEntry, propertyDefinitions } from '@/engines/codex/properties';
import { deleteCodexTemplate, templateFromEntry, saveCodexTemplate, type CodexTemplate } from '@/engines/codex/templates';
import { applyTemplateSync, planTemplateSync, previewTemplateSync } from '@/engines/codex/templateSync';
import { importProjectData } from '@/db/operations';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { getBridgeTool } from '@/services/aiBridge/manifest';
import { buildWorldWiki } from '@/services/worldWikiExport';
import CodexEntryForm from '@/components/codex/CodexEntryForm';
import CodexTemplateManager from '@/components/codex/CodexTemplateManager';
import TablesEngine from '@/engines/tables/TablesEngine';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
const P = 'synthetic-property-depth';
const project: Project = { id: P, title: 'Synthetic property QA', description: '', mode: 'custom', type: 'standalone', color: '#777777', status: 'draft', enabledEngines: ['codex', 'tables'], engineOrder: ['codex', 'tables'], createdAt: 1, updatedAt: 1 };
const baseTemplate: CodexTemplate = { id: 'merchant', name: 'Merchant', category: 'custom', fields: { price: '10', quantity: '3', tax: '1.2', subtotal: '', total: '', label: '', date: '', color: '', roles: '[]' }, propertyDefinitions: [
  ...['price', 'quantity', 'tax', 'subtotal', 'total'].map(key => ({ id: `identity-${key}`, key, label: key[0].toUpperCase() + key.slice(1), kind: 'number' as const, ...(key === 'subtotal' ? { formula: '=@[Price] * @[Quantity]' } : key === 'total' ? { formula: '=CEILING(@[Subtotal] * @[Tax], 1)' } : {}) })),
  { id: 'identity-label', key: 'label', label: 'Status', kind: 'text', formula: '=IFS(@[Total] > 100, "Expensive", @[Total] > 10, UPPER("normal"), TRUE, "Cheap")' },
  { id: 'identity-date', key: 'date', label: 'Established', kind: 'date' },
  { id: 'identity-color', key: 'color', label: 'Banner', kind: 'color', presets: ['#ff0000', '#00ff00'] },
  { id: 'identity-roles', key: 'roles', label: 'Roles', kind: 'multiselect', presets: ['Trader', 'Guide'] },
], content: '<h2>Background</h2><p>Default biography.</p>', revision: 0, createdAt: 1, updatedAt: 1 };
const entry: CodexEntry = { id: 'merchant-card', projectId: P, title: 'Synthetic merchant', type: 'custom', templateId: baseTemplate.id, fields: { price: '12.5', quantity: '4', tax: '1.2', date: '2026-10-20', color: '#ff0000', roles: '["Trader"]', legacy: 'preserved' }, content: '<p>Authored biography.</p>', tags: [], relations: [], createdAt: 1, updatedAt: 1 };
const rejects = async (action: () => unknown | Promise<unknown>) => { let rejected = false; try { await action(); } catch { rejected = true; } assert(rejected, 'Expected conflict or invalid input rejection'); };
const input = (node: HTMLInputElement | HTMLTextAreaElement, value: string) => { assert(node, 'Missing input'); Object.getOwnPropertyDescriptor(node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); };
const select = (node: HTMLSelectElement, value: string) => { assert(node, 'Missing select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('change', { bubbles: true })); };

export async function testCodexPropertiesDepth(): Promise<string[]> {
  const passed: string[] = []; let cloneId: string | undefined;
  const root = createRoot(document.getElementById('root')!);
  const render = async (node: React.ReactNode) => { await act(async () => { root.render(<MemoryRouter>{node}</MemoryRouter>); await pause(200); }); await act(async () => { await pause(150); }); };
  try {
    useLocaleStore.setState({ locale: 'en' }); await db.projects.put(project); await db.codexEntries.put(entry);
    let template = await saveCodexTemplate(P, baseTemplate, null);
    let projected = projectCodexEntry(entry, [template]);
    assert(projected.fields.subtotal === '50' && projected.fields.total === '60' && projected.fields.label === 'NORMAL' && projected.fields.roles === 'Trader' && projected.fields.legacy === 'preserved', JSON.stringify(projected));
    assert(entry.fields.subtotal === undefined, 'Projection must not persist a cache');
    assert(projectCodexEntry({ ...entry, templateId: undefined }, [template]).fields.price === '12.5', 'Legacy entries changed');
    passed.push('Current derived values, multi-hop calculations, typed fields and old string data without a table or persisted cache');
    const renamed = { ...template, propertyDefinitions: template.propertyDefinitions!.map(item => item.key === 'price' ? { ...item, label: 'Cost' } : item) };
    template = await saveCodexTemplate(P, renamed, template.revision);
    projected = projectCodexEntry(entry, [template]);
    assert(projected.fields.total === '60' && displayPropertyFormula(template.propertyDefinitions!.find(item => item.key === 'subtotal')!, propertyDefinitions(template)).includes('@[Cost]'), 'Renaming broke stable formulas');
    assert((await db.codexEntries.get(entry.id))!.fields.price === '12.5', 'Renaming rewrote authored fields');
    passed.push('Stable property identities survive labels renamed without rewriting cards or formula references');
    const child = await saveCodexTemplate(P, { ...baseTemplate, id: 'junior-merchant', name: 'Junior merchant', parentTemplateId: template.id, fields: { price: '8' }, propertyDefinitions: undefined, content: '', contentMode: 'inherit' }, null);
    assert(child.propertyDefinitions![0].id === 'identity-price' && projectCodexEntry({ ...entry, templateId: child.id }, [template, child]).fields.total === '60', 'Inherited default override changed stable identity');
    await rejects(() => saveCodexTemplate(P, { ...child, propertyDefinitions: [{ id: 'collision', key: 'other', label: 'Cost', kind: 'text' }] }, child.revision));
    const calculate = (formula: string, kind: 'number' | 'text' = 'number') => projectCodexEntry(entry, [bindPropertyFormulas({ ...template, propertyDefinitions: [...template.propertyDefinitions!.filter(item => item.key !== 'total'), { id: 'identity-total', key: 'total', label: 'Total', kind, formula, formulaBindings: undefined }] })]).fields.total;
    assert(calculate('=IF(TRUE, ROUND(10/3, 2), 1/0)') === '3.33', 'IF must be lazy');
    assert(calculate('=CONCATENATE(TRIM("  A   B  "), LOWER("CD"), LEN("xyz"))', 'text') === 'A Bcd3', 'Text functions');
    assert(calculate('=ABS(-3)+MIN(4,2)+MAX(3,5)+FLOOR(2.9,1)+2^3') === '20', 'Numeric functions');
    assert(calculate('=1/0') === '#DIV/0!' && calculate('=WHATEVER(1)') === '#NAME?' && calculate('=@[Deleted]') === '#REF!' && calculate('="text"') === '#VALUE!', 'Formula errors not visible');
    assert(calculate('=fetch("https://example.invalid")') === '#NAME?', 'Formula executed external code');
    const cycles = bindPropertyFormulas({ ...template, propertyDefinitions: template.propertyDefinitions!.map(item => item.key === 'subtotal' ? { ...item, formula: '=@[Total]', formulaBindings: undefined } : item.key === 'total' ? { ...item, formula: '=@[Subtotal]', formulaBindings: undefined } : item) });
    const cyclic = projectCodexEntry(entry, [cycles]); assert(cyclic.fields.subtotal === '#CIRCULAR!' && cyclic.fields.total === '#CIRCULAR!' && cyclic.fields.price === '12.5', 'Cycles must remain local and visible');
    const lazyCycle = bindPropertyFormulas({ ...cycles, propertyDefinitions: cycles.propertyDefinitions!.map(item => item.key === 'subtotal' ? { ...item, formula: '=IF(TRUE, 1, @[Total])', formulaBindings: undefined } : item) });
    assert(projectCodexEntry(entry, [lazyCycle]).fields.subtotal === '#CIRCULAR!', 'A circular dependency is still circular in an unselected branch');
    assert(projectCodexEntry({ ...entry, fields: { ...entry.fields, price: '' } }, [template]).fields.total === '', 'Empty inputs cannot silently become zero');
    const invalidValues = projectCodexEntry({ ...entry, fields: { ...entry.fields, date: '2026-02-30', color: 'red', roles: 'not-json' } }, [template]);
    assert(['date', 'color', 'roles'].every(key => invalidValues.properties[key].error === '#VALUE!'), 'Invalid typed value accepted');
    const missingProperty = { ...template, propertyDefinitions: template.propertyDefinitions!.filter(item => item.key !== 'price'), fields: Object.fromEntries(Object.entries(template.fields).filter(([key]) => key !== 'price')) };
    assert(projectCodexEntry(entry, [missingProperty]).fields.total === '#REF!', 'Deleted property did not invalidate dependent formulas');
    passed.push('Lazy IF/IFS, numeric/text functions, missing/invalid input, unknown names, invalid references, divide-by-zero and isolated circular statuses');
    assert(planTemplateSync([{ ...entry, content: '<p><br></p>' }], template, [template])[0].bodyChanged && !planTemplateSync([{ ...entry, content: '<figure data-wh-tool-block="true"></figure>' }], template, [template])[0].bodyChanged, 'Empty rich body/media distinction failed');
    const inheritedPlan = planTemplateSync([{ ...entry, templateId: child.id, fields: {} }], template, [template, child], { includeSubtypes: true });
    assert(inheritedPlan[0].fields.price === '8' && inheritedPlan[0].fields.tax === '1.2', 'Subtype sync did not use inherited defaults');
    const original = (await db.codexEntries.get(entry.id))!;
    await db.codexEntries.put({ ...original, fields: { ...original.fields, price: '99' }, updatedAt: 2 });
    let preview = await previewTemplateSync(P, template.id);
    assert(preview.changes[0].preserved.includes('price') && !preview.changes[0].bodyChanged, 'Default sync overwrites authored content');
    await applyTemplateSync(preview); assert((await db.codexEntries.get(entry.id))!.fields.price === '99' && (await db.codexEntries.get(entry.id))!.content === original.content, 'Preserving sync lost authored data');
    preview = await previewTemplateSync(P, template.id, { resetFields: ['price'], content: 'append' });
    await db.codexEntries.update(entry.id, { updatedAt: Date.now(), fields: { ...(await db.codexEntries.get(entry.id))!.fields, quantity: '6' } });
    await rejects(() => applyTemplateSync(preview)); assert((await db.codexEntries.get(entry.id))!.fields.price === '99', 'Conflict partially applied sync');
    preview = await previewTemplateSync(P, template.id, { resetFields: ['price'], content: 'append' }); await applyTemplateSync(preview);
    assert((await db.codexEntries.get(entry.id))!.fields.price === '10' && (await db.codexEntries.get(entry.id))!.content === original.content + template.content, 'Explicit reset/append failed');
    preview = await previewTemplateSync(P, template.id); template = await saveCodexTemplate(P, { ...template, name: 'Changed template' }, template.revision); await rejects(() => applyTemplateSync(preview));
    passed.push('Preview/apply synchronization preserves authored values by default, explicitly resets selected fields/blocks and rejects changed cards/templates atomically');
    cloneId = await importProjectData({ project: (await db.projects.get(P))!, codexEntries: [(await db.codexEntries.get(entry.id))!] });
    const clone = (await db.projects.get(cloneId))!, clonedEntry = (await db.codexEntries.where('projectId').equals(cloneId).toArray())[0];
    assert(clonedEntry.templateId !== template.id && projectCodexEntry(clonedEntry, clone.codexTemplates).fields.total === '72', 'Cloned formulas or template references changed');
    passed.push('Native project cloning preserves formula bindings, typed definitions and values within the new project');
    const createReply = await runBridgeTool('wh_create_codex_entry', { projectId: P, title: 'Bridge merchant', templateId: template.id, fields: { price: '20', quantity: '2' } });
    assert(createReply.ok, `Native bridge create: ${createReply.error}`);
    const id = (createReply.result as { id: string }).id;
    const read = await runBridgeTool('wh_get_codex_entry', { id }); assert(read.ok && (read.result as { fields: Record<string, string> }).fields.total === '48', 'Native MCP read did not derive values');
    const cannotWrite = await runBridgeTool('wh_update_codex_entry', { id, fields: { total: '1' } }); assert(!cannotWrite.ok && cannotWrite.code === 'bad-args', 'Native MCP wrote into a computed property');
    const definitions = await runBridgeTool('wh_codex_templates', { projectId: P }); assert(definitions.ok && getBridgeTool('wh_save_codex_template')?.engineId === 'codex', 'Native schema/handler registration missing');
    const mp = await runBridgeTool('wh_preview_codex_sync', { projectId: P, templateId: template.id }); assert(mp.ok, 'Native sync preview');
    assert((await runBridgeTool('wh_apply_codex_sync', { projectId: P, preview: mp.result })).ok, 'Native sync apply');
    const msave = await runBridgeTool('wh_save_codex_template', { projectId: P, expectedRevision: template.revision, template: { ...template, name: 'Native revised' } }); assert(msave.ok, 'Native template edit failed');
    template = (msave.result as { template: CodexTemplate }).template;
    const { html } = buildWorldWiki({ project: (await db.projects.get(P))!, entries: [(await db.codexEntries.get(id))!], maps: [], pins: [], images: [] }, { includeImages: false });
    assert(html.includes('Cost') && html.includes('48') && html.includes('NORMAL'), 'Wiki omitted projected labels/calculations');
    passed.push('Native bridge manifest/handlers create/edit types, create templated cards, project values, protect calculated fields and preview/apply sync; wiki carries the same values');
    await render(<CodexEntryForm projectId={P} entry={entry} onSave={async () => {}} onCancel={() => {}} />);
    assert(document.querySelector('output')?.textContent === '50', 'Form did not expose computed output');
    const priceLabel = [...document.querySelectorAll('label')].find(node => node.textContent === 'Cost'); assert(priceLabel, 'Renamed property label missing');
    await act(async () => { input(document.getElementById(priceLabel.htmlFor) as HTMLInputElement, '20'); await pause(); });
    assert([...document.querySelectorAll('output')].some(node => node.textContent === '96'), 'Form did not react to current typed inputs');
    assert(document.querySelector('input[type="date"]') && document.querySelector('input[type="color"]') && [...document.querySelectorAll('label')].some(node => node.textContent === 'Guide'), 'Typed value controls missing');
    passed.push('Native card form displays named typed controls, presets/multiselect and immediate read-only calculations');
    await db.projects.update(P, { dataTables: [{ id: 'live', title: 'Live merchants', mode: 'table', codexType: 'custom', columns: [{ id: 'total', name: 'Total', kind: 'number', field: 'total' }], rows: [] }] });
    await render(<TablesEngine projectId={P} />);
    assert([...document.querySelectorAll<HTMLInputElement>('input')].some(node => node.disabled && node.value === '48')||[...document.querySelectorAll('output')].some(node=>node.textContent==='48'), 'Live table did not read derived value as read-only');
    passed.push('Live tables render read-only calculated properties using the shared projector');
    await deleteCodexTemplate(P, template.id, template.revision);
    const retiredEntry = (await db.codexEntries.get(id))!;
    assert(retiredEntry.propertyDefinitions?.some(item => item.formula) && projectCodexEntry(retiredEntry, []).fields.total === '48', 'Retirement lost calculated definitions');
    const changedRetired = { ...retiredEntry, fields: { ...retiredEntry.fields, price: '30' } };
    assert(projectCodexEntry(changedRetired, []).fields.total === '72', 'Retirement materialized a stale calculation cache');
    const restoredType = templateFromEntry(changedRetired, 'restored', 'Restored', Date.now());
    assert(restoredType.propertyDefinitions?.some(item => item.formula) && Object.hasOwn(restoredType.fields, 'subtotal'), 'Type recreated from a retired card lost definitions');
    passed.push('Retired types preserve typed schema and live formulas on their cards, including recreation as a new reusable type');
    return passed;
  } finally { await act(async () => root.unmount()); for (const projectId of [P, cloneId].filter((id): id is string => Boolean(id))) { await db.codexEntries.where('projectId').equals(projectId).delete(); await db.projects.delete(projectId); } }
}

export async function testCodexPropertiesLayout(): Promise<string[]> {
  const root = createRoot(document.getElementById('root')!); const passed: string[] = [];
  try {
    useLocaleStore.setState({ locale: 'en' }); await db.projects.put(project); await db.codexEntries.put(entry);
    const template = await saveCodexTemplate(P, baseTemplate, null);
    await act(async () => { root.render(<MemoryRouter><CodexTemplateManager projectId={P} open initial={template} onUse={() => {}} onClose={() => {}} /></MemoryRouter>); await pause(200); }); await act(async () => { await pause(200); });
    const property = document.querySelector<HTMLDetailsElement>('[data-property-definition="price"]')!; assert(property, 'Property authoring workflow missing'); property.open = true;
    await act(async () => { select(document.querySelector<HTMLSelectElement>('[aria-label="Property type · price"]')!, 'number'); input(document.querySelector<HTMLInputElement>('[aria-label="Display name · price"]')!, 'Cost'); await pause(); });
    const subtotal = document.querySelector<HTMLDetailsElement>('[data-property-definition="subtotal"]')!; subtotal.open = true;
    await act(async () => { input(document.querySelector<HTMLInputElement>('[aria-label="Calculate · subtotal"]')!, '=ROUND(@[Cost] * @[Quantity], 1)'); input(document.querySelector<HTMLInputElement>('[aria-label="Field name"]')!, 'Region'); await pause(); });
    await act(async () => { [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === 'Add template field')!.click(); await pause(); });
    await act(async () => { input(document.querySelector<HTMLTextAreaElement>('[aria-label="Fields and default values · Region"]')!, 'North'); await pause(); });
    await act(async () => { [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === 'Save template')?.click(); await pause(300); });
    assert((await db.projects.get(P))!.codexTemplates![0].propertyDefinitions!.find(item => item.key === 'price')!.label === 'Cost', 'UI property definition did not save');
    assert((await db.projects.get(P))!.codexTemplates![0].propertyDefinitions!.find(item => item.key === 'subtotal')!.formula === '=ROUND(@[Cost] * @[Quantity], 1)', 'UI formula authoring did not save');
    const sync = document.querySelector<HTMLDetailsElement>('[data-testid="template-sync-panel"]')!; sync.open = true;
    await act(async () => { [...sync.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === 'Preview sync changes')!.click(); await pause(150); });
    assert(sync.textContent?.includes('Region') && sync.textContent?.includes('price'), 'UI sync preview omitted added/preserved values');
    for (const [w, h] of [[1280, 900], [640, 780]]) {
      const state = window as unknown as { __want: { w: number; h: number; n: number } | null; __sizeAck: number; __shot: { name: string } | null; __shotDone: string };
      state.__want = { w, h, n: w }; const limit = Date.now() + 8000; while (state.__sizeAck !== w && Date.now() < limit) await pause(25); assert(state.__sizeAck === w, 'Viewport resize failed'); await pause(150);
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!, bounds = dialog.getBoundingClientRect(); assert(bounds.left >= 0 && bounds.right <= innerWidth + 1, 'Dialog overflows desktop window');
      for (const node of dialog.querySelectorAll<HTMLElement>('input, select, textarea')) { const rect = node.getBoundingClientRect(); assert(rect.width > 0 && rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1, `Field overflow: ${node.getAttribute('aria-label')}`); }
      assert(getComputedStyle(dialog).backgroundColor !== 'rgba(0, 0, 0, 0)', 'Real product CSS was not loaded');
      const calculation=document.querySelector<HTMLInputElement>('[aria-label="Calculate · subtotal"]')!;
      calculation.scrollIntoView({block:'center',behavior:'instant'});await new Promise<void>(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done())));
      const calculationRect=calculation.getBoundingClientRect();assert(calculation.value.includes('ROUND')&&calculationRect.top>=0&&calculationRect.bottom<=innerHeight&&document.elementFromPoint(calculationRect.x+calculationRect.width/2,calculationRect.y+calculationRect.height/2)===calculation,'Actual Calculate control/formula is not visible for the evidence capture');
      state.__shot = { name: `codex-properties-${w}` }; while (state.__shotDone !== `codex-properties-${w}` && Date.now() < limit + 8000) await pause(25);
      sync.scrollIntoView({block:'end',behavior:'instant'});await new Promise<void>(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done())));
      const applyButton=[...sync.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.trim()==='Apply these changes')!,applyRect=applyButton.getBoundingClientRect();assert(sync.textContent?.includes('Region')&&!applyButton.disabled&&applyRect.top>=0&&applyRect.bottom<=innerHeight,'Actual sync plan and enabled apply action are not visible for the evidence capture');
      state.__shot = { name: `codex-sync-${w}` }; while (state.__shotDone !== `codex-sync-${w}` && Date.now() < limit + 12000) await pause(25);
      passed.push(`Actual CSS property editor at desktop ${w}×${h}: visible fields and dialog remain within the window`);
    }
    await act(async () => { [...sync.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === 'Apply these changes')!.click(); await pause(150); });
    assert((await db.codexEntries.get(entry.id))!.fields.Region === 'North' && (await db.codexEntries.get(entry.id))!.fields.price === '12.5', 'GUI apply did not add defaults while preserving authored data');
    passed.push('Real GUI authors and saves typed definitions/renames/formulas, captures the actual Calculate field and uncommitted sync plan, then applies sync with authored values preserved');
    return passed;
  } finally { await act(async () => root.unmount()); await db.codexEntries.where('projectId').equals(P).delete(); await db.projects.delete(P); }
}
