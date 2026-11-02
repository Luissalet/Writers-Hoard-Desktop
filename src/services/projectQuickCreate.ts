import { db } from '@/db';
import { generateId } from '@/utils/idGenerator';
import { eraWritingOperations } from '@/services/worldEras/writings';
import { listEraRows, mutateEraRows } from '@/services/worldEras/store';
import type { EraRow, WorldEraScope } from '@/services/worldEras/types';
import { createNote, makeNote } from '@/engines/notes/operations';
import { createOutlineFromTemplate } from '@/engines/outline/operations';
import { createTimeline } from '@/engines/timeline/operations';
import { createBoard } from '@/engines/board/operations';
import type { Timeline } from '@/types';
import type { Board } from '@/engines/board/types';

export const QUICK_CREATE_ENGINES = ['writings', 'notes', 'outline', 'timeline', 'board'] as const;
export type QuickCreateEngine = typeof QUICK_CREATE_ENGINES[number];

/** Outline has no era adapter; never create a base outline from an era pane. */
export function quickCreateEngines(enabled: readonly string[], eraId?: string): QuickCreateEngine[] {
  return QUICK_CREATE_ENGINES.filter(id => enabled.includes(id) && !(eraId && id === 'outline'));
}

/** The same create operations used by the editors, with the pane's explicit scope. */
export async function quickCreateProjectDocument(scope: WorldEraScope, engineId: QuickCreateEngine, text: string): Promise<{ id: string; engineId: QuickCreateEngine }> {
  const title = text.trim();
  if (!title) throw new Error('A title or note is required');
  const project = await db.projects.get(scope.projectId);
  if (!project) throw new Error('Project no longer exists');
  if (!quickCreateEngines(project.enabledEngines, scope.eraId).includes(engineId)) throw new Error('Creation is unavailable in this engine or era');
  if (scope.eraId && !project.worldEras?.some(era => era.id === scope.eraId && !era.archived)) throw new Error('Era no longer exists');
  if (engineId === 'notes') {
    const note = makeNote(scope.projectId, { text: title });
    if (scope.eraId) await mutateEraRows(scope, [{ table: 'notes', id: note.id, row: note as unknown as EraRow }]);
    else await createNote(note);
    return { id: note.id, engineId };
  }
  if (engineId === 'outline') {
    const outline = await createOutlineFromTemplate(scope.projectId, title, undefined, key => key);
    return { id: outline.id, engineId };
  }
  if (engineId === 'timeline') {
    const palette = ['#c4973b', '#3b82f6', '#ef4444', '#22c55e', '#a855f7', '#ec4899', '#14b8a6', '#f97316'];
    const count = scope.eraId
      ? (await listEraRows(scope, 'timelines')).length
      : await db.timelines.where('projectId').equals(scope.projectId).count();
    const now = Date.now(), timeline: Timeline = { id: generateId('tl'), projectId: scope.projectId, title, color: palette[count % palette.length], createdAt: now, updatedAt: now };
    if (scope.eraId) await mutateEraRows(scope, [{ table: 'timelines', id: timeline.id, row: timeline as unknown as EraRow }]);
    else await createTimeline(timeline);
    return { id: timeline.id, engineId };
  }
  if (engineId === 'board') {
    const now = Date.now(), board: Board = { id: generateId('board'), projectId: scope.projectId, title, surface: 'cork', createdAt: now, updatedAt: now };
    if (scope.eraId) await mutateEraRows(scope, [{ table: 'boards', id: board.id, row: board as unknown as EraRow }]);
    else await createBoard(board);
    return { id: board.id, engineId };
  }
  const now = Date.now(), id = generateId('writing');
  await eraWritingOperations(scope).createWriting({ id, projectId: scope.projectId, title, status: 'idea', content: '', wordCount: 0, tags: [], createdAt: now, updatedAt: now });
  return { id, engineId };
}
