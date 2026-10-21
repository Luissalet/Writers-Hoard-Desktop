import {remapLocalToolBlocksInHtml,validateLocalToolBlocksInHtml} from '@/engines/local/blocks/types';
import {remapLocalToolReferences} from '@/engines/local/stateCodec';
import {remapSourceToolDocuments} from '@/engines/local/documents/types';
import {remapToolDockLayout} from '@/engines/writings/toolDock/types';
import {remapWorldFolderImports,WORLD_FOLDER_IMPORT_ID_PREFIX} from '@/services/worldFolderImport/portability';
import {worldDocumentPrefixes} from '@/services/worldEras/documentPrefixes';
import { cloneCoverJacket } from '@/engines/writings/coverDesign/model';
import { validateCodexOptionLists } from '@/engines/codex/optionListTypes';
import { validateProjectArchiveMetadata } from '@/services/projectArchiveMetadata';
import { remapWikiProfiles } from '@/services/wikiProfiles/validation';
import { cloneLocalToolInstallations } from '@/engines/local/installations';
import {validateWorkspaceAppearanceProject} from '@/services/workspaceAppearance/validation';
import { remapPublishedEditions, validatePublishedEditionsProject } from '@/services/publishedEditions/validation';
import { remapPublishedEditionContent } from '@/services/publishedEditions/portability';
import type { Project } from '@/types';
import { safeDictionaryFont } from '@/engines/dictionary/fonts';
import type { ReaderAudioTrack } from '@/engines/writings/readerPresentationTypes';
import { remapWorkspaceLibrary } from '@/components/project/workspace/library/portability';
import {cloneLocalToolStates,validateLocalToolProjectStates} from '@/engines/local/stateTypes';
import type { WorkflowStep } from '@/types/writingWorkflow';

/** Complete project copies carry the materials omitted by the legacy JSON format. */
export function remapProjectDuplicateExtras(project: Project, remap: (id: string, prefix: string) => string, entity: (engineId: string, id: string) => string): Partial<Project> {
  const creativeEngines = { note: 'notes', board: 'board-node', codex: 'codex', gallery: 'gallery', seed: 'seeds' } as const;
  const promotionEngines = { note: 'notes', board: 'board-node', codex: 'codex', seed: 'seeds', outline: 'outline-beat', timeline: 'timeline-event' } as const;
  const materialEngines = { note: 'notes', writing: 'writings', snapshot: 'scrapper', citation: 'citations' } as const;
  const steps = (rows: WorkflowStep[]) => rows.map(step => ({ ...step, id: remap(step.id, 'workflow-step') }));
  return {
    creativePossibilities: project.creativePossibilities?.map(item => ({
      ...item, id: remap(item.id, 'possibility'), projectId: remap(project.id, 'proj'),
      provenance: { ...item.provenance, sources: item.provenance.sources.map(source => source.projectId === project.id
        ? { ...source, projectId: remap(project.id, 'proj'), id: entity(creativeEngines[source.kind], source.id) }
        : { ...source }) },
      promotion: item.promotion ? { ...item.promotion, entityId: entity(promotionEngines[item.promotion.target], item.promotion.entityId) } : undefined,
    })),
    writingWorkflows: project.writingWorkflows?.map(workflow => ({
      ...workflow, id: remap(workflow.id, 'workflow'),
      materials: workflow.materials.map(material => ({ ...material, id: entity(materialEngines[material.kind], material.id) })),
      steps: steps(workflow.steps),
      history: workflow.history.map(revision => ({ ...revision, id: remap(revision.id, 'workflow-history'), steps: steps(revision.steps) })),
      exports: workflow.exports.map(item => ({ ...item, stepId: remap(item.stepId, 'workflow-step'), writingId: entity('writings', item.writingId) })),
    })),
  };
}

