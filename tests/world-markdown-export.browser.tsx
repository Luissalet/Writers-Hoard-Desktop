// Whole-world Markdown vault: build the ZIP of a seeded project, unzip it here and
// read the files; links, CSV, media toggle, phases, cancel, size estimate, the
// bridge tool and the "Export as Markdown" panel with its real download.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import { db } from '@/db';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { BRIDGE_TOOLS } from '@/services/aiBridge/manifest';
import { TOOL_HANDLERS } from '@/services/aiBridge/tools';
import { buildWorldMarkdownVault, estimateWorldMarkdownVault, isWorldMarkdownAborted } from '@/services/worldMarkdownExport';
import WorldMarkdownExportPanel from '@/components/project/WorldMarkdownExportPanel';
import ProjectCard from '@/components/bubbles/ProjectCard';
import { useLocaleStore } from '@/stores/localeStore';
import type { Project } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string, tries = 200) { for (let i = 0; i < tries; i++) { if (check()) return; await act(async () => { await pause(20); }); } throw new Error(`Timed out: ${label}`); }
// Each picture differs, because identical pictures are stored once.
function picture(color: string): string { const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 4; const context = canvas.getContext('2d')!; context.fillStyle = color; context.fillRect(0, 0, 4, 4); return canvas.toDataURL('image/png'); }
const PNG = picture('#cc3322'), PNG_INLINE = picture('#22cc33'), PNG_NOTE = picture('#2233cc'), PNG_MAP = picture('#cccc22'), PNG_COVER = picture('#22cccc');
const P = 'wmd-test';

async function seed() {
  const now = 1791532800000;
  await db.projects.put({
    id: P, title: 'Mundo de Prueba', description: 'Un mundo de faros.', mode: 'custom', type: 'standalone', color: '#123456', status: 'draft', enabledEngines: ['codex', 'writings', 'notes', 'tables', 'timeline', 'maps'],
    engineOrder: [], coverImage: PNG_COVER, createdAt: now, updatedAt: now,
    dataTables: [{ id: 'tbl', title: 'Precios', mode: 'table', columns: [{ id: 'c1', name: 'Objeto', kind: 'text' }, { id: 'c2', name: 'Precio', kind: 'number' }], rows: [{ id: 'r1', cells: { c1: 'Pan', c2: '3' } }, { id: 'r2', cells: { c1: 'Vino, tinto', c2: '12.5' } }] }],
  } as Project);
  const card = (id: string, title: string, type: string, extra: Record<string, unknown> = {}) => ({ id, projectId: P, title, type, fields: {}, content: '', tags: [], relations: [], createdAt: now, updatedAt: now, ...extra });
  await db.codexEntries.bulkPut([
    card('ana', 'Ana Ruiz', 'character', {
      fields: { occupation: 'Cartógrafa', aliases: 'Anita' }, tags: ['protagonista'], avatar: PNG,
      relations: [{ targetId: 'faro', targetTitle: 'El Faro', type: 'lives_in', description: 'Vive arriba' }],
      content: `<p>Dibuja mapas. Vive en <a href="/project/${P}/codex?entry=faro">la torre</a>.</p><p>Odia <strong>la niebla</strong> &amp; el frío.</p><img src="${PNG_INLINE}">`,
    }),
    card('faro', 'El Faro', 'location', { content: '<p>Una torre con dos luces. Allí trabaja Ana Ruiz y también Ana Ruiz. Dup no cuenta.</p>' }),
    card('dup1', 'Dup', 'item'),
    card('dup2', 'Dup', 'item'),
  ] as never);
  await db.writings.put({ id: 'w1', projectId: P, title: 'Llegada', status: 'draft', chapter: 1, content: '<h2>Inicio</h2><p>Ana Ruiz llegó a El Faro.</p>', synopsis: 'Ana llega.', wordCount: 6, tags: ['uno'], createdAt: now, updatedAt: now } as never);
  await db.notes.put({ id: 'n1', projectId: P, kind: 'idea', title: 'Idea del mapa', text: 'Dibujar el Faro con dos luces.\nHablar con Ana Ruiz.', cover: PNG_NOTE, tags: ['mapa'], pinned: false, createdAt: now, updatedAt: now } as never);
  await db.notes.put({ id: 'inbox', projectId: '__inbox__', kind: 'note', text: 'Nota de la bandeja', tags: [], pinned: false, createdAt: now, updatedAt: now } as never);
  await db.timelines.put({ id: 'tl', projectId: P, title: 'Historia', color: '#123', createdAt: now, updatedAt: now } as never);
  await db.timelineEvents.bulkPut([
    { id: 'e1', projectId: P, timelineId: 'tl', title: 'Se enciende la segunda luz', description: 'Ana mira.', date: 'Día del viento', dateMode: 'text', eventType: 'point', order: 1, lane: '', color: '#123', linkedEntryIds: ['faro'], createdAt: now, updatedAt: now },
    { id: 'e2', projectId: P, timelineId: 'tl', title: 'Ana llega', description: '', date: '1 may', dateMode: 'calendar', realDate: '2026-05-01', eventType: 'milestone', order: 2, lane: 'Viaje', color: '#123', linkedEntryId: 'ana', tags: ['viaje'], createdAt: now, updatedAt: now },
  ] as never);
  await db.timelineConnections.put({ id: 'c', projectId: P, timelineId: 'tl', sourceEventId: 'e1', targetEventId: 'e2', label: 'luego', color: '#123', style: 'solid', createdAt: now } as never);
  await db.worldMaps.put({ id: 'm1', projectId: P, title: 'Costa', backgroundImage: PNG_MAP, createdAt: now, updatedAt: now } as never);
  await db.mapPins.put({ id: 'pin', projectId: P, mapId: 'm1', name: 'Faro', icon: 'port', position: { x: 50, y: 20 }, linkedEntryId: 'faro', description: 'Puerto' } as never);
  await db.outlines.put({ id: 'o1', projectId: P, title: 'Esquema', createdAt: now, updatedAt: now } as never);
  await db.outlineBeats.put({ id: 'b1', outlineId: 'o1', projectId: P, order: 1, level: 'scene', title: 'Llegada', description: 'Ana llega', status: 'planned', linkedWritingId: 'w1', createdAt: now, updatedAt: now } as never);
  await db.diaryEntries.put({ id: 'd1', projectId: P, entryDate: '2026-05-01T10:00', title: 'Primer día', content: '<p>Hoy llegó <em>Ana Ruiz</em>.</p>', tags: [], pinned: false, createdAt: now, updatedAt: now } as never);
  await db.localMediaAssets.put({ id: 'a1', projectId: P, title: 'Mar', kind: 'audio', mime: 'audio/mpeg', blob: new Blob([new Uint8Array(100).fill(7)], { type: 'audio/mpeg' }), size: 100, notes: '', tags: [], linkedEntryIds: [], createdAt: now, updatedAt: now } as never);
}

