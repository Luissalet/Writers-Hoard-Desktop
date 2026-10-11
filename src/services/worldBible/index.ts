import { db } from '@/db';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { downloadTextFile, exportHtmlPdf, sanitizeFilename } from '@/engines/writings/manuscriptExport';
import type { Project, CodexEntry, Timeline, TimelineEvent, WorldMap, MapPin } from '@/types';
import type { Relationship } from '@/engines/relationships/types';
import es from '@/locales/es';
import en from '@/locales/en';

export const BIBLE_SECTIONS = ['codex', 'timeline', 'maps', 'relationships'] as const;
export type BibleSection = typeof BIBLE_SECTIONS[number];
export interface BibleSelection {
  sections?: BibleSection[];
  entryIds?: string[];
  timelineIds?: string[];
  mapIds?: string[];
  relationshipIds?: string[];
  includeSecrets?: boolean;
  locale?: 'es' | 'en';
}
export interface BibleData {
  project: Project;
  entries: CodexEntry[];
  timelines: Timeline[];
  events: TimelineEvent[];
  maps: WorldMap[];
  pins: MapPin[];
  relationships: Relationship[];
}
export const bibleCopy = (locale: 'es' | 'en' = 'es') => locale === 'es' ? {
  title: 'Biblia del mundo', codex: 'Codex', timeline: 'Cronología', maps: 'Mapas', relationships: 'Relaciones',
  index: 'Índice', source: 'Procedencia', empty: 'No hay contenido seleccionado.', omitted: 'Fuera de la selección',
  created: 'Generada', secret: 'Secreta', current: 'Actual', past: 'Pasada', intensity: 'Intensidad',
} : {
  title: 'World bible', codex: 'Codex', timeline: 'Timeline', maps: 'Maps', relationships: 'Relationships',
  index: 'Contents', source: 'Provenance', empty: 'No content selected.', omitted: 'Outside selection',
  created: 'Generated', secret: 'Secret', current: 'Current', past: 'Past', intensity: 'Intensity',
};