/** Remap only semantic local pointers; ordinary prose remains byte-identical. */
export type WorldToolIds = Readonly<Record<string, ReadonlySet<string>>>;
const toolPrefixes: Readonly<Record<string, string>> = { 'dialog-scene':'scene',worldgen:'world',maps: 'map', board: 'board', timeline: 'tl', 'relation-tree': 'tree', dictionary: 'language', tables: 'table', 'character-sheets': 'sheet', radar: 'radar', 'model-viewer': 'model' };
export function projectToolIds(project: Project, core: { writings?:{id:string}[];scenes?:{id:string}[];generatedWorlds?:{id:string}[];worldMaps?: { id: string }[]; boards?: { id: string }[]; timelines?: { id: string }[] } = {}): WorldToolIds {
  const ids = (rows: { id: string }[] | undefined) => new Set(rows?.map(row => row.id));
  const localDocuments: Record<string, Set<string>> = {};
  for (const row of project.sourceToolDocuments ?? []) (localDocuments[`local-tool-${row.namespace}`] ??= new Set()).add(row.id);
  return { ...localDocuments, writings:ids(core.writings), 'dialog-scene':ids(core.scenes),worldgen:ids(core.generatedWorlds),maps: ids(core.worldMaps), board: ids(core.boards), timeline: ids(core.timelines), 'relation-tree': ids(project.relationTrees), dictionary: ids(project.dictionaries), tables: ids(project.dataTables), 'character-sheets': ids(project.characterSheets), radar: ids(project.radarCharts), 'model-viewer': ids(project.modelAssets) };
}
export function remapWorldRichContent(content: string, sourceProjectId: string, targetProjectId: string, remap: (id: string, prefix: string) => string, codexIds: ReadonlySet<string>, mediaIds: ReadonlySet<string> = new Set(), toolIds: WorldToolIds = {}): string {
  if(content.includes('data-wh-source-block')){validateLocalToolBlocksInHtml(content,sourceProjectId);content=remapLocalToolBlocksInHtml(content,remap,targetProjectId);}
  if (!content.includes('data-wh-codex-block') && !content.includes('data-wh-media-block') && !content.includes('data-wh-tool-block') && !/\/(?:codex|writings|tables|timeline)\?/.test(content)) return content;
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
    const catalogKey=kind==='local-tool'?`local-tool-${block.getAttribute('data-namespace')??''}`:kind,prefix=kind==='local-tool'?'source-tool':toolPrefixes[kind];
    block.setAttribute('data-project-id', targetProjectId);
    block.setAttribute('data-document-id', prefix && toolIds[catalogKey]?.has(id) ? remap(id, prefix) : '');
  }
  for (const anchor of template.content.querySelectorAll('a[href]')) {
    try {
      const url = new URL(anchor.getAttribute('href')!, 'https://writer.invalid');
      const routes: Record<string,{parameter:string;ids:ReadonlySet<string>;prefix:string}> = {
        codex:{parameter:'entry',ids:codexIds,prefix:'codex'},
        writings:{parameter:'writing',ids:toolIds.writings??new Set(),prefix:'wr'},
        tables:{parameter:'entity',ids:toolIds.tables??new Set(),prefix:'table'},
        timeline:{parameter:'entity',ids:toolIds.timeline??new Set(),prefix:'tl'},
      };
      const route = Object.keys(routes).find(kind=>url.pathname===`/project/${encodeURIComponent(sourceProjectId)}/${kind}`);
      if (url.origin !== 'https://writer.invalid' || !route) continue;
      const target=routes[route],id=url.searchParams.get(target.parameter)??'';
      if (!target.ids.has(id)) {anchor.removeAttribute('href');continue;}
      url.pathname=`/project/${encodeURIComponent(targetProjectId)}/${route}`;
      url.searchParams.set(target.parameter,remap(id,target.prefix));
      const era=url.searchParams.get('era');if(era)url.searchParams.set('era',remap(era,'era'));
      anchor.setAttribute('href',`${url.pathname}${url.search}${url.hash}`);
    } catch { /* Ordinary links retain their original destination. */ }
  }
  return template.innerHTML;
}

