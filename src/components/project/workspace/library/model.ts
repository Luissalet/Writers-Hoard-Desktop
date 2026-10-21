import type { Project } from '@/types';
import { workspaceDocumentKey, isWorkspaceEngineId, type WorkspaceDocument, type WorkspaceFolder, type WorkspaceLibrary, type WorkspacePlacement } from './types';

export class WorkspaceLibraryConflict extends Error {}
export class WorkspaceLibraryInvalidAction extends Error {}
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 500;
export function readWorkspaceLibrary(project: Pick<Project, 'workspaceFolders' | 'workspacePlacements' | 'workspaceRevision'>): WorkspaceLibrary {
  const folders: WorkspaceFolder[] = [], seen = new Set<string>();
  for (const folder of Array.isArray(project.workspaceFolders) ? project.workspaceFolders : []) {
    if (!folder || !validId(folder.id) || seen.has(folder.id) || typeof folder.name !== 'string' || !folder.name.trim()) continue;
    seen.add(folder.id); folders.push({ id: folder.id, name: folder.name.trim().slice(0, 120), parentId: validId(folder.parentId) ? folder.parentId : undefined, order: Number.isFinite(folder.order) ? folder.order : folders.length });
  }
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  for (const folder of folders) {
    const chain = new Set([folder.id]); let cursor = folder.parentId;
    while (cursor) { if (chain.has(cursor) || !byId.has(cursor)) { folder.parentId = undefined; break; } chain.add(cursor); cursor = byId.get(cursor)?.parentId; }
  }
  const placements = new Map<string, WorkspacePlacement>();
  for (const placement of Array.isArray(project.workspacePlacements) ? project.workspacePlacements : []) {
    if (!placement || !isWorkspaceEngineId(placement.engineId) || !validId(placement.entityId)) continue;
    placements.set(workspaceDocumentKey(placement), { engineId: placement.engineId, entityId: placement.entityId, folderId: placement.folderId && byId.has(placement.folderId) ? placement.folderId : undefined, order: Number.isFinite(placement.order) ? placement.order : 0 });
  }
  return { folders, placements: [...placements.values()], revision: Number.isSafeInteger(project.workspaceRevision) && (project.workspaceRevision ?? 0) >= 0 ? project.workspaceRevision! : 0 };
}
export function folderPath(folders: readonly WorkspaceFolder[], id: string): string {
  const byId = new Map(folders.map(folder => [folder.id, folder])), path: string[] = [], seen = new Set<string>(); let cursor: string | undefined = id;
  while (cursor && byId.has(cursor) && !seen.has(cursor)) { seen.add(cursor); const folder: WorkspaceFolder = byId.get(cursor)!; path.unshift(folder.name); cursor = folder.parentId; }
  return path.join(' / ');
}
export function sortedFolders(folders: readonly WorkspaceFolder[], parentId?: string) { return folders.filter(folder => folder.parentId === parentId).sort((left, right) => left.order - right.order || left.name.localeCompare(right.name)); }
export function folderTree(folders: readonly WorkspaceFolder[]) {
  const children = new Map<string | undefined, WorkspaceFolder[]>();
  for (const folder of folders) { const siblings = children.get(folder.parentId) ?? []; siblings.push(folder); children.set(folder.parentId, siblings); }
  for (const siblings of children.values()) siblings.sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
  const result: Array<{ folder: WorkspaceFolder; depth: number }> = [], pending = [...(children.get(undefined) ?? [])].reverse().map(folder => ({ folder, depth: 0 }));
  const seen = new Set<string>();
  while (pending.length) { const item = pending.pop()!; if (seen.has(item.folder.id)) continue; seen.add(item.folder.id); result.push(item); pending.push(...[...(children.get(item.folder.id) ?? [])].reverse().map(folder => ({ folder, depth: item.depth + 1 }))); }
  return result;
}
export function sortWorkspaceDocuments(documents: readonly WorkspaceDocument[], placements: readonly WorkspacePlacement[]) {
  const byKey = new Map(placements.map(placement => [workspaceDocumentKey(placement), placement.order]));
  return [...documents].sort((left, right) => (byKey.get(workspaceDocumentKey(left)) ?? Number.MAX_SAFE_INTEGER) - (byKey.get(workspaceDocumentKey(right)) ?? Number.MAX_SAFE_INTEGER) || left.title.localeCompare(right.title) || workspaceDocumentKey(left).localeCompare(workspaceDocumentKey(right)));
}
export type WorkspaceLibraryAction =
  | { kind: 'create-folder'; id: string; name: string; parentId?: string }
  | { kind: 'rename-folder'; id: string; name: string }
  | { kind: 'move-folder'; id: string; parentId?: string }
  | { kind: 'delete-folder'; id: string }
  | { kind: 'order-folder'; id: string; direction: -1 | 1 }
  | { kind: 'place'; documents: Array<Pick<WorkspaceDocument, 'engineId' | 'entityId'>>; folderId?: string }
  | { kind: 'order-document'; document: Pick<WorkspaceDocument, 'engineId' | 'entityId'>; direction: -1 | 1 }
  | { kind: 'prune' };

