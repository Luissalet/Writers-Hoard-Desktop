// Where a writer got to in each guided tour. App-wide (a tour is about the
// app, not about one world), so it lives in one `settings` row — the same flat
// store the interface language and the sidebar width use — and is never part
// of a world's backup.

import { getSetting, updateSetting } from '@/db/operations';
import type { TourProgress, TourRecord, TourStatus } from './tourTypes';

export const TOUR_PROGRESS_KEY = 'tours.progress.v1';

export function emptyProgress(): TourProgress {
  return { version: 1, tours: {} };
}

/** Tolerant: a hand-edited or newer row degrades to "nothing started", never throws. */
export function parseProgress(raw: string | undefined): TourProgress {
  if (!raw) return emptyProgress();
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return emptyProgress();
    const record = value as Record<string, unknown>;
    const tours: Record<string, TourRecord> = {};
    if (typeof record.tours === 'object' && record.tours !== null) {
      for (const [id, entry] of Object.entries(record.tours as Record<string, unknown>)) {
        if (typeof entry !== 'object' || entry === null) continue;
        const item = entry as Record<string, unknown>;
        if (item.status !== 'in-progress' && item.status !== 'done') continue;
        tours[id] = {
          status: item.status,
          step: typeof item.step === 'number' && item.step >= 0 ? Math.floor(item.step) : 0,
          updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0,
        };
      }
    }
    return { version: 1, tours, offerAnswered: record.offerAnswered === true ? true : undefined };
  } catch {
    return emptyProgress();
  }
}

export async function readTourProgress(): Promise<TourProgress> {
  return parseProgress(await getSetting(TOUR_PROGRESS_KEY));
}

/** Atomic read-modify-write, so two quick writes cannot drop each other. */
export async function updateTourProgress(change: (current: TourProgress) => TourProgress): Promise<TourProgress> {
  let next = emptyProgress();
  await updateSetting(TOUR_PROGRESS_KEY, current => {
    next = change(parseProgress(current));
    return JSON.stringify(next);
  });
  return next;
}

export function tourStatus(progress: TourProgress, tourId: string): { status: TourStatus; step: number } {
  const record = progress.tours[tourId];
  return record ? { status: record.status, step: record.step } : { status: 'not-started', step: 0 };
}

/** Pure transitions, so the rules are testable without a database. */
export function withStep(progress: TourProgress, tourId: string, step: number, now: number): TourProgress {
  const existing = progress.tours[tourId];
  // A finished tour stays finished while it is repeated.
  if (existing?.status === 'done') return progress;
  // Showing the first step of a tour never started is not "in progress" yet.
  if (!existing && step <= 0) return progress;
  return { ...progress, tours: { ...progress.tours, [tourId]: { status: 'in-progress', step, updatedAt: now } } };
}

export function withDone(progress: TourProgress, tourId: string, now: number): TourProgress {
  return { ...progress, tours: { ...progress.tours, [tourId]: { status: 'done', step: 0, updatedAt: now } } };
}

export function withOfferAnswered(progress: TourProgress): TourProgress {
  return { ...progress, offerAnswered: true };
}
