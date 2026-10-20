import { db } from '@/db';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { exportMapSvg, DEFAULT_MAP_LAYERS } from '@/components/maps/mapGeometry';
import { exportRelationTreeSvg } from '@/engines/genealogy/relationTrees';
import { exportRadarSvg } from '@/engines/radar/interchange';
import { resolveRadarSeries } from '@/engines/radar/model';
import { sheetValues } from '@/engines/tables/formulas';
import { cellKey } from '@/engines/tables/types';
import { compactTimelineLabel } from '@/engines/timeline/timelineSettings';
import { resolveWorldCalendar } from '@/engines/timeline/worldCalendarStore';
import { toolBlockCopy } from './copy';
import { escapeToolText as esc, targetAllowed, toolTarget, type ToolDocumentTarget } from './model';

export interface ToolPreview { title: string; html: string; truncated: boolean }
export interface ToolExportPolicy { includeMaps?: boolean; includeImages?: boolean; excludedMapIds?: ReadonlySet<string>|readonly string[]; excludedEntryIds?: ReadonlySet<string>|readonly string[]; excludedFields?:readonly string[] }
const excluded = (ids:ReadonlySet<string>|readonly string[]|undefined,id:string|undefined) => Boolean(id && (Array.isArray(ids)?ids.includes(id):(ids as ReadonlySet<string>|undefined)?.has(id)));
const text = (value: unknown, max = 400) => esc(String(value ?? '').slice(0, max));
const list = (items: string[]) => `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`;
const table = (head: string[], rows: string[][]) => `<div style="overflow:auto"><table><thead><tr>${head.map(value => `<th>${text(value)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(value => `<td>${text(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const raster = (value: string) => /^data:image\/(?:png|jpeg|webp|gif|avif|bmp);base64,[a-z\d+/=\s]+$/i.test(value) ? value : '';

/** Exporters produce XML, but imported records are untrusted. Admit only the
 * small, resource-free SVG vocabulary our map/tree/radar exporters require. */
export function safeToolSvg(source: string): string {
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
  const prefix = `tool-${crypto.randomUUID()}-`;
  for (const element of root.querySelectorAll('[id]')) element.id = prefix + element.id;
  for (const element of root.querySelectorAll('[marker-end]')) element.setAttribute('marker-end', element.getAttribute('marker-end')!.replace('url(#', `url(#${prefix}`));
  root.setAttribute('style', 'display:block;width:100%;max-height:360px;height:auto');
  return new XMLSerializer().serializeToString(root);
}

/** The public wiki builder can receive imported/test data. Rebuild its cached
 * semantic preview rather than trusting a supposedly prepared HTML string. */
export function sanitizeToolPreviewHtml(source:string):string {
  const doc=new DOMParser().parseFromString(source,'text/html'),out=document.createElement('div');
  const tags=new Set(['P','H3','H4','STRONG','B','EM','UL','OL','LI','TABLE','THEAD','TBODY','TR','TD','TH','DIV','SPAN']);
  const visit=(node:Node,parent:Element)=>{
    if(node.nodeType===Node.TEXT_NODE){parent.append(document.createTextNode(node.textContent??''));return;}
    if(!(node instanceof Element))return;
    if(node.localName==='svg'){const safe=safeToolSvg(node.outerHTML);if(safe){const fragment=document.createElement('template');fragment.innerHTML=safe;parent.append(fragment.content);}return;}
    if(!tags.has(node.tagName))return;
    const element=document.createElement(node.tagName.toLowerCase());parent.append(element);
    for(const child of node.childNodes)visit(child,element);
  };
  for(const child of doc.body.childNodes)visit(child,out);return out.innerHTML;
}

/** Query project scope before IDs. Foreign IDs never resolve even transiently. */
export async function listToolDocuments(projectId: string): Promise<ToolDocumentTarget[]> {
  const project = await db.projects.get(projectId); if (!project) return [];
  const result: ToolDocumentTarget[] = [];
  const add = (kind: ToolDocumentTarget['kind'], id: string, label: string) => result.push({ projectId, kind, documentId: id, label });
  await Promise.all([
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
  return result.sort((a,b) => a.label.localeCompare(b.label));
}

export async function resolveToolPreview(target: ToolDocumentTarget, hostProjectId: string, locale: 'es'|'en' = 'en', policy:ToolExportPolicy = {}): Promise<ToolPreview|null> {
  if (!targetAllowed(target, { projectId: hostProjectId })) return null;
  const project = await db.projects.get(hostProjectId); if (!project) return null;
  const missing = toolBlockCopy[locale].unavailable;
  const entries = new Map<string, { id:string; projectId:string; title:string; fields:Record<string,string> }>();
  const loadNames = async () => { await db.codexEntries.where('projectId').equals(hostProjectId).each(entry => { if(!excluded(policy.excludedEntryIds,entry.id))entries.set(entry.id, {id:entry.id,projectId:entry.projectId,title:entry.title,fields:Object.fromEntries(Object.entries(entry.fields).filter(([key])=>!policy.excludedFields?.includes(key)))}); }); };
  const result = (title: string, html: string, truncated = false): ToolPreview => ({title,html,truncated});
  if (target.kind === 'maps') {
    if(policy.includeMaps===false||excluded(policy.excludedMapIds,target.documentId))return null;
    const map = await db.worldMaps.where('projectId').equals(hostProjectId).filter(row => row.id === target.documentId).first(); if (!map) return null;
    const pins = await db.mapPins.where('mapId').equals(map.id).filter(row => row.projectId === hostProjectId&&!excluded(policy.excludedEntryIds,row.linkedEntryId)).limit(200).toArray();
    const svg = safeToolSvg(exportMapSvg(policy.includeImages===false?'':raster(map.backgroundImage ?? ''), 800, 450, (map.features ?? []).filter(row=>!excluded(policy.excludedEntryIds,row.linkedEntryId)).slice(0,200), pins, map.layerVisibility ?? DEFAULT_MAP_LAYERS, map.layers));
    return result(map.title, svg + list(pins.slice(0,8).map(pin => text(pin.name))), pins.length >= 200 || (map.features?.length ?? 0) > 200);
  }
  if (target.kind === 'board') {
    const board = await db.boards.where('projectId').equals(hostProjectId).filter(row => row.id === target.documentId).first(); if (!board) return null;
    const nodes = await db.boardNodes.where('boardId').equals(board.id).filter(row => row.projectId === hostProjectId).limit(31).toArray();
    return result(board.title, list(nodes.slice(0,30).filter(node=>!excluded(policy.excludedEntryIds,node.ref?.entityId)).map(node => `<strong>${text(node.title)}</strong>${node.content ? ` — ${text(node.content)}` : ''}`)), nodes.length > 30);
  }
  if (target.kind === 'timeline') {
    const lane = await db.timelines.where('projectId').equals(hostProjectId).filter(row => row.id === target.documentId).first(); if (!lane) return null;
    const events = await db.timelineEvents.where('timelineId').equals(lane.id).filter(row => row.projectId === hostProjectId).limit(1001).toArray(); events.sort((a,b) => a.order-b.order);
    const calendar = await resolveWorldCalendar(hostProjectId,lane.id);
    return result(lane.title, list(events.slice(0,12).map(event => `<strong>${text(event.title)}</strong> <span>${text(compactTimelineLabel(event, calendar?.calendar, lane.displayPrecision, locale))}</span>${event.description ? `<p>${text(event.description)}</p>` : ''}`)), events.length > 12);
  }
  if (target.kind === 'dictionary') {
    const dictionary = project.dictionaries?.find(row => row.id === target.documentId); if (!dictionary) return null;
    return result(dictionary.name, `<p>${text(dictionary.description)}</p>` + table(locale==='es'?['Palabra','Significado']:['Word','Meaning'], dictionary.words.slice(0,12).map(word => [word.nativeForm || word.word,word.meaning])), dictionary.words.length > 12);
  }
  if (target.kind === 'tables') {
    const sheet = project.dataTables?.find(row => row.id === target.documentId); if (!sheet) return null;
    await loadNames();
    const rows = sheet.codexType ? await db.codexEntries.where('projectId').equals(hostProjectId).filter(entry => entry.type === sheet.codexType&&!excluded(policy.excludedEntryIds,entry.id)).limit(13).toArray().then(rows => rows.map(entry => ({id:entry.id,cells:Object.fromEntries(sheet.columns.map(column => [column.id,column.field === 'title' ? entry.title : policy.excludedFields?.includes(column.field??column.name)?'':entry.fields[column.field ?? column.name] ?? '']))}))) : sheet.rows;
    const values = sheet.mode === 'sheet' ? sheetValues(sheet) : null;
    return result(sheet.title, table(sheet.columns.slice(0,8).map(column => column.name), rows.slice(0,12).map((row,r) => sheet.columns.slice(0,8).map((column,c) => {
      const value = String(values?.get(cellKey(c,r)) ?? row.cells[column.id] ?? ''); return column.kind === 'reference' && value ? entries.get(value)?.title ?? missing : value;
    }))), rows.length > 12 || sheet.columns.length > 8);
  }
  if (target.kind === 'relation-tree') {
    const tree = project.relationTrees?.find(row => row.id === target.documentId); if (!tree) return null;
    await loadNames(); const nodes = tree.nodes.slice(0,80), ids = new Set(nodes.map(node => node.id));
    return result(tree.title, safeToolSvg(exportRelationTreeSvg({...tree,nodes:nodes.map(node => node.codexEntryId ? {...node,label:entries.get(node.codexEntryId)?.title ?? missing} : node),edges:tree.edges.filter(edge => ids.has(edge.source)&&ids.has(edge.target))}, new Map([...entries].map(([id,entry]) => [id,entry.title])))), tree.nodes.length > 80);
  }
  if (target.kind === 'radar') {
    const chart = project.radarCharts?.find(row => row.id === target.documentId); if (!chart) return null;
    await loadNames(); const series = chart.series.filter(series=>!excluded(policy.excludedEntryIds,series.linkedEntryId)).map(series => resolveRadarSeries(series,chart.axes,[...entries.values()],hostProjectId)).map(series => series.missingEntry ? {...series,name:missing} : series);
    return result(chart.title, safeToolSvg(exportRadarSvg(chart,series)));
  }
  if (target.kind === 'character-sheets') {
    const sheet = project.characterSheets?.find(row => row.id === target.documentId); if (!sheet) return null;
    return result(sheet.title, `<p>${text(sheet.preset)}</p>` + table(locale==='es'?['Rasgo','Valor']:['Trait','Value'], [...sheet.traits.slice(0,12).map(trait => [trait.label,String(trait.value)]),...sheet.resources.slice(0,12).map(resource => [resource.label,`${resource.current} / ${resource.max}`])]), sheet.traits.length > 12 || sheet.resources.length > 12);
  }
  const model = project.modelAssets?.find(row => row.id === target.documentId); if (!model) return null;
  return result(model.name, `<p>${text(toolBlockCopy[locale].kinds['model-viewer'])} · GLB · ${text((model.size/1048576).toFixed(2))} MB</p>`);
}

/** Run after host sanitization. Only trusted semantic previews are injected;
 * unavailable pointers always use generic text, never their cached label. */
export async function prepareToolDocumentBlocksForExport(html: string, projectId: string, locale: 'es'|'en' = 'en', policy:ToolExportPolicy = {}): Promise<string> {
  const doc = new DOMParser().parseFromString(sanitizeRichHtml(html), 'text/html');
  for (const element of doc.querySelectorAll<HTMLElement>('figure[data-wh-tool-block="true"]')) {
    const target = toolTarget({projectId:element.dataset.projectId,kind:element.dataset.toolKind,documentId:element.dataset.documentId,label:element.dataset.label});
    let preview: ToolPreview|null = null;
    try { if (target) preview = await resolveToolPreview(target,projectId,locale,policy); } catch { /* Invalid sources get an honest fallback. */ }
    const section = doc.createElement('section'); section.className = 'wh-tool-export';
    section.innerHTML = preview ? `<h3>${text(preview.title)}</h3>${preview.html}${preview.truncated ? `<p>${text(toolBlockCopy[locale].truncated)}</p>` : ''}` : `<p>${text(toolBlockCopy[locale].unavailable)}</p>`;
    element.replaceWith(section);
  }
  return doc.body.innerHTML;
}
