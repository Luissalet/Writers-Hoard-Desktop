import type { Project } from '@/types';
import { safeDictionaryFont } from '@/engines/dictionary/fonts';
import type { ReaderAudioTrack } from '@/engines/writings/readerPresentationTypes';
import { remapWorkspaceLibrary } from '@/components/project/workspace/library/portability';
import {cloneLocalToolStates} from '@/engines/local/stateTypes';

/** Remap only semantic local pointers; ordinary prose remains byte-identical. */
export type WorldToolIds = Readonly<Record<string, ReadonlySet<string>>>;
const toolPrefixes: Readonly<Record<string, string>> = { maps: 'map', board: 'board', timeline: 'tl', 'relation-tree': 'tree', dictionary: 'language', tables: 'table', 'character-sheets': 'sheet', radar: 'radar', 'model-viewer': 'model' };
export function projectToolIds(project: Project, core: { worldMaps?: { id: string }[]; boards?: { id: string }[]; timelines?: { id: string }[] } = {}): WorldToolIds {
  const ids = (rows: { id: string }[] | undefined) => new Set(rows?.map(row => row.id));
  return { maps: ids(core.worldMaps), board: ids(core.boards), timeline: ids(core.timelines), 'relation-tree': ids(project.relationTrees), dictionary: ids(project.dictionaries), tables: ids(project.dataTables), 'character-sheets': ids(project.characterSheets), radar: ids(project.radarCharts), 'model-viewer': ids(project.modelAssets) };
}
export function remapWorldRichContent(content: string, sourceProjectId: string, targetProjectId: string, remap: (id: string, prefix: string) => string, codexIds: ReadonlySet<string>, mediaIds: ReadonlySet<string> = new Set(), toolIds: WorldToolIds = {}): string {
  if (!content.includes('data-wh-codex-block') && !content.includes('data-wh-media-block') && !content.includes('data-wh-tool-block') && !content.includes('/codex?')) return content;
  const template = document.createElement('template'); template.innerHTML = content;
  for (const block of template.content.querySelectorAll('[data-wh-codex-block="true"], [data-wh-media-block="true"]')) {
    if (block.getAttribute('data-project-id') !== sourceProjectId) continue;
    const media = block.hasAttribute('data-wh-media-block'), attribute = media ? 'data-asset-id' : 'data-entry-id';
    const id = block.getAttribute(attribute) ?? ''; const admitted = (media ? mediaIds : codexIds).has(id);
    block.setAttribute('data-project-id', targetProjectId); block.setAttribute(attribute, admitted ? remap(id, media ? 'media' : 'codex') : '');
  }
  for (const block of template.content.querySelectorAll('[data-wh-tool-block="true"]')) {
    if (block.getAttribute('data-project-id') !== sourceProjectId) continue;
    const kind = block.getAttribute('data-tool-kind') ?? '', id = block.getAttribute('data-document-id') ?? '';
    block.setAttribute('data-project-id', targetProjectId);
    block.setAttribute('data-document-id', toolPrefixes[kind] && toolIds[kind]?.has(id) ? remap(id, toolPrefixes[kind]) : '');
  }
  for (const anchor of template.content.querySelectorAll('a[href]')) {
    try {
      const url = new URL(anchor.getAttribute('href')!, 'https://writer.invalid');
      if (url.origin !== 'https://writer.invalid' || url.pathname !== `/project/${encodeURIComponent(sourceProjectId)}/codex`) continue;
      const id = url.searchParams.get('entry') ?? '';
      if (codexIds.has(id)) anchor.setAttribute('href', `/project/${encodeURIComponent(targetProjectId)}/codex?entry=${encodeURIComponent(remap(id, 'codex'))}`); else anchor.removeAttribute('href');
    } catch { /* Ordinary links retain their original destination. */ }
  }
  return template.innerHTML;
}

