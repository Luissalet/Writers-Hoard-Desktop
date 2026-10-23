// ============================================
// World Markdown export — one renderer per kind of document
// ============================================
// Pure given the loaded rows and a context: no Dexie, no downloads. Every
// renderer answers the text of one file (or one CSV).

import { htmlToMarkdown } from '@/engines/writings/manuscriptExport';
import { readAliases } from '@/services/codexReference/aliases';
import { projectWorldTable } from '@/engines/tables/projection';
import { sheetValues } from '@/engines/tables/formulas';
import { cellKey, tableCsv, type WorldTable } from '@/engines/tables/types';
import { formatWorldRange, type WorldCalendar } from '@/engines/timeline/worldCalendar';
import type { CodexEntry, MapPin, Project, Timeline, TimelineConnection, TimelineEvent, Writing, WorldMap } from '@/types';
import type { Note } from '@/engines/notes/types';
import type { Outline, OutlineBeat } from '@/engines/outline/types';
import type { DiaryEntry } from '@/engines/diary/types';
import { frontmatter, isoDate } from './yaml';
import { relativePath } from './names';
import { linkHtml, linkPlainText, wikilink, type CardRef, type LinkContext } from './linking';
import type { MediaSink } from './media';
import type { vaultCopy } from './copy';

export interface VaultData {
  project: Project;
  entries: CodexEntry[];
  writings: Writing[];
  notes: Note[];
  timelines: Timeline[];
  events: TimelineEvent[];
  connections: TimelineConnection[];
  maps: WorldMap[];
  pins: MapPin[];
  outlines: Outline[];
  beats: OutlineBeat[];
  diary: DiaryEntry[];
}

export interface RenderContext {
  copy: ReturnType<typeof vaultCopy>;
  data: VaultData;
  link: LinkContext;
  media: MediaSink;
  /** Writing id -> file name without extension, for links from outlines. */
  writingNames: ReadonlyMap<string, string>;
}

