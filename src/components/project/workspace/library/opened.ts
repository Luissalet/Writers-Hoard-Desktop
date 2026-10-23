import { useSyncExternalStore } from 'react';
import { workspaceDocumentKey, type WorkspaceDocument } from './types';

// Window-session memory only. Source titles/routes are resolved again on display.
const scopes = new Map<string, readonly string[]>();
const listeners = new Set<() => void>();
const empty: readonly string[] = [];
const scopeKey = (projectId: string, eraId?: string) => JSON.stringify([projectId, eraId ?? null]);
export const openedInLibrary = (projectId: string, eraId?: string): readonly string[] => scopes.get(scopeKey(projectId, eraId)) ?? empty;
export function recordLibraryOpen(projectId: string, document: WorkspaceDocument, eraId?: string) {
  const key = workspaceDocumentKey(document), scope = scopeKey(projectId, eraId);
  scopes.set(scope, [key, ...openedInLibrary(projectId, eraId).filter(item => item !== key)]);
  for (const listener of listeners) listener();
}
export function useLibraryOpened(projectId: string, eraId?: string) {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => openedInLibrary(projectId, eraId));
}
