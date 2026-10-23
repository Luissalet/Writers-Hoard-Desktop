// Card properties: a single-select kind, required properties a card cannot be
// saved without, and a line of help under a property; through the card form,
// the type editor and the bridge.
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { db } from '@/db';
import CodexEntryForm from '@/components/codex/CodexEntryForm';
import PropertyDefinitionEditor from '@/components/codex/PropertyDefinitionEditor';
import { bindPropertyFormulas, missingRequiredProperties, projectCodexEntry } from '@/engines/codex/properties';
import type { CodexTemplate } from '@/engines/codex/templateTypes';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import type { CodexEntry, Project } from '@/types';
import { useLocaleStore } from '@/stores/localeStore';
import { t } from '@/i18n/useTranslation';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

export async function testCodexRequiredProperties(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const passed: string[] = [];
  const P = 'crp-project';
  const template: CodexTemplate = {
    id: 'crp-ship', name: 'Barco', category: 'item', fields: { Bandera: '', Tripulación: '' }, content: '', revision: 1, createdAt: 1, updatedAt: 1,
    propertyDefinitions: [
      { id: 'p-flag', key: 'Bandera', label: 'Bandera', kind: 'select', presets: ['Sal', 'Faro', 'Corona'], optionColors: { Sal: '#3d85c6' }, required: true, description: 'El puerto que lo arma' },
      { id: 'p-crew', key: 'Tripulación', label: 'Tripulación', kind: 'number' },
    ],
  };
  assert(bindPropertyFormulas(template) && (() => { try { bindPropertyFormulas({ ...template, propertyDefinitions: [{ ...template.propertyDefinitions![0], required: 'yes' as unknown as boolean }] }); return false; } catch { return true; } })(), 'Definitions validated');
  assert(missingRequiredProperties(template.propertyDefinitions!, { Bandera: '' }).length === 1 && missingRequiredProperties(template.propertyDefinitions!, { Bandera: 'Sal' }).length === 0, 'Missing required');
  const projected = projectCodexEntry({ id: 'x', projectId: P, type: 'item', title: 'La Gaviota', content: '', fields: { Bandera: 'Sal' }, tags: [], relations: [], templateId: template.id, createdAt: 1, updatedAt: 1 } as CodexEntry, [template]);
  assert(projected.properties.Bandera.options?.[0]?.color === '#3d85c6', `Select carries its option colour: ${JSON.stringify(projected.properties.Bandera)}`);
  passed.push('Model: a single-select property projects its value with the option colour; required and description are validated; a required property left empty is reported');

  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  let saved: CodexEntry | null = null;
  try {
    await db.projects.put({ id: P, title: 'Flota', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['codex'], createdAt: 1, updatedAt: 1, codexTemplates: [template] } as Project);
    await act(async () => { root = createRoot(host); root.render(<CodexEntryForm projectId={P} entry={null} template={template} onSave={async entry => { saved = entry; }} onCancel={() => {}} />); await pause(400); });
    const setInput = (element: HTMLInputElement | HTMLSelectElement, value: string) => { const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); };
    const title = [...document.querySelectorAll('input')].find(input => input.placeholder === t('codex.entryName')) as HTMLInputElement;
    await act(async () => { setInput(title, 'La Gaviota'); await pause(); });
    assert(document.querySelector('[data-testid="codex-property-required"]') && document.querySelector('[data-testid="codex-property-description"]')?.textContent === 'El puerto que lo arma', 'Required star and description');
    const saveButton = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === t('codex.createEntry')) as HTMLButtonElement;
    await act(async () => { saveButton.click(); await pause(200); });
    assert(!saved && /Rellena antes de guardar: Bandera/.test(document.querySelector('[data-testid="codex-required-missing"]')?.textContent ?? ''), 'Refused while empty');
    const select = document.querySelector('[data-testid="codex-property-select"]') as HTMLSelectElement;
    assert([...select.options].map(option => option.value).join('|') === '|Sal|Faro|Corona', 'Options from the presets');
    await act(async () => { setInput(select, 'Faro'); await pause(); });
    await act(async () => { saveButton.click(); await pause(300); });
    assert((saved as CodexEntry | null)?.fields.Bandera === 'Faro', `Saved: ${JSON.stringify(saved)}`);
    passed.push('Card form: "Bandera" shows a red * and "El puerto que lo arma" under it; saving empty says "Rellena antes de guardar: Bandera" and saves nothing; choosing "Faro" from the list (Sal, Faro, Corona) saves');
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
  }

  let latest: CodexTemplate = template;
  function Harness() {
    const [draft, setDraft] = useState<CodexTemplate>({ ...template, propertyDefinitions: [{ ...template.propertyDefinitions![1] }] });
    latest = draft;
    return <PropertyDefinitionEditor template={draft} fieldKey="Tripulación" locale="es" available={draft.propertyDefinitions ?? []} onChange={setDraft} />;
  }
  try {
    await act(async () => { root = createRoot(host); root.render(<Harness />); await pause(200); });
    (document.querySelector('details') as HTMLDetailsElement).open = true;
    const kind = document.querySelector('select[aria-label^="Tipo de propiedad"]') as HTMLSelectElement;
    assert([...kind.options].some(option => option.value === 'select' && option.textContent === 'Selección única'), 'Single select offered');
    await act(async () => { (document.querySelector('[data-testid="property-required"]') as HTMLInputElement).click(); await pause(); });
    const description = document.querySelector('[data-testid="property-description"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(description, 'Cuántos marineros'); description.dispatchEvent(new Event('input', { bubbles: true })); await pause(); });
    const definition = latest.propertyDefinitions?.find(item => item.key === 'Tripulación');
    assert(definition?.required === true && definition.description === 'Cuántos marineros', `Editor: ${JSON.stringify(definition)}`);
    passed.push('Type editor: "Selección única" is a property type; "Obligatoria" and the description are set on the property');
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
  }

  try {
    const created = await runBridgeTool('wh_create_codex_entry', { projectId: P, type: 'item', title: 'El Cormorán', templateId: template.id, fields: { Tripulación: '12' } });
    assert(created.ok, JSON.stringify(created));
    const got = await runBridgeTool('wh_get_codex_entry', { id: (created.result as { id: string }).id });
    assert((got.result as { missingRequired: string[] }).missingRequired.join() === 'Bandera', `Bridge: ${JSON.stringify(got.result).slice(0, 300)}`);
    passed.push('Bridge: wh_get_codex_entry reports missingRequired ["Bandera"] for a card made without it');
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
