import { useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import { db } from '@/db';
import type { AtlasPlace } from '@/engines/real-atlas/types';
import { computeAch, type AchResult } from './ach';
import { buildChronology, deriveClaims, type Chronology, type ClaimView } from './derive';
import { loadInquirySnapshot, type InquirySnapshot } from './operations';
import { DEFAULT_STALE_DAYS } from './types';

export interface InquiryModel {
  loading: boolean;
  failed: boolean;
  retry: () => void;
  snapshot: InquirySnapshot | null;
  places: AtlasPlace[];
  staleDays: number;
  /** Every claim with its derived state, evaluated at `asOf` (all of them, flagged inEffect). */
  views: ClaimView[];
  chronology: Chronology;
  ach: AchResult;
}

/**
 * Live model of a project's investigation. The derived state is recomputed from
 * the citations on every change, so retracting a source anywhere in the app
 * reshapes the claims here without a reload.
 */
export function useInquiry(projectId: string, asOf: string | null): InquiryModel {
  const [snapshot, setSnapshot] = useState<InquirySnapshot | null>(null);
  const [places, setPlaces] = useState<AtlasPlace[]>([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const subscription = liveQuery(async () => ({
      snapshot: await loadInquirySnapshot(projectId),
      places: await db.atlasPlaces.where('projectId').equals(projectId).toArray(),
    })).subscribe({
      next: value => { setSnapshot(value.snapshot); setPlaces(value.places); setFailed(false); },
      error: () => setFailed(true),
    });
    return () => subscription.unsubscribe();
  }, [projectId, attempt]);

  const staleDays = snapshot?.case?.staleDays ?? DEFAULT_STALE_DAYS;
  const functionalPredicates = snapshot?.case?.functionalPredicates;

  const views = useMemo(
    () => (snapshot ? deriveClaims(snapshot.claims, snapshot.citations, { staleDays, asOf }) : []),
    [snapshot, staleDays, asOf],
  );
  const chronology = useMemo(() => buildChronology(views, { asOf, functionalPredicates }), [views, asOf, functionalPredicates]);
  const ach = useMemo(
    () => computeAch(snapshot?.hypotheses ?? [], asOf ? views.filter(view => view.inEffect) : views, snapshot?.ratings ?? []),
    [snapshot, views, asOf],
  );

  return {
    loading: !snapshot && !failed,
    failed,
    retry: () => setAttempt(value => value + 1),
    snapshot,
    places,
    staleDays,
    views,
    chronology,
    ach,
  };
}
