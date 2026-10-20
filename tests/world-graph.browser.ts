import { db } from '@/db';
import type { CodexEntry } from '@/types';
import type { Relationship } from '@/engines/relationships/types';
import { buildWorldGraph, filterWorldGraph, layoutWorldGraph } from '@/engines/codex/worldGraph/model';
import { saveWorldGraphLayout } from '@/engines/codex/worldGraph/store';
import { exportWorldGraphSvg } from '@/engines/codex/worldGraph/svg';
import { exportProjectData, importProjectData } from '@/db/operations';
import type { WorldGraphFilters } from '@/engines/codex/worldGraph/types';
import { extractContentCodexReferences } from '@/services/codexReference/contentReferences';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export async function testWorldGraph(): Promise<string[]> {
  const P = `world-graph-${Date.now()}`, passed: string[] = [];
  const entry = (id: string, title: string, extra: Partial<CodexEntry> = {}): CodexEntry => ({ id: `${P}-${id}`, projectId: P, title, type: 'character', fields: {}, content: '', tags: [], relations: [], createdAt: 1, updatedAt: 1, ...extra });
  const alvaro = entry('alvaro', 'Álvaro', { fields: { aliases: 'La Sombra' } }), ana = entry('ana', 'Ana'), anaRuiz = entry('ana-ruiz', 'Ana Ruiz'), port = entry('port', 'Puerto de Sal', { type: 'location' }), alex1 = entry('alex1', 'Alex'), alex2 = entry('alex2', 'Alex'), isolated = entry('isolated', '<Unlinked>', { type: 'concept' }), foreign = entry('foreign', 'Other project', { projectId: `${P}-foreign` });
  const narrator = entry('narrator', 'Narrator', { type: 'concept', content: '<p>🗺️ ÁLVARO vio a Ana Ruiz y a La Sombra en el Puerto de Sal. Alex saludó. Other project.</p>', fields: { aliases: 'Ana', context: 'PUERTO DE SAL' }, relations: [{ targetId: port.id, targetTitle: port.title, type: 'located_in' }, { targetId: foreign.id, targetTitle: foreign.title, type: 'unknown' }], referenceFields: { home: [port.id, port.id, foreign.id] } });
  const relationship = (id: string, a: string, b: string, projectId = P): Relationship => ({ id, projectId, entityAId: a, entityAType: 'codex-entry', entityAName: '', entityBId: b, entityBType: 'codex-entry', entityBName: '', kind: 'mentor', intensity: 3, label: 'Mentor', notes: 'Authored connection', directional: true, state: 'current', createdAt: 1, updatedAt: 1 });
  const entries = [narrator, alvaro, ana, anaRuiz, port, alex1, alex2, isolated, foreign];
  const graph = buildWorldGraph({ projectId: P, entries, relationships: [relationship('r1', alvaro.id, ana.id), relationship('foreign-r', alvaro.id, port.id, `${P}-foreign`), relationship('unresolved', alvaro.id, foreign.id)], referenceLabels: { [narrator.id]: { home: 'Residence' } } });
  assert(graph.nodes.length === 8 && graph.nodes.every(node => node.id !== foreign.id), 'Only this project’s cards become graph nodes');
  const alvaroMention = graph.edges.find(edge => edge.kind === 'mention' && edge.source === narrator.id && edge.target === alvaro.id);
  assert(alvaroMention?.count === 2 && alvaroMention.evidence.some(item => item.matchedAlias === 'La Sombra') && alvaroMention.evidence[0].excerpt.includes('ÁLVARO'), 'Name and alias matches aggregate with original text evidence');
  assert(!graph.edges.some(edge => edge.kind === 'mention' && edge.source === narrator.id && edge.target === ana.id), 'Longer full names suppress nested shorter names');
  assert(graph.edges.filter(edge => edge.kind === 'mention' && [alex1.id, alex2.id].includes(edge.target)).every(edge => edge.ambiguousCount === 1) && graph.stats.ambiguousMatches === 1, 'Shared aliases/names are explicitly ambiguous');
  assert(graph.edges.some(edge => edge.kind === 'codex' && edge.label === 'located_in') && graph.edges.some(edge => edge.kind === 'reference' && edge.label === 'Residence') && graph.edges.some(edge => edge.kind === 'relationship' && edge.recordId === 'r1'), 'Authored card relations, typed reference fields and project relationships retain distinct provenance');
  assert(!graph.nodes.some(node => node.id === foreign.id) && !graph.edges.some(edge => edge.target === foreign.id || edge.source === foreign.id || edge.recordId === 'foreign-r') && graph.stats.unresolvedReferences === 3, 'Foreign endpoints never become nodes or edges beyond a scoped unresolved count');
  passed.push('World graph: indexed title/alias mentions, evidence, ambiguity and three explicit relationship sources remain distinct and project-scoped');
  const filters: WorldGraphFilters = { query: '', type: 'all', tag: '', kinds: ['mention', 'codex', 'reference', 'relationship'], focusId: '', depth: 1, showIsolated: true, nodeLimit: 150, edgeLimit: 500 };
  const referenceOnly = filterWorldGraph(graph, { ...filters, kinds: ['reference'], showIsolated: false });
  assert(referenceOnly.nodes.length === 2 && referenceOnly.edges.length === 1, 'Kind/isolation filters explain only the selected relation source');
  const aliasOnly = filterWorldGraph(graph, { ...filters, query: 'sombra' }); assert(aliasOnly.nodes.length === 1 && aliasOnly.nodes[0].id === alvaro.id, 'Search finds aliases');
  const firstHop = filterWorldGraph(graph, { ...filters, focusId: narrator.id, depth: 1 }), secondHop = filterWorldGraph(graph, { ...filters, focusId: narrator.id, depth: 2 });
  assert(!firstHop.nodes.some(node => node.id === ana.id) && secondHop.nodes.some(node => node.id === ana.id), 'Neighborhood depth follows filtered edges');
  const limited = filterWorldGraph(graph, { ...filters, nodeLimit: 2, edgeLimit: 1 });
  assert(limited.nodes.length === 2 && limited.omittedNodes === 6 && limited.matchingEdges > limited.edges.length && limited.omittedEdges === limited.matchingEdges - limited.edges.length, 'Caps expose exact omitted counts instead of pretending completeness');
  const positions = layoutWorldGraph(graph.nodes, graph.edges, { positions: { [alvaro.id]: { x: 720, y: -120 } } });
  assert(positions[alvaro.id].x === 720 && positions[alvaro.id].y === -120 && JSON.stringify(layoutWorldGraph(graph.nodes, graph.edges)) === JSON.stringify(layoutWorldGraph(graph.nodes, graph.edges)), 'Automatic layout is deterministic and preserves explicitly pinned positions');
  const svg = exportWorldGraphSvg(graph.nodes, graph.edges, positions, { mention: 'Mentions', codex: 'Card relations', reference: 'References', relationship: 'Relationships' });
  assert(svg.includes('&lt;Unlinked&gt;') && !new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror'), 'Diagram export safely escapes titles and yields portable XML');
  passed.push('World graph: type/source/alias/neighborhood filters, visible caps, deterministic pinned layout and escaped SVG export pass');

  const linked = entry('linked', 'A renamed destination'), live = entry('live', 'Current live destination'), phantom = entry('phantom', 'PhantomCachedName'), trap = entry('trap', 'Trap destination');
  const escaped = entry('escaped', 'Escaped destination', { id: `${P}-&"'<>世界` });
  const href = (id: string, projectId = P) => `/project/${encodeURIComponent(projectId)}/codex?entry=${encodeURIComponent(id)}`;
  const attr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const trapLink = `<a href="${href(trap.id)}">inert pointer</a>`;
  const rich = entry('rich', 'Rich reference owner', { content: [
    `<p><a href="${href(linked.id)}">the route nobody named</a> <a href='${href(linked.id)}&amp;view=full'><strong>another custom caption</strong></a></p>`,
    `<ASIDE DATA-WH-CODEX-BLOCK="true" DATA-PROJECT-ID="${P}" DATA-ENTRY-ID="${live.id}" data-label="PhantomCachedName"><p>Codex: PhantomCachedName</p>${trapLink}</ASIDE>`,
    `<aside data-wh-codex-block="true" data-project-id="${P}" data-entry-id="${attr(escaped.id)}"><p>Old and unrelated label</p></aside>`,
    `<a href="${Array.from(href(escaped.id)).map(char => `&#${char.codePointAt(0)};`).join('')}">numeric attribute escaping</a>`,
    `<a href="${href('missing-local')}">missing</a><aside data-wh-codex-block="true" data-project-id="${P}" data-entry-id="missing-block"><p>PhantomCachedName</p></aside>`,
    `<a href="${href(trap.id, P + '-foreign')}">foreign owner</a><aside data-wh-codex-block="true" data-project-id="${P}-foreign" data-entry-id="${trap.id}"><p>PhantomCachedName</p></aside>`,
    `<a href="https://foreign.invalid${href(trap.id)}">external origin</a><a href="javascript:alert(1)">invalid protocol</a><a href="${href(trap.id)}&#0;">invalid scalar</a>`,
    `<a href="${href(trap.id)}&copy;">ambiguous entity in ID</a><a href="${href(trap.id)}" href="${href(linked.id)}">first attribute wins</a>`,
    `<!-- ${trapLink} --><script>const fake = '${trapLink}';</script><style>/* ${trapLink} */</style><textarea>${trapLink}</textarea><template><template>${trapLink}</template>${trapLink}</template>`,
    `<div data-note="${trapLink.replace(/"/g, "'")}">plain text</div>&lt;a href="${href(trap.id)}"&gt;escaped example&lt;/a&gt;`,
  ].join('') });
  // The intentional duplicate anchor above targets Trap once: a later duplicate
  // href must not redirect it to Linked. Every other Trap source is inert/foreign.
  const richGraph = buildWorldGraph({ projectId: P, entries: [rich, linked, live, escaped, phantom, trap], relationships: [], contentReferenceLabels: { link: 'Enlace del texto', block: 'Bloque Codex vivo' } });
  const linkEdge = richGraph.edges.find(edge => edge.kind === 'reference' && edge.source === rich.id && edge.target === linked.id);
  assert(linkEdge?.label === 'Enlace del texto' && linkEdge.count === 2 && linkEdge.directional, 'Semantic anchors with arbitrary prose must aggregate by pointer identity');
  assert(richGraph.edges.some(edge => edge.kind === 'reference' && edge.target === live.id && edge.label === 'Bloque Codex vivo') && richGraph.edges.filter(edge => edge.kind === 'reference' && edge.target === escaped.id).length === 2, 'Live block IDs and escaped Unicode anchor/block IDs must resolve independently of their captions');
  assert(!richGraph.edges.some(edge => edge.kind === 'mention' && edge.target === phantom.id) && richGraph.edges.filter(edge => edge.target === trap.id).length === 1 && richGraph.stats.unresolvedReferences === 2, 'Cached atom labels, foreign pointers, inert HTML and invalid escapes must not manufacture graph edges');
  const renamed = buildWorldGraph({ projectId: P, entries: [rich, { ...linked, title: 'Another completely new name' }, live, escaped, phantom, trap], relationships: [] });
  assert(renamed.edges.some(edge => edge.kind === 'reference' && edge.target === linked.id && edge.count === 2), 'Renaming a target must not remove an authored content reference');
  assert(!extractContentCodexReferences(`<div data-note="unterminated ${trapLink}`, P).references.length && !extractContentCodexReferences(`&lt;aside data-wh-codex-block="true" data-project-id="${P}" data-entry-id="${trap.id}"&gt;`, P).references.length, 'Malformed quoted tags and escaped serialized examples must remain ordinary text');
  passed.push('World graph rich pointers: custom-label links, renamed targets, stale live blocks, escaped Unicode, first-attribute ownership and inert/foreign/invalid HTML retain explicit scoped provenance');
  const many = Array.from({ length: 5000 }, (_, index) => entry(`large-${index}`, `Entity ${index}`, { content: `<p>Entity ${(index + 1) % 5000} and Entity ${(index + 27) % 5000}.</p>` }));
  const start = performance.now(), large = buildWorldGraph({ projectId: P, entries: many, relationships: [] }), elapsed = performance.now() - start;
  assert(large.nodes.length === 5000 && large.edges.length === 10000, 'Large indexed analysis covers every card and inferred mention edge');
  passed.push(`World graph: 5,000 cards / 10,000 edges analyzed in ${Math.round(elapsed)} ms; visual caps do not truncate analysis`);

  let cloned = '';
  try {
    await db.projects.put({ id: P, title: 'Graph portability', type: 'standalone', mode: 'custom', color: '#d5b575', description: 'Keep metadata', status: 'draft', enabledEngines: ['codex'], engineOrder: ['codex'], createdAt: 1, updatedAt: 1 });
    await db.codexEntries.bulkPut(entries);
    await saveWorldGraphLayout(P, { [alvaro.id]: { x: 720, y: -120 }, [foreign.id]: { x: 99, y: 99 }, [ana.id]: { x: Infinity, y: 2 } });
    let project = (await db.projects.get(P))!;
    assert(project.codexGraphLayout?.positions[alvaro.id].x === 720 && Object.keys(project.codexGraphLayout.positions).length === 1 && project.description === 'Keep metadata', 'Layout writes reject foreign/invalid positions and preserve other project metadata');
    const reject = () => { throw new Error('Expected graph layout failure'); }; db.projects.hook('updating', reject);
    try { await saveWorldGraphLayout(P, { [ana.id]: { x: 10, y: 20 } }); throw new Error('Expected failure'); } catch (error) { assert(String(error).includes('Expected graph layout failure'), 'Only the induced storage failure is expected'); }
    finally { db.projects.hook('updating').unsubscribe(reject); }
    assert((await db.projects.get(P))!.codexGraphLayout?.positions[alvaro.id], 'Failed layout write preserves saved positions');
    await saveWorldGraphLayout(P, { [alvaro.id]: { x: 720, y: -120 }, [ana.id]: { x: 10, y: 20 } });
    cloned = await importProjectData(await exportProjectData(P));
    project = (await db.projects.get(cloned))!; const clonedCards = await db.codexEntries.where('projectId').equals(cloned).toArray(), clonedAlvaro = clonedCards.find(entry => entry.title === alvaro.title)!;
    assert(project.codexGraphLayout?.positions[clonedAlvaro.id].x === 720 && !project.codexGraphLayout.positions[alvaro.id], 'Legacy JSON cloning remaps portable layout node keys to cloned card ownership');
    passed.push('World graph layout: scoped atomic persistence, failure recovery and portable project cloning retain correct card ownership');
  } finally {
    for (const id of [P, cloned].filter(Boolean)) { await db.codexEntries.where('projectId').equals(id).delete(); await db.projects.delete(id); }
    await db.codexEntries.where('projectId').equals(`${P}-foreign`).delete();
  }
  return passed;
}
