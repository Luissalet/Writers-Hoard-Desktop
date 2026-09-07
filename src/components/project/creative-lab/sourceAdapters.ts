import type { BoardNode } from '@/engines/board/types';
import type { Note } from '@/engines/notes/types';
import type { Seed } from '@/engines/seeds/types';
import type { CodexEntry, InspirationImage } from '@/types';
import { stripHtml } from '@/utils/text';
import { getCreativeLabCopy } from './copy';
import type { CreativeLabCopy } from './copy';
import type { CreativeSource, CreativeSourceKind } from './types';

export interface CreativeSourceCollections {
  projectId: string;
  notes?: readonly Note[];
  boardNodes?: readonly BoardNode[];
  codexEntries?: readonly CodexEntry[];
  images?: readonly InspirationImage[];
  seeds?: readonly Seed[];
  usageCounts?: Readonly<Record<string, number>>;
  locale?: string;
  copy?: Pick<CreativeLabCopy, 'untitledSources'>;
}

const EXCERPT_LENGTH = 220;

export function creativeSourceKey(kind: CreativeSourceKind, id: string): string {
  return `${kind}:${id}`;
}

function cleanLine(value: string): string {
  return value.split('\n').map(line => line.trim()).find(Boolean) ?? '';
}

function excerpt(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= EXCERPT_LENGTH) return clean;
  return `${clean.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…`;
}

function usageCount(
  counts: CreativeSourceCollections['usageCounts'],
  kind: CreativeSourceKind,
  id: string,
): number {
  const value = counts?.[creativeSourceKey(kind, id)] ?? 0;
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * Builds disposable picker rows from canonical entities. The returned objects
 * contain no write path and are safe to throw away when the lab closes.
 */
export function buildCreativeSources(input: CreativeSourceCollections): CreativeSource[] {
  const { projectId, usageCounts: counts } = input;
  const untitled = input.copy?.untitledSources ?? getCreativeLabCopy(input.locale).untitledSources;
  const sources: CreativeSource[] = [];

  for (const note of input.notes ?? []) {
    if (note.projectId !== projectId) continue;
    sources.push({
      key: creativeSourceKey('note', note.id),
      kind: 'note',
      id: note.id,
      projectId,
      title: cleanLine(note.text) || untitled.note,
      excerpt: excerpt(note.text),
      tags: [...note.tags],
      revision: note.updatedAt,
      usageCount: usageCount(counts, 'note', note.id),
    });
  }

  for (const node of input.boardNodes ?? []) {
    if (node.projectId !== projectId) continue;
    sources.push({
      key: creativeSourceKey('board', node.id),
      kind: 'board',
      id: node.id,
      projectId,
      title: node.title.trim() || cleanLine(node.content) || untitled.board,
      excerpt: excerpt(node.content || stripHtml(node.richContent ?? '')),
      tags: [...node.tags],
      ...(node.image ? { thumbnail: node.image } : {}),
      revision: node.updatedAt,
      usageCount: usageCount(counts, 'board', node.id),
    });
  }

  for (const entry of input.codexEntries ?? []) {
    if (entry.projectId !== projectId) continue;
    const fieldText = Object.values(entry.fields).filter(Boolean).join(' · ');
    sources.push({
      key: creativeSourceKey('codex', entry.id),
      kind: 'codex',
      id: entry.id,
      projectId,
      title: entry.title.trim() || untitled.codex,
      excerpt: excerpt(stripHtml(entry.content) || fieldText),
      tags: [...entry.tags],
      ...(entry.avatar ? { thumbnail: entry.avatar } : {}),
      revision: entry.updatedAt,
      usageCount: usageCount(counts, 'codex', entry.id),
    });
  }

  for (const image of input.images ?? []) {
    if (image.projectId !== projectId) continue;
    const firstTag = image.tags.find(tag => tag.trim());
    sources.push({
      key: creativeSourceKey('gallery', image.id),
      kind: 'gallery',
      id: image.id,
      projectId,
      title: cleanLine(image.notes) || firstTag || untitled.gallery,
      excerpt: excerpt(image.notes || image.tags.join(' · ')),
      tags: [...image.tags],
      thumbnail: image.thumbnailData ?? image.imageData,
      revision: image.createdAt,
      usageCount: usageCount(counts, 'gallery', image.id),
    });
  }

  for (const seed of input.seeds ?? []) {
    if (seed.projectId !== projectId) continue;
    sources.push({
      key: creativeSourceKey('seed', seed.id),
      kind: 'seed',
      id: seed.id,
      projectId,
      title: seed.title.trim() || untitled.seed,
      excerpt: excerpt(seed.description),
      tags: [...seed.tags],
      revision: seed.updatedAt,
      usageCount: usageCount(counts, 'seed', seed.id),
    });
  }

  return sources.sort((left, right) => {
    if (left.usageCount !== right.usageCount) return left.usageCount - right.usageCount;
    if ((right.revision ?? 0) !== (left.revision ?? 0)) {
      return (right.revision ?? 0) - (left.revision ?? 0);
    }
    return left.key.localeCompare(right.key);
  });
}
