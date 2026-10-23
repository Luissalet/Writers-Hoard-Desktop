// ============================================
// Whole-world Markdown vault export
// ============================================
// Builds a ZIP that is a readable Markdown vault of one project: a file per
// Codex card, chapter, note, timeline, map, outline and diary page (YAML
// frontmatter on top, the body in Markdown, links between cards as
// [[wikilinks]]), tables as CSV, an index and a world.json. Pictures and
// sounds go under media/ only when asked.
//
// Read-only: it never writes to the database and it does not use, change or
// replace the ZIP backup formats (services/zipBackup.ts).

import JSZip from 'jszip';
import type { Table } from 'dexie';
import { db } from '@/db';
import type { Project } from '@/types';
import { GLOBAL_NOTES_SCOPE } from '@/engines/notes/types';
import { mediaFilename } from '@/engines/media/types';
import { vaultCopy, type VaultLang } from './copy';
import { createLinkContext, type CardRef } from './linking';
import type { MediaLimits } from './limits';
import { MediaSink, dataUrlBytes, inlineImageBytes } from './media';
import { NameRegistry, relativePath, safeName } from './names';
import {
  noteTitle, renderCodexEntry, renderDiaryEntry, renderMap, renderNote, renderOutline, renderTableCsv, renderTimeline, renderWriting,
  type RenderContext, type VaultData,
} from './render';

export type VaultKind = 'codex' | 'writing' | 'note' | 'table' | 'timeline' | 'map' | 'outline' | 'diary' | 'media';
export const VAULT_KINDS: readonly VaultKind[] = ['codex', 'writing', 'note', 'table', 'timeline', 'map', 'outline', 'diary', 'media'];

export interface WorldMarkdownOptions {
  /** Put pictures and sounds under media/. Default false. */
  includeMedia?: boolean;
  /** Turn mentions of a card's name in prose into [[links]] (first mention per document). Default true. */
  linkMentions?: boolean;
  /** Language of headings written into the files. Default 'es'. */
  lang?: VaultLang;
  /** Said at the start of each phase, and while compressing. */
  onPhase?: (text: string, done: number, total: number) => void;
  /** Test hook: smaller memory guards than the defaults (200 MB per file, 1 GB in all). */
  mediaLimits?: Partial<MediaLimits>;
  signal?: AbortSignal;
}

export interface WorldMarkdownResult {
  blob: Blob;
  fileName: string;
  /** Files inside the ZIP. */
  files: number;
  /** Size of the ZIP. */
  bytes: number;
  includeMedia: boolean;
  /** Documents written, by kind (media counts files under media/). */
  summary: Record<VaultKind, number>;
  warnings: string[];
}

export class WorldMarkdownAborted extends Error {
  constructor() { super('world_markdown_aborted'); this.name = 'WorldMarkdownAborted'; }
}

export function isWorldMarkdownAborted(error: unknown): boolean {
  return error instanceof WorldMarkdownAborted || (error instanceof Error && error.name === 'AbortError');
}

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new WorldMarkdownAborted();
}

export async function loadVaultData(projectId: string): Promise<VaultData> {
  const project = await db.projects.get(projectId);
  if (!project) throw new Error('Project not found');
  const of = <T>(table: Table<T, string>) => table.where('projectId').equals(projectId).toArray();
  const [entries, writings, notes, timelines, events, connections, maps, pins, outlines, beats, diary] = await Promise.all([
    of(db.codexEntries), of(db.writings), of(db.notes), of(db.timelines), of(db.timelineEvents), of(db.timelineConnections),
    of(db.worldMaps), of(db.mapPins), of(db.outlines), of(db.outlineBeats), of(db.diaryEntries),
  ]);
  return {
    project, entries, writings, notes: notes.filter(note => note.projectId !== GLOBAL_NOTES_SCOPE), timelines, events, connections, maps, pins, outlines, beats, diary,
  };
}

const worldReplacer = (_key: string, value: unknown) => (typeof value === 'string' && value.startsWith('data:') && value.length > 200 ? `[data omitted: ${dataUrlBytes(value)} bytes]` : value);

/**
 * The project as world.json keeps it: the same record, minus what is huge and already exists
 * elsewhere (published editions, each wiki edition's standalone reader page with its inline pictures).
 */