export async function loadBibleData(projectId: string): Promise<BibleData> {
  return db.transaction('r', [db.projects, db.codexEntries, db.timelines, db.timelineEvents, db.worldMaps, db.mapPins, db.relationships], async () => {
    const project = await db.projects.get(projectId);
    if (!project) throw new Error('Project not found');
    const [entries, timelines, events, maps, pins, relationships] = await Promise.all([
      db.codexEntries.where('projectId').equals(projectId).toArray(),
      db.timelines.where('projectId').equals(projectId).toArray(),
      db.timelineEvents.where('projectId').equals(projectId).toArray(),
      db.worldMaps.where('projectId').equals(projectId).toArray(),
      db.mapPins.where('projectId').equals(projectId).toArray(),
      db.relationships.where('projectId').equals(projectId).toArray(),
    ]);
    return { project, entries, timelines, events, maps, pins, relationships };
  });
}
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const anchor = (kind: string, id: string) => `${kind}-${[...new TextEncoder().encode(id)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
const raster = (url?: string) => !!url && /^data:image\/(png|jpe?g|webp|gif|avif|bmp);base64,[a-z0-9+/=\s]+$/i.test(url);
const byTitle = <T extends { title: string; id: string }>(a: T, b: T) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
function choose<T extends { id: string }>(rows: T[], ids: string[] | undefined, name: string): T[] {
  if (ids === undefined) return rows;
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new Error(`Invalid ${name} selection`);
  const wanted = new Set(ids);
  if ([...wanted].some(id => !rows.some(row => row.id === id))) throw new Error(`Unknown or out-of-project ${name} id`);
  return rows.filter(row => wanted.has(row.id));
}
function rich(value: string): string {
  const doc = new DOMParser().parseFromString(sanitizeRichHtml(value), 'text/html');
  // A portable document never loads remote/private images, scripts or styles.
  doc.querySelectorAll('img').forEach(img => { if (!raster(img.getAttribute('src') ?? undefined)) img.remove(); });
  doc.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  return doc.body.innerHTML;
}

export function buildWorldBible(data: BibleData, selection: BibleSelection = {}, generatedAt = Date.now()) {
  const locale = selection.locale ?? 'es';
  const copy = bibleCopy(locale);
  const labels: Record<string, string> = locale === 'es' ? es : en;
  const label = (prefix: string, value: string) => labels[`${prefix}.${value}`] ?? value;
  const sections = selection.sections ?? [...BIBLE_SECTIONS];
  if (!Array.isArray(sections) || sections.some(section => !BIBLE_SECTIONS.includes(section))) throw new Error('Invalid bible sections');
  const scoped = <T extends { projectId: string }>(rows: T[]) => rows.filter(row => row.projectId === data.project.id);
  // Validate every explicit selection, including sections omitted from this export.
  const entries = choose(scoped(data.entries), selection.entryIds, 'Codex').sort(byTitle);
  const timelines = choose(scoped(data.timelines), selection.timelineIds, 'timeline').sort(byTitle);
  const maps = choose(scoped(data.maps), selection.mapIds, 'map').sort(byTitle);
  const relations = choose(scoped(data.relationships), selection.relationshipIds, 'relationship').filter(row => selection.includeSecrets || row.state !== 'secret');
  const events = scoped(data.events).filter(row => timelines.some(timeline => timeline.id === row.timelineId)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const pins = scoped(data.pins).filter(row => maps.some(map => map.id === row.mapId));
  const selectedEntries = new Map((sections.includes('codex') ? entries : []).map(entry => [entry.id, entry]));
  const link = (id: string, label: string) => selectedEntries.has(id)
    ? `<a href="#${anchor('entry', id)}">${esc(selectedEntries.get(id)!.title)}</a>`
    : `${esc(label)} <small>(${copy.omitted})</small>`;
  const source = (id: string, revision?: number, ref?: string) => `<footer>${copy.source}: <code>${esc(id)}</code>${revision === undefined ? '' : ` · ${esc(new Date(revision).toISOString())}`}${ref ? ` · ${esc(ref)}` : ''}</footer>`;
  const contents: string[] = [];
  const index: string[] = [];
  for (const section of [...new Set(sections)]) {
    index.push(`<li><a href="#${section}">${copy[section]}</a>${section === 'codex' ? `<ol>${entries.map(entry => `<li><a href="#${anchor('entry', entry.id)}">${esc(entry.title)}</a></li>`).join('')}</ol>` : ''}</li>`);
    let body = '';
    if (section === 'codex') body = entries.map(entry => {
      return `<article id="${anchor('entry', entry.id)}"><h3>${esc(entry.title)}</h3><p class="meta">${esc(label('codex.types', entry.type))} · ${entry.tags.map(esc).join(', ')}</p>${raster(entry.avatar) ? `<img class="portrait" src="${entry.avatar}" alt="${esc(entry.title)}">` : ''}<dl>${Object.entries(entry.fields).filter(([, value]) => value).map(([key, value]) => `<dt>${esc(label('codex.field', key))}</dt><dd>${esc(value)}</dd>`).join('')}</dl>${rich(entry.content)}${entry.relations.length ? `<ul>${entry.relations.map(relation => `<li>${link(relation.targetId, relation.targetTitle)} — ${esc(relation.type)} ${esc(relation.description)}</li>`).join('')}</ul>` : ''}${source(entry.id, entry.updatedAt, entry.familySource?.ref)}</article>`;
    }).join('');
    if (section === 'timeline') body = timelines.map(timeline => `<article><h3>${esc(timeline.title)}</h3><p>${esc(timeline.description)}</p><ol>${events.filter(event => event.timelineId === timeline.id).map(event => `<li><h4>${esc(event.date)} · ${esc(event.title)}</h4><p>${esc(event.description).replace(/\n/g, '<br>')}</p>${event.linkedEntryId ? `<p>${link(event.linkedEntryId, event.linkedEntryId)}</p>` : ''}${source(event.id, event.updatedAt, event.familySource?.ref)}</li>`).join('')}</ol>${source(timeline.id, timeline.updatedAt)}</article>`).join('');
    if (section === 'maps') body = maps.map(map => {
      const mapPins = pins.filter(pin => pin.mapId === map.id);
      const markers = mapPins.filter(pin => Number.isFinite(pin.position.x) && Number.isFinite(pin.position.y)).map(pin => `<span class="pin" style="left:${Math.min(100, Math.max(0, pin.position.x))}%;top:${Math.min(100, Math.max(0, pin.position.y))}%" title="${esc(pin.name)}">${mapPins.indexOf(pin) + 1}</span>`).join('');
      return `<article><h3>${esc(map.title)}</h3>${raster(map.backgroundImage) ? `<div class="map-wrap"><img class="map" src="${map.backgroundImage}" alt="${esc(map.title)}">${markers}</div>` : ''}<ol>${mapPins.map(pin => `<li><strong>${esc(pin.name)}</strong> (${esc(pin.position.x)}%, ${esc(pin.position.y)}%)${pin.linkedEntryId ? ` · ${link(pin.linkedEntryId, pin.name)}` : ''}<p>${esc(pin.description)}</p>${source(pin.id)}</li>`).join('')}</ol>${source(map.id, map.updatedAt, map.sourceWorldId ? `worldgen:${map.sourceWorldId}@${map.sourceRevision ?? '?'}` : undefined)}</article>`;
    }).join('');
    if (section === 'relationships') body = relations.map(relation => `<article><h3>${link(relation.entityAId, relation.entityAName)} ${relation.directional ? '→' : '↔'} ${link(relation.entityBId, relation.entityBName)}</h3><p>${esc(relation.label || label('relationships.kind', relation.kind))} · ${copy[relation.state]} · ${copy.intensity}: ${esc(relation.intensity)}</p><p>${esc(relation.notes).replace(/\n/g, '<br>')}</p>${source(relation.id, relation.updatedAt, relation.familySource?.ref)}</article>`).join('');
    contents.push(`<section id="${section}"><h2>${copy[section]}</h2>${body || `<p>${copy.empty}</p>`}</section>`);
  }
  const counts = { codex: sections.includes('codex') ? entries.length : 0, timeline: sections.includes('timeline') ? events.length : 0, maps: sections.includes('maps') ? maps.length : 0, relationships: sections.includes('relationships') ? relations.length : 0 };
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(data.project.title)} · ${copy.title}</title><style>body{max-width:860px;margin:40px auto;padding:0 24px;font:16px/1.6 Georgia,serif;color:#242d36;background:white}h1,h2,h3,h4{line-height:1.25}h1{font-size:34px}h2{border-bottom:1px solid #aabbc7;padding-bottom:12px;margin-top:40px}h3{font-size:22px}article{display:flow-root;margin:24px 0}a{color:#315f86}footer,small,.meta{font:12px/1.6 system-ui;color:#53606d}footer{clear:both;border-top:1px solid #dde2e6;margin-top:16px;padding-top:8px;overflow-wrap:anywhere}dt{font-weight:bold}dd{margin-left:0;white-space:pre-wrap;margin-bottom:10px}.portrait{max-width:180px;max-height:220px;float:right;margin:0 0 16px 24px}.map{display:block;width:100%;height:auto}.map-wrap{position:relative;break-inside:avoid}.pin{position:absolute;transform:translate(-50%,-50%);border:2px solid white;background:#315f86;color:white;border-radius:50%;width:22px;height:22px;text-align:center;font:14px/22px system-ui}img{max-width:100%}.sub{margin-left:24px}nav ol{padding-left:24px}section{clear:both}code{overflow-wrap:anywhere}@media print{body{margin:0;max-width:none}h2,h3,h4{break-after:avoid}img{break-inside:avoid}section{break-before:page}nav{break-after:page}a{color:inherit;text-decoration:underline}}</style></head><body><header><h1>${esc(data.project.title)}</h1><p>${copy.title}</p><p>${esc(data.project.description)}</p><p class="meta">${copy.created}: ${esc(new Date(generatedAt).toISOString())}</p>${source(data.project.id, data.project.updatedAt)}</header><nav aria-label="${copy.index}"><h2>${copy.index}</h2><ol>${index.join('')}</ol></nav>${contents.join('')}</body></html>`;
  return { html, counts, filename: `${sanitizeFilename(data.project.title)}-world-bible.html`, generatedAt, projectId: data.project.id };
}
export async function exportWorldBible(projectId: string, selection: BibleSelection, format: 'html' | 'pdf') {
  const artifact = buildWorldBible(await loadBibleData(projectId), selection);
  return saveWorldBibleArtifact(artifact, format);
}
/** Save the exact preview snapshot, even if the underlying rows change meanwhile. */
export async function saveWorldBibleArtifact(artifact: ReturnType<typeof buildWorldBible>, format: 'html' | 'pdf') {
  if (format === 'html') {
    downloadTextFile(artifact.html, artifact.filename, 'text/html');
    return { ok: true, counts: artifact.counts, filename: artifact.filename };
  }
  const result = await exportHtmlPdf(artifact.html, artifact.filename.replace(/\.html$/, '.pdf'));
  return { ...result, counts: artifact.counts, filename: artifact.filename.replace(/\.html$/, '.pdf') };
}
