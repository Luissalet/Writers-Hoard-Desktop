// ============================================================================
// Copilot hand-off — a passage handed to the dock from wherever it was read
// ============================================================================
//
// The twin of imageHandoffStore, for text: when the writer selects a sentence
// in the editor and wants to talk about it, the selection is dropped here and
// the dock drains it into its draft. Deliberately NOT a send — the quote lands
// in the composer and the writer types the question themselves.
//
// Kept out of the URL because a passage can be long; kept out of component
// state because the dock is mounted by MainLayout, far above whatever engine
// the selection came from.

import { create } from 'zustand';

export interface CopilotHandoff {
  /** The selected passage, verbatim. Quoted into the draft, never sent alone. */
  quote: string;
}

interface CopilotHandoffState {
  pending: CopilotHandoff | null;
  request: (handoff: CopilotHandoff) => void;
  /** Return the pending hand-off and clear it, so it fires exactly once. */
  take: () => CopilotHandoff | null;
}

export const useCopilotHandoffStore = create<CopilotHandoffState>((set, get) => ({
  pending: null,
  request: (handoff) => set({ pending: handoff }),
  take: () => {
    const pending = get().pending;
    if (pending) set({ pending: null });
    return pending;
  },
}));

/** Longer than a paragraph is a chapter, and a chapter belongs in a tool call. */
const MAX_QUOTE = 2000;

/**
 * Whether there is a dock to hand anything to.
 *
 * The same gate CopilotDock itself uses: the copilot is a desktop feature, so
 * on the web build a button offering it would be a button that does nothing.
 * Call sites check this to decide whether to show the offer at all.
 */
export function copilotAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean(window.electronAPI?.copilot);
}

/**
 * Hand a selected passage to the copilot dock.
 *
 * The one call sites outside the dock need: it trims, caps and ignores an
 * empty selection, so a caller never has to think about any of that.
 */
export function askCopilotAbout(text: string): void {
  if (!copilotAvailable()) return;
  const quote = text.trim().slice(0, MAX_QUOTE);
  if (!quote) return;
  useCopilotHandoffStore.getState().request({ quote });
}