function slimProject(project: Project, cover: string | null): Record<string, unknown> {
  const slim = { ...project, coverImage: cover ?? undefined } as Record<string, unknown>;
  if (Array.isArray(project.publishedEditions)) slim.publishedEditions = { omitted: true, count: project.publishedEditions.length };
  if (Array.isArray(project.wikiProfiles)) {
    slim.wikiProfiles = project.wikiProfiles.map(profile => Array.isArray(profile.editions)
      ? { ...profile, editions: profile.editions.map(edition => edition?.reader && typeof edition.reader.html === 'string'
        ? { ...edition, reader: { ...edition.reader, html: { omitted: true, sha256: edition.reader.sha256, bytes: new TextEncoder().encode(edition.reader.html).byteLength } } }
        : edition) }
      : profile);
  }
  return slim;
}

function worldFile(project: Project, includeMedia: boolean, cover: string | null, counts: Record<string, number>): string {
  return JSON.stringify({
    format: 'writers-hoard-markdown-vault/1',
    generatedAt: new Date().toISOString(),
    includeMedia,
    counts,
    project: slimProject(project, cover),
  }, worldReplacer, 2);
}

export function vaultFileName(project: Pick<Project, 'title'>): string {
  return `${safeName(project.title, 'world')} - markdown vault.zip`;
}