const oneLine = (text: string | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

function bodyOf(html: string, path: string, context: RenderContext, selfId?: string): string {
  const stem = path.split('/').pop()!.replace(/\.md$/, '');
  const linked = linkHtml(html, context.link, {
    selfId,
    imageOmitted: context.copy.imageOmitted,
    image: dataUrl => {
      const stored = context.media.addDataUrl(dataUrl, 'inline', `${stem} image`);
      return stored ? relativePath(path, stored) : null;
    },
  });
  return htmlToMarkdown(linked);
}

function imageEmbed(path: string, stored: string | null, alt = ''): string {
  return stored ? `![${alt.replace(/[[\]]/g, '')}](${relativePath(path, stored)})` : '';
}

const join = (...blocks: (string | undefined | false)[]) => `${blocks.filter(Boolean).join('\n\n').trim()}\n`;

function calendarOf(project: Project, timeline?: Timeline): WorldCalendar | undefined {
  return timeline?.worldCalendar ?? project.worldCalendar;
}

function worldDateText(calendar: WorldCalendar | undefined, start: Writing['worldDate'], end?: Writing['worldDate']): string | undefined {
  if (!start) return undefined;
  try { if (calendar) return formatWorldRange(calendar, start, end); } catch { /* A date the calendar cannot place is written as its numbers. */ }
  return [start.year, start.month, start.day].filter(value => value !== undefined).join('-');
}

// --- Codex -------------------------------------------------------------------

export function renderCodexEntry(entry: CodexEntry, ref: CardRef, context: RenderContext): string {
  const { data, copy } = context;
  const template = entry.templateId ? data.project.codexTemplates?.find(item => item.id === entry.templateId) : undefined;
  const avatar = context.media.addDataUrl(entry.avatarOriginal || entry.avatar, 'codex', ref.name);
  const references = Object.fromEntries(Object.entries(entry.referenceFields ?? {}).map(([name, ids]) => [name, ids.map(id => {
    const card = context.link.cards.get(id);
    return card ? wikilink(card) : id;
  })]));
  const head = frontmatter({
    kind: 'codex',
    type: entry.type,
    template: template?.name,
    title: entry.title,
    aliases: readAliases(entry.fields),
    tags: entry.tags,
    fields: entry.fields,
    references,
    avatar: avatar ?? undefined,
    eraId: (entry as { eraId?: string }).eraId,
    id: entry.id,
    createdAt: isoDate(entry.createdAt),
    updatedAt: isoDate(entry.updatedAt),
  });
  const relations = entry.relations.length
    ? `## ${copy.relations}\n\n${entry.relations.map(relation => {
        const card = context.link.cards.get(relation.targetId);
        const target = card ? wikilink(card) : relation.targetTitle;
        return `- ${relation.type}: ${target}${relation.description ? ` — ${oneLine(relation.description)}` : ''}`;
      }).join('\n')}`
    : '';
  return head + join(`# ${entry.title || copy.untitled}`, imageEmbed(ref.path, avatar, entry.title), bodyOf(entry.content, ref.path, context, entry.id), relations);
}

// --- Writings ----------------------------------------------------------------

export function renderWriting(writing: Writing, path: string, context: RenderContext): string {
  const { data, copy } = context;
  const head = frontmatter({
    kind: 'writing',
    type: 'writing',
    title: writing.title,
    chapter: writing.chapter,
    kicker: writing.kicker,
    status: writing.status,
    synopsis: writing.synopsis,
    wordCount: writing.wordCount,
    heldBack: writing.heldBack,
    worldDate: worldDateText(data.project.worldCalendar, writing.worldDate, writing.worldDateEnd),
    tags: writing.tags,
    eraId: (writing as { eraId?: string }).eraId,
    id: writing.id,
    createdAt: isoDate(writing.createdAt),
    updatedAt: isoDate(writing.updatedAt),
  });
  return head + join(`# ${writing.title || copy.untitled}`, bodyOf(writing.content, path, context));
}

// --- Notes -------------------------------------------------------------------

export function noteTitle(note: Note, untitled: string): string {
  const own = oneLine(note.title);
  if (own) return own;
  const first = oneLine(note.text.split(/\r?\n/).find(line => line.trim()) ?? '');
  return (first.length > 60 ? `${first.slice(0, 57)}...` : first) || untitled;
}

export function renderNote(note: Note, name: string, path: string, context: RenderContext): string {
  const cover = context.media.addDataUrl(note.cover, 'notes', name);
  const titled = Boolean(oneLine(note.title));
  const head = frontmatter({
    kind: 'note',
    type: 'note',
    noteKind: note.kind,
    title: noteTitle(note, context.copy.untitled),
    source: note.source,
    tags: note.tags,
    pinned: note.pinned || undefined,
    color: note.color,
    cover: cover ?? undefined,
    id: note.id,
    createdAt: isoDate(note.createdAt),
    updatedAt: isoDate(note.updatedAt),
  });
  return head + join(titled && `# ${oneLine(note.title)}`, imageEmbed(path, cover, name), linkPlainText(note.text, context.link));
}

// --- Tables ------------------------------------------------------------------

export function renderTableCsv(table: WorldTable, context: RenderContext): string {
  const { project, entries } = context.data;
  const projection = projectWorldTable(table, entries, project.codexTemplates ?? []);
  const computed = table.mode === 'sheet' ? sheetValues(table) : undefined;
  const columns = projection.columns;
  // Indexed once: finding each cell's row or column by scanning made a big table quadratic.
  const columnIndex = new Map(columns.map((column, index) => [column, index]));
  const rowIndex = new Map(projection.rows.map((row, index) => [row, index]));
  const displayById = new Map<string, (typeof projection.displayRows)[number]>();
  for (const item of projection.displayRows) if (!displayById.has(item.id)) displayById.set(item.id, item);
  return tableCsv(columns, projection.rows, (row, column) => computed
    ? String(computed.get(cellKey(columnIndex.get(column) ?? -1, rowIndex.get(row) ?? -1)) ?? '')
    : displayById.get(row.id)?.cells[column.id] ?? row.cells[column.id] ?? '');
}

// --- Timelines ---------------------------------------------------------------

function tagText(tags: readonly string[] | undefined): string {
  return (tags ?? []).map(tag => `#${tag.trim().replace(/\s+/g, '-')}`).filter(tag => tag.length > 1).join(' ');
}

export function renderTimeline(timeline: Timeline, path: string, context: RenderContext): string {
  const { data, copy } = context;
  const calendar = calendarOf(data.project, timeline);
  const events = data.events.filter(event => event.timelineId === timeline.id).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  const byId = new Map(events.map(event => [event.id, event]));
  const dateOf = (event: TimelineEvent): string => {
    try {
      if (event.dateMode === 'world' && event.worldDate && calendar) return formatWorldRange(calendar, event.worldDate, event.worldDateEnd);
    } catch { /* Falls back to the text the author typed. */ }
    if (event.dateMode === 'calendar' && event.realDate) return event.realDateEnd ? `${event.realDate} → ${event.realDateEnd}` : event.realDate;
    return event.date || event.realDate || '';
  };
  const lines = events.map(event => {
    const when = [dateOf(event), event.time ? (event.endTime ? `${event.time}-${event.endTime}` : event.time) : ''].filter(Boolean).join(' ');
    const ids = [...new Set([...(event.linkedEntryIds ?? []), ...(event.linkedEntryId ? [event.linkedEntryId] : [])])];
    const cards = ids.map(id => context.link.cards.get(id)).filter((card): card is CardRef => Boolean(card)).map(card => wikilink(card));
    const picture = context.media.addDataUrl(event.image, 'timelines', `${timeline.title} ${event.title}`);
    const parts = [
      when ? `**${when}**` : '',
      `**${oneLine(event.title) || copy.untitled}**${event.eventType !== 'point' ? ` (${event.eventType})` : ''}`,
      event.lane ? oneLine(event.lane) : '',
      cards.join(', '),
      tagText(event.tags),
    ].filter(Boolean);
    const description = oneLine(linkPlainText(event.description ?? '', context.link));
    return `- ${parts.join(' · ')}${description ? ` — ${description}` : ''}${picture ? `\n  ${imageEmbed(path, picture)}` : ''}`;
  });
  const connections = data.connections.filter(connection => connection.timelineId === timeline.id).flatMap(connection => {
    const from = byId.get(connection.sourceEventId) ?? data.events.find(event => event.id === connection.sourceEventId);
    const to = byId.get(connection.targetEventId) ?? data.events.find(event => event.id === connection.targetEventId);
    return from && to ? [`- ${oneLine(from.title)} → ${oneLine(to.title)}${connection.label ? ` (${oneLine(connection.label)})` : ''}`] : [];
  });
  const head = frontmatter({
    kind: 'timeline',
    type: 'timeline',
    title: timeline.title,
    color: timeline.color,
    events: events.length,
    eraId: (timeline as { eraId?: string }).eraId,
    id: timeline.id,
    createdAt: isoDate(timeline.createdAt),
    updatedAt: isoDate(timeline.updatedAt),
  });
  return head + join(`# ${timeline.title || copy.untitled}`, timeline.description && oneLine(linkPlainText(timeline.description, context.link)), lines.length > 0 && `## ${copy.events}\n\n${lines.join('\n')}`, connections.length > 0 && `## ${copy.connections}\n\n${connections.join('\n')}`);
}

// --- Maps --------------------------------------------------------------------

export function renderMap(map: WorldMap, name: string, path: string, context: RenderContext): string {
  const { data, copy } = context;
  const picture = context.media.addDataUrl(map.backgroundImage, 'maps', name);
  const pins = data.pins.filter(pin => pin.mapId === map.id).map(pin => {
    const card = pin.linkedEntryId ? context.link.cards.get(pin.linkedEntryId) : undefined;
    const description = oneLine(linkPlainText(pin.description ?? '', context.link));
    return `- **${oneLine(pin.name) || copy.untitled}** (${pin.icon}) · ${Math.round(pin.position.x)}%, ${Math.round(pin.position.y)}%${card ? ` · ${wikilink(card)}` : ''}${description ? ` — ${description}` : ''}`;
  });
  const head = frontmatter({
    kind: 'map',
    type: 'map',
    title: map.title,
    source: map.source,
    widthKm: map.widthKm,
    image: picture ?? undefined,
    pins: pins.length,
    id: map.id,
    createdAt: isoDate(map.createdAt),
    updatedAt: isoDate(map.updatedAt),
  });
  return head + join(`# ${map.title || copy.untitled}`, imageEmbed(path, picture, map.title), pins.length > 0 && `## ${copy.pins}\n\n${pins.join('\n')}`);
}

// --- Outlines and diary ------------------------------------------------------

const LEVELS: Record<OutlineBeat['level'], number> = { act: 0, chapter: 1, scene: 2, beat: 3 };

export function renderOutline(outline: Outline, context: RenderContext): string {
  const { data, copy } = context;
  const beats = data.beats.filter(beat => beat.outlineId === outline.id).sort((a, b) => a.order - b.order);
  const lines = beats.map(beat => {
    const written = beat.linkedWritingId ? context.writingNames.get(beat.linkedWritingId) : undefined;
    const description = oneLine(linkPlainText(beat.description ?? '', context.link));
    return `${'  '.repeat(LEVELS[beat.level] ?? 0)}- [${beat.status}] **${oneLine(beat.title) || copy.untitled}**${written ? ` · [[${written}]]` : ''}${description ? ` — ${description}` : ''}`;
  });
  const head = frontmatter({
    kind: 'outline', type: 'outline', title: outline.title, template: outline.templateId, beats: beats.length,
    id: outline.id, createdAt: isoDate(outline.createdAt), updatedAt: isoDate(outline.updatedAt),
  });
  return head + join(`# ${outline.title || copy.untitled}`, lines.length > 0 && `## ${copy.beats}\n\n${lines.join('\n')}`);
}

export function renderDiaryEntry(entry: DiaryEntry, path: string, context: RenderContext): string {
  const head = frontmatter({
    kind: 'diary', type: 'diary', title: entry.title || entry.entryDate, date: entry.entryDate, mood: entry.mood, tags: entry.tags,
    pinned: entry.pinned || undefined, id: entry.id, createdAt: isoDate(entry.createdAt), updatedAt: isoDate(entry.updatedAt),
  });
  return head + join(`# ${entry.title || entry.entryDate}`, bodyOf(entry.content, path, context));
}
