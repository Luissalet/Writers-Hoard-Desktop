import {renderLocalAssetPreview} from '@/engines/local/assetBrowser';
import {richProsePreviewHtml,type RichProsePolicy} from '@/engines/local/richProseHtml';
import {wikiDocumentExcluded} from '@/services/wikiProfiles/policy';
import {eraDocumentKinds,type EraDocumentKind} from '@/services/worldEras/types';
import type {ReaderSource} from '@/engines/writings/readerSource';
import {sourceDocumentPreview} from '@/engines/local/documents/preview';
import { db } from '@/db';
import { getEraProject, listEraRows, readEraRow } from '@/services/worldEras/store';
import type { CodexEntry, WorldMap, MapPin, Timeline, TimelineEvent } from '@/types';
import type { Board, BoardNode } from '@/engines/board/types';
import { visibleCanvasNodes, pileItemCount } from '@/engines/board/graph/membership';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { exportMapSvg, DEFAULT_MAP_LAYERS } from '@/components/maps/mapGeometry';
import { exportRelationTreeSvg } from '@/engines/genealogy/relationTrees';
import { exportRadarSvgComplete } from '@/engines/radar/interchange';
import { validateSheet,type CharacterSheet } from '@/engines/character-sheets/types';
import { cocSummary,type CocSummary } from '@/engines/character-sheets/cocSummary';
import { cocSummaryHtml } from '@/engines/character-sheets/cocSummaryMarkup';
import { sheetPaper } from '@/engines/character-sheets/paper';
import { projectCodexEntry } from '@/engines/codex/properties';
import { resolveRadarSeries } from '@/engines/radar/model';
import { sheetValues } from '@/engines/tables/formulas';
import { projectWorldTable } from '@/engines/tables/projection';
import { cellKey } from '@/engines/tables/types';
import { compactTimelineLabel } from '@/engines/timeline/timelineSettings';
import { resolveWorldCalendar } from '@/engines/timeline/worldCalendarStore';
import { toolBlockCopy } from './copy';
import { readerModel, modelReaderMarkup } from '@/engines/model-viewer/readerMarkup';
import type { ModelAsset } from '@/engines/model-viewer/portable';
import { prepareModelReaderRuntime } from '@/engines/model-viewer/offlineExport';
import { escapeToolText as esc, targetAllowed, toolTarget, type ToolDocumentTarget } from './model';

