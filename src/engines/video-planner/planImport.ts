// ============================================================================
// Plan import — read an exported video-plan JSON back into a new plan
// ============================================================================
//
// Accepts the shape produced by PlanExportMenu's "Plan (JSON)" export
// ({ plan: {...}, segments: [...] }), and is tolerant of variations: a bare
// array of segments, or a flat plan object. Unknown/missing fields fall back
// to safe defaults rather than throwing, so hand-edited files still import.

import { db } from '@/db';
import { generateId } from '@/utils/idGenerator';
import type { VideoPlan, VideoSegment, VisualType } from './types';

const VISUAL_TYPES: readonly VisualType[] = [
  'camera',
  'broll',
  'screen-capture',
  'graphic',
  'text-overlay',
  'custom',
];

/** Typed error so the UI can map to a localized message. `message` is the key suffix. */
export class PlanImportError extends Error {}

export interface ParsedSegment {
  title: string;
  startTime?: string;
  endTime?: string;
  speakerName?: string;
  script: string;
  visualType: VisualType;
  visualDescription?: string;
  audioNotes?: string;
  notes?: string;
  tags: string[];
}

export interface ParsedPlan {
  title: string;
  totalDuration?: string;
  segments: ParsedSegment[];
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

/** Parse + normalize raw JSON text into a plan we can persist. */
export function parsePlanJson(raw: string, fallbackTitle: string): ParsedPlan {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new PlanImportError('invalid-json');
  }
  if (!isRecord(data) && !Array.isArray(data)) {
    throw new PlanImportError('invalid-shape');
  }

  const root = isRecord(data) ? data : {};
  const planObj = isRecord(root.plan) ? root.plan : root;
  const segmentsRaw: unknown[] = Array.isArray(root.segments)
    ? root.segments
    : Array.isArray(data)
      ? data
      : [];

  const title = asString(planObj.title)?.trim() || fallbackTitle;
  const totalDuration = asString(planObj.totalDuration);

  const segments: ParsedSegment[] = segmentsRaw.filter(isRecord).map((s) => {
    const vt = asString(s.visualType);
    const visualType: VisualType =
      vt && (VISUAL_TYPES as readonly string[]).includes(vt) ? (vt as VisualType) : 'camera';
    const tags = Array.isArray(s.tags)
      ? s.tags.filter((t): t is string => typeof t === 'string')
      : [];
    return {
      title: asString(s.title)?.trim() || '',
      startTime: asString(s.startTime),
      endTime: asString(s.endTime),
      speakerName: asString(s.speakerName),
      script: asString(s.script) ?? '',
      visualType,
      visualDescription: asString(s.visualDescription),
      audioNotes: asString(s.audioNotes),
      notes: asString(s.notes),
      tags,
    };
  });

  // A file with neither a usable title nor any segments is not a plan.
  if (segments.length === 0 && !asString(planObj.title)?.trim()) {
    throw new PlanImportError('invalid-shape');
  }

  return { title, totalDuration, segments };
}

/** Persist a parsed plan as a brand-new plan (+ segments) in the project, atomically. */
export async function importPlan(projectId: string, parsed: ParsedPlan): Promise<VideoPlan> {
  const now = Date.now();
  const plan: VideoPlan = {
    id: generateId('vpl'),
    projectId,
    title: parsed.title,
    totalDuration: parsed.totalDuration,
    createdAt: now,
    updatedAt: now,
  };
  const segments: VideoSegment[] = parsed.segments.map((s, i) => ({
    id: generateId('vsg'),
    videoPlanId: plan.id,
    projectId,
    order: i,
    title: s.title,
    startTime: s.startTime,
    endTime: s.endTime,
    script: s.script,
    speakerName: s.speakerName,
    visualType: s.visualType,
    visualDescription: s.visualDescription,
    audioNotes: s.audioNotes,
    notes: s.notes,
    tags: s.tags,
    createdAt: now,
    updatedAt: now,
  }));

  await db.transaction('rw', db.videoPlans, db.videoSegments, async () => {
    await db.videoPlans.add(plan);
    if (segments.length) await db.videoSegments.bulkAdd(segments);
  });

  return plan;
}
