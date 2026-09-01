/**
 * Who answers Ctrl/Cmd+F.
 *
 * The find bar belongs to a document, but the keystroke arrives at the window,
 * and several editors can be mounted at once (a chapter and a board card, a
 * codex entry inside a modal). Two rules keep it predictable:
 *
 *   1. The editor that holds focus always answers.
 *   2. If focus is in some other field — a title, a tag box, a search input —
 *      nobody answers, and the keystroke is left alone. Stealing it there
 *      would trap the writer with a find bar aimed at the wrong text.
 *
 * Otherwise (focus on the page chrome or nowhere) the editor the writer
 * touched last answers, which is the one they are looking at.
 */

const surfaces: HTMLElement[] = [];
let lastFocused: HTMLElement | null = null;

/** Registers an editor container. Returns the unregister function. */
export function registerEditorSurface(surface: HTMLElement): () => void {
  surfaces.push(surface);
  const remember = () => {
    lastFocused = surface;
  };
  surface.addEventListener('focusin', remember);
  return () => {
    surface.removeEventListener('focusin', remember);
    const at = surfaces.indexOf(surface);
    if (at !== -1) surfaces.splice(at, 1);
    if (lastFocused === surface) lastFocused = null;
  };
}

function isTextEntry(node: Element | null): boolean {
  if (!(node instanceof HTMLElement)) return false;
  if (
    node instanceof HTMLInputElement ||
    node instanceof HTMLTextAreaElement ||
    node instanceof HTMLSelectElement
  ) {
    return true;
  }
  return node.isContentEditable;
}

export function ownsEditorShortcut(surface: HTMLElement): boolean {
  const active = document.activeElement;
  if (active && surface.contains(active)) return true;
  if (isTextEntry(active)) return false;

  const fallback =
    lastFocused && surfaces.includes(lastFocused)
      ? lastFocused
      : surfaces.length === 1
        ? surfaces[0]
        : null;
  return fallback === surface;
}

const MAC = /Mac|iPhone|iPad/i.test(navigator.platform);

/** Layout-independent: Ctrl+F on a Dvorak keyboard is still `KeyF`. */
function isKey(event: KeyboardEvent, letter: string): boolean {
  return event.key.toLowerCase() === letter || event.code === `Key${letter.toUpperCase()}`;
}

export function isFindShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && isKey(event, 'f');
}

/**
 * ⌘H hides the application on macOS and the OS takes that key before the page
 * ever sees it, so the Mac gets its own platform shortcut for replace. The bar
 * also carries a visible toggle, which is the only path anyone has to be told
 * about once.
 */
export function isReplaceShortcut(event: KeyboardEvent): boolean {
  if (MAC) return event.metaKey && event.altKey && !event.shiftKey && event.code === 'KeyF';
  return event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && isKey(event, 'h');
}
