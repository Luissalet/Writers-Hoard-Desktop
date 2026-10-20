import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import type { CodexEntry, Project } from '@/types';
import { useCodexEntries } from '@/engines/codex/hooks';
import { saveCodexDraft, CodexEditConflict } from '@/engines/codex/operations';
import { deleteCodexTemplate, saveCodexTemplate, CodexTemplateConflict } from '@/engines/codex/templates';
import CodexEntryList from '@/components/codex/CodexEntryList';
import CodexEntryForm from '@/components/codex/CodexEntryForm';
import { codexDraftStore } from '@/components/codex/codexDrafts';
import { t } from '@/i18n/useTranslation';

const P = 'test-codex-reusable-templates';
const pause = () => new Promise(resolve => setTimeout(resolve, 45));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function inputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function selectValue(select: HTMLSelectElement, value: string) { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value); select.dispatchEvent(new Event('change', { bubbles: true })); }

export async function testCodexTemplates(): Promise<string[]> {
  const host = document.getElementById('root'); assert(host, 'Missing root');
  const root = createRoot(host);
  const project: Project = { id: P, title: 'Ecology', description: '', mode: 'custom', type: 'standalone', color: '#000', status: 'draft', enabledEngines: ['codex'], engineOrder: ['codex'], createdAt: 1, updatedAt: 1 };
  const source: CodexEntry = { id: `${P}-source`, projectId: P, title: 'Creature source', type: 'custom', fields: { habitat: 'desert', ecology: 'nocturnal' }, content: '<p>Describe appearance.</p>', tags: ['fauna'], relations: [], createdAt: 1, updatedAt: 1 };
  const location: CodexEntry = { ...source, id: `${P}-location`, title: 'Salt Desert', type: 'location', fields: {}, content: '' };
  const secondLocation: CodexEntry = { ...location, id: `${P}-location-two`, title: 'Ice Desert' };
  const passed: string[] = [];
  function Harness() {
    const { items, addItem, editItem, removeItem } = useCodexEntries(P);
    return <CodexEntryList projectId={P} entries={items} onAdd={addItem} onDelete={removeItem} onEdit={async (id, changes, base) => { if (base) { await saveCodexDraft(base, { ...base, ...changes }); await editItem(id, {}); } else await editItem(id, changes); }} />;
  }
  const render = async (node: React.ReactNode) => { await act(async () => { root.render(<StrictMode><MemoryRouter>{node}</MemoryRouter></StrictMode>); await pause(); }); await act(async () => { await pause(); }); };
  const waitFor = async (label: string, condition: () => boolean) => { const end = Date.now() + 5000; while (!condition() && Date.now() < end) await act(async () => { await pause(); }); assert(condition(), `Timed out ${label}`); };
  const topDialog = () => [...document.querySelectorAll('[role="dialog"]')].at(-1)!;
  const button = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll('button')].find(button => button.textContent?.trim() === label);
  const click = async (node: HTMLElement | undefined | null, label: string) => { assert(node, `Missing ${label}`); await act(async () => { node.click(); await pause(); }); await act(async () => { await pause(); }); };
  const byLabel = <T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(label: string) => { const node = topDialog().querySelector<T>(`[aria-label="${label}"]`); assert(node, `Missing input ${label}`); return node; };
  try {
    await db.projects.put(project); await db.codexEntries.bulkPut([source, location, secondLocation]); codexDraftStore(P).clear();
    await render(<Harness />);
    await waitFor('source card', () => !![...host.querySelectorAll('button')].find(button => button.querySelector('h3')?.textContent === source.title));
    await click([...host.querySelectorAll('button')].find(button => button.querySelector('h3')?.textContent === source.title), 'source card');
    await click(button(t('codex.templates.fromEntry'), topDialog()), 'create template from existing entry');
    await waitFor('template manager', () => !!document.querySelector('[data-testid="codex-template-manager"]'));
    await act(async () => { inputValue(byLabel<HTMLInputElement>(t('codex.templates.name')), 'Desert species'); inputValue(byLabel<HTMLTextAreaElement>(`${t('codex.templates.fields')} · habitat`), 'arid dunes'); inputValue(byLabel<HTMLInputElement>(t('codex.templates.fieldName')), 'Territory'); selectValue(byLabel<HTMLSelectElement>(t('codex.fields.kind')), 'reference'); await pause(); });
    await click(button(t('codex.templates.addField'), topDialog()), 'add typed reference property');
    await act(async () => { selectValue(byLabel<HTMLSelectElement>(`${t('codex.templates.category')} · Territory`), 'location'); await pause(); });
    await click(button(t('codex.templates.save'), topDialog()), 'save reusable type/template');
    await waitFor('template ready to use', () => !button(t('codex.templates.use'), topDialog())?.hasAttribute('disabled'));
    const template = (await db.projects.get(P))!.codexTemplates![0];
    assert(template.name === 'Desert species' && template.fields.habitat === 'arid dunes' && template.referenceFieldDefinitions?.[0].targetType === 'location', 'Reusable template values or typed references did not persist');
    await click(button(t('codex.templates.use'), topDialog()), 'create entry from template');
    const titleInput = topDialog().querySelector<HTMLInputElement>(`input[placeholder="${t('codex.entryName')}"]`)!;
    assert(titleInput, 'Template did not open the new-entry form');
    await act(async () => { inputValue(titleInput, 'Dune fox'); await pause(); });
    const reference = topDialog().querySelector<HTMLSelectElement>('[data-reference-field="Territory"] select')!;
    assert(reference && [...reference.options].some(option => option.value === location.id) && ![...reference.options].some(option => option.value === source.id), 'Typed reference chooser did not restrict the target category');
    await act(async () => { selectValue(reference, location.id); await pause(); });
    await click(button(t('codex.createEntry'), topDialog()), 'save entry from template');
    await waitFor('new detail', () => topDialog()?.textContent?.includes('Dune fox') === true);
    const created = await db.codexEntries.where('projectId').equals(P).filter(entry => entry.title === 'Dune fox').first();
    assert(created?.templateId === template.id && created.fields.habitat === 'arid dunes' && created.referenceFields?.Territory[0] === location.id, 'New entry did not preserve template defaults and typed links');
    assert((await db.codexEntries.get(source.id))!.fields.habitat === 'desert', 'Template creation edited the source card');
    passed.push('author reusable named types from cards, edit defaults, restrict reference categories and create complete linked entries');

    await render(<CodexEntryForm key="reference-recovery" projectId={P} entry={created} onSave={async () => { throw new Error('Recovery check must not save'); }} onCancel={() => {}} />);
    const additionalReference = host.querySelector<HTMLSelectElement>('[data-reference-field="Territory"] select')!;
    await act(async () => { selectValue(additionalReference, secondLocation.id); await pause(); });
    const stored = codexDraftStore(P).get(created.id);
    assert(stored?.templateId === template.id && stored.referenceFields?.Territory.length === 2, 'Template/ref metadata did not reach the recovery journal');
    await render(<p>Closed without saving</p>);
    await render(<CodexEntryForm key="recovered-reference" projectId={P} entry={created} onSave={async () => {}} onCancel={() => {}} />);
    assert(host.querySelector('[data-reference-field="Territory"]')?.textContent?.includes(secondLocation.title), 'Reopened draft lost its typed reference properties');
    const templateLabel = [...host.querySelectorAll('label')].find(label => label.textContent === t('codex.templates.template'));
    assert((document.getElementById(templateLabel?.htmlFor ?? '') as HTMLSelectElement)?.value === template.id, 'Reopened draft lost its template provenance');
    assert((await db.codexEntries.get(created.id))!.referenceFields!.Territory.length === 1, 'Uncommitted draft leaked reference changes into saved data');
    codexDraftStore(P).clear();
    passed.push('typed reference properties and template provenance survive closing/reopening without changing saved data');

    await saveCodexTemplate(P, { ...template, name: 'Updated species', fields: { ...template.fields, habitat: 'tundra' } }, template.revision);
    assert((await db.codexEntries.get(created.id))!.fields.habitat === 'arid dunes', 'Changing template defaults changed existing entries');
    let stale = false; try { await saveCodexTemplate(P, { ...template, name: 'Stale template' }, template.revision); } catch (error) { stale = error instanceof CodexTemplateConflict; }
    assert(stale, 'Stale template overwrite was accepted');
    const currentTemplate = (await db.projects.get(P))!.codexTemplates![0];
    await deleteCodexTemplate(P, template.id, currentTemplate.revision);
    assert(!(await db.projects.get(P))!.codexTemplates!.length && (await db.codexEntries.get(created.id))!.referenceFields?.Territory[0] === location.id, 'Retiring template removed entry data or reference properties');
    passed.push('template edits/retirement preserve existing cards and stale template writes are rejected');

    const base = (await db.codexEntries.get(created.id))!;
    const remote = { ...base, referenceFields: { Territory: [secondLocation.id] }, fields: { ...base.fields, remoteOnly: 'Preserve' } };
    await db.codexEntries.put(remote);
    const draft = { ...base, referenceFields: { Territory: [] }, templateId: 'new-template-provenance' };
    let conflict: CodexEditConflict | undefined;
    try { await saveCodexDraft(base, draft); } catch (error) { if (error instanceof CodexEditConflict) conflict = error; else throw error; }
    assert(conflict?.conflicts.some(item => item.key === 'referenceFields.Territory') && (await db.codexEntries.get(base.id))!.referenceFields!.Territory[0] === secondLocation.id, 'Reference property conflict was silently overwritten');
    codexDraftStore(P).clear();
    await render(<CodexEntryForm projectId={P} entry={base} onSave={async (entry, original) => { await saveCodexDraft(original!, entry); }} onCancel={() => {}} />);
    const targetChip = host.querySelector('[data-reference-field="Territory"] li button') as HTMLButtonElement;
    await click(targetChip, 'remove link in local draft');
    const save = [...host.querySelectorAll('button')].find(button => button.textContent === t('codex.saveChanges'));
    await click(save, 'save reference conflict');
    assert(host.textContent?.includes(t('codex.conflictNotice')), 'Reference conflict UI did not preserve choice');
    await click(button(t('codex.keepYourVersion'), host), 'resolve reference conflict explicitly');
    await click(save, 'save chosen reference state');
    assert((await db.codexEntries.get(base.id))!.referenceFields!.Territory.length === 0 && (await db.codexEntries.get(base.id))!.fields.remoteOnly === 'Preserve', 'Reference resolution lost unrelated remote fields');
    passed.push('template provenance/reference properties participate in recovery and atomic three-way conflict resolution');
    return passed;
  } finally {
    await act(async () => { root.unmount(); await pause(); });
    await db.projects.delete(P); await db.codexEntries.where('projectId').equals(P).delete(); codexDraftStore(P).clear();
  }
}
