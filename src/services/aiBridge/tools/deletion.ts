// ============================================================================
// AI bridge tools — deletion, the one act that cannot be undone
// ============================================================================
//
// One tool, not fifteen: a registry maps an entity type to the operation that
// deletes it CORRECTLY. That matters more here than anywhere else in the
// bridge, because most of these have cascades and unlink policies that a bare
// `db.table.delete` would skip — deleteScene unlinks outline beats, and
// deleteCodexEntry deletes join rows while unassigning authored text.
//
// Every deletion asks the person at the keyboard first. Nobody at the keyboard
// means nothing is deleted. The dialog is written in the user's language: it
// is the one place where an AI's mistake becomes permanent, so it had better
// be readable.

import { db } from '@/db';
import { deleteCodexEntry } from '@/db/operations';
import { deleteWriting } from '@/engines/writings/operations';
import { deleteNote } from '@/engines/notes/operations';
import { deleteEntry as deleteDiaryEntry } from '@/engines/diary/operations';
import { deleteScene, deleteDialogBlock } from '@/engines/dialog-scene/operations';
import {
  deleteTimeline,
  deleteTimelineEvent,
  deleteConnection,
} from '@/engines/timeline/operations';
import { deleteOutline, deleteBeat } from '@/engines/outline/operations';
import { deleteSeed, deletePayoff } from '@/engines/seeds/operations';
import { deleteArc, deleteBeat as deleteArcBeat } from '@/engines/character-arc/operations';
import { deleteRelationship } from '@/engines/relationships/operations';
import { deleteBiography, deleteFact } from '@/engines/biography/operations';
import { deleteBoard, deleteBoardNode } from '@/engines/board/operations';
import { deleteSnapshot } from '@/engines/scrapper/operations';
import { inspirationImageOps } from '@/engines/gallery/operations';
import { mapPinOps } from '@/engines/maps/operations';
import { deletePanel, deleteStoryboard } from '@/engines/storyboard/operations';
import { deleteSegment, deleteVideoPlan } from '@/engines/video-planner/operations';
import { deleteAnnotation } from '@/engines/annotations/operations';
import { t } from '@/i18n/useTranslation';
import { requestBridgeConfirmation } from '../confirmation';
import { BridgeError, optString, requireString, withAudit, type ToolArgs } from './shared';

interface DeletableType {
  /** Dexie table the row lives in, so its name can be shown before it goes. */
  table: string;
  /** Which field reads as the row's name. Defaults to `title`. */
  titleField?: string;
  /** True when other rows go with it — spelled out by bridge.delete.cascade.<type>. */
  cascade?: boolean;
  remove: (id: string) => Promise<void>;
}

/**
 * Every type the bridge can delete, pointed at the RIGHT operation.
 * Nothing is deleted through a bare table handle.
 *
 * The map key doubles as the i18n suffix: `bridge.delete.type.<key>` names it
 * and `bridge.delete.cascade.<key>` says what goes with it.
 */
