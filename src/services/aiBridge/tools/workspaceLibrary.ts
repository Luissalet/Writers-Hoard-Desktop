// ============================================
// AI bridge — organising the project Library
// ============================================
// The Library files references to the project's documents in folders; the
// documents stay in their tools. One action per call, against the revision
// read with wh_workspace_library_get, exactly as the Library panel runs it.

import { updateWorkspaceLibrary } from '@/components/project/workspace/library/store';
import { readLibraryCreationContext } from '@/components/project/workspace/library/createCodex';
import { WorkspaceLibraryConflict, WorkspaceLibraryInvalidAction, type WorkspaceLibraryAction } from '@/components/project/workspace/library/model';
import { isWorkspaceEngineId } from '@/components/project/workspace/library/types';
import { BridgeError, resolveProjectId, withAudit, type ToolArgs } from './shared';

const ACTIONS = ['create-folder', 'rename-folder', 'move-folder', 'delete-folder', 'order-folder', 'style-folder', 'place', 'order-document', 'pin', 'group', 'prune'] as const;

function documentsArg(args: ToolArgs): Array<{ engineId: never; entityId: string }> {
  const list = args.documents;
  if (!Array.isArray(list) || !list.length || list.length > 500) throw new BridgeError('bad-args', 'documents must list 1 to 500 {engineId, entityId} from wh_workspace_library_get.');
  return list.map((item) => {
    const row = item as { engineId?: unknown; entityId?: unknown };
    if (!isWorkspaceEngineId(row?.engineId) || typeof row.entityId !== 'string' || !row.entityId) throw new BridgeError('bad-args', 'Each document needs the engineId and entityId given by wh_workspace_library_get.');
    return { engineId: row.engineId as never, entityId: row.entityId };
  });
}
const text = (args: ToolArgs, key: string) => { const value = args[key]; if (typeof value !== 'string' || !value.trim()) throw new BridgeError('bad-args', `${key} is required for this action.`); return value; };
const optFolder = (args: ToolArgs, key: string) => { const value = args[key]; if (value === undefined || value === null || value === '') return undefined; if (typeof value !== 'string') throw new BridgeError('bad-args', `${key} must be a folder id (empty for Unfiled).`); return value; };
const direction = (args: ToolArgs) => { if (args.direction !== -1 && args.direction !== 1) throw new BridgeError('bad-args', 'direction must be -1 (up) or 1 (down).'); return args.direction; };

/** Run one Library action and return the Library as it now stands. */
export async function whWorkspaceLibraryUpdate(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const eraId = typeof args.eraId === 'string' && args.eraId ? args.eraId : undefined;
  const kind = args.action;
  if (typeof kind !== 'string' || !(ACTIONS as readonly string[]).includes(kind)) throw new BridgeError('bad-args', `action must be one of ${ACTIONS.join(', ')}.`);
  if (!Number.isSafeInteger(args.expectedRevision) || Number(args.expectedRevision) < 0) throw new BridgeError('bad-args', 'expectedRevision (the revision from wh_workspace_library_get) is required.');
  let action: WorkspaceLibraryAction;
  switch (kind) {
    case 'create-folder': action = { kind, id: crypto.randomUUID(), name: text(args, 'name'), parentId: optFolder(args, 'parentId') }; break;
    case 'rename-folder': action = { kind, id: text(args, 'folderId'), name: text(args, 'name') }; break;
    case 'move-folder': action = { kind, id: text(args, 'folderId'), parentId: optFolder(args, 'parentId') }; break;
    case 'delete-folder': action = { kind, id: text(args, 'folderId') }; break;
    case 'order-folder': action = { kind, id: text(args, 'folderId'), direction: direction(args) }; break;
    case 'style-folder': {
      const pick = (key: 'icon' | 'color') => (args[key] === null || args[key] === '' ? null : typeof args[key] === 'string' ? (args[key] as string) : undefined);
      action = { kind, id: text(args, 'folderId'), icon: pick('icon'), color: pick('color') };
      break;
    }
    case 'place': action = { kind, documents: documentsArg(args), folderId: optFolder(args, 'folderId') }; break;
    case 'order-document': action = { kind, document: documentsArg(args)[0], direction: direction(args) }; break;
    case 'pin': action = { kind, documents: documentsArg(args), pinned: args.pinned !== false }; break;
    case 'group': action = { kind, id: crypto.randomUUID(), name: text(args, 'name'), parentId: optFolder(args, 'parentId'), documents: documentsArg(args) }; break;
    default: action = { kind: 'prune' };
  }
  try {
    await updateWorkspaceLibrary(projectId, Number(args.expectedRevision), action, eraId);
  } catch (error) {
    if (error instanceof WorkspaceLibraryConflict) throw new BridgeError('conflict', 'The Library changed since that revision. Read wh_workspace_library_get again.');
    if (error instanceof WorkspaceLibraryInvalidAction) throw new BridgeError('bad-args', 'The Library refused that action: an unknown folder or document, a duplicate folder name in the same place, a folder moved into itself, or an icon/colour outside the allowed set (icons folder, book, users, map, scroll, sword, crown, star, heart, flag, gem, leaf; colours #rrggbb).');
    throw error;
  }
  const library = await readLibraryCreationContext({ projectId, eraId });
  const created = action.kind === 'create-folder' || action.kind === 'group' ? action.id : undefined;
  return withAudit(
    { projectId, eraId: eraId ?? null, revision: library.revision, folders: library.folders, placements: library.placements, ...(created ? { folderId: created } : {}) },
    { projectId, entityId: created ?? (typeof args.folderId === 'string' ? args.folderId : projectId), summary: `Library: ${kind}` },
  );
}