/** Clone project-owned world documents without retaining links into the source project. */
export function remapWorldMetadata(project: Project, remap: (id: string, prefix: string) => string, codexIds: ReadonlySet<string>, mediaIds: ReadonlySet<string> = new Set(), writingIds: ReadonlySet<string> = new Set(), toolIds: WorldToolIds = projectToolIds(project)): Partial<Project> {
  validateProjectArchiveMetadata(project);
  validateLocalToolProjectStates(project);validateWorkspaceAppearanceProject(project);validatePublishedEditionsProject(project);validateCodexOptionLists(project.codexOptionLists);
  const entry = (id: string | undefined) => id && codexIds.has(id) ? remap(id, 'codex') : undefined;
  const templateIds = new Set(project.codexTemplates?.map(template => template.id));
  const templateLink = (id: string | undefined) => id && templateIds.has(id) ? remap(id, 'template') : undefined;
  const track = (audio: ReaderAudioTrack | undefined): ReaderAudioTrack | undefined => audio && mediaIds.has(audio.assetId) ? { ...audio, assetId: remap(audio.assetId, 'media') } : undefined;
  const localStates=(states:Project['localToolStates'])=>{const cloned=cloneLocalToolStates(states);if(cloned)for(const [namespace,state]of Object.entries(cloned)){const codec=project.localToolContracts?.[namespace];if(codec)state.data=remapLocalToolReferences(state.data,codec,(kind,id)=>remap(id,worldDocumentPrefixes[kind]));}return cloned;};
  return {
    sourceToolDocuments: remapSourceToolDocuments(project.sourceToolDocuments, remap),
    writingToolDock: remapToolDockLayout(project.writingToolDock, remap),
    worldFolderImports: remapWorldFolderImports(project.worldFolderImports, (id,kind)=>remap(id,kind==='import'?WORLD_FOLDER_IMPORT_ID_PREFIX:kind==='era'?'era':worldDocumentPrefixes[kind])),
    localToolContracts: project.localToolContracts ? structuredClone(project.localToolContracts) : undefined,
    ...remapWikiProfiles(project, remap),
    localToolInstallations: cloneLocalToolInstallations(project.localToolInstallations),
    entityDetectionPreferences: project.entityDetectionPreferences ? { ...project.entityDetectionPreferences, revision: 0 } : undefined,
    ...remapPublishedEditions(project, remap, content => remapPublishedEditionContent(project.id, remap(project.id, 'proj'), content, remap), id => remap(id, 'media')),
    worldEras: project.worldEras?.map(era => {
      const defaults = era.defaults;
      const mapped = defaults ? remapWorldMetadata({ ...project, ...defaults, worldEras: undefined }, remap, codexIds, mediaIds, writingIds, toolIds) : undefined;
      return { ...era, readerCover: era.readerCover ? cloneCoverJacket(era.readerCover, remap) : undefined, id: remap(era.id, 'era'),localToolStates:localStates(era.localToolStates), defaults: defaults ? Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, mapped && key in mapped ? mapped[key as keyof Project] : value])) : undefined };
    }),
    localToolStates:localStates(project.localToolStates),
    ...remapWorkspaceLibrary(project, remap, { ...Object.fromEntries(Object.entries(toolIds).filter(([kind]) => kind.startsWith('local-tool-'))), 'dialog-scene':toolIds['dialog-scene'],worldgen:toolIds.worldgen,codex: codexIds, writings: writingIds, media: mediaIds, maps: toolIds.maps, board: toolIds.board, timeline: toolIds.timeline, dictionary: toolIds.dictionary, tables: toolIds.tables, genealogy: toolIds['relation-tree'], 'character-sheets': toolIds['character-sheets'], radar: toolIds.radar, 'model-viewer': toolIds['model-viewer'] }),
    readerPresentation: project.readerPresentation ? { ...project.readerPresentation, cover: project.readerPresentation.cover?.jacket ? cloneCoverJacket(project.readerPresentation.cover, remap) : project.readerPresentation.cover, revision: 0, chapters: Object.fromEntries(Object.entries(project.readerPresentation.chapters).filter(([id]) => writingIds.has(id)).map(([id, style]) => [remap(id, 'wr'), { ...style, audio: track(style.audio), paragraphAudio: style.paragraphAudio?.flatMap(cue => { const audio = track(cue.track); return audio ? [{ ...cue, track: audio }] : []; }) }])) } : undefined,
    codexGraphLayout: project.codexGraphLayout ? { positions: Object.fromEntries(Object.entries(project.codexGraphLayout.positions).filter(([id]) => codexIds.has(id)).map(([id, position]) => [remap(id, 'codex'), position])) } : undefined,
    wikiOptions: project.wikiOptions ? {
      ...project.wikiOptions,
      excludedEntryIds: project.wikiOptions.excludedEntryIds?.map(id => entry(id)).filter((id): id is string => Boolean(id)),
      excludedMapIds: project.wikiOptions.excludedMapIds?.map(id => remap(id, 'map')),
    } : undefined,
    codexOptionLists: project.codexOptionLists?.map(list => ({ ...list, id: remap(list.id, 'option-list'), revision: 0 })),
    codexTemplates: project.codexTemplates?.map(template => ({ ...template, id: remap(template.id, 'template'), parentTemplateId: templateLink(template.parentTemplateId), referenceFieldDefinitions: template.referenceFieldDefinitions?.map(field => ({ ...field, targetTemplateId: templateLink(field.targetTemplateId) })), content: remapWorldRichContent(template.content, project.id, remap(project.id, 'proj'), remap, codexIds, mediaIds, toolIds) })),
    dictionaries: project.dictionaries?.map(dictionary => ({
      ...dictionary, id: remap(dictionary.id, 'language'), font: safeDictionaryFont(dictionary.font),
      words: dictionary.words.map(word => ({ ...word, id: remap(word.id, 'word'), linkedEntryId: entry(word.linkedEntryId) })),
    })),
    modelAssets: project.modelAssets?.map(asset => ({ ...asset, id: remap(asset.id, 'model') })),
    characterSheets: project.characterSheets?.map(sheet => ({ ...sheet, id: remap(sheet.id, 'sheet'), linkedEntryId: entry(sheet.linkedEntryId), revision: 0 })),
    radarCharts: project.radarCharts?.map(chart => ({ ...chart, id: remap(chart.id, 'radar'), revision: 0, series: chart.series.map(series => ({ ...series, linkedEntryId: entry(series.linkedEntryId) })) })),
    dataTables: project.dataTables?.map(table => ({
      ...table, id: remap(table.id, 'table'),codexTemplateId:templateLink(table.codexTemplateId),
      columns: table.columns.map(column => ({ ...column, id: column.id.startsWith('property:')?column.id:remap(column.id, 'column'),calculation:column.calculation?{...column.calculation,rowBindings:Object.fromEntries(Object.entries(column.calculation.rowBindings).map(([name,id])=>[name,id.startsWith('property:')?id:remap(id,'column')])),columnBindings:Object.fromEntries(Object.entries(column.calculation.columnBindings).map(([name,id])=>[name,id.startsWith('property:')?id:remap(id,'column')]))}:undefined })),
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
