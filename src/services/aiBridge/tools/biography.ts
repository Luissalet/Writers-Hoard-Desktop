// ============================================================================
// AI bridge tools — biography
// ============================================================================
//
// `biographyFacts` is scoped by biographyId. `Biography.subjectPhoto` is an
// inline base64 photo and is never serialised into a tool result: it would be
// megabytes of noise in a model's context.

import { db } from '@/db';
import type { Biography, BiographyCategory, BiographyFact } from '@/engines/biography/types';
import {
  createBiography,
  createFact,
  getBiographies,
  getBiography,
  getFacts,
  updateFact,
} from '@/engines/biography/operations';
import { generateId } from '@/utils/idGenerator';
import {
  assertEngineEnabled,
  assertRowInScope,
  BridgeError,
  EMPTY_CONTENT,
  htmlFromMarkdown,
  markdownFromHtml,
  optEnum,
  optString,
  optStringArray,
  requireString,
  resolveProjectForEngine,
  resolveProjectId,
  withAudit,
  type ToolArgs,
} from './shared';

const CATEGORIES = [
  'birth', 'death', 'education', 'career', 'relationship', 'achievement',
  'conflict', 'travel', 'health', 'personal', 'political', 'creative', 'custom',
] as const satisfies readonly BiographyCategory[];

const CONFIDENCE = [
  'confirmed', 'likely', 'uncertain', 'disputed',
] as const satisfies readonly BiographyFact['confidence'][];

export async function whListBiographies(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const bios = await getBiographies(projectId);
  const facts = await db.biographyFacts.where('projectId').equals(projectId).toArray();
  return {
    projectId,
    biographies: bios.map((bio) => ({
      id: bio.id,
      subjectName: bio.subjectName,
      subjectId: bio.subjectId,
      hasPhoto: Boolean(bio.subjectPhoto),
      factCount: facts.filter((fact) => fact.biographyId === bio.id).length,
      updatedAt: bio.updatedAt,
    })),
  };
}

export async function whGetBiography(args: ToolArgs): Promise<unknown> {
  const id = requireString(args, 'id');
  const bio = await getBiography(id);
  if (!bio) throw new BridgeError('not-found', `No biography with id "${id}".`);
  assertRowInScope(args, bio.projectId);
  const facts = await getFacts(id);
  return {
    id: bio.id,
    projectId: bio.projectId,
    subjectName: bio.subjectName,
    subjectId: bio.subjectId,
    facts: facts.map((fact) => ({
      id: fact.id,
      order: fact.order,
      title: fact.title,
      content: markdownFromHtml(fact.content),
      date: fact.date,
      endDate: fact.endDate,
      category: fact.category,
      confidence: fact.confidence,
      sources: fact.sources,
      tags: fact.tags,
    })),
  };
}

export async function whCreateBiography(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, 'biography');
  const subjectId = optString(args, 'subjectId');
  const subject = subjectId ? await db.codexEntries.get(subjectId) : undefined;
  if (subjectId && !subject) {
    throw new BridgeError('not-found', `No codex entry with id "${subjectId}".`);
  }
  const now = Date.now();
  const bio: Biography = {
    id: generateId('bio'),
    projectId,
    subjectId,
    // Denormalised beside the id, as the app's own editor writes it.
    subjectName: optString(args, 'subjectName') || subject?.title || '',
    createdAt: now,
    updatedAt: now,
  };
  if (!bio.subjectName) {
    throw new BridgeError('bad-args', '"subjectName" is required unless subjectId resolves to one.');
  }
  await createBiography(bio);
  return withAudit(
    { id: bio.id, subjectName: bio.subjectName, created: true },
    { projectId, entityId: bio.id, summary: `started a biography of ${bio.subjectName}` },
  );
}

export async function whAddBiographyFact(args: ToolArgs): Promise<unknown> {
  const biographyId = requireString(args, 'biographyId');
  const bio = await getBiography(biographyId);
  if (!bio) throw new BridgeError('not-found', `No biography with id "${biographyId}".`);
  await assertEngineEnabled(bio.projectId, 'biography');
  assertRowInScope(args, bio.projectId);
  const siblings = await getFacts(biographyId);

  const sourceDescription = optString(args, 'sourceDescription');
  const sourceUrl = optString(args, 'sourceUrl');
  const now = Date.now();
  const fact: BiographyFact = {
    id: generateId('fact'),
    biographyId,
    projectId: bio.projectId,
    title: requireString(args, 'title'),
    content: htmlFromMarkdown(optString(args, 'content') ?? ''),
    date: optString(args, 'date'),
    endDate: optString(args, 'endDate'),
    category: optEnum(args, 'category', CATEGORIES) ?? 'custom',
    order: siblings.length,
    sources: sourceDescription || sourceUrl
      ? [{ type: sourceUrl ? 'link' : 'manual', description: sourceDescription ?? '', url: sourceUrl }]
      : [],
    confidence: optEnum(args, 'confidence', CONFIDENCE) ?? 'likely',
    tags: optStringArray(args, 'tags') ?? [],
    createdAt: now,
    updatedAt: now,
  };
  await createFact(fact);
  return withAudit(
    { id: fact.id, biographyId, created: true },
    {
      projectId: bio.projectId,
      entityId: fact.id,
      summary: `added a ${fact.confidence} ${fact.category} fact to ${bio.subjectName}`,
    },
  );
}

export async function whUpdateBiographyFact(args: ToolArgs): Promise<unknown> {
  const id = requireString(args, 'id');
  const existing = await db.biographyFacts.get(id);
  if (!existing) throw new BridgeError('not-found', `No biography fact with id "${id}".`);
  await assertEngineEnabled(existing.projectId, 'biography');
  assertRowInScope(args, existing.projectId);

  const changes: Partial<BiographyFact> = {};
  const title = optString(args, 'title');
  if (title !== undefined) changes.title = title;
  const content = optString(args, 'content');
  if (content !== undefined) {
    if (!content.trim()) throw new BridgeError('bad-args', EMPTY_CONTENT);
    changes.content = htmlFromMarkdown(content);
  }
  const date = optString(args, 'date');
  if (date !== undefined) changes.date = date;
  const endDate = optString(args, 'endDate');
  if (endDate !== undefined) changes.endDate = endDate;
  const category = optEnum(args, 'category', CATEGORIES);
  if (category !== undefined) changes.category = category;
  const confidence = optEnum(args, 'confidence', CONFIDENCE);
  if (confidence !== undefined) changes.confidence = confidence;
  const tags = optStringArray(args, 'tags');
  if (tags !== undefined) changes.tags = tags;

  if (!Object.keys(changes).length) {
    throw new BridgeError('bad-args', 'Nothing to change: pass at least one field besides id.');
  }
  const before: Record<string, unknown> = {
    title: existing.title,
    category: existing.category,
    confidence: existing.confidence,
  };
  // The fact's prose is replaced whole, and nothing else keeps a copy of it.
  if (changes.content !== undefined) before.content = existing.content;
  await updateFact(id, changes);
  return withAudit(
    { id, updated: Object.keys(changes) },
    {
      projectId: existing.projectId,
      entityId: id,
      summary: `updated fact "${existing.title}"`,
      before,
    },
  );
}