/** Pure folder/placement mutation. Its caller supplies the authoritative scoped
 * catalog, so forging a document key cannot add a cross-project reference. */
export function applyWorkspaceLibraryAction(library: WorkspaceLibrary, action: WorkspaceLibraryAction, documents: readonly WorkspaceDocument[]): WorkspaceLibrary {
  const next = structuredClone(library), folders = new Map(next.folders.map(folder => [folder.id, folder]));
  const invalid = () => { throw new WorkspaceLibraryInvalidAction('Invalid folder or document action.'); };
  if ((action.kind === 'order-document' || action.kind === 'order-folder') && action.direction !== -1 && action.direction !== 1) invalid();
  const requireFolder = (id: string | undefined) => { if (id !== undefined && !folders.has(id)) invalid(); };
  const name = (value: string, parentId: string | undefined, ignoreId?: string) => { const result = value.trim(); if (!result || result.length > 120 || next.folders.some(folder => folder.id !== ignoreId && folder.parentId === parentId && folder.name.toLocaleLowerCase() === result.toLocaleLowerCase())) invalid(); return result; };
  const reorderFolders = (parentId: string | undefined) => sortedFolders(next.folders, parentId).forEach((folder, order) => { folder.order = order; });
  const catalog = new Map(documents.map(document => [workspaceDocumentKey(document), document]));
  const placements = new Map(next.placements.map(placement => [workspaceDocumentKey(placement), placement]));
  const inFolder = (document: WorkspaceDocument, folderId?: string) => placements.get(workspaceDocumentKey(document))?.folderId === folderId;
  const setOrder = (ordered: WorkspaceDocument[], folderId?: string) => ordered.forEach((document, order) => placements.set(workspaceDocumentKey(document), { engineId: document.engineId, entityId: document.entityId, folderId, order }));
  if (action.kind === 'create-folder') {
    requireFolder(action.parentId); if (!validId(action.id) || folders.has(action.id)) invalid();
    next.folders.push({ id: action.id, name: name(action.name, action.parentId), parentId: action.parentId, order: sortedFolders(next.folders, action.parentId).length });
  } else if (action.kind === 'place') {
    requireFolder(action.folderId); if (!action.documents.length) invalid();
    const keys = new Set(action.documents.map(workspaceDocumentKey)); if ([...keys].some(key => !catalog.has(key))) invalid();
    const siblings = sortWorkspaceDocuments(documents.filter(document => inFolder(document, action.folderId) && !keys.has(workspaceDocumentKey(document))), next.placements);
    setOrder([...siblings, ...[...keys].map(key => catalog.get(key)!)], action.folderId);
  } else if (action.kind === 'order-document') {
    const key = workspaceDocumentKey(action.document), document = catalog.get(key); if (!document) invalid();
    const folderId = placements.get(key)?.folderId, siblings = sortWorkspaceDocuments(documents.filter(document => inFolder(document, folderId)), next.placements);
    const index = siblings.findIndex(item => workspaceDocumentKey(item) === key), target = index + action.direction;
    if (target >= 0 && target < siblings.length) [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
    setOrder(siblings, folderId);
  } else if (action.kind === 'prune') {
    for (const key of placements.keys()) if (!catalog.has(key)) placements.delete(key);
  } else {
    const folder = folders.get(action.id); if (!folder) invalid();
    if (action.kind === 'rename-folder') folder!.name = name(action.name, folder!.parentId, folder!.id);
    else if (action.kind === 'move-folder') {
      requireFolder(action.parentId); let cursor = action.parentId;
      while (cursor) { if (cursor === folder!.id) invalid(); cursor = folders.get(cursor)?.parentId; }
      const parent = folder!.parentId; folder!.name = name(folder!.name, action.parentId, folder!.id); folder!.parentId = action.parentId; folder!.order = next.folders.length; reorderFolders(parent); reorderFolders(action.parentId);
    } else if (action.kind === 'delete-folder') {
      next.folders = next.folders.filter(item => item.id !== folder!.id);
      for (const child of next.folders) if (child.parentId === folder!.id) { child.parentId = folder!.parentId; child.order += next.folders.length; }
      for (const placement of placements.values()) if (placement.folderId === folder!.id) placement.folderId = folder!.parentId;
      reorderFolders(folder!.parentId);
    } else if (action.kind === 'order-folder') {
      const siblings = sortedFolders(next.folders, folder!.parentId), index = siblings.findIndex(item => item.id === folder!.id), target = index + action.direction;
      if (target >= 0 && target < siblings.length) [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
      siblings.forEach((item, order) => { item.order = order; });
    }
  }
  next.placements = [...placements.values()]; next.revision++;
  return next;
}