export const DELETABLE: Record<string, DeletableType> = {
  writing: { table: 'writings', cascade: true, remove: deleteWriting },
  'codex-entry': { table: 'codexEntries', cascade: true, remove: deleteCodexEntry },
  note: { table: 'notes', titleField: 'text', remove: deleteNote },
  'diary-entry': { table: 'diaryEntries', remove: deleteDiaryEntry },
  scene: { table: 'scenes', cascade: true, remove: deleteScene },
  'dialog-block': { table: 'dialogBlocks', titleField: 'content', remove: deleteDialogBlock },
  timeline: { table: 'timelines', cascade: true, remove: deleteTimeline },
  'timeline-event': { table: 'timelineEvents', cascade: true, remove: deleteTimelineEvent },
  'timeline-connection': { table: 'timelineConnections', titleField: 'label', remove: deleteConnection },
  outline: { table: 'outlines', cascade: true, remove: deleteOutline },
  beat: { table: 'outlineBeats', remove: deleteBeat },
  seed: { table: 'seeds', cascade: true, remove: deleteSeed },
  payoff: { table: 'payoffs', remove: deletePayoff },
  arc: { table: 'characterArcs', cascade: true, remove: deleteArc },
  'arc-beat': { table: 'arcBeats', remove: deleteArcBeat },
  relationship: { table: 'relationships', titleField: 'label', remove: deleteRelationship },
  biography: { table: 'biographies', titleField: 'subjectName', cascade: true, remove: deleteBiography },
  'biography-fact': { table: 'biographyFacts', remove: deleteFact },
  board: { table: 'boards', cascade: true, remove: deleteBoard },
  'board-card': { table: 'boardNodes', cascade: true, remove: deleteBoardNode },
  snapshot: { table: 'snapshots', cascade: true, remove: deleteSnapshot },
  image: { table: 'inspirationImages', titleField: 'notes', remove: (id) => inspirationImageOps.delete(id) },
  'map-pin': { table: 'mapPins', titleField: 'name', remove: (id) => mapPinOps.delete(id) },
  storyboard: { table: 'storyboards', cascade: true, remove: deleteStoryboard },
  panel: { table: 'storyboardPanels', titleField: 'subtitle', cascade: true, remove: deletePanel },
  'video-plan': { table: 'videoPlans', cascade: true, remove: deleteVideoPlan },
  'video-segment': { table: 'videoSegments', remove: deleteSegment },
  annotation: { table: 'annotations', titleField: 'noteBody', cascade: true, remove: deleteAnnotation },
};

export const DELETABLE_TYPES = Object.keys(DELETABLE);

/** Whatever reads as this row's name, flattened and trimmed for a dialog. */
function describe(row: Record<string, unknown>, spec: DeletableType): string {
  const raw = spec.titleField ? row[spec.titleField] : row.title;
  const text = typeof raw === 'string' && raw.trim() ? raw.trim() : t('bridge.delete.untitled');
  const flat = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > 70 ? `${flat.slice(0, 69)}…` : flat;
}

export async function whDelete(args: ToolArgs): Promise<unknown> {
  const type = requireString(args, 'type');
  const id = requireString(args, 'id');
  const spec = DELETABLE[type];
  if (!spec) {
    throw new BridgeError(
      'bad-args',
      `Cannot delete "${type}". Supported: ${DELETABLE_TYPES.join(', ')}.`,
    );
  }

  const row = (await db.table(spec.table).get(id)) as Record<string, unknown> | undefined;
  const label = t(`bridge.delete.type.${type}`);
  if (!row) throw new BridgeError('not-found', `No ${type} with id "${id}".`);
  const name = describe(row, spec);
  const reason = optString(args, 'reason');

  // Composed with t(), not written in English here: this dialog is the last
  // thing standing between a model and someone's work.
  const lines = [t('bridge.delete.message').replace('{type}', label).replace('{name}', name)];
  if (spec.cascade) {
    lines.push(t('bridge.delete.alsoRemoves').replace('{what}', t(`bridge.delete.cascade.${type}`)));
  }
  if (reason) lines.push(t('bridge.delete.reason').replace('{reason}', reason));
  lines.push(t('bridge.delete.irreversible'));

  const confirmed = await requestBridgeConfirmation({
    title: t('settings.bridge.confirmTitle'),
    message: lines.join('\n\n'),
  });
  if (!confirmed) {
    throw new BridgeError(
      'declined',
      `Nothing was deleted: the user did not confirm removing the ${type} "${name}". Do not ask again unless they bring it up.`,
    );
  }

  await spec.remove(id);
  return withAudit(
    { deleted: true, type, id, name },
    {
      projectId: typeof row.projectId === 'string' ? row.projectId : undefined,
      entityId: id,
      summary: `DELETED ${type} "${name}" (user confirmed)`,
      // The whole row, and the table it came from: together they are what an
      // undo needs to put it back.
      before: row,
      table: spec.table,
    },
  );
}
