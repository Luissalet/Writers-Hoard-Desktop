import Dexie from 'dexie';
import { db } from '@/db';
import { stripHtml } from '@/utils/text';

export interface ContentSearchHit {
  id: string;
  engineId: string;
  projectId: string;
  title: string;
  subtitle: string;
  snippet: string;
}

interface SearchDocument extends Omit<ContentSearchHit, 'snippet'> {
  body: string;
  normalizedBody: string;
}

let cachedDocuments: SearchDocument[] | null = null;
let pendingBuild: Promise<SearchDocument[]> | null = null;

function excerpt(plain: string, query: string): string {
  const index = plain.toLocaleLowerCase().indexOf(query);
  const start = Math.max(0, index - 40);
  const end = Math.min(plain.length, index + query.length + 40);
  return `${start > 0 ? '…' : ''}${plain.slice(start, end).trim()}${end < plain.length ? '…' : ''}`;
}

async function buildIndex(): Promise<SearchDocument[]> {
  const [writings, codexEntries, diaryEntries, dialogBlocks, scenes, snapshots] = await Promise.all([
    db.writings.toArray(),
    db.codexEntries.toArray(),
    db.diaryEntries.toArray(),
    db.dialogBlocks.toArray(),
    db.scenes.toArray(),
    db.snapshots.toArray(),
  ]);
  const sceneById = new Map(scenes.map(scene => [scene.id, scene]));
  const documents: SearchDocument[] = [];

  for (const writing of writings) {
    const body = stripHtml(writing.content ?? '');
    documents.push({
      id: writing.id,
      engineId: 'writings',
      projectId: writing.projectId,
      title: writing.title,
      subtitle: writing.status,
      body,
      normalizedBody: body.toLocaleLowerCase(),
    });
  }
  for (const entry of codexEntries) {
    const body = stripHtml(entry.content ?? '');
    documents.push({
      id: entry.id,
      engineId: 'codex',
      projectId: entry.projectId,
      title: entry.title,
      subtitle: entry.type,
      body,
      normalizedBody: body.toLocaleLowerCase(),
    });
  }
  for (const entry of diaryEntries) {
    const body = stripHtml(entry.content ?? '');
    documents.push({
      id: entry.id,
      engineId: 'diary',
      projectId: entry.projectId,
      title: entry.title || entry.entryDate,
      subtitle: 'diary',
      body,
      normalizedBody: body.toLocaleLowerCase(),
    });
  }
  for (const block of dialogBlocks) {
    const scene = sceneById.get(block.sceneId);
    if (!scene) continue;
    const body = stripHtml(block.content ?? '');
    documents.push({
      id: scene.id,
      engineId: 'dialog-scene',
      projectId: scene.projectId,
      title: scene.title,
      subtitle: block.characterName || block.type,
      body,
      normalizedBody: body.toLocaleLowerCase(),
    });
  }
  for (const snapshot of snapshots) {
    const body = stripHtml([
      snapshot.description,
      snapshot.notes,
      snapshot.extractedText,
      snapshot.author,
      snapshot.tags.join(' '),
    ].filter(Boolean).join('\n'));
    documents.push({
      id: snapshot.id,
      engineId: 'scrapper',
      projectId: snapshot.projectId,
      title: snapshot.title || snapshot.url,
      subtitle: snapshot.source,
      body,
      normalizedBody: body.toLocaleLowerCase(),
    });
  }

  cachedDocuments = documents;
  pendingBuild = null;
  return documents;
}

async function getDocuments(): Promise<SearchDocument[]> {
  if (cachedDocuments) return cachedDocuments;
  pendingBuild ??= buildIndex();
  return pendingBuild;
}

/** Search prose from an invalidation-aware index instead of rescanning tables per keypress. */
export async function searchProjectContent(
  query: string,
  projectId?: string,
  limit = 8,
): Promise<ContentSearchHit[]> {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length < 3) return [];
  const documents = await getDocuments();
  const seen = new Set<string>();
  const hits: ContentSearchHit[] = [];

  for (const document of documents) {
    if (projectId && document.projectId !== projectId) continue;
    if (!document.normalizedBody.includes(normalizedQuery)) continue;
    const key = `${document.engineId}:${document.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({
      id: document.id,
      engineId: document.engineId,
      projectId: document.projectId,
      title: document.title,
      subtitle: document.subtitle,
      snippet: excerpt(document.body, normalizedQuery),
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

export function invalidateProjectSearchIndex(): void {
  cachedDocuments = null;
  pendingBuild = null;
}

// Cross-window writes (including quick capture) invalidate the same cache.
Dexie.on('storagemutated', invalidateProjectSearchIndex);
