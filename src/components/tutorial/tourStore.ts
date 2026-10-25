// The tour's live state. One small store so the overlay, the list and the
// checklist link read the same thing without a context.

import { create } from 'zustand';
import { emptyProgress } from './tourProgress';
import type { TourProgress, TourBinding } from './tourTypes';

export interface ActiveTour {
  binding?: TourBinding;
  tourId: string;
  /** Index in the tour's `steps` of the step on screen. */
  index: number;
  /** How many steps this run has put on screen (0 = it never showed anything). */
  shown: number;
  /** `data-tour` of the spotlighted element, if the step has one. */
  anchor?: string;
}

interface TourState {
  progress: TourProgress;
  progressLoaded: boolean;
  panelOpen: boolean;
  active: ActiveTour | null;
  /** A step is being found (navigating, waiting for its element). */
  resolving: boolean;
  setProgress: (progress: TourProgress) => void;
  setPanelOpen: (open: boolean) => void;
  setActive: (active: ActiveTour | null) => void;
  setResolving: (resolving: boolean) => void;
}

export const useTourStore = create<TourState>(set => ({
  progress: emptyProgress(),
  progressLoaded: false,
  panelOpen: false,
  active: null,
  resolving: false,
  setProgress: progress => set({ progress, progressLoaded: true }),
  setPanelOpen: panelOpen => set({ panelOpen }),
  setActive: active => set({ active }),
  setResolving: resolving => set({ resolving }),
}));

/** Opens the list from anywhere (top bar, checklist). */
export function openToursPanel(): void {
  useTourStore.getState().setPanelOpen(true);
}