const open = (blob: Blob) => JSZip.loadAsync(blob);
const text = async (zip: JSZip, path: string) => { const file = zip.file(path); assert(file, `missing ${path}`); return (await file.async('string')).replace(/^﻿/, ''); };
const names = (zip: JSZip) => Object.keys(zip.files).filter(name => !zip.files[name].dir);
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

export async function testWorldMarkdownExport(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const passed: string[] = [];
  await seed();
  const before = JSON.stringify(await db.projects.get(P)) + (await db.codexEntries.count());

  // --- Vault without media ---
  const phases: string[] = [];
  const plain = await buildWorldMarkdownVault(P, { lang: 'es', onPhase: text => { if (!phases.includes(text)) phases.push(text); } });
  const zip = await open(plain.blob);
  const files = names(zip);
  for (const path of ['index.md', 'world.json', 'Codex/character/Ana Ruiz.md', 'Codex/location/El Faro.md', 'Codex/item/Dup.md', 'Codex/item/Dup (2).md', 'Writings/01 - Llegada.md', 'Notes/Idea del mapa.md', 'Tables/Precios.csv', 'Timelines/Historia.md', 'Maps/Costa.md', 'Outlines/Esquema.md']) assert(files.includes(path), `has ${path}: ${files.join(' | ')}`);
  assert(files.some(name => name.startsWith('Diary/')) && !files.some(name => name.startsWith('media/')), 'diary page present, no media folder without the toggle');
  assert(!files.some(name => name.includes('bandeja')) && !(await Promise.all(files.filter(name => name.endsWith('.md')).map(name => text(zip, name)))).some(body => body.includes('Nota de la bandeja')), 'the inbox note of another scope is not exported');
  assert(plain.files === files.length && plain.bytes === plain.blob.size, 'result counts match the zip');
  assert(plain.summary.codex === 4 && plain.summary.writing === 1 && plain.summary.note === 1 && plain.summary.table === 1 && plain.summary.timeline === 1 && plain.summary.map === 1 && plain.summary.outline === 1 && plain.summary.diary === 1 && plain.summary.media === 0, `summary ${JSON.stringify(plain.summary)}`);
  assert(['Fichas del Codex', 'Capítulos y escritos', 'Notas', 'Tablas', 'Cronologías', 'Mapas'].every(name => phases.includes(name)) && phases.some(name => name.startsWith('Comprimiendo')), `phase texts ${phases.join(' | ')}`);
  passed.push('Vault: one file per card, chapter, note, table, timeline, map, outline and diary page in Codex/<type>/, Writings/, Notes/, Tables/, Timelines/, Maps/, Outlines/, Diary/; duplicate titles get "(2)"; the inbox note is left out; phases reported');

  // --- Frontmatter, body, wikilinks ---
  const ana = await text(zip, 'Codex/character/Ana Ruiz.md');
  assert(ana.startsWith('---\nkind: codex\ntype: character\ntitle: Ana Ruiz\naliases:\n  - Anita\ntags:\n  - protagonista\nfields:\n'), `frontmatter head:\n${ana.slice(0, 260)}`);
  assert(ana.includes('  occupation: Cartógrafa') && ana.includes('id: ana') && /updatedAt: "2026-/.test(ana) && /\n---\n\n# Ana Ruiz\n/.test(ana), 'fields, id, updatedAt, title heading');
  assert(ana.includes('[[El Faro|la torre]]') && ana.includes('**la niebla** & el frío'), 'a link the author made becomes a wikilink with its own wording; marks and entities are converted');
  assert(ana.includes('## Relaciones') && ana.includes('- lives_in: [[El Faro]] — Vive arriba'), 'relations listed with wikilinks');
  assert(ana.includes('[imagen no incluida]') && !ana.includes('data:image'), 'an embedded picture is left out with a marker when media is off');
  const faro = await text(zip, 'Codex/location/El Faro.md');
  assert(count(faro, '[[Ana Ruiz') === 1 && faro.includes('[[Ana Ruiz]]'), `first mention only linked:\n${faro}`);
  assert(!faro.includes('[[Dup'), 'a name shared by two cards never links');
  const writing = await text(zip, 'Writings/01 - Llegada.md');
  assert(/chapter: 1\n/.test(writing) && writing.includes('status: draft') && writing.includes('## Inicio') && writing.includes('[[Ana Ruiz]] llegó a [[El Faro]].'), `writing:\n${writing}`);
  const note = await text(zip, 'Notes/Idea del mapa.md');
  assert(note.includes('noteKind: idea') && note.includes('[[El Faro|el Faro]]') && note.includes('[[Ana Ruiz]]') && !note.includes('cover:'), `note:\n${note}`);
  const diary = await text(zip, files.find(name => name.startsWith('Diary/'))!);
  assert(diary.includes('*[[Ana Ruiz]]*'), 'mentions inside emphasis in a diary page');
  passed.push('Cards: YAML frontmatter (kind, type, title, aliases, tags, fields, id, updatedAt), body as Markdown, author links and first mentions as [[wikilinks]], ambiguous names left alone, relations listed');

  // --- CSV, timeline, map, outline, index, world.json ---
  const csv = await text(zip, 'Tables/Precios.csv');
  assert(csv.split('\r\n')[0] === '"Objeto","Precio"' && csv.includes('"Vino, tinto","12.5"'), `csv:\n${csv}`);
  const timeline = await text(zip, 'Timelines/Historia.md');
  assert(timeline.includes('- **Día del viento** · **Se enciende la segunda luz** · [[El Faro]] — Ana mira.') && timeline.includes('- **2026-05-01** · **Ana llega** (milestone) · Viaje · [[Ana Ruiz]] · #viaje') && timeline.includes('- Se enciende la segunda luz → Ana llega (luego)'), `timeline:\n${timeline}`);
  const map = await text(zip, 'Maps/Costa.md');
  assert(map.includes('- **Faro** (port) · 50%, 20% · [[El Faro]] — Puerto') && !map.includes('![') && !map.includes('image:'), 'map pins with wikilink, no image without media');
  const outline = await text(zip, 'Outlines/Esquema.md');
  assert(outline.includes('    - [planned] **Llegada** · [[01 - Llegada]] — Ana llega'), `outline:\n${outline}`);
  const index = await text(zip, 'index.md');
  assert(index.startsWith('# Mundo de Prueba') && index.includes('## Codex (4)') && index.includes('- [[Ana Ruiz]] (character)') && index.includes('[Precios](Tables/Precios.csv)') && index.includes('Sin imágenes ni sonidos'), `index:\n${index}`);
  const world = JSON.parse(await text(zip, 'world.json')) as { format: string; includeMedia: boolean; counts: Record<string, number>; project: Record<string, unknown> };
  assert(world.format === 'writers-hoard-markdown-vault/1' && world.includeMedia === false && world.counts.codex === 4 && world.project.title === 'Mundo de Prueba' && world.project.coverImage === undefined, 'world.json');
  assert(!(await Promise.all(files.map(name => text(zip, name).catch(() => '')))).some(body => body.includes('base64,')), 'no embedded picture data anywhere without media');
  passed.push('Tables as CSV, timelines as dated lists with linked cards and connections, map pins, outline beats linked to chapters, index.md with counts, world.json without embedded pictures');

  // --- Media toggle ---
  const withMedia = await buildWorldMarkdownVault(P, { includeMedia: true, lang: 'en' });
  const mzip = await open(withMedia.blob);
  const mfiles = names(mzip);
  for (const path of ['media/codex/Ana Ruiz.png', 'media/notes/Idea del mapa.png', 'media/maps/Costa.png', 'media/audio/Mar.mp3', 'media/project/cover.png']) assert(mfiles.includes(path), `media has ${path}: ${mfiles.filter(name => name.startsWith('media')).join(' | ')}`);
  assert(mfiles.some(name => name.startsWith('media/inline/')), 'inline picture externalised');
  const png = await mzip.file('media/codex/Ana Ruiz.png')!.async('uint8array');
  assert(png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47, 'a real PNG');
  assert((await mzip.file('media/audio/Mar.mp3')!.async('uint8array')).length === 100, 'sound bytes intact');
  const anaMedia = await text(mzip, 'Codex/character/Ana Ruiz.md');
  assert(anaMedia.includes('avatar: media/codex/Ana Ruiz.png') && anaMedia.includes('![Ana Ruiz](../../media/codex/Ana%20Ruiz.png)') && /!\[\]\(\.\.\/\.\.\/media\/inline\/[^)]+\.png\)/.test(anaMedia) && !anaMedia.includes('[image not included]'), `ana with media:\n${anaMedia}`);
  assert((await text(mzip, 'Maps/Costa.md')).includes('![Costa](../media/maps/Costa.png)') && (await text(mzip, 'Notes/Idea del mapa.md')).includes('cover: media/notes/Idea del mapa.png'), 'map and note reference their pictures relatively');
  assert(withMedia.summary.media >= 6 && withMedia.includeMedia && withMedia.bytes > plain.bytes, 'summary counts media and the zip is bigger');
  const enIndex = await text(mzip, 'index.md');
  assert(enIndex.includes('## Index') && enIndex.includes('## Media (') && enIndex.includes('(audio)'), 'English headings and a media section');
  assert((JSON.parse(await text(mzip, 'world.json')) as { project: { coverImage: string } }).project.coverImage === 'media/project/cover.png', 'world.json points the cover at media/');
  passed.push('Media toggle: off writes no media/ and leaves markers; on writes real PNG and sound bytes under media/<kind>/ with relative embeds, a cover path in world.json and English headings on request');

  // --- Estimate ---
  const estimate = await estimateWorldMarkdownVault(P);
  assert(estimate.documents === 11 && estimate.mediaBytes > 100 && estimate.estimatedBytesWithMedia > estimate.estimatedBytes && estimate.estimatedBytes > 0, `estimate ${JSON.stringify(estimate)}`);
  passed.push('Size estimate: documents, media bytes and a with/without-media figure');

  // --- Cancel ---
  const early = new AbortController(); early.abort();
  let failure: unknown;
  try { await buildWorldMarkdownVault(P, { signal: early.signal }); } catch (error) { failure = error; }
  assert(isWorldMarkdownAborted(failure), 'an already-cancelled export refuses at once');
  const midway = new AbortController();
  failure = undefined;
  try { await buildWorldMarkdownVault(P, { signal: midway.signal, onPhase: text => { if (text === 'Tablas') midway.abort(); } }); } catch (error) { failure = error; }
  assert(isWorldMarkdownAborted(failure), 'cancel in the middle of the phases');
  const packing = new AbortController();
  failure = undefined;
  try { await buildWorldMarkdownVault(P, { signal: packing.signal, onPhase: text => { if (text.startsWith('Comprimiendo')) packing.abort(); } }); } catch (error) { failure = error; }
  assert(isWorldMarkdownAborted(failure), 'cancel while compressing');
  assert(JSON.stringify(await db.projects.get(P)) + (await db.codexEntries.count()) === before, 'exporting and cancelling never change stored data');
  passed.push('Cancel: AbortSignal before, during the phases and while compressing; stored data untouched');

  // --- Bridge ---
  const tool = BRIDGE_TOOLS.find(item => item.name === 'wh_world_markdown_export');
  assert(tool && tool.writes === false && TOOL_HANDLERS.wh_world_markdown_export, 'tool is in the catalogue as read-only with a handler');
  const reply = await runBridgeTool('wh_world_markdown_export', { projectId: P });
  assert(reply.ok, `bridge: ${JSON.stringify(reply).slice(0, 300)}`);
  const result = reply.result as { fileName: string; files: number; bytes: number; includeMedia: boolean; summary: Record<string, number>; base64: string };
  const unzipped = await JSZip.loadAsync(result.base64, { base64: true });
  assert(result.fileName === 'Mundo de Prueba - markdown vault.zip' && result.includeMedia === false && result.files === names(unzipped).length && result.summary.codex === 4 && (await unzipped.file('index.md')!.async('string')).includes('Mundo de Prueba'), 'bridge returns a real zip with its summary');
  const withMediaReply = await runBridgeTool('wh_world_markdown_export', { projectId: P, includeMedia: true, locale: 'en' });
  assert(withMediaReply.ok && (withMediaReply.result as { summary: Record<string, number> }).summary.media >= 6, 'bridge media toggle');
  assert((await runBridgeTool('wh_world_markdown_export', { projectId: P, includeMedia: 'yes' })).code === 'bad-args' && (await runBridgeTool('wh_world_markdown_export', { projectId: 'nope' })).code === 'not-found', 'bad arguments and unknown project are refused');
  await db.projects.put({ ...(await db.projects.get(P))!, id: 'wmd-big', title: 'Grande' } as Project);
  await db.localMediaAssets.put({ id: 'big', projectId: 'wmd-big', title: 'Banda sonora', kind: 'audio', mime: 'audio/mpeg', blob: new Blob([new Uint8Array(26 * 1048576)]), size: 26 * 1048576, notes: '', tags: [], linkedEntryIds: [], createdAt: 1, updatedAt: 1 } as never);
  const tooBig = await runBridgeTool('wh_world_markdown_export', { projectId: 'wmd-big', includeMedia: true });
  assert(!tooBig.ok && tooBig.code === 'too-large' && /includeMedia: false/.test(tooBig.error ?? ''), `size cap refuses with advice: ${JSON.stringify(tooBig)}`);
  assert((await runBridgeTool('wh_world_markdown_export', { projectId: 'wmd-big' })).ok, 'the same project without media is fine');
  passed.push('Bridge wh_world_markdown_export: read-only, base64 zip with summary, media and locale options, bad-args/not-found, 25 MB cap that suggests includeMedia:false');

  // --- Panel + download ---
  const host = document.getElementById('root')!, root = createRoot(host);
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL, originalClick = HTMLAnchorElement.prototype.click;
  let downloaded: Blob | undefined, downloadName = '';
  try {
    await act(async () => { root.render(<WorldMarkdownExportPanel projectId={P} />); await pause(200); });
    const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    await until(() => /Unos .* MB sin imágenes ni sonidos · 11 documentos/.test(q('world-md-estimate')?.textContent ?? ''), 'estimate in Spanish');
    const checkbox = q('world-md-include-media') as HTMLInputElement;
    assert(checkbox && !checkbox.checked && q('world-md-start')?.textContent === 'Exportar como Markdown', 'checkbox off by default, button labelled');
    await act(async () => { checkbox.click(); await pause(30); });
    assert(/con imágenes y sonidos/.test(q('world-md-estimate')!.textContent!), 'estimate follows the checkbox');
    await act(async () => { checkbox.click(); await pause(30); });
    URL.createObjectURL = (blob: Blob | MediaSource) => { if (blob instanceof Blob && (!downloaded || blob.size > 0)) downloaded = blob; return 'blob:wmd-test'; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () { downloadName = this.download; };
    await act(async () => { q('world-md-start')!.click(); await pause(30); });
    await until(() => !!q('world-md-notice'), 'export finished');
    assert(/^Listo: \d+ archivos en el ZIP\.$/.test(q('world-md-notice')!.textContent!) && !q('world-md-cancel'), `done notice: ${q('world-md-notice')?.textContent}`);
    assert(downloadName === 'Mundo de Prueba - markdown vault.zip' && downloaded && downloaded.size > 500, 'the real download path got the zip');
    assert(names(await open(downloaded)).includes('Codex/character/Ana Ruiz.md'), 'downloaded zip is the vault');
    passed.push('Panel: Spanish labels, size estimate that follows the "incluir imágenes y sonidos" checkbox, the click downloads the vault ZIP through the app download path');

    // Cancel from the panel on a big world.
    const now = 1791532800000;
    await db.projects.put({ ...(await db.projects.get(P))!, id: 'wmd-slow', title: 'Lento' } as Project);
    await db.notes.bulkPut(Array.from({ length: 3000 }, (_, i) => ({ id: `s${i}`, projectId: 'wmd-slow', kind: 'note', text: `Nota ${i}. Habla de Ana Ruiz y del Faro.`, tags: [], pinned: false, createdAt: now + i, updatedAt: now + i })) as never);
    await db.codexEntries.bulkPut([{ id: 'sa', projectId: 'wmd-slow', title: 'Ana Ruiz', type: 'character', fields: {}, content: '', tags: [], relations: [], createdAt: now, updatedAt: now }] as never);
    downloaded = undefined; downloadName = '';
    await act(async () => { root.render(<WorldMarkdownExportPanel key="slow" projectId="wmd-slow" />); await pause(200); });
    await act(async () => { q('world-md-start')!.click(); await pause(0); });
    await until(() => !!q('world-md-cancel'), 'cancel button while running', 400);
    assert(/Notas|Leyendo|Exportando|Fichas|Capítulos/.test(q('world-md-phase')?.textContent ?? ''), `phase text: ${q('world-md-phase')?.textContent}`);
    await act(async () => { q('world-md-cancel')!.click(); await pause(30); });
    await until(() => !!q('world-md-notice'), 'cancel notice');
    assert(q('world-md-notice')!.textContent === 'Exportación cancelada. No se ha guardado nada.' && !downloaded && !downloadName && !q('world-md-cancel') && !(q('world-md-start') as HTMLButtonElement).disabled, `canceled: ${q('world-md-notice')?.textContent}`);
    passed.push('Panel: phase text while running, Cancel stops it with a clear notice, nothing downloaded and the button is usable again');

    await act(async () => { useLocaleStore.setState({ locale: 'en' }); await pause(60); });
    await act(async () => { root.render(<WorldMarkdownExportPanel key="en" projectId={P} />); await pause(200); });
    assert(q('world-md-start')!.textContent === 'Export as Markdown' && host.textContent!.includes('Include images and sounds'), 'English labels');
    useLocaleStore.setState({ locale: 'es' });

    // The project card button.
    let asked = 0;
    await act(async () => { root.render(<ProjectCard project={(await db.projects.get(P))!} index={0} onClick={() => {}} onDelete={() => {}} onExportMarkdown={() => { asked++; }} />); await pause(100); });
    const cardButton = q('project-export-markdown');
    assert(cardButton?.getAttribute('aria-label') === 'Exportar como Markdown', 'project card has the export button');
    await act(async () => { cardButton.click(); await pause(20); });
    assert(asked === 1, 'project card button opens the export');
    passed.push('English labels and the dashboard project-card button');
  } finally {
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; HTMLAnchorElement.prototype.click = originalClick;
    await act(async () => { root.unmount(); await pause(); });
  }
  return passed;
}
