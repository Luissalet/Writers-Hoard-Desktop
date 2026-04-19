// ============================================
// Annotations — React hooks
// ============================================
//
// All hooks are read-only. Mutations go through `operations.ts` directly so
// the call sites can pair them with optimistic UI / refresh().

import { useCallback, useEffect, useState } from 'react';
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
 * All annotations for a single entity, hydrated with their reference rows
 * (so `noteType === 'reference'` notes carry their target inline).
 */
export function useAnnotationsForEntity(key: EntityKey | undefined) {
  const [items, setItems] = useState<AnnotationWithReference[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const refresh = useCallback(async () => {
    if (!key?.engineId || !key?.entityId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const annotations = await getAnnotationsForEntity(key.engineId, key.entityId);
      const hydrated: AnnotationWithReference[] = await Promise.all(
        annotations.map(async (ann) => {
          if (ann.noteType !== 'reference') return ann;
          const reference = await getReferenceForAnnotation(ann.id);
          return { ...ann, reference };
        }),
      );
      setItems(hydrated);
    } finally {
      setLoading(false);
    }
  }, [key?.engineId, key?.entityId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { items, loading, refresh };
}

/**
 * All annotations elsewhere that *reference* this entity. Each preview
 * carries enough info for a tappable list ("Chapter 3 — Hid the sword").
 */
export function useEntityBacklinks(key: EntityKey | undefined) {
  const [items, setItems] = useState<BacklinkPreview[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const refresh = useCallback(async () => {
    if (!key?.engineId || !key?.entityId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const pairs = await getBacklinksForEntity(key.engineId, key.entityId);
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
      setItems(previews.sort((a, b) => b.createdAt - a.createdAt));
    } finally {
      setLoading(false);
    }
  }, [key?.engineId, key?.entityId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { items, loading, refresh };
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

  const refresh = useCallback(async () => {
    if (!projectId) {
      setCount(0);
      return;
    }
    setCount(await countOrphansForProject(projectId));
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { count, refresh };
}
