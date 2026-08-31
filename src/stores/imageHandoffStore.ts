// ============================================================================
// Image hand-off — a one-shot prompt handed to the Image Studio from elsewhere
// ============================================================================
//
// When another engine (e.g. a text selection in Escritos) wants the studio to
// generate a specific prompt, it drops it here and navigates to the studio tab.
// The studio drains it once on mount. Kept out of the URL because a generated
// prompt can be long; kept out of component state because the source engine
// unmounts when the tab switches.

import { create } from 'zustand';

export interface ImageHandoff {
  /** Prompt to pre-fill; empty keeps whatever the studio already has. */
  prompt: string;
  /** Kick off generation on arrival instead of only pre-filling the prompt. */
  autoGenerate: boolean;
  /** A reference image (data URL) to set as the img2img source. */
  initImage?: string;
}

interface ImageHandoffState {
  pending: ImageHandoff | null;
  request: (handoff: ImageHandoff) => void;
  /** Return the pending hand-off and clear it, so it fires exactly once. */
  take: () => ImageHandoff | null;
}

export const useImageHandoffStore = create<ImageHandoffState>((set, get) => ({
  pending: null,
  request: (handoff) => set({ pending: handoff }),
  take: () => {
    const pending = get().pending;
    if (pending) set({ pending: null });
    return pending;
  },
}));
