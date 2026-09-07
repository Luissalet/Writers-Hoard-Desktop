/** A shared entry point for visible capture buttons and the keyboard host. */
export const QUICK_NOTE_OPEN_EVENT = 'wh:quick-note-open';

export function openQuickNote(): void {
  window.dispatchEvent(new Event(QUICK_NOTE_OPEN_EVENT));
}
