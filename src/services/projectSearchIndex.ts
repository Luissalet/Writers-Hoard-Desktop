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

/** Push a document, skipping anything with no text worth matching. */
function add(
  documents: SearchDocument[],
  doc: Omit<SearchDocument, 'normalizedBody'>,
): void {
  if (!doc.body.trim()) return;
  documents.push({ ...doc, normalizedBody: doc.body.toLocaleLowerCase() });
}

/**
 * Build the body index.
 *
 * Deliberately absent: `boardNodes`, `inspirationImages`, `storyboardPanels`
 * and `videoSegments`. All four store base64 images inline, and loading them
 * here would deserialise every picture in the project on the first keystroke —
 * the exact regression `engines/board/index.ts` records having already been
 * fixed once. Their titles remain searchable through the entity resolvers.
 */
async function buildIndex(): Promise<SearchDocument[]> {
  const [
    writings, codexEntries, diaryEntries, dialogBlocks, scenes, snapshots,
    notes, outlineBeats, seeds, payoffs, characterArcs, arcBeats,
    relationships, biographyFacts, timelineEvents, mapPins, annotations,
  ] = await Promise.all([
    db.writings.toArray(),
    db.codexEntries.toArray(),
    db.diaryEntries.toArray(),
    db.dialogBlocks.toArray(),
    db.scenes.toArray(),
    db.snapshots.toArray(),
    db.notes.toArray(),
    db.outlineBeats.toArray(),
    db.seeds.toArray(),
    db.payoffs.toArray(),
    db.characterArcs.toArray(),
    db.arcBeats.toArray(),
    db.relationships.toArray(),
    db.biographyFacts.toArray(),
    db.timelineEvents.toArray(),
    db.mapPins.toArray(),
    db.annotations.toArray(),
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

  for (const note of notes) {
    add(documents, {
      id: note.id,
      engineId: 'notes',
      projectId: note.projectId,
      title: note.text.split('\n')[0]?.slice(0, 80) ?? '',
      subtitle: note.kind,
      body: [note.text, note.source, note.tags.join(' ')].filter(Boolean).join('\n'),
    });
  }
  for (const beat of outlineBeats) {
    add(documents, {
      id: beat.id,
      engineId: 'outline',
      projectId: beat.projectId,
      title: beat.title,
      subtitle: beat.level,
      body: [beat.title, beat.description].filter(Boolean).join('\n'),
    });
  }
  for (const seed of seeds) {
    add(documents, {
      id: seed.id,
      engineId: 'seeds',
      projectId: seed.projectId,
      title: seed.title,
      subtitle: seed.kind,
      body: [seed.title, seed.description, seed.locationLabel, seed.tags.join(' ')]
        .filter(Boolean).join('\n'),
    });
  }
  for (const payoff of payoffs) {
    add(documents, {
      id: payoff.seedId,
      engineId: 'seeds',
      projectId: payoff.projectId,
      title: payoff.title,
      subtitle: 'payoff',
      body: [payoff.title, payoff.description, payoff.locationLabel].filter(Boolean).join('\n'),
    });
  }
  for (const arc of characterArcs) {
    add(documents, {
      id: arc.id,
      engineId: 'character-arc',
      projectId: arc.projectId,
      title: arc.title,
      subtitle: arc.characterName ?? arc.status,
      // The five spine fields are the arc: without them it is just a title.
      body: [arc.title, arc.summary, arc.ghost, arc.lie, arc.truth, arc.want, arc.need]
        .filter(Boolean).join('\n'),
    });
  }
  for (const beat of arcBeats) {
    add(documents, {
      id: beat.arcId,
      engineId: 'character-arc',
      projectId: beat.projectId,
      title: beat.title,
      subtitle: beat.stage,
      body: [beat.title, beat.description, beat.emotion].filter(Boolean).join('\n'),
    });
  }
  for (const relationship of relationships) {
    add(documents, {
      id: relationship.id,
      engineId: 'relationships',
      projectId: relationship.projectId,
      title: `${relationship.entityAName} – ${relationship.entityBName}`,
      subtitle: relationship.kind,
      body: [relationship.label, relationship.notes, relationship.entityAName, relationship.entityBName]
        .filter(Boolean).join('\n'),
    });
  }
  for (const fact of biographyFacts) {
    add(documents, {
      id: fact.biographyId,
      engineId: 'biography',
      projectId: fact.projectId,
      title: fact.title,
      subtitle: fact.category,
      body: [fact.title, stripHtml(fact.content ?? ''), fact.date, fact.tags.join(' ')]
        .filter(Boolean).join('\n'),
    });
  }
  for (const event of timelineEvents) {
    add(documents, {
      id: event.id,
      engineId: 'timeline',
      projectId: event.projectId,
      title: event.title,
      subtitle: event.date || event.eventType,
      body: [event.title, event.description, event.date, event.lane].filter(Boolean).join('\n'),
    });
  }
  for (const pin of mapPins) {
    add(documents, {
      id: pin.id,
      engineId: 'maps',
      projectId: pin.projectId,
      title: pin.name,
      subtitle: pin.icon,
      body: [pin.name, pin.description].filter(Boolean).join('\n'),
    });
  }
  for (const annotation of annotations) {
    add(documents, {
      id: annotation.id,
      engineId: 'annotations',
      projectId: annotation.projectId,
      title: annotation.anchor.selectedText || annotation.sourceEngineId,
      subtitle: annotation.sourceEngineId,
      // noteImageUrl may be a data URL — never indexed.
      body: [annotation.noteBody, annotation.anchor.selectedText].filter(Boolean).join('\n'),
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
