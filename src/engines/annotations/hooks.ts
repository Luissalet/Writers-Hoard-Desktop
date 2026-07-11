// ============================================
// Annotations — React hooks
// ============================================
//
// All hooks are read-only. Mutations go through `operations.ts` directly so
// the call sites can pair them with optimistic UI / refresh().

import { useCallback, useEffect, useRef, useState } from 'react';
import { makeReadOnlyHook } from '@/engines/_shared';
import {
  getAnnotationsForEntity,
  getReferenceForAnnotation,
  getBacklinksForEntity,
  getAnnotationsForProject,
  countOrphansForProject,
} from './operations';
import type {
  Annotation,
  AnnotationWithReference,
  BacklinkPreview,
} from './types';
import { getAnchorAdapter } from '@/engines/_shared/anchoring';

interface EntityKey {
  engineId: string;
  entityId: string;
}

/**
 * Shared core for the two entity-keyed hydrated lists below. Adds the same
 * concurrency guards as the `_shared` factories: a monotonic sequence token
 * (a slow hydration for entity A resolving after a switch to entity B can
 * never overwrite B's list) and a mounted ref (no setState after the editor
 * unmounts mid-hydration).
 */
function useHydratedList<T>(
  cacheKey: string | null,
  fetcher: (() => Promise<T[]>) | null,
) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const seqRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The fetcher closure is re-created by callers every render; route it
  // through a ref so `refresh` only re-fires when the cache key changes.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async () => {
    if (!cacheKey || !fetcherRef.current) return; // empty state is DERIVED below
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const data = await fetcherRef.current();
      if (seq !== seqRef.current || !mountedRef.current) return; // superseded
      setItems(data);
    } catch (err) {
      if (seq === seqRef.current && mountedRef.current) {
        console.error('[annotations] fetch failed', err);
      }
    } finally {
      if (seq === seqRef.current && mountedRef.current) setLoading(false);
    }
  }, [cacheKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // When the key is null the empty state is DERIVED (no setState-in-effect):
  // stale items from a previous key are hidden, and the seq token discards
  // their in-flight fetches.
  return {
    items: cacheKey ? items : (EMPTY_ITEMS as T[]),
    loading: cacheKey ? loading : false,
    refresh,
  };
}

const EMPTY_ITEMS: never[] = [];

/**
 * All annotations for a single entity, hydrated with their reference rows
 * (so `noteType === 'reference'` notes carry their target inline).
 */
export function useAnnotationsForEntity(key: EntityKey | undefined) {
  const valid = Boolean(key?.engineId && key?.entityId);
  return useHydratedList<AnnotationWithReference>(
    valid ? `${key!.engineId}:${key!.entityId}` : null,
    valid
      ? async () => {
          const annotations = await getAnnotationsForEntity(key!.engineId, key!.entityId);
          return Promise.all(
            annotations.map(async (ann) => {
              if (ann.noteType !== 'reference') return ann;
              const reference = await getReferenceForAnnotation(ann.id);
              return { ...ann, reference };
            }),
          );
        }
      : null,
  );
}

/**
 * All annotations elsewhere that *reference* this entity. Each preview
 * carries enough info for a tappable list ("Chapter 3 — Hid the sword").
 */
export function useEntityBacklinks(key: EntityKey | undefined) {
  const valid = Boolean(key?.engineId && key?.entityId);
  return useHydratedList<BacklinkPreview>(
    valid ? `${key!.engineId}:${key!.entityId}` : null,
    valid
      ? async () => {
          const pairs = await getBacklinksForEntity(key!.engineId, key!.entityId);
          const previews: BacklinkPreview[] = await Promise.all(
            pairs.map(async ({ annotation }) => {
              const sourceAdapter = getAnchorAdapter(annotation.sourceEngineId);
              const sourceTitle =
                (await sourceAdapter?.getEntityTitle(annotation.sourceEntityId)) ??
                annotation.sourceEntityId;
              return {
                annotationId: annotation.id,
                sourceEngineId: annotation.sourceEngineId,
                sourceEntityId: annotation.sourceEntityId,
                sourceEntityTitle: sourceTitle,
                anchorSnippet: annotation.anchor.selectedText,
                noteType: annotation.noteType,
                noteBody: annotation.noteBody,
                createdAt: annotation.createdAt,
              };
            }),
          );
          return previews.sort((a, b) => b.createdAt - a.createdAt);
        }
      : null,
  );
}

/**
 * Project-wide list (used by the AnnotationsEngine dashboard).
 */
export const useAnnotationsForProject = makeReadOnlyHook<Annotation>({
  fetchFn: (projectId: string) => getAnnotationsForProject(projectId),
});

/**
 * Project-wide orphan count for a "needs attention" badge.
 */
export function useOrphanCount(projectId: string | undefined) {
  const [count, setCount] = useState<number>(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    countOrphansForProject(projectId).then((n) => {
      if (!cancelled) setCount(n);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, tick]);

  /** Bumping the tick re-runs the count effect. */
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  return { count: projectId ? count : 0, refresh };
}