/** Builds the vault. Throws WorldMarkdownAborted when the signal fires. */
export async function buildWorldMarkdownVault(projectId: string, options: WorldMarkdownOptions = {}): Promise<WorldMarkdownResult> {
  const { signal, onPhase } = options;
  const includeMedia = options.includeMedia === true;
  const lang: VaultLang = options.lang === 'en' ? 'en' : 'es';
  const copy = vaultCopy(lang);
  const warnings: string[] = [];
  checkAbort(signal);
  onPhase?.(copy.phaseLoading, 0, 1);
  const data = await loadVaultData(projectId);
  const { project } = data;
  const zip = new JSZip();
  const media = new MediaSink(zip, includeMedia, options.mediaLimits, { tooBig: copy.mediaTooBig, capped: copy.mediaCapped });
  const summary = Object.fromEntries(VAULT_KINDS.map(kind => [kind, 0])) as Record<VaultKind, number>;
  const indexLines: Record<VaultKind, string[]> = Object.fromEntries(VAULT_KINDS.map(kind => [kind, [] as string[]])) as Record<VaultKind, string[]>;

  // Names first, so a link written in one file resolves to a file written in another.
  const names = new NameRegistry(['index', 'world']);
  const cards = new Map<string, CardRef>();
  const entries = [...data.entries].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  for (const entry of entries) {
    const name = names.take(entry.title, copy.untitled);
    cards.set(entry.id, { id: entry.id, title: entry.title, name, path: `Codex/${safeName(entry.type, 'custom')}/${name}.md` });
  }
  const writings = [...data.writings].sort((a, b) => (a.chapter ?? Infinity) - (b.chapter ?? Infinity) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const writingNames = new Map<string, string>();
  const writingPaths = new Map<string, string>();
  for (const writing of writings) {
    const prefix = typeof writing.chapter === 'number' ? `${String(writing.chapter).padStart(2, '0')} - ` : '';
    const name = names.take(`${prefix}${writing.title || copy.untitled}`);
    writingNames.set(writing.id, name);
    writingPaths.set(writing.id, `Writings/${name}.md`);
  }
  const notes = [...data.notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const notePaths = notes.map(note => { const name = names.take(noteTitle(note, copy.untitled)); return { note, name, path: `Notes/${name}.md` }; });
  const tables = project.dataTables ?? [];
  const tableNames = new NameRegistry();
  const tablePaths = tables.map(table => ({ table, path: `Tables/${tableNames.take(table.title, copy.untitled)}.csv` }));
  const timelines = [...data.timelines].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const timelinePaths = timelines.map(timeline => { const name = names.take(timeline.title, copy.untitled); return { timeline, name, path: `Timelines/${name}.md` }; });
  const maps = [...data.maps].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const mapPaths = maps.map(map => { const name = names.take(map.title, copy.untitled); return { map, name, path: `Maps/${name}.md` }; });
  const outlines = [...data.outlines].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const outlinePaths = outlines.map(outline => { const name = names.take(outline.title, copy.untitled); return { outline, name, path: `Outlines/${name}.md` }; });
  const diary = [...data.diary].sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.id.localeCompare(b.id));
  const diaryPaths = diary.map(entry => { const name = names.take(`${entry.entryDate.slice(0, 10)} ${entry.title || ''}`.trim(), copy.untitled); return { entry, name, path: `Diary/${name}.md` }; });

  const link = createLinkContext(projectId, entries, cards, options.linkMentions !== false);
  const context: RenderContext = { copy, data, link, media, writingNames };
  const total = entries.length + writings.length + notes.length + tables.length + timelines.length + maps.length + outlines.length + diary.length;
  let done = 0;
  const step = async (text: string) => { done++; if (done % 25 === 0) { checkAbort(signal); onPhase?.(text, done, total); await tick(); } };
  const put = (path: string, content: string, kind: VaultKind, line: string) => { zip.file(path, content); summary[kind]++; indexLines[kind].push(line); };
  const mdLine = (name: string, extra = '') => `- [[${name}]]${extra}`;
  const guard = async <T>(label: string, work: () => T | Promise<T>): Promise<void> => {
    try { await work(); } catch (error) { if (isWorldMarkdownAborted(error)) throw error; warnings.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); }
  };

  checkAbort(signal);
  onPhase?.(copy.phaseCodex, done, total);
  for (const entry of entries) {
    const ref = cards.get(entry.id)!;
    await guard(`codex ${entry.title}`, () => put(ref.path, renderCodexEntry(entry, ref, context), 'codex', mdLine(ref.name, ` (${entry.type})`)));
    await step(copy.phaseCodex);
  }
  checkAbort(signal);
  onPhase?.(copy.phaseWritings, done, total);
  for (const writing of writings) {
    const path = writingPaths.get(writing.id)!;
    await guard(`writing ${writing.title}`, () => put(path, renderWriting(writing, path, context), 'writing', mdLine(writingNames.get(writing.id)!, writing.wordCount ? ` (${writing.wordCount})` : '')));
    await step(copy.phaseWritings);
  }
  checkAbort(signal);
  onPhase?.(copy.phaseNotes, done, total);
  for (const { note, name, path } of notePaths) {
    await guard(`note ${name}`, () => put(path, renderNote(note, name, path, context), 'note', mdLine(name)));
    await step(copy.phaseNotes);
  }
  checkAbort(signal);
  onPhase?.(copy.phaseTables, done, total);
  for (const { table, path } of tablePaths) {
    await guard(`table ${table.title}`, () => put(path, renderTableCsv(table, context), 'table', `- [${table.title.replace(/[[\]]/g, '')}](${relativePath('index.md', path)}) (${table.mode}, ${table.rows.length})`));
    await step(copy.phaseTables);
  }
  checkAbort(signal);
  onPhase?.(copy.phaseTimelines, done, total);
  for (const { timeline, name, path } of timelinePaths) {
    await guard(`timeline ${timeline.title}`, () => put(path, renderTimeline(timeline, path, context), 'timeline', mdLine(name)));
    await step(copy.phaseTimelines);
  }
  checkAbort(signal);
  onPhase?.(copy.phaseMaps, done, total);
  for (const { map, name, path } of mapPaths) {
    await guard(`map ${map.title}`, () => put(path, renderMap(map, name, path, context), 'map', mdLine(name)));
    await step(copy.phaseMaps);
  }
  checkAbort(signal);
  onPhase?.(copy.phaseOther, done, total);
  for (const { outline, name, path } of outlinePaths) {
    await guard(`outline ${outline.title}`, () => put(path, renderOutline(outline, context), 'outline', mdLine(name)));
    await step(copy.phaseOther);
  }
  for (const { entry, name, path } of diaryPaths) {
    await guard(`diary ${name}`, () => put(path, renderDiaryEntry(entry, path, context), 'diary', mdLine(name)));
    await step(copy.phaseOther);
  }

  checkAbort(signal);
  onPhase?.(copy.phaseMedia, done, total);
  let cover: string | null = null;
  if (includeMedia) {
    cover = media.addDataUrl(project.coverImage, 'project', 'cover');
    for (const asset of await db.localMediaAssets.where('projectId').equals(projectId).toArray()) {
      checkAbort(signal);
      await guard(`media ${asset.title}`, async () => {
        const stored = await media.addBlob(asset.blob, asset.kind === 'video' ? 'video' : 'audio', mediaFilename(asset));
        if (stored) indexLines.media.push(`- [${asset.title.replace(/[[\]]/g, '')}](${relativePath('index.md', stored)}) (${asset.kind})`);
      });
    }
    let galleryCount = 0;
    await db.inspirationImages.where('projectId').equals(projectId).each(image => {
      galleryCount++;
      const stored = media.addDataUrl(image.imageDataOriginal || image.imageData, 'gallery', `image ${galleryCount}`);
      if (stored) indexLines.media.push(`- [${stored.split('/').pop()}](${relativePath('index.md', stored)}) (gallery)`);
    });
    if (media.skipped) warnings.push(`${media.skipped} picture(s) could not be decoded and were left out.`);
    warnings.push(...media.warnings());
  }
  summary.media = media.files;

  checkAbort(signal);
  onPhase?.(copy.phaseIndex, done, total);
  const counts = { ...summary };
  const sections = VAULT_KINDS.filter(kind => indexLines[kind].length > 0 || kind === 'media').map(kind => {
    if (kind === 'media' && !includeMedia) return `## ${copy.kinds.media}\n\n${copy.noMedia}`;
    if (!indexLines[kind].length) return '';
    return `## ${copy.kinds[kind]} (${summary[kind]})\n\n${indexLines[kind].join('\n')}`;
  }).filter(Boolean);
  const index = [
    `# ${project.title}`,
    project.description ? project.description.trim() : '',
    `*${copy.generated} ${new Date().toISOString().slice(0, 10)}.*`,
    `## ${copy.indexTitle}`,
    ...sections,
  ].filter(Boolean).join('\n\n');
  zip.file('index.md', `${index}\n`);
  zip.file('world.json', worldFile(project, includeMedia, cover, counts));
  let files = 0;
  zip.forEach((_path, file) => { if (!file.dir) files++; });

  // JSZip cannot be stopped half-way, so the wait is raced with the signal: a
  // cancelled export answers at once and the half-built archive is dropped.
  checkAbort(signal);
  onPhase?.(`${copy.phasePacking} 0%`, total, total);
  let last = -1;
  const packing = zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'application/zip' }, meta => {
    const percent = Math.floor(meta.percent);
    if (percent !== last && percent % 5 === 0) { last = percent; onPhase?.(`${copy.phasePacking} ${percent}%`, total, total); }
  });
  const blob = await new Promise<Blob>((resolve, reject) => {
    const abort = () => reject(new WorldMarkdownAborted());
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    packing.then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort));
  });
  return { blob, fileName: vaultFileName(project), files, bytes: blob.size, includeMedia, summary, warnings };
}

