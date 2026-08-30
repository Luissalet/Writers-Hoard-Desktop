// ============================================================================
// AI bridge tools — video plans
// ============================================================================
//
// Segments are scoped by videoPlanId. Times are free-text strings by design,
// not numbers: the app never parses them.

import { db } from '@/db';
import type { VideoPlan, VideoSegment, VisualType } from '@/engines/video-planner/types';
import {
  createSegment,
  createVideoPlan,
  getSegments,
  getVideoPlan,
  getVideoPlans,
  updateSegment,
} from '@/engines/video-planner/operations';
import { generateId } from '@/utils/idGenerator';
import {
  BridgeError,
  optEnum,
  optNumber,
  optString,
  optStringArray,
  requireString,
  resolveProjectForEngine,
  resolveProjectId,
  withAudit,
  type ToolArgs,
} from './shared';

const VISUAL_TYPES = [
  'camera', 'broll', 'screen-capture', 'graphic', 'text-overlay', 'custom',
] as const satisfies readonly VisualType[];

export async function whCreateVideoPlan(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, 'video-planner');
  const now = Date.now();
  const plan: VideoPlan = {
    id: generateId('videoplan'),
    projectId,
    title: requireString(args, 'title'),
    totalDuration: optString(args, 'totalDuration'),
    createdAt: now,
    updatedAt: now,
  };
  await createVideoPlan(plan);
  return withAudit(
    { id: plan.id, title: plan.title, created: true },
    { projectId, entityId: plan.id, summary: `created video plan "${plan.title}"` },
  );
}

export async function whListVideoPlans(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const plans = await getVideoPlans(projectId);
  return {
    projectId,
    plans: await Promise.all(
      plans.map(async (plan) => ({
        id: plan.id,
        title: plan.title,
        totalDuration: plan.totalDuration,
        segments: (await getSegments(plan.id)).map((segment) => ({
          id: segment.id,
          order: segment.order,
          title: segment.title,
          script: segment.script,
          speakerName: segment.speakerName,
          startTime: segment.startTime,
          endTime: segment.endTime,
          visualType: segment.visualType,
          visualDescription: segment.visualDescription,
          audioNotes: segment.audioNotes,
          notes: segment.notes,
          tags: segment.tags,
          hasImage: Boolean(segment.visualImageData),
        })),
      })),
    ),
  };
}

export async function whAddVideoSegment(args: ToolArgs): Promise<unknown> {
  const videoPlanId = requireString(args, 'videoPlanId');
  const plan = await getVideoPlan(videoPlanId);
  if (!plan) throw new BridgeError('not-found', `No video plan with id "${videoPlanId}".`);
  const siblings = await getSegments(videoPlanId);
  const now = Date.now();
  const segment: VideoSegment = {
    id: generateId('segment'),
    videoPlanId,
    projectId: plan.projectId,
    order: optNumber(args, 'order') ?? siblings.length,
    title: requireString(args, 'title'),
    startTime: optString(args, 'startTime'),
    endTime: optString(args, 'endTime'),
    script: optString(args, 'script') ?? '',
    speakerName: optString(args, 'speakerName'),
    visualType: optEnum(args, 'visualType', VISUAL_TYPES) ?? 'camera',
    visualDescription: optString(args, 'visualDescription'),
    audioNotes: optString(args, 'audioNotes'),
    notes: optString(args, 'notes'),
    tags: optStringArray(args, 'tags') ?? [],
    createdAt: now,
    updatedAt: now,
  };
  await createSegment(segment);
  return withAudit(
    { id: segment.id, videoPlanId, order: segment.order, created: true },
    {
      projectId: plan.projectId,
      entityId: segment.id,
      summary: `added segment "${segment.title}" to "${plan.title}"`,
    },
  );
}

export async function whUpdateVideoSegment(args: ToolArgs): Promise<unknown> {
  const id = requireString(args, 'id');
  const segment = await db.videoSegments.get(id);
  if (!segment) throw new BridgeError('not-found', `No video segment with id "${id}".`);

  const changes: Partial<VideoSegment> = {};
  (
    ['title', 'script', 'visualDescription', 'speakerName', 'startTime', 'endTime', 'audioNotes', 'notes'] as const
  ).forEach((key) => {
    const value = optString(args, key);
    if (value !== undefined) changes[key] = value;
  });
  const visualType = optEnum(args, 'visualType', VISUAL_TYPES);
  if (visualType !== undefined) changes.visualType = visualType;
  const order = optNumber(args, 'order');
  if (order !== undefined) changes.order = order;

  if (!Object.keys(changes).length) {
    throw new BridgeError('bad-args', 'Nothing to change: pass at least one field besides id.');
  }
  await updateSegment(id, changes);
  return withAudit(
    { id, updated: Object.keys(changes) },
    {
      projectId: segment.projectId,
      entityId: id,
      summary: `updated segment "${segment.title}"`,
      before: { title: segment.title, script: segment.script.slice(0, 400) },
    },
  );
}
