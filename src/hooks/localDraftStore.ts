import { trackPendingWrite } from '@/services/pendingWrites';

// Keep a single owner per journal, including while storage is unavailable.
// Reopening an engine must neither lose the in-memory draft nor create a stale
// retry callback that could later overwrite a newer draft from another owner.
const liveStores = new Map<string, Map<string, object>>();

/** Exact project-owned keys only; keep their emptied owners for safe retries. */
export function clearProjectDraftStores(projectId: string): void {
  const keys = new Set(liveStores.keys());
  try { for (let index = 0; index < localStorage.length; index++) { const key = localStorage.key(index); if (key) keys.add(key); } } catch { /* In-memory owners can still be cleared. */ }
  for (const prefix of ['wh.annotation-drafts.v1.', 'wh.maps-drafts.v1.', 'wh.map-features-drafts.v1.', 'wh.real-atlas-drafts.v1.', 'wh.editorial-drafts.v1.', 'wh.codex-drafts.v1.', 'wh.tool-dock-drafts.v1.', 'wh.relation-trees.v1.', 'wh.character-sheets.v1.', 'wh.dictionary-drafts.v1.', 'wh.radar-drafts.v1.', 'wh.world-sheets-drafts.v1.', 'wh.conversation-drafts.v1.', 'wh.board-era-drafts.v1.']) {
    const baseKey = `${prefix}${projectId}`;
    keys.add(baseKey);
    for (const key of keys) if (key === baseKey || key.startsWith(`${baseKey}.era:`)) {
      createLocalDraftStore(key, (value): value is object => value !== null && typeof value === 'object').clear();
    }
  }
  try { localStorage.removeItem(`writing-workflow-draft:${projectId}`); } catch { /* Saved project deletion remains authoritative. */ }
}

/** Retire recovery only after its entity deletion has committed successfully. */
export async function deleteWithDraftCleanup(
  drafts: Map<string, object>, ids: readonly string[], remove: () => Promise<unknown>,
): Promise<void> {
  await remove();
  for (const id of ids) drafts.delete(id);
}

/** Recovery drafts are separate from saved entities and survive engine/app navigation. */
export function createLocalDraftStore<T extends object>(key: string, accept: (value: unknown) => value is T): Map<string, T> {
  const live = liveStores.get(key);
  if (live) return live as Map<string, T>;
  const entries: [string, T][] = [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (Array.isArray(item) && typeof item[0] === 'string' && accept(item[1])) entries.push([item[0], item[1]]);
      }
    }
  } catch {
    // A corrupt or unavailable recovery copy never prevents opening saved data.
  }

  class DraftStore extends Map<string, T> {
    persist = (): Promise<void> => {
      const write = Promise.resolve().then(() => {
        if (this.size) localStorage.setItem(key, JSON.stringify([...this]));
        else localStorage.removeItem(key);
      });
      return trackPendingWrite(write, this.persist, `draft-recovery:${key}`);
    };

    set(id: string, value: T): this {
      super.set(id, value);
      void this.persist().catch(() => undefined);
      return this;
    }

    delete(id: string): boolean {
      const removed = super.delete(id);
      if (removed) void this.persist().catch(() => undefined);
      return removed;
    }

    clear(): void {
      super.clear();
      void this.persist().catch(() => undefined);
    }
  }

  // Map's iterable constructor calls the override before class fields exist.
  const store = new DraftStore();
  for (const [id, value] of entries) Map.prototype.set.call(store, id, value);
  liveStores.set(key, store);
  return store;
}
