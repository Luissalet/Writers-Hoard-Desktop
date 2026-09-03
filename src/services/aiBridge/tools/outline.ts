// ============================================================================
// AI bridge tools — the outline: acts, chapters, scenes, beats
// ============================================================================

import { db } from '@/db';
import type { BeatStatus, Outline, OutlineBeat } from '@/engines/outline/types';
import { BEAT_SHEET_TEMPLATES } from '@/engines/outline/types';
import {
  createBeat,
  createOutline,
  getAllProjectBeats,
  getBeats,
  getOutlines,
  updateBeat,
} from '@/engines/outline/operations';
import { generateId } from '@/utils/idGenerator';
import { t } from '@/i18n/useTranslation';
// The list a model is offered and the list this file accepts are the same
// array, so the schema can never promise a template the handler rejects.
import { TEMPLATE_IDS } from '../manifest';
import {
  assertEngineEnabled,
  assertRowInScope,
  checkLinkedRow,
  BridgeError,
  optEnum,
  optNumber,
  optPercent,
  optString,
  requireString,
  resolveProjectForEngine,
  resolveProjectId,
  withAudit,
  type ToolArgs,
} from './shared';

const LEVELS = ['act', 'chapter', 'scene', 'beat'] as const satisfies readonly OutlineBeat['level'][];
const STATUSES = ['empty', 'outlined', 'drafted', 'done'] as const satisfies readonly BeatStatus[];

function serializeBeat(beat: OutlineBeat): Record<string, unknown> {
  return {
    id: beat.id,
    outlineId: beat.outlineId,
    order: beat.order,
    level: beat.level,
    parentId: beat.parentId,
    title: beat.title,
    description: beat.description,
    status: beat.status,
    storyPosition: beat.storyPosition,
    wordTarget: beat.wordTarget,
    linkedWritingId: beat.linkedWritingId,
  };
}

export async function whListOutlines(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const outlines = await getOutlines(projectId);
  const beats = await getAllProjectBeats(projectId);
  return {
    projectId,
    outlines: outlines.map((outline) => {
      const own = beats.filter((beat) => beat.outlineId === outline.id);
      return {
        id: outline.id,
        title: outline.title,
        templateId: outline.templateId,
        beatCount: own.length,
        done: own.filter((beat) => beat.status === 'done').length,
        updatedAt: outline.updatedAt,
      };
    }),
  };
}

export async function whListBeats(args: ToolArgs): Promise<unknown> {
  const outlineId = optString(args, 'outlineId');
  if (outlineId) {
    const outline = await db.outlines.get(outlineId);
    if (!outline) throw new BridgeError('not-found', `No outline with id "${outlineId}".`);
    assertRowInScope(args, outline.projectId);
    const beats = await getBeats(outlineId);
    return { outlineId, beats: beats.map(serializeBeat) };
  }
  const projectId = resolveProjectId(args);
  const beats = await getAllProjectBeats(projectId);
  return { projectId, beats: beats.map(serializeBeat) };
}

/**
 * Start an outline, optionally laid out from a beat-sheet template.
 *
 * The templates hold i18n keys, never prose: they must be resolved here, at
 * creation, because the resulting strings are copied into the author's rows
 * and live there for good — the same reason `OutlineEngine.tsx` resolves them
 * on its own path. A key written now would never be re-translated.
 */
export async function whCreateOutline(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, 'outline');
  const templateId = optString(args, 'template');
  const template = templateId
    ? BEAT_SHEET_TEMPLATES.find((candidate) => candidate.id === templateId)
    : undefined;
  if (templateId && !template) {
    throw new BridgeError(
      'bad-args',
      `No beat sheet template "${templateId}". Known templates: ${TEMPLATE_IDS.join(', ')}.`,
    );
  }

  const now = Date.now();
  const outline: Outline = {
    id: generateId('outline'),
    projectId,
    title: requireString(args, 'title'),
    templateId: template?.id,
    createdAt: now,
    updatedAt: now,
  };
  await createOutline(outline);

  let beats = 0;
  if (template) {
    for (const [index, templateBeat] of template.beats.entries()) {
      await createBeat({
        id: generateId('beat'),
        outlineId: outline.id,
        projectId,
        order: index,
        level: templateBeat.level,
        title: t(templateBeat.titleKey),
        description: t(templateBeat.descriptionKey),
        storyPosition: templateBeat.storyPosition,
        color: templateBeat.color,
        status: 'empty',
        createdAt: now,
        updatedAt: now,
      });
      beats += 1;
    }
  }

  return withAudit(
    { id: outline.id, title: outline.title, template: template?.id ?? null, beats, created: true },
    {
      projectId,
      entityId: outline.id,
      summary: template
        ? `created outline "${outline.title}" from ${template.id} (${beats} beats)`
        : `created outline "${outline.title}"`,
    },
  );
}

