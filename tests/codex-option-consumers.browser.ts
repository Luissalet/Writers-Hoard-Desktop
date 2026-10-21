import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import type { CodexEntry, Project, Writing } from '@/types';
import { hydrateCodexBlocks } from '@/components/editor/codexBlocks/reading';
import { buildReaderHtml } from '@/engines/writings/readerExport';
import { defaultReaderPresentation } from '@/engines/writings/readerPresentation';
import { buildWorldWiki, loadWorldWikiData } from '@/services/worldWikiExport';
import { getEraProject, readWorldDocument, saveEraDocument, saveWorldEra } from '@/services/worldEras/store';
import type { EraRow } from '@/services/worldEras/types';
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
export async function testCodexOptionConsumers() {
  const P = `option-consumers-${Date.now()}`, E = 'later', host = document.createElement('div'); document.body.append(host); let dispose: (() => void) | undefined;
  const values = ['North <script>', 'South'], encoded = JSON.stringify(values);
  const project: Project = { id: P, title: 'Synthetic option consumers', mode: 'custom', type: 'standalone', enabledEngines: ['codex', 'writings'], createdAt: 1, updatedAt: 1 };
  const entry: CodexEntry = { id: `${P}-card`, projectId: P, title: 'Harbor', type: 'location', content: '<p>Scoped harbor.</p>', fields: { regions: encoded }, propertyDefinitions: [{ id: 'regions', key: 'regions', label: 'Regions', kind: 'multiselect', presets: values, optionColors: { [values[0]]: '#163d54', South: '#f2d98e' } }], tags: [], relations: [], createdAt: 1, updatedAt: 1 };
  const block = `<aside data-wh-codex-block="true" data-project-id="${P}" data-entry-id="${entry.id}"></aside>`, writing: Writing = { id: `${P}-chapter`, projectId: P, title: 'Chapter', content: `<p>Journey.</p>${block}<p><a href="/project/${P}/codex?entry=${entry.id}">Harbor</a></p>`, status: 'draft', wordCount: 2, tags: [], createdAt: 1, updatedAt: 1 };
  const parsed = (html: string) => new DOMParser().parseFromString(html, 'text/html');
  try {
    await db.projects.put(project); await db.codexEntries.put(entry); await db.writings.put(writing);
    host.innerHTML = block; dispose = hydrateCodexBlocks(host, P, 'Unavailable');
    for (let i = 0; i < 160 && !host.querySelector('[data-wh-property-option]'); i++) await new Promise(resolve => setTimeout(resolve, 25));
    const live = host.querySelector<HTMLElement>('[data-wh-property-option]'); assert(live?.textContent === values[0] && live.style.backgroundColor === 'rgb(22, 61, 84)', 'Live card block omitted colored options or treated authored labels as markup');
    const reader = parsed((await buildReaderHtml(project, [writing], defaultReaderPresentation(), 'en')).html);
    assert(reader.querySelectorAll('[data-wh-property-option]').length === 4 && !reader.querySelector('aside script') && reader.querySelector('aside [data-wh-property-option]')?.textContent === values[0], 'Reader block/linked-card appendix lost colors or escaped labels');
    const wikiData = await loadWorldWikiData(P), wiki = parsed(buildWorldWiki(wikiData, { locale: 'en' }).html);
    assert(wiki.querySelectorAll('[data-wh-property-option]').length === 2 && !wiki.querySelector('article script') && wiki.querySelector('[data-wh-property-option]')?.textContent === values[0], 'Wiki property article omitted colored values');
    const hidden = parsed(buildWorldWiki(wikiData, { locale: 'en', excludedFields: ['regions'] }).html); assert(!hidden.querySelector('[data-wh-property-option]'), 'Excluded property colors or values leaked into the wiki');
    await saveWorldEra(P, { id: E, name: 'Later', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    const source = (await readWorldDocument({ projectId: P, eraId: E }, 'codex', entry.id))!;
    await saveEraDocument({ projectId: P, eraId: E }, 'codex', { root: { ...entry, fields: { regions: JSON.stringify(['South']) } } as unknown as EraRow, children: {} }, source.version);
    const effective = await getEraProject({ projectId: P, eraId: E }), laterReader = parsed((await buildReaderHtml(effective, [writing], defaultReaderPresentation(), 'en', { projectId: P, eraId: E })).html);
    assert(laterReader.querySelectorAll('[data-wh-property-option]').length === 2 && [...laterReader.querySelectorAll('[data-wh-property-option]')].every(node => node.textContent === 'South'), 'Standalone Reader colored options ignored its explicit era');
    assert((await db.codexEntries.get(entry.id))?.fields.regions === encoded, 'Display projection rewrote stored multiselect JSON');
    return ['Live Codex, Reader block/appendix and wiki render the same escaped colored options', 'Wiki exclusions and explicit Reader era preserve Base data and original multiselect JSON'];
  } finally { dispose?.(); host.remove(); await deleteProject(P); }
}