export interface ToolPreview { title: string; html: string; truncated: boolean; model?: ModelAsset;sheet?:CharacterSheet;summary?:CocSummary }
export interface ToolExportPolicy { assetFontCollector?:import('@/engines/local/localAssetFonts').LocalAssetFont[]; page?:boolean; excludedDocuments?:readonly {kind:string;id:string;namespace?:string}[]; source?:ReaderSource; eraId?: string; includeMaps?: boolean; includeImages?: boolean; includeMedia?: boolean; excludedMapIds?: ReadonlySet<string>|readonly string[]; excludedEntryIds?: ReadonlySet<string>|readonly string[]; excludedImageIds?:readonly string[]; excludedFields?:readonly string[] }
const excluded = (ids:ReadonlySet<string>|readonly string[]|undefined,id:string|undefined) => Boolean(id && (Array.isArray(ids)?ids.includes(id):(ids as ReadonlySet<string>|undefined)?.has(id)));
const text = (value: unknown, max = 400) => esc(String(value ?? '').slice(0, max));
const list = (items: string[]) => `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`;
const table = (head: string[], rows: string[][], page = false) => `<div style="overflow:auto"><table><thead><tr>${head.map(value => `<th>${text(value,page?Infinity:400)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(value => `<td>${text(value,page?Infinity:400)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const raster = (value: string) => /^data:image\/(?:png|jpeg|webp|gif|avif|bmp);base64,[a-z\d+/=\s]+$/i.test(value) ? value : '';

/** Exporters produce XML, but imported records are untrusted. Admit only the
 * small, resource-free SVG vocabulary our map/tree/radar exporters require. */
export function safeToolSvg(source: string, stablePrefix?:string): string {
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.localName !== 'svg' || doc.querySelector('parsererror')) return '';
  const tags = new Set(['svg','g','defs','marker','rect','circle','ellipse','path','polygon','polyline','line','text','tspan','title','desc','image']);
  const attributes = new Set(['xmlns','viewBox','width','height','x','y','x1','y1','x2','y2','cx','cy','r','rx','ry','d','points','fill','fill-opacity','stroke','stroke-width','stroke-opacity','stroke-dasharray','stroke-linecap','stroke-linejoin','paint-order','font-family','font-size','text-anchor','text-decoration','transform','id','marker-end','markerWidth','markerHeight','refX','refY','orient','role']);
  for (const element of [root, ...root.querySelectorAll('*')]) {
    if (!tags.has(element.localName)) { element.remove(); continue; }
    for (const attr of [...element.attributes]) {
      const value = attr.value;
      if (element.localName === 'image' && attr.name === 'href' && raster(value)) continue;
      if (!attributes.has(attr.name) || /(?:javascript:|https?:|data:|@import|expression|[<>])/i.test(value) || /url\(/i.test(value) && !/^url\(#[a-z\d_-]+\)$/i.test(value)) element.removeAttribute(attr.name);
    }
    if (element.localName === 'image' && !element.hasAttribute('href')) element.remove();
  }
  // Separate fragments cannot resolve each other's marker IDs.
  const prefix = stablePrefix ?? `tool-${crypto.randomUUID()}-`;
  for (const element of root.querySelectorAll('[id]')) element.id = prefix + element.id;
  for (const element of root.querySelectorAll('[marker-end]')) element.setAttribute('marker-end', element.getAttribute('marker-end')!.replace('url(#', `url(#${prefix}`));
  root.setAttribute('style', 'display:block;width:100%;max-height:360px;height:auto');
  return new XMLSerializer().serializeToString(root);
}

/** The public wiki builder can receive imported/test data. Rebuild its cached
 * semantic preview rather than trusting a supposedly prepared HTML string. */
export function sanitizeToolPreviewHtml(source:string,stablePrefix?:string,allowImages=false,richPolicy?:RichProsePolicy):string {
  const doc=new DOMParser().parseFromString(source,'text/html'),out=document.createElement('div');
  const tags=new Set(['P','H1','H2','H3','H4','H5','H6','STRONG','B','EM','UL','OL','LI','TABLE','THEAD','TBODY','TR','TD','TH','DIV','SPAN','SECTION','DL','DT','DD']);
  const visit=(node:Node,parent:Element)=>{
    if(node.nodeType===Node.TEXT_NODE){parent.append(document.createTextNode(node.textContent??''));return;}
    if(!(node instanceof Element))return;
    if(node.getAttribute('data-wh-rich-prose')==='true'){
      const element=document.createElement('div');element.setAttribute('data-wh-rich-prose','true');element.innerHTML=richProsePreviewHtml(node.innerHTML,{includeImages:allowImages,...richPolicy});parent.append(element);return;
    }
    if(node.localName==='svg'){const safe=safeToolSvg(node.outerHTML,stablePrefix);if(safe){const fragment=document.createElement('template');fragment.innerHTML=safe;parent.append(fragment.content);}return;}
    if(allowImages&&node.tagName==='IMG'&&raster(node.getAttribute('src')??'')){const img=document.createElement('img');img.src=node.getAttribute('src')!;img.alt=node.getAttribute('alt')??'';parent.append(img);return;}
    if(!tags.has(node.tagName))return;
    const element=document.createElement(node.tagName.toLowerCase());parent.append(element);
    if(node.tagName==='SECTION'&&node.hasAttribute('data-coc-summary'))element.setAttribute('data-coc-summary',node.getAttribute('data-coc-summary')!);
    if(node.tagName==='SECTION'&&node.hasAttribute('data-wh-local-tool-preview'))element.setAttribute('data-wh-local-tool-preview','true');
    if(node.tagName==='SECTION'&&node.hasAttribute('data-wh-local-tool-preview')&&/^[a-f0-9]{64}$/.test(node.getAttribute('data-wh-asset-font')??''))element.setAttribute('data-wh-asset-font',node.getAttribute('data-wh-asset-font')!);
    for(const child of node.childNodes)visit(child,element);
  };
  for(const child of doc.body.childNodes)visit(child,out);return out.innerHTML;
}

/** Query project scope before IDs. Foreign IDs never resolve even transiently. */
export async function listToolDocuments(projectId: string, eraId?: string): Promise<ToolDocumentTarget[]> {
  const scope = { projectId, eraId };
  const project = eraId ? await getEraProject(scope) : await db.projects.get(projectId); if (!project) return [];
  const result: ToolDocumentTarget[] = [];
  const add = (kind: ToolDocumentTarget['kind'], id: string, label: string) => result.push({ projectId, kind, documentId: id, label });
  if (eraId) {
    const [maps, boards, timelines] = await Promise.all([listEraRows<WorldMap>(scope, 'worldMaps'), listEraRows<Board>(scope, 'boards'), listEraRows<Timeline>(scope, 'timelines')]);
    maps.forEach(row => add('maps', row.id, row.title)); boards.forEach(row => add('board', row.id, row.title)); timelines.forEach(row => add('timeline', row.id, row.title));
  } else await Promise.all([
    db.worldMaps.where('projectId').equals(projectId).each(row => { add('maps', row.id, row.title); }),
    db.boards.where('projectId').equals(projectId).each(row => { add('board', row.id, row.title); }),
    db.timelines.where('projectId').equals(projectId).each(row => { add('timeline', row.id, row.title); }),
  ]);
  project.dictionaries?.forEach(row => add('dictionary', row.id, row.name));
  project.dataTables?.forEach(row => add('tables', row.id, row.title));
  project.relationTrees?.forEach(row => add('relation-tree', row.id, row.title));
  project.characterSheets?.forEach(row => add('character-sheets', row.id, row.title));
  project.radarCharts?.forEach(row => add('radar', row.id, row.title));
  project.modelAssets?.forEach(row => add('model-viewer', row.id, row.name));
  project.sourceToolDocuments?.forEach(row => result.push({projectId,kind:'local-tool',documentId:row.id,label:row.title,namespace:row.namespace}));
  return result.sort((a,b) => a.label.localeCompare(b.label));
}

export async function resolveToolPreview(target: ToolDocumentTarget, hostProjectId: string, locale: 'es'|'en' = 'en', policy:ToolExportPolicy = {}): Promise<ToolPreview|null> {
  if (!targetAllowed(target, { projectId: hostProjectId })) return null;
  if(wikiDocumentExcluded(policy.excludedDocuments,target.kind,target.documentId,target.namespace))return null;
  const limit=(value:number)=>policy.page?Infinity:value;
  const text=(value:unknown)=>esc(String(value??'').slice(0,limit(400)));
  const safeSvg=(html:string)=>safeToolSvg(html,policy.page?'tool-page-'+Array.from(new TextEncoder().encode(JSON.stringify([target.kind,target.documentId,target.namespace??'']))).map(byte=>byte.toString(16).padStart(2,'0')).join('')+'-':undefined);
  const scope = { projectId: hostProjectId, eraId: policy.eraId };
  if(policy.source&&policy.source.project.id!==hostProjectId)throw Error('reader_source_project_mismatch');const project = policy.source?policy.source.project:policy.eraId ? await getEraProject(scope) : await db.projects.get(hostProjectId); if (!project) return null;
  const missing = toolBlockCopy[locale].unavailable;
  const entries = new Map<string, { id:string; projectId:string; type:string; title:string; fields:Record<string,string> }>();
  let codexRows: CodexEntry[] = [];
  const loadNames = async () => { const rows = policy.source?policy.source.rows('codexEntries'):policy.eraId ? await listEraRows<CodexEntry>(scope, 'codexEntries') : await db.codexEntries.where('projectId').equals(hostProjectId).toArray(); codexRows = rows.filter(entry => !excluded(policy.excludedEntryIds, entry.id)); codexRows.forEach(entry => { entries.set(entry.id, {id:entry.id,projectId:entry.projectId,type:entry.type,title:entry.title,fields:Object.fromEntries(Object.entries(projectCodexEntry(entry, project.codexTemplates).fields).filter(([key])=>!policy.excludedFields?.includes(key)))}); }); };
  const result = (title: string, html: string, truncated = false): ToolPreview => ({title,html,truncated});
  if(target.kind==='local-tool'){
    const source=project.sourceToolDocuments?.find(row=>row.id===target.documentId&&row.namespace===target.namespace);if(!source)return null;
    return result(source.title,await renderLocalAssetPreview(sourceDocumentPreview(source,locale),hostProjectId,source.namespace,policy,false));
  }
  if (target.kind === 'maps') {
    if(policy.includeMaps===false||excluded(policy.excludedMapIds,target.documentId))return null;
    const map = policy.source?policy.source.rows('worldMaps').find(row=>row.id===target.documentId&&row.projectId===hostProjectId):policy.eraId ? await readEraRow<WorldMap>(scope, 'worldMaps', target.documentId) : await db.worldMaps.where('projectId').equals(hostProjectId).filter(row => row.id === target.documentId).first(); if (!map) return null;
    const pins = policy.source?policy.source.rows('mapPins').filter(row=>row.mapId===map.id&&row.projectId===hostProjectId&&!excluded(policy.excludedEntryIds,row.linkedEntryId)).slice(0,200):policy.eraId ? (await listEraRows<MapPin>(scope, 'mapPins')).filter(row => row.mapId === map.id && !excluded(policy.excludedEntryIds, row.linkedEntryId)).slice(0,200) : await db.mapPins.where('mapId').equals(map.id).filter(row => row.projectId === hostProjectId&&!excluded(policy.excludedEntryIds,row.linkedEntryId)).limit(200).toArray();
    const svg = safeSvg(exportMapSvg(policy.includeImages===false?'':raster(map.backgroundImage ?? ''), 800, 450, (map.features ?? []).filter(row=>!excluded(policy.excludedEntryIds,row.linkedEntryId)).slice(0,200), pins, map.layerVisibility ?? DEFAULT_MAP_LAYERS, map.layers));
    return result(map.title, svg + list(pins.slice(0,8).map(pin => text(pin.name))), pins.length >= 200 || (map.features?.length ?? 0) > 200);
  }
  if (target.kind === 'board') {
    const board = policy.source?policy.source.rows('boards').find(row=>row.id===target.documentId&&row.projectId===hostProjectId):policy.eraId ? await readEraRow<Board>(scope, 'boards', target.documentId) : await db.boards.where('projectId').equals(hostProjectId).filter(row => row.id === target.documentId).first(); if (!board) return null;
    const allNodes = policy.source?policy.source.rows('boardNodes').filter(row=>row.boardId===board.id&&row.projectId===hostProjectId):policy.eraId ? (await listEraRows<BoardNode>(scope, 'boardNodes')).filter(row => row.boardId === board.id) : await db.boardNodes.where('boardId').equals(board.id).filter(row => row.projectId === hostProjectId).toArray();
    if(policy.page)await loadNames();
    const nodes = visibleCanvasNodes(allNodes);
    const boardText=(node:BoardNode)=>{if(!policy.page||!node.richContent)return node.content;const doc=new DOMParser().parseFromString(sanitizeRichHtml(node.richContent),'text/html');doc.querySelectorAll('[data-wh-wiki-hidden="true"]').forEach(element=>element.remove());return doc.body.textContent??'';};
    const pageReference=(node:BoardNode)=>{
      const ref=node.ref;if(!policy.page||!ref)return undefined;
      if(!policy.source)return null;
      if(ref.engineId==='codex'||ref.engineId==='codex-entry')return entries.get(ref.entityId)?.title??null;
      if(ref.engineId==='maps'){
        if(policy.includeMaps===false||excluded(policy.excludedMapIds,ref.entityId))return null;
        const row=ref.entityType==='map-pin'?policy.source.rows('mapPins').find(row=>row.id===ref.entityId):policy.source.rows('worldMaps').find(row=>row.id===ref.entityId);
        if(!row||row.projectId!==hostProjectId||'mapId'in row&&excluded(policy.excludedMapIds,String(row.mapId))||'linkedEntryId'in row&&excluded(policy.excludedEntryIds,String(row.linkedEntryId)))return null;
        return String('name'in row?row.name:row.title);
      }
      if(!(eraDocumentKinds as readonly string[]).includes(ref.engineId))return null;
      const root=policy.source.documents?.(ref.engineId as EraDocumentKind).find(document=>document.root.id===ref.entityId)?.root;
      return root&&(!root.projectId||root.projectId===hostProjectId)?String(root.title??root.name??root.text??root.id):null;
    };
    const rows=nodes.slice(0,limit(30)).filter(node=>!excluded(policy.excludedEntryIds,node.ref?.entityId)&&(!node.ref||!wikiDocumentExcluded(policy.excludedDocuments,node.ref.engineId,node.ref.entityId))).flatMap(node=>{
      const reference=pageReference(node);if(reference===null)return[];
      const body=reference===undefined?boardText(node):'';
      return[`<strong>${text(reference??node.title)}</strong>${node.kind==='frame'&&node.collapsed?` — ${pileItemCount(node,allNodes)} ${locale==='es'?'elementos':'items'}`:body?` — ${text(body)}`:''}`];
    });
    return result(board.title,list(rows),!policy.page&&nodes.length>30);
  }
  if (target.kind === 'timeline') {
    const lane = policy.source?policy.source.rows('timelines').find(row=>row.id===target.documentId&&row.projectId===hostProjectId):policy.eraId ? await readEraRow<Timeline>(scope, 'timelines', target.documentId) : await db.timelines.where('projectId').equals(hostProjectId).filter(row => row.id === target.documentId).first(); if (!lane) return null;
    const events = policy.source?policy.source.rows('timelineEvents').filter(row=>row.timelineId===lane.id&&row.projectId===hostProjectId&&!row.hideFromWiki).slice(0,1001):policy.eraId ? (await listEraRows<TimelineEvent>(scope, 'timelineEvents')).filter(row => row.timelineId === lane.id).slice(0,1001) : await db.timelineEvents.where('timelineId').equals(lane.id).filter(row => row.projectId === hostProjectId).limit(1001).toArray(); events.sort((a,b) => a.order-b.order);
    const calendar = policy.source?policy.source.calendar(lane.id):await resolveWorldCalendar(hostProjectId,lane.id,policy.eraId);
    return result(lane.title, list(events.slice(0,12).map(event => `<strong>${text(event.title)}</strong> <span>${text(compactTimelineLabel(event, calendar?.calendar, lane.displayPrecision, locale))}</span>${event.description ? `<p>${text(event.description)}</p>` : ''}`)), events.length > 12);
  }
  if (target.kind === 'dictionary') {
    const dictionary = project.dictionaries?.find(row => row.id === target.documentId); if (!dictionary) return null;
    if(policy.page){await loadNames();const words=dictionary.words.filter(word=>!word.linkedEntryId||entries.has(word.linkedEntryId));return result(dictionary.name,`<p>${text(dictionary.description)}</p>`+words.map(word=>`<section><h4>${text(word.nativeForm||word.word)}</h4><dl>${(['word','pronunciation','partOfSpeech','meaning','examples','phrases','derivatives','origin'] as const).filter(key=>!policy.excludedFields?.includes(key)&&word[key]).map(key=>`<dt>${text(key)}</dt><dd>${text(word[key])}</dd>`).join('')}${(word.senses??[]).map(sense=>`<dt>${text(sense.partOfSpeech)}</dt><dd>${text(sense.meaning)} ${text(sense.examples)}</dd>`).join('')}${word.seeAlso?.length?`<dt>${locale==='es'?'Véase también':'See also'}</dt><dd>${word.seeAlso.map(text).join(', ')}</dd>`:''}</dl></section>`).join(''));}
    return result(dictionary.name, `<p>${text(dictionary.description)}</p>` + table(locale==='es'?['Palabra','Significado']:['Word','Meaning'], dictionary.words.slice(0,limit(12)).map(word => [word.nativeForm || word.word,word.meaning]),policy.page), !policy.page && dictionary.words.length > 12);
  }
  if (target.kind === 'tables') {
    const sheet = project.dataTables?.find(row => row.id === target.documentId); if (!sheet) return null;
    await loadNames();
    const projected = projectWorldTable(sheet, codexRows, project.codexTemplates), rows = projected.displayRows;
    const columns = policy.page?projected.columns.filter(column=>!policy.excludedFields?.includes(column.field??column.name)):projected.columns;
    const values = sheet.mode === 'sheet' ? sheetValues(sheet) : null;
    return result(sheet.title, table(columns.slice(0,limit(8)).map(column => column.name), rows.slice(0,limit(12)).map((row,r) => columns.slice(0,limit(8)).map((column,c) => {
      const value = (sheet.codexType || sheet.codexTemplateId) && policy.excludedFields?.includes(column.field ?? column.name) ? '' : String(values?.get(cellKey(policy.page?projected.columns.indexOf(column):c,r)) ?? row.cells[column.id] ?? ''); return column.kind === 'reference' && value ? entries.get(value)?.title ?? missing : value;
    })),policy.page), !policy.page && (rows.length > 12 || columns.length > 8));
  }
  if (target.kind === 'relation-tree') {
    const tree = project.relationTrees?.find(row => row.id === target.documentId); if (!tree) return null;
    await loadNames(); const nodes = tree.nodes.filter(node=>!policy.page||!excluded(policy.excludedEntryIds,node.codexEntryId)).slice(0,limit(80)), ids = new Set(nodes.map(node => node.id));
    return result(tree.title, safeSvg(exportRelationTreeSvg({...tree,nodes:nodes.map(node => ({ ...node, ...(policy.includeImages === false ? { image: undefined } : {}), ...(node.codexEntryId ? { label: entries.get(node.codexEntryId)?.title ?? missing } : {}) })),edges:tree.edges.filter(edge => ids.has(edge.source)&&ids.has(edge.target))}, new Map([...entries].map(([id,entry]) => [id,entry.title])))), !policy.page && tree.nodes.length > 80);
  }
  if (target.kind === 'radar') {
    const chart = project.radarCharts?.find(row => row.id === target.documentId); if (!chart) return null;
    await loadNames(); const series = chart.series.filter(series=>!excluded(policy.excludedEntryIds,series.linkedEntryId)).map(series => resolveRadarSeries(series,chart.axes,[...entries.values()],hostProjectId)).map(series => series.missingEntry ? {...series,name:missing} : series);
    return result(chart.title, safeSvg(await exportRadarSvgComplete(chart,series)));
  }
  if (target.kind === 'character-sheets') {
    const source = project.characterSheets?.find(row => row.id === target.documentId); if (!source || policy.page&&excluded(policy.excludedEntryIds,source.linkedEntryId)) return null;
    validateSheet(source);
    if(target.sheetDisplay==='compact'){const summary=cocSummary(source);return summary?{...result(source.title,cocSummaryHtml(summary,locale)),summary}:null;}
    return {...result(source.title,''),sheet:structuredClone(source)};
  }
  const model = project.modelAssets?.find(row => row.id === target.documentId); if (!model || policy.includeMedia === false) return null;
  return { ...result(model.name, ''), model: readerModel(model) };
}

/** Run after host sanitization. Only trusted semantic previews are injected;
 * unavailable pointers always use generic text, never their cached label. */
export async function prepareToolDocumentBlocksForExport(html: string, projectId: string, locale: 'es'|'en' = 'en', policy:ToolExportPolicy = {}): Promise<string> {
  const doc = new DOMParser().parseFromString(sanitizeRichHtml(html), 'text/html');
  for (const element of doc.querySelectorAll<HTMLElement>('figure[data-wh-tool-block="true"]')) {
    const target = toolTarget({projectId:element.dataset.projectId,kind:element.dataset.toolKind,documentId:element.dataset.documentId,label:element.dataset.label,namespace:element.dataset.namespace,presentation:element.dataset.presentation,sheetDisplay:element.dataset.sheetDisplay});
    let preview: ToolPreview|null = null;
    try { if (target) preview = await resolveToolPreview(target,projectId,locale,policy); } catch { /* Invalid sources get an honest fallback. */ }
    const section = doc.createElement('section'); section.className = 'wh-tool-export';
    if (preview?.model) await prepareModelReaderRuntime();
    section.innerHTML = preview ? `<h3>${text(preview.title)}</h3>${preview.model ? modelReaderMarkup(preview.model,locale) : preview.sheet?sheetPaper(preview.sheet,locale).svg:preview.html}${preview.truncated ? `<p>${text(toolBlockCopy[locale].truncated)}</p>` : ''}` : `<p>${text(toolBlockCopy[locale].unavailable)}</p>`;
    element.replaceWith(section);
  }
  return doc.body.innerHTML;
}
