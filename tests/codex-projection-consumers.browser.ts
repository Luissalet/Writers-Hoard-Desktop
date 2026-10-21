import { db } from '@/db';
import type { CodexEntry, Project, Writing } from '@/types';
import { bindPropertyFormulas } from '@/engines/codex/properties';
import type { CodexTemplate } from '@/engines/codex/templateTypes';
import { codexBlockPreview } from '@/components/editor/codexBlocks/model';
import { hydrateCodexBlocks } from '@/components/editor/codexBlocks/reading';
import { buildReaderHtml } from '@/engines/writings/readerExport';
import { defaultReaderPresentation } from '@/engines/writings/readerPresentation';
import { searchProjectContent, invalidateProjectSearchIndex } from '@/services/projectSearchIndex';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
export async function testCodexProjectionConsumers() {
  const P = `property-consumers-${Date.now()}`;
  const template: CodexTemplate = bindPropertyFormulas({ id: `${P}-template`, name: 'Cargo', category: 'custom', fields: { cargo: '3', description: '' }, propertyDefinitions: [
    { id: 'cargo-id', key: 'cargo', label: 'Cargo', kind: 'number' },
    { id: 'description-id', key: 'description', label: 'Description', kind: 'text', formula: '=IF(@[Cargo]>2,"Saffron convoy","Empty convoy")' },
  ], content: '', revision: 0, createdAt: 1, updatedAt: 1 });
  const project: Project = { id: P, title: 'Consumer QA', description: '', mode: 'custom', type: 'standalone', color: '#777777', status: 'draft', codexTemplates: [template], createdAt: 1, updatedAt: 1 };
  const entry: CodexEntry = { id: `${P}-entry`, projectId: P, title: 'Harbor cargo', type: 'custom', templateId: template.id, fields: { cargo: '4' }, content: '<p>Authored content.</p>', tags: [], relations: [], createdAt: 1, updatedAt: 1 };
  const block = `<aside data-wh-codex-block="true" data-project-id="${P}" data-entry-id="${entry.id}"></aside>`;
  const writing: Writing = { id: `${P}-writing`, projectId: P, title: 'Chapter', content: `${block}<p><a href="/project/${P}/codex?entry=${entry.id}">Cargo</a></p>`, status: 'draft', wordCount: 1, tags: [], createdAt: 1, updatedAt: 1 };
  const host = document.createElement('div'); host.innerHTML = block; document.body.append(host);
  let stop: (() => void) | undefined;
  const wait = async (test: () => boolean) => { for (let i = 0; i < 120; i++) { if (test()) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw Error('Live projection did not update'); };
  try {
    await db.projects.put(project); await db.codexEntries.put(entry);
    assert(codexBlockPreview(entry, [template]).fields.some(([label, value]) => label === 'Description' && value === 'Saffron convoy'), 'Live editor preview must resolve current computed labels and values');
    stop = hydrateCodexBlocks(host, P, 'Unavailable'); await wait(() => host.textContent!.includes('Saffron convoy'));
    const first = await searchProjectContent('Saffron', P); assert(first.some(hit => hit.id === entry.id), 'Search omitted computed property');
    const artifact = await buildReaderHtml(project, [writing], defaultReaderPresentation(), 'en');
    const html = document.createElement('template'); html.innerHTML = artifact.html;
    assert(html.content.querySelectorAll('dd').length === 4 && html.content.textContent?.includes('Saffron convoy'), 'Reader live block and linked appendix omitted computed values');
    const changed = bindPropertyFormulas({ ...template, propertyDefinitions: template.propertyDefinitions!.map(item => item.key === 'description' ? { ...item, label: 'Shipment', formula: '="Cinnabar convoy"', formulaBindings: undefined } : item) });
    await db.projects.update(P, { codexTemplates: [changed], updatedAt: 2 });
    await wait(() => host.textContent!.includes('Cinnabar convoy') && host.textContent!.includes('Shipment'));
    const updated = await searchProjectContent('Cinnabar', P); assert(updated.some(hit => hit.id === entry.id), 'Search retained stale computed values after template changed');
    assert(!(await searchProjectContent('Saffron', P)).some(hit => hit.id === entry.id), 'Search retained removed formula result');
    assert(JSON.stringify((await db.codexEntries.get(entry.id))!.fields) === JSON.stringify(entry.fields), 'Read consumers persisted derived values');
    return ['Computed Codex properties in editor preview, live reader DOM, portable HTML blocks/appendix and search; template-only changes refresh without writing authored fields'];
  } finally { stop?.(); host.remove(); await db.codexEntries.delete(entry.id); await db.projects.delete(P); invalidateProjectSearchIndex(); }
}
