// ============================================================================
// AI bridge — the session planner: outlines marked as table sessions
// ============================================================================
//
// wh_session_planner reads the sessions grouped live / next / prep / played (and,
// on request, the dock actions of a layout preset for a session's prep note).
// wh_session_set_status marks an outline as a session or changes its status,
// date or prep note: revision-checked, engine-guarded, undoable.

import { db } from '@/db';
import { getAllProjectBeats, getOutlines } from '@/engines/outline/operations';
import { SessionConflict, groupSessions, isSession, PLANNER_ORDER, updateSession, type SessionPatch } from '@/engines/outline/session';
import { DOCK_PRESET_IDS, planDockPreset, type DockPresetId } from '@/engines/outline/sessionDock';
import { SESSION_STATUSES, type Outline, type SessionStatus } from '@/engines/outline/types';
import {
  BridgeError,
  assertRowInScope,
  optEnum,
  optNumber,
  requireString,
  resolveProjectForEngine,
  resolveProjectId,
  withAudit,
  type ToolArgs,
} from './shared';

export function serializeSession(outline: Outline, beats: { total: number; done: number }): Record<string, unknown> {
  return {
    id: outline.id,
    title: outline.title,
    templateId: outline.templateId,
    status: outline.sessionStatus ?? 'prep',
    date: outline.sessionDate,
    linkedWritingId: outline.linkedWritingId,
    revision: outline.sessionRevision ?? 0,
    beatCount: beats.total,
    done: beats.done,
  };
}

export async function whSessionPlanner(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const project = await db.projects.get(projectId);
  if (!project) throw new BridgeError('not-found', `No project with id "${projectId}".`);
  const outlines = await getOutlines(projectId);
  const beats = await getAllProjectBeats(projectId);
  const count = new Map<string, { total: number; done: number }>();
  for (const beat of beats) {
    const row = count.get(beat.outlineId) ?? { total: 0, done: 0 };
    row.total += 1;
    if (beat.status === 'done') row.done += 1;
    count.set(beat.outlineId, row);
  }
  const grouped = groupSessions(outlines);
  const groups: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const status of PLANNER_ORDER) {
    groups[status] = grouped[status].map(outline => serializeSession(outline, count.get(outline.id) ?? { total: 0, done: 0 }));
    counts[status] = grouped[status].length;
  }
  const result: Record<string, unknown> = {
    projectId,
    sessions: outlines.filter(isSession).length,
    counts,
    groups,
    presets: [...DOCK_PRESET_IDS],
  };

  const preset = optEnum(args, 'preset', DOCK_PRESET_IDS);
  if (args.preset !== undefined && !preset) {
    throw new BridgeError('bad-args', `preset is one of ${DOCK_PRESET_IDS.join(', ')}.`);
  }
  if (preset) {
    const outlineId = requireString(args, 'outlineId');
    const outline = outlines.find(row => row.id === outlineId);
    if (!outline || !isSession(outline)) throw new BridgeError('not-found', `No session with id "${outlineId}". Call wh_session_planner first.`);
    if (!outline.linkedWritingId) throw new BridgeError('bad-args', 'This session has no prep note; link one with wh_session_set_status first.');
    try {
      const plan = await planDockPreset(projectId, outline.linkedWritingId, preset as DockPresetId);
      result.dockPlan = {
        preset,
        noteId: outline.linkedWritingId,
        documents: plan.documents,
        // Pass these as-is to wh_writing_tool_dock_apply (empty when the project has none of the documents).
        apply: plan.actions.length ? { owner: plan.owner, expectedVersion: plan.expectedVersion, actions: plan.actions } : null,
      };
    } catch (error) {
      throw new BridgeError('bad-args', `The prep note's dock could not be read: ${error instanceof Error ? error.message : String(error)}.`);
    }
  }
  return result;
}

export async function whSessionSetStatus(args: ToolArgs): Promise<unknown> {
  // The gate first, as in every other outline write: a switched-off engine answers before anything is read.
  const projectId = await resolveProjectForEngine(args, 'outline');
  const outlineId = requireString(args, 'outlineId');
  const existing = await db.outlines.get(outlineId);
  if (!existing || existing.projectId !== projectId) {
    throw new BridgeError('not-found', `No outline with id "${outlineId}" in this project. Call wh_list_outlines first.`);
  }
  assertRowInScope(args, existing.projectId);

  const patch: SessionPatch = {};
  if (args.status !== undefined) {
    const status = optEnum(args, 'status', SESSION_STATUSES);
    if (!status) throw new BridgeError('bad-args', `status is one of ${SESSION_STATUSES.join(', ')}.`);
    patch.status = status as SessionStatus;
  }
  if (args.date !== undefined) {
    if (args.date !== null && typeof args.date !== 'string') throw new BridgeError('bad-args', 'date is a day YYYY-MM-DD, or null to clear it.');
    patch.date = args.date as string | null;
  }
  if (args.linkedWritingId !== undefined) {
    if (args.linkedWritingId !== null && typeof args.linkedWritingId !== 'string') throw new BridgeError('bad-args', 'linkedWritingId is a chapter id, or null to unlink it.');
    patch.linkedWritingId = args.linkedWritingId as string | null;
  }
  if (!Object.keys(patch).length) {
    throw new BridgeError('bad-args', 'Nothing to change: pass status, date or linkedWritingId.');
  }

  try {
    const { outline, before } = await updateSession(outlineId, patch, optNumber(args, 'expectedRevision'));
    const revision = outline.sessionRevision ?? 0;
    return withAudit(
      { id: outline.id, status: outline.sessionStatus, date: outline.sessionDate ?? null, linkedWritingId: outline.linkedWritingId ?? null, revision, updated: true },
      {
        projectId,
        entityId: outline.id,
        kind: 'update',
        summary: `session "${outline.title}"${patch.status ? ` -> ${patch.status}` : ''}`,
        before: { ...before, __sessionAfterRevision: revision, __sessionBeforeRevision: revision - 1 },
      },
    );
  } catch (error) {
    if (error instanceof SessionConflict) {
      throw new BridgeError('conflict', `The session is at revision ${error.current}; read it again with wh_session_planner.`);
    }
    const code = error instanceof Error ? error.message : '';
    if (code === 'session_date') throw new BridgeError('bad-args', 'date is a real day, YYYY-MM-DD.');
    if (code === 'session_note') throw new BridgeError('not-found', 'linkedWritingId is not a chapter of this project.');
    if (code === 'session_missing') throw new BridgeError('not-found', `No outline with id "${outlineId}".`);
    throw error;
  }
}
