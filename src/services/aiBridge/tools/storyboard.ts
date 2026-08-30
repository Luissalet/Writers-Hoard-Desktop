// ============================================================================
// AI bridge tools — storyboards
// ============================================================================
//
// Panels are scoped by storyboardId and ordered by `order`. `subtitle` is the
// panel's title in practice. Panel images are base64 and stay out of results.

import { db } from '@/db';
import type { Storyboard, StoryboardPanel } from '@/engines/storyboard/types';
import {
  createPanel,
  createStoryboard,
  getPanels,
  getStoryboard,
  getStoryboards,
  updatePanel,
} from '@/engines/storyboard/operations';
import { generateId } from '@/utils/idGenerator';
import {
  BridgeError,
  optNumber,
  optString,
  optStringArray,
  requireString,
  resolveProjectForEngine,
  resolveProjectId,
  withAudit,
  type ToolArgs,
} from './shared';

export async function whCreateStoryboard(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, 'storyboard');
  const now = Date.now();
  const columns = optNumber(args, 'columns') ?? 3;
  const board: Storyboard = {
    id: generateId('storyboard'),
    projectId,
    title: requireString(args, 'title'),
    // The grid has to hold at least one panel per row and stay readable.
    columns: Math.min(8, Math.max(1, Math.round(columns))),
    createdAt: now,
    updatedAt: now,
  };
  await createStoryboard(board);
  return withAudit(
    { id: board.id, title: board.title, columns: board.columns, created: true },
    { projectId, entityId: board.id, summary: `created storyboard "${board.title}"` },
  );
}

export async function whListStoryboards(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const boards = await getStoryboards(projectId);
  return {
    projectId,
    storyboards: await Promise.all(
      boards.map(async (board) => ({
        id: board.id,
        title: board.title,
        panels: (await getPanels(board.id)).map((panel) => ({
          id: panel.id,
          order: panel.order,
          subtitle: panel.subtitle,
          description: panel.description,
          duration: panel.duration,
          linkedSceneId: panel.linkedSceneId,
          tags: panel.tags,
          hasImage: Boolean(panel.imageData || panel.imageRef),
        })),
      })),
    ),
  };
}

export async function whAddStoryboardPanel(args: ToolArgs): Promise<unknown> {
  const storyboardId = requireString(args, 'storyboardId');
  const board = await getStoryboard(storyboardId);
  if (!board) throw new BridgeError('not-found', `No storyboard with id "${storyboardId}".`);
  const siblings = await getPanels(storyboardId);
  const now = Date.now();
  const panel: StoryboardPanel = {
    id: generateId('panel'),
    storyboardId,
    projectId: board.projectId,
    order: optNumber(args, 'order') ?? siblings.length,
    subtitle: requireString(args, 'subtitle'),
    description: optString(args, 'description'),
    duration: optString(args, 'duration'),
    linkedSceneId: optString(args, 'linkedSceneId'),
    tags: optStringArray(args, 'tags') ?? [],
    createdAt: now,
    updatedAt: now,
  };
  await createPanel(panel);
  return withAudit(
    { id: panel.id, storyboardId, order: panel.order, created: true },
    {
      projectId: board.projectId,
      entityId: panel.id,
      summary: `added panel "${panel.subtitle}" to "${board.title}"`,
    },
  );
}

export async function whUpdateStoryboardPanel(args: ToolArgs): Promise<unknown> {
  const id = requireString(args, 'id');
  const panel = await db.storyboardPanels.get(id);
  if (!panel) throw new BridgeError('not-found', `No storyboard panel with id "${id}".`);

  const changes: Partial<StoryboardPanel> = {};
  (['subtitle', 'description', 'duration', 'linkedSceneId'] as const).forEach((key) => {
    const value = optString(args, key);
    if (value !== undefined) changes[key] = value;
  });
  const order = optNumber(args, 'order');
  if (order !== undefined) changes.order = order;
  const tags = optStringArray(args, 'tags');
  if (tags !== undefined) changes.tags = tags;

  if (!Object.keys(changes).length) {
    throw new BridgeError('bad-args', 'Nothing to change: pass at least one field besides id.');
  }
  await updatePanel(id, changes);
  return withAudit(
    { id, updated: Object.keys(changes) },
    {
      projectId: panel.projectId,
      entityId: id,
      summary: `updated panel "${panel.subtitle}"`,
      before: { subtitle: panel.subtitle, description: panel.description, order: panel.order },
    },
  );
}