// --- Size estimate -----------------------------------------------------------

export interface WorldMarkdownEstimate {
  documents: number;
  /** Rough size of the Markdown and CSV, before compression. */
  textBytes: number;
  /** Size of the pictures and sounds that includeMedia would add. */
  mediaBytes: number;
  /** Rough size of the ZIP without and with media. */
  estimatedBytes: number;
  estimatedBytesWithMedia: number;
}

/** Cheap: it adds up lengths, it does not render anything. Good to a few tens of percent. */
export async function estimateWorldMarkdownVault(projectId: string): Promise<WorldMarkdownEstimate> {
  const data = await loadVaultData(projectId);
  const { project } = data;
  let text = 0, mediaBytes = dataUrlBytes(project.coverImage);
  const stripped = (html: string | undefined) => (html ?? '').replace(/<img\b[^>]*>/gi, '').length;
  for (const entry of data.entries) {
    text += stripped(entry.content) + JSON.stringify(entry.fields).length + 200 + entry.relations.length * 60;
    mediaBytes += dataUrlBytes(entry.avatarOriginal || entry.avatar) + inlineImageBytes(entry.content);
  }
  for (const writing of data.writings) { text += stripped(writing.content) + 200; mediaBytes += inlineImageBytes(writing.content); }
  for (const note of data.notes) { text += note.text.length + 200; mediaBytes += dataUrlBytes(note.cover); }
  for (const table of project.dataTables ?? []) text += table.rows.reduce((total, row) => total + Object.values(row.cells).join(',').length + 4, 0) + table.columns.length * 20;
  for (const event of data.events) { text += (event.description?.length ?? 0) + (event.title?.length ?? 0) + 80; mediaBytes += dataUrlBytes(event.image); }
  for (const map of data.maps) { text += 200; mediaBytes += dataUrlBytes(map.backgroundImage); }
  for (const pin of data.pins) text += (pin.description?.length ?? 0) + 80;
  for (const beat of data.beats) text += (beat.description?.length ?? 0) + 80;
  for (const entry of data.diary) { text += stripped(entry.content) + 150; mediaBytes += inlineImageBytes(entry.content); }
  await db.localMediaAssets.where('projectId').equals(projectId).each(asset => { mediaBytes += asset.blob.size; });
  await db.inspirationImages.where('projectId').equals(projectId).each(image => { mediaBytes += dataUrlBytes(image.imageDataOriginal || image.imageData); });
  // world.json keeps the whole project record (pictures and wiki editions already slimmed), so it counts too.
  text += JSON.stringify(slimProject(project, null), worldReplacer, 2).length;
  const documents = data.entries.length + data.writings.length + data.notes.length + (project.dataTables?.length ?? 0) + data.timelines.length + data.maps.length + data.outlines.length + data.diary.length;
  const estimatedBytes = Math.round(text * 0.4) + 2048 + documents * 150;
  return { documents, textBytes: text, mediaBytes, estimatedBytes, estimatedBytesWithMedia: estimatedBytes + mediaBytes };
}