export async function whCreateBeat(args: ToolArgs): Promise<unknown> {
  const outlineId = requireString(args, 'outlineId');
  const outline = await db.outlines.get(outlineId);
  if (!outline) {
    throw new BridgeError('not-found', `No outline with id "${outlineId}". Call wh_list_outlines first.`);
  }
  await assertEngineEnabled(outline.projectId, 'outline');
  assertRowInScope(args, outline.projectId);
  const parentId = optString(args, 'parentId') || undefined;
  const linkedWritingId = optString(args, 'linkedWritingId') || undefined;
  const [parent] = await Promise.all([
    checkLinkedRow(db.outlineBeats, parentId, outline.projectId, 'outline beat'),
    checkLinkedRow(db.writings, linkedWritingId, outline.projectId, 'writing'),
  ]);
  if (parent && parent.outlineId !== outlineId) {
    throw new BridgeError('bad-args', `The parent beat "${parentId}" belongs to another outline.`);
  }
  const siblings = await getBeats(outlineId);
  const now = Date.now();
  const beat: OutlineBeat = {
    id: generateId('beat'),
    outlineId,
    projectId: outline.projectId,
    order: optNumber(args, 'order') ?? siblings.length,
    level: optEnum(args, 'level', LEVELS) ?? 'beat',
    parentId,
    title: requireString(args, 'title'),
    description: optString(args, 'description') ?? '',
    storyPosition: optPercent(args, 'storyPosition'),
    status: optEnum(args, 'status', STATUSES) ?? 'empty',
    linkedWritingId,
    color: optString(args, 'color'),
    wordTarget: optNumber(args, 'wordTarget'),
    createdAt: now,
    updatedAt: now,
  };
  await createBeat(beat);
  return withAudit(
    { id: beat.id, title: beat.title, outlineId, created: true },
    {
      projectId: outline.projectId,
      entityId: beat.id,
      summary: `added ${beat.level} "${beat.title}" to "${outline.title}"`,
    },
  );
}

export async function whUpdateBeat(args: ToolArgs): Promise<unknown> {
  const id = requireString(args, 'id');
  const existing = await db.outlineBeats.get(id);
  if (!existing) throw new BridgeError('not-found', `No beat with id "${id}".`);
  await assertEngineEnabled(existing.projectId, 'outline');
  assertRowInScope(args, existing.projectId);

  const changes: Partial<OutlineBeat> = {};
  (['title', 'description', 'color', 'linkedWritingId'] as const).forEach((key) => {
    const value = optString(args, key);
    if (value !== undefined) changes[key] = value;
  });
  await checkLinkedRow(db.writings, changes.linkedWritingId, existing.projectId, 'writing');
  const level = optEnum(args, 'level', LEVELS);
  if (level !== undefined) changes.level = level;
  const status = optEnum(args, 'status', STATUSES);
  if (status !== undefined) changes.status = status;
  const storyPosition = optPercent(args, 'storyPosition');
  if (storyPosition !== undefined) changes.storyPosition = storyPosition;
  const order = optNumber(args, 'order');
  if (order !== undefined) changes.order = order;
  const wordTarget = optNumber(args, 'wordTarget');
  if (wordTarget !== undefined) changes.wordTarget = wordTarget;

  if (!Object.keys(changes).length) {
    throw new BridgeError('bad-args', 'Nothing to change: pass at least one field besides id.');
  }
  await updateBeat(id, changes);
  return withAudit(
    { id, updated: Object.keys(changes) },
    {
      projectId: existing.projectId,
      entityId: id,
      summary: `updated beat "${existing.title}"`,
      before: serializeBeat(existing),
    },
  );
}