/** Clone project-owned world documents without retaining links into the source project. */
export function remapWorldMetadata(project: Project, remap: (id: string, prefix: string) => string, codexIds: ReadonlySet<string>, mediaIds: ReadonlySet<string> = new Set(), writingIds: ReadonlySet<string> = new Set(), toolIds: WorldToolIds = projectToolIds(project)): Partial<Project> {
  const entry = (id: string | undefined) => id && codexIds.has(id) ? remap(id, 'codex') : undefined;
  const templateIds = new Set(project.codexTemplates?.map(template => template.id));
  const templateLink = (id: string | undefined) => id && templateIds.has(id) ? remap(id, 'template') : undefined;
  const track = (audio: ReaderAudioTrack | undefined): ReaderAudioTrack | undefined => audio && mediaIds.has(audio.assetId) ? { ...audio, assetId: remap(audio.assetId, 'media') } : undefined;
  return {
    localToolStates:cloneLocalToolStates(project.localToolStates),
    ...remapWorkspaceLibrary(project, remap, { codex: codexIds, writings: writingIds, media: mediaIds, maps: toolIds.maps, board: toolIds.board, timeline: toolIds.timeline, dictionary: toolIds.dictionary, tables: toolIds.tables, genealogy: toolIds['relation-tree'], 'character-sheets': toolIds['character-sheets'], radar: toolIds.radar, 'model-viewer': toolIds['model-viewer'] }),
    readerPresentation: project.readerPresentation ? { ...project.readerPresentation, revision: 0, chapters: Object.fromEntries(Object.entries(project.readerPresentation.chapters).filter(([id]) => writingIds.has(id)).map(([id, style]) => [remap(id, 'wr'), { ...style, audio: track(style.audio), paragraphAudio: style.paragraphAudio?.flatMap(cue => { const audio = track(cue.track); return audio ? [{ ...cue, track: audio }] : []; }) }])) } : undefined,
    codexGraphLayout: project.codexGraphLayout ? { positions: Object.fromEntries(Object.entries(project.codexGraphLayout.positions).filter(([id]) => codexIds.has(id)).map(([id, position]) => [remap(id, 'codex'), position])) } : undefined,
    wikiOptions: project.wikiOptions ? {
      ...project.wikiOptions,
      excludedEntryIds: project.wikiOptions.excludedEntryIds?.map(id => entry(id)).filter((id): id is string => Boolean(id)),
      excludedMapIds: project.wikiOptions.excludedMapIds?.map(id => remap(id, 'map')),
    } : undefined,
    codexTemplates: project.codexTemplates?.map(template => ({ ...template, id: remap(template.id, 'template'), parentTemplateId: templateLink(template.parentTemplateId), referenceFieldDefinitions: template.referenceFieldDefinitions?.map(field => ({ ...field, targetTemplateId: templateLink(field.targetTemplateId) })), content: remapWorldRichContent(template.content, project.id, remap(project.id, 'proj'), remap, codexIds, mediaIds, toolIds) })),
    dictionaries: project.dictionaries?.map(dictionary => ({
      ...dictionary, id: remap(dictionary.id, 'language'), font: safeDictionaryFont(dictionary.font),
      words: dictionary.words.map(word => ({ ...word, id: remap(word.id, 'word'), linkedEntryId: entry(word.linkedEntryId) })),
    })),
    modelAssets: project.modelAssets?.map(asset => ({ ...asset, id: remap(asset.id, 'model') })),
    characterSheets: project.characterSheets?.map(sheet => ({ ...sheet, id: remap(sheet.id, 'sheet'), linkedEntryId: entry(sheet.linkedEntryId), revision: 0 })),
    radarCharts: project.radarCharts?.map(chart => ({ ...chart, id: remap(chart.id, 'radar'), revision: 0, series: chart.series.map(series => ({ ...series, linkedEntryId: entry(series.linkedEntryId) })) })),
    dataTables: project.dataTables?.map(table => ({
      ...table, id: remap(table.id, 'table'),
      columns: table.columns.map(column => ({ ...column, id: remap(column.id, 'column') })),
      rows: table.rows.map(row => ({ id: remap(row.id, 'row'), cells: Object.fromEntries(table.columns.map(column => [remap(column.id, 'column'), column.kind === 'reference' ? entry(row.cells[column.id]) ?? '' : row.cells[column.id] ?? ''])) })),
    })),
    relationTrees: project.relationTrees?.map(tree => ({
      ...tree, id: remap(tree.id, 'tree'), revision: 0,
      copiedFrom: tree.copiedFrom ? remap(tree.copiedFrom, 'tree') : undefined,
      nodes: tree.nodes.map(node => ({ ...node, id: remap(node.id, 'tree-node'), codexEntryId: entry(node.codexEntryId) })),
      junctions: tree.junctions?.map(junction => ({ ...junction, id: remap(junction.id, 'tree-junction') })),
      edges: tree.edges.map(edge => ({ ...edge, id: remap(edge.id, 'tree-edge'), source: remap(edge.source, tree.junctions?.some(junction => junction.id === edge.source) ? 'tree-junction' : 'tree-node'), target: remap(edge.target, tree.junctions?.some(junction => junction.id === edge.target) ? 'tree-junction' : 'tree-node'), via: edge.via?.map(id => remap(id, 'tree-junction')) })),
    })),
  };
}
