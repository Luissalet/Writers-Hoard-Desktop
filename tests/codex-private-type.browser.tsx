// A private Codex type: its cards, and those of every type inheriting from it,
// stay out of the published world wiki; set in the type's appearance and
// through wh_save_codex_template.
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import TemplateAppearance from '@/components/codex/TemplateAppearance';
import { privateTemplateIds } from '@/engines/codex/templateHierarchy';
import type { CodexTemplate } from '@/engines/codex/templateTypes';
import { buildWorldWiki, loadWorldWikiData } from '@/services/worldWikiExport';
import { db } from '@/db';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import type { CodexEntry, Project } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

export async function testCodexPrivateType(): Promise<string[]> {
  const passed: string[] = [];
  const base = { fields: {}, content: '', revision: 1, createdAt: 1, updatedAt: 1 };
  const templates: CodexTemplate[] = [
    { id: 'secret', name: 'Secreto', category: 'concept', privateType: true, ...base },
    { id: 'plot', name: 'Giro de trama', category: 'concept', parentTemplateId: 'secret', ...base },
    { id: 'open', name: 'Leyenda', category: 'concept', parentTemplateId: 'secret', privateType: false, ...base },
    { id: 'town', name: 'Pueblo', category: 'location', ...base },
  ];
  const ids = privateTemplateIds(templates);
  assert(ids.has('secret') && ids.has('plot') && !ids.has('open') && !ids.has('town'), `Private: ${[...ids]}`);
  const project = { id: 'pt', title: 'La sal', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['codex'], createdAt: 1, updatedAt: 1, codexTemplates: templates } as Project;
  const card = (id: string, title: string, type: CodexEntry['type'], templateId?: string): CodexEntry => ({ id, projectId: 'pt', type, title, content: `<p>${title}.</p>`, fields: {}, tags: [], relations: [], createdAt: 1, updatedAt: 1, ...(templateId ? { templateId } : {}) } as CodexEntry);
  const entries = [card('c1', 'El traidor es el faro', 'concept', 'plot'), card('c2', 'La sirena del puerto', 'concept', 'open'), card('c3', 'Puerto Sal', 'location', 'town'), card('c4', 'La clave del mapa', 'concept', 'secret')];
  const { html } = buildWorldWiki({ project, entries, maps: [], pins: [], images: [] }, { includeImages: false, locale: 'es' });
  assert(!html.includes('El traidor es el faro') && !html.includes('La clave del mapa') && html.includes('La sirena del puerto') && html.includes('Puerto Sal'), 'Wiki leaves out private cards');
  passed.push('World wiki: the cards of "Secreto" and of "Giro de trama" (which inherits from it) are left out; "Leyenda" (inheriting but marked Se publica) and "Pueblo" are published');

  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  let latest: CodexTemplate | undefined;
  function Harness() {
    const [draft, setDraft] = useState<CodexTemplate>(templates[3]);
    latest = draft;
    return <TemplateAppearance draft={draft} templates={templates} locale="es" onChange={setDraft} />;
  }
  try {
    await act(async () => { root = createRoot(host); root.render(<Harness />); await pause(200); });
    const select = document.querySelector('[data-testid="template-private"]') as HTMLSelectElement;
    assert(select && /En la wiki publicada/.test(document.body.textContent ?? ''), 'Privacy control');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(select, 'true'); select.dispatchEvent(new Event('change', { bubbles: true })); await pause(100); });
    assert(latest?.privateType === true && /tipo privado/.test(document.querySelector('[data-testid="template-appearance"]')?.textContent ?? ''), 'Marked private');
    passed.push('Type appearance: "En la wiki publicada → Privado: nunca se publica" marks the type and its summary reads "tipo privado"');
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
  }

  const P = 'pt-bridge';
  try {
    await db.projects.put({ ...project, id: P, codexTemplates: [] });
    const saved = await runBridgeTool('wh_save_codex_template', { projectId: P, expectedRevision: null, template: { name: 'Secreto', category: 'concept', fields: {}, content: '', privateType: true } });
    assert(saved.ok, JSON.stringify(saved));
    const templateId = (saved.result as { template: CodexTemplate }).template.id;
    await db.codexEntries.bulkPut([{ ...card('b1', 'El traidor es el faro', 'concept', templateId), projectId: P }, { ...card('b2', 'Puerto Sal', 'location'), projectId: P }]);
    const wiki = buildWorldWiki(await loadWorldWikiData(P), { includeImages: false }).html;
    assert(!wiki.includes('El traidor es el faro') && wiki.includes('Puerto Sal'), 'Bridge-made private type stays out');
    passed.push('Bridge: wh_save_codex_template with privateType:true makes a type whose cards the wiki leaves out');
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
