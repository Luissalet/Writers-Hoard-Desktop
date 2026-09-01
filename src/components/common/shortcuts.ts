// ============================================================================
// Every key Writers Hoard answers to, written down once
// ============================================================================
//
// The shortcuts grew where they were needed and never anywhere else: the
// palette binds ⌘K inside `GlobalSearch`, the find bar has `editorShortcuts`,
// the reader reads the arrows in its own effect, the board and the world map
// each keep their own keymap. Nothing ever told the writer any of it existed.
// This is the list the shortcuts panel prints.
//
// It is deliberately DATA — no React, no translation, no DOM. A component can
// render it, a handler can ask it whether the keystroke it just caught is the
// one it was waiting for, and a test can read it without a browser.
//
// THE ONE RULE: a row that does not match the code is worse than no row at
// all. A sheet promising a key that does nothing sends the writer hunting for
// a fault in their keyboard. So every row carries `source` — the file that
// actually answers it — and the rows whose handler asks this table back
// (`matchesShortcut`) are marked `readsThisTable`. For every other row the
// chord is written twice, here and in the handler, and this comment is the
// only thing holding the two copies together:
//
//   CHANGING A KEY IN A HANDLER MUST CHANGE ITS ROW HERE, IN THE SAME COMMIT.
//
// The rows that are only described, never enforced, are the ones living in
// files this table cannot reach into (`components/editor`, the writings
// engine, the board, worldgen). They were read off the source line by line.
//
// What is deliberately NOT here: the plain Enter/Escape a text field answers
// with (send this note, commit this title, cancel this rename). Those are the
// conventions every form on the planet has; listing forty of them would bury
// the eight keys a writer actually needs to be told about.

/** The keyboard contexts, in the order the panel prints them. */
export type ShortcutScope =
  | 'global'
  | 'search'
  | 'editor'
  | 'find'
  | 'reader'
  | 'board'
  | 'world';

export interface ShortcutScopeMeta {
  id: ShortcutScope;
  /** Heading for the group. */
  titleKey: string;
  /**
   * One line saying WHERE the group's keys are live. This is the half a
   * shortcuts sheet usually leaves out, and the half that makes it usable:
   * "Ctrl+F" means nothing without "while the chapter editor has the page".
   */
  whereKey: string;
}

export const SHORTCUT_SCOPES: readonly ShortcutScopeMeta[] = [
  { id: 'global', titleKey: 'shortcuts.scope.global', whereKey: 'shortcuts.scope.global.where' },
  { id: 'search', titleKey: 'shortcuts.scope.search', whereKey: 'shortcuts.scope.search.where' },
  { id: 'editor', titleKey: 'shortcuts.scope.editor', whereKey: 'shortcuts.scope.editor.where' },
  { id: 'find', titleKey: 'shortcuts.scope.find', whereKey: 'shortcuts.scope.find.where' },
  { id: 'reader', titleKey: 'shortcuts.scope.reader', whereKey: 'shortcuts.scope.reader.where' },
  { id: 'board', titleKey: 'shortcuts.scope.board', whereKey: 'shortcuts.scope.board.where' },
  { id: 'world', titleKey: 'shortcuts.scope.world', whereKey: 'shortcuts.scope.world.where' },
];

export interface Shortcut {
  id: string;
  scope: ShortcutScope;
  /**
   * The chords that fire it, in this module's notation: modifiers joined with
   * `+`, `Mod` standing for ⌘ on a Mac and Ctrl everywhere else. More than one
   * means alternatives — `['Mod+Shift+Z', 'Mod+Y']` is one action with two
   * keys, not two actions.
   */
  keys: readonly string[];
  /**
   * Replaces `keys` on a Mac, for the handful macOS took away. Only `replace`
   * needs it: ⌘H hides the application and the page never sees the keystroke.
   */
  macKeys?: readonly string[];
  /** Locale key of the one-line description. */
  descriptionKey: string;
  /** The file that answers this key — where to go when the row looks wrong. */
  source: string;
  /**
   * Set on the rows whose handler asks this table (`matchesShortcut`) instead
   * of carrying its own copy of the chord. Those cannot drift; the rest can.
   */
  readsThisTable?: boolean;
}

/** Ids referenced from code, so a rename breaks the build instead of the key. */
export const COMMAND_CENTRE_SHORTCUT = 'global.commandCentre';
export const SHORTCUTS_PANEL_SHORTCUT = 'global.shortcuts';

export const SHORTCUTS: readonly Shortcut[] = [
  // ── Anywhere ──────────────────────────────────────────────────────────────
  {
    id: COMMAND_CENTRE_SHORTCUT,
    scope: 'global',
    keys: ['Mod+K'],
    descriptionKey: 'shortcuts.global.commandCentre',
    source: 'src/components/common/GlobalSearch.tsx',
    readsThisTable: true,
  },
  {
    id: 'global.quickNote',
    scope: 'global',
    keys: ['Mod+Shift+N'],
    descriptionKey: 'shortcuts.global.quickNote',
    // Bound twice on purpose: the desktop registers it with the OS so it works
    // with the app in the background, and the page binds it again for the web
    // build and for when another application already owns the accelerator.
    source: 'src/engines/notes/components/QuickNoteHost.tsx, electron/main.ts',
  },
  {
    id: SHORTCUTS_PANEL_SHORTCUT,
    scope: 'global',
    keys: ['Mod+/'],
    descriptionKey: 'shortcuts.global.shortcuts',
    source: 'src/components/common/ShortcutsPanel.tsx',
    readsThisTable: true,
  },
  {
    id: 'global.dismiss',
    scope: 'global',
    keys: ['Escape'],
    descriptionKey: 'shortcuts.global.dismiss',
    source: 'src/components/common/Modal.tsx',
  },

  // ── Command centre ────────────────────────────────────────────────────────
  {
    id: 'search.move',
    scope: 'search',
    keys: ['ArrowUp', 'ArrowDown'],
    descriptionKey: 'shortcuts.search.move',
    source: 'src/components/common/GlobalSearch.tsx',
  },
  {
    id: 'search.open',
    scope: 'search',
    keys: ['Enter'],
    descriptionKey: 'shortcuts.search.open',
    source: 'src/components/common/GlobalSearch.tsx',
  },
  {
    id: 'search.openAndStay',
    scope: 'search',
    keys: ['Mod+Enter'],
    descriptionKey: 'shortcuts.search.openAndStay',
    source: 'src/components/common/GlobalSearch.tsx',
  },
  {
    id: 'search.complete',
    scope: 'search',
    keys: ['Tab'],
    descriptionKey: 'shortcuts.search.complete',
    source: 'src/components/common/GlobalSearch.tsx',
  },
  {
    id: 'search.deleteSaved',
    scope: 'search',
    keys: ['Delete', 'Backspace'],
    descriptionKey: 'shortcuts.search.deleteSaved',
    source: 'src/components/common/GlobalSearch.tsx',
  },
  {
    id: 'search.close',
    scope: 'search',
    keys: ['Escape'],
    descriptionKey: 'shortcuts.search.close',
    source: 'src/components/common/GlobalSearch.tsx',
  },

  // ── The chapter editor ────────────────────────────────────────────────────
  {
    id: 'editor.find',
    scope: 'editor',
    keys: ['Mod+F'],
    descriptionKey: 'shortcuts.editor.find',
    source: 'src/components/editor/editorShortcuts.ts',
  },
  {
    id: 'editor.replace',
    scope: 'editor',
    keys: ['Ctrl+H'],
    // ⌘H hides the application and macOS takes it before the page sees it, so
    // the Mac gets its own chord. `isReplaceShortcut` says the same thing.
    macKeys: ['Mod+Alt+F'],
    descriptionKey: 'shortcuts.editor.replace',
    source: 'src/components/editor/editorShortcuts.ts',
  },
  {
    id: 'editor.save',
    scope: 'editor',
    keys: ['Mod+S'],
    descriptionKey: 'shortcuts.editor.save',
    source: 'src/engines/writings/components/WritingsView.tsx',
  },
  {
    id: 'editor.bold',
    scope: 'editor',
    keys: ['Mod+B'],
    descriptionKey: 'shortcuts.editor.bold',
    source: 'src/components/editor/TiptapEditor.tsx',
  },
  {
    id: 'editor.italic',
    scope: 'editor',
    keys: ['Mod+I'],
    descriptionKey: 'shortcuts.editor.italic',
    source: 'src/components/editor/TiptapEditor.tsx',
  },
  {
    id: 'editor.undo',
    scope: 'editor',
    keys: ['Mod+Z'],
    descriptionKey: 'shortcuts.editor.undo',
    source: 'src/components/editor/TiptapEditor.tsx',
  },
  {
    id: 'editor.redo',
    scope: 'editor',
    keys: ['Mod+Shift+Z', 'Mod+Y'],
    descriptionKey: 'shortcuts.editor.redo',
    source: 'src/components/editor/TiptapEditor.tsx',
  },
  {
    id: 'editor.leaveFocusMode',
    scope: 'editor',
    keys: ['Escape'],
    descriptionKey: 'shortcuts.editor.leaveFocusMode',
    source: 'src/engines/writings/components/WritingsView.tsx',
  },

  // ── Find and replace ──────────────────────────────────────────────────────
  {
    id: 'find.next',
    scope: 'find',
    // One chord, two readings, because the bar has two boxes and the same key
    // means "go on" in both of them. Saying so is the only way to keep this
    // row true without inventing a scope per text field.
    keys: ['Enter'],
    descriptionKey: 'shortcuts.find.next',
    source: 'src/components/editor/FindReplaceBar.tsx',
  },
  {
    id: 'find.previous',
    scope: 'find',
    keys: ['Shift+Enter'],
    descriptionKey: 'shortcuts.find.previous',
    source: 'src/components/editor/FindReplaceBar.tsx',
  },
  {
    id: 'find.replaceAll',
    scope: 'find',
    keys: ['Mod+Enter'],
    descriptionKey: 'shortcuts.find.replaceAll',
    source: 'src/components/editor/FindReplaceBar.tsx',
  },
  {
    id: 'find.close',
    scope: 'find',
    keys: ['Escape'],
    descriptionKey: 'shortcuts.find.close',
    source: 'src/components/editor/TiptapEditor.tsx',
  },

  // ── Reading mode ──────────────────────────────────────────────────────────
  {
    id: 'reader.screenDown',
    scope: 'reader',
    keys: ['Space', 'PageDown'],
    descriptionKey: 'shortcuts.reader.screenDown',
    source: 'src/engines/writings/components/ReadingView.tsx',
  },
  {
    id: 'reader.screenUp',
    scope: 'reader',
    keys: ['Shift+Space', 'PageUp'],
    descriptionKey: 'shortcuts.reader.screenUp',
    source: 'src/engines/writings/components/ReadingView.tsx',
  },
  {
    id: 'reader.lineDown',
    scope: 'reader',
    keys: ['ArrowDown'],
    descriptionKey: 'shortcuts.reader.lineDown',
    source: 'src/engines/writings/components/ReadingView.tsx',
  },
  {
    id: 'reader.lineUp',
    scope: 'reader',
    keys: ['ArrowUp'],
    descriptionKey: 'shortcuts.reader.lineUp',
    source: 'src/engines/writings/components/ReadingView.tsx',
  },
  {
    id: 'reader.nextPiece',
    scope: 'reader',
    keys: ['ArrowRight'],
    descriptionKey: 'shortcuts.reader.nextPiece',
    source: 'src/engines/writings/components/ReadingView.tsx',
  },
  {
    id: 'reader.previousPiece',
    scope: 'reader',
    keys: ['ArrowLeft'],
    descriptionKey: 'shortcuts.reader.previousPiece',
    source: 'src/engines/writings/components/ReadingView.tsx',
  },
  {
    id: 'reader.first',
    scope: 'reader',
    keys: ['Home'],
    descriptionKey: 'shortcuts.reader.first',
    source: 'src/engines/writings/components/ReadingView.tsx',
  },
  {
    id: 'reader.last',
    scope: 'reader',
    keys: ['End'],
    descriptionKey: 'shortcuts.reader.last',
    source: 'src/engines/writings/components/ReadingView.tsx',
  },
  {
    id: 'reader.exit',
    scope: 'reader',
    keys: ['Escape'],
    descriptionKey: 'shortcuts.reader.exit',
    source: 'src/engines/writings/components/ReadingView.tsx',
  },

  // ── The story board ───────────────────────────────────────────────────────
  {
    id: 'board.undo',
    scope: 'board',
    keys: ['Mod+Z'],
    descriptionKey: 'shortcuts.board.undo',
    source: 'src/engines/board/components/BoardCanvas.tsx',
  },
  {
    id: 'board.redo',
    scope: 'board',
    keys: ['Mod+Shift+Z', 'Mod+Y'],
    descriptionKey: 'shortcuts.board.redo',
    source: 'src/engines/board/components/BoardCanvas.tsx',
  },
  {
    id: 'board.copy',
    scope: 'board',
    keys: ['Mod+C'],
    descriptionKey: 'shortcuts.board.copy',
    source: 'src/engines/board/components/BoardCanvas.tsx',
  },
  {
    id: 'board.paste',
    scope: 'board',
    keys: ['Mod+V'],
    descriptionKey: 'shortcuts.board.paste',
    source: 'src/engines/board/components/BoardCanvas.tsx',
  },
  {
    id: 'board.duplicate',
    scope: 'board',
    keys: ['Mod+D'],
    descriptionKey: 'shortcuts.board.duplicate',
    source: 'src/engines/board/components/BoardCanvas.tsx',
  },
  {
    id: 'board.selectAll',
    scope: 'board',
    keys: ['Mod+A'],
    descriptionKey: 'shortcuts.board.selectAll',
    source: 'src/engines/board/components/BoardCanvas.tsx',
  },
  {
    id: 'board.frame',
    scope: 'board',
    keys: ['Mod+G'],
    descriptionKey: 'shortcuts.board.frame',
    source: 'src/engines/board/components/BoardCanvas.tsx',
  },
  {
    id: 'board.delete',
    scope: 'board',
    keys: ['Delete', 'Backspace'],
    descriptionKey: 'shortcuts.board.delete',
    source: 'src/engines/board/components/BoardCanvas.tsx',
  },
  {
    id: 'board.nudge',
    scope: 'board',
    keys: ['Arrows'],
    descriptionKey: 'shortcuts.board.nudge',
    source: 'src/engines/board/components/BoardCanvas.tsx',
  },
  {
    id: 'board.nudgeGrid',
    scope: 'board',
    keys: ['Shift+Arrows'],
    descriptionKey: 'shortcuts.board.nudgeGrid',
    source: 'src/engines/board/components/BoardCanvas.tsx',
  },
  {
    id: 'board.clear',
    scope: 'board',
    keys: ['Escape'],
    descriptionKey: 'shortcuts.board.clear',
    source: 'src/engines/board/components/BoardCanvas.tsx',
  },
  {
    id: 'board.linkCommit',
    scope: 'board',
    keys: ['Enter'],
    descriptionKey: 'shortcuts.board.linkCommit',
    source: 'src/engines/board/components/BoardCanvas.tsx',
  },
  {
    id: 'board.linkSwapEnd',
    scope: 'board',
    keys: ['Tab'],
    descriptionKey: 'shortcuts.board.linkSwapEnd',
    source: 'src/engines/board/components/BoardCanvas.tsx',
  },

  // ── The world map ─────────────────────────────────────────────────────────
  {
    id: 'world.undo',
    scope: 'world',
    keys: ['Mod+Z'],
    descriptionKey: 'shortcuts.world.undo',
    source: 'src/engines/worldgen/components/Map2D.tsx, World3D.tsx, CartoMap.tsx',
  },
  {
    id: 'world.redo',
    scope: 'world',
    keys: ['Mod+Shift+Z', 'Mod+Y'],
    descriptionKey: 'shortcuts.world.redo',
    source: 'src/engines/worldgen/components/Map2D.tsx, World3D.tsx, CartoMap.tsx',
  },
  {
    id: 'world.locator',
    scope: 'world',
    keys: ['Mod+F'],
    descriptionKey: 'shortcuts.world.locator',
    source: 'src/engines/worldgen/components/WorldView.tsx',
  },
  {
    id: 'world.home',
    scope: 'world',
    keys: ['Home'],
    descriptionKey: 'shortcuts.world.home',
    source: 'src/engines/worldgen/components/Map2D.tsx, WorldView.tsx',
  },
  {
    id: 'world.back',
    scope: 'world',
    // Two things, one reading — "undo the last step", nearest first — which is
    // how Map2D justifies binding them to the same key. One row, both said.
    keys: ['Backspace'],
    descriptionKey: 'shortcuts.world.back',
    source: 'src/engines/worldgen/components/Map2D.tsx',
  },
  {
    id: 'world.closeBorder',
    scope: 'world',
    keys: ['Enter'],
    descriptionKey: 'shortcuts.world.closeBorder',
    source: 'src/engines/worldgen/components/Map2D.tsx',
  },
  {
    id: 'world.drop',
    scope: 'world',
    keys: ['Escape'],
    descriptionKey: 'shortcuts.world.drop',
    source: 'src/engines/worldgen/components/Map2D.tsx',
  },
  {
    id: 'world.pan',
    scope: 'world',
    keys: ['Space'],
    descriptionKey: 'shortcuts.world.pan',
    source: 'src/engines/worldgen/components/Map2D.tsx',
  },
  {
    id: 'world.brushSmaller',
    scope: 'world',
    keys: ['['],
    descriptionKey: 'shortcuts.world.brushSmaller',
    source: 'src/engines/worldgen/components/World3D.tsx',
  },
  {
    id: 'world.brushBigger',
    scope: 'world',
    keys: [']'],
    descriptionKey: 'shortcuts.world.brushBigger',
    source: 'src/engines/worldgen/components/World3D.tsx',
  },
  {
    id: 'world.mirrorX',
    scope: 'world',
    keys: ['X'],
    descriptionKey: 'shortcuts.world.mirrorX',
    source: 'src/engines/worldgen/components/World3D.tsx',
  },
  {
    id: 'world.mirrorY',
    scope: 'world',
    keys: ['Y'],
    descriptionKey: 'shortcuts.world.mirrorY',
    source: 'src/engines/worldgen/components/World3D.tsx',
  },
  {
    id: 'world.focus',
    scope: 'world',
    keys: ['F'],
    descriptionKey: 'shortcuts.world.focus',
    source: 'src/engines/worldgen/components/World3D.tsx',
  },
  {
    id: 'world.shadow',
    scope: 'world',
    keys: ['S'],
    descriptionKey: 'shortcuts.world.shadow',
    source: 'src/engines/worldgen/components/World3D.tsx',
  },
  {
    id: 'world.shape',
    scope: 'world',
    keys: ['G'],
    descriptionKey: 'shortcuts.world.shape',
    source: 'src/engines/worldgen/components/World3D.tsx',
  },
];

export function getShortcut(id: string): Shortcut | undefined {
  return SHORTCUTS.find((shortcut) => shortcut.id === id);
}

export function shortcutsInScope(scope: ShortcutScope): Shortcut[] {
  return SHORTCUTS.filter((shortcut) => shortcut.scope === scope);
}

// ---------------------------------------------------------------------------
// Printing the keys
// ---------------------------------------------------------------------------

/**
 * The same test the top bar has always used for its ⌘K badge, hoisted here so
 * there is one answer to "is this a Mac" instead of one per component.
 */
export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform);
}

/** Which chords are live on this platform. */
export function shortcutChords(shortcut: Shortcut, mac: boolean = isMacPlatform()): readonly string[] {
  return mac && shortcut.macKeys ? shortcut.macKeys : shortcut.keys;
}

/**
 * One key on the sheet. `text` is what to print; `localeKey` is set for the
 * caps whose name is a WORD, because a Spanish keyboard has Intro, Retroceso
 * and Supr written on it, not Enter, Backspace and Delete. Symbols (⌘, ⇧, ↑)
 * are the same everywhere and carry no key.
 */
export interface KeyCap {
  text: string;
  localeKey?: string;
}

const KEY_CAPS: Readonly<Record<string, KeyCap | undefined>> = {
  Escape: { text: 'Esc' },
  Enter: { text: '↵' },
  Tab: { text: 'Tab' },
  Space: { text: 'Space', localeKey: 'shortcuts.key.space' },
  Home: { text: 'Home', localeKey: 'shortcuts.key.home' },
  End: { text: 'End', localeKey: 'shortcuts.key.end' },
  PageUp: { text: 'Page Up', localeKey: 'shortcuts.key.pageUp' },
  PageDown: { text: 'Page Down', localeKey: 'shortcuts.key.pageDown' },
  Delete: { text: 'Delete', localeKey: 'shortcuts.key.delete' },
  Backspace: { text: 'Backspace', localeKey: 'shortcuts.key.backspace' },
  ArrowUp: { text: '↑' },
  ArrowDown: { text: '↓' },
  ArrowLeft: { text: '←' },
  ArrowRight: { text: '→' },
  Arrows: { text: '↑ ↓ ← →' },
};

/**
 * Tokens that stand for a HANDFUL of keys rather than one, so the board's
 * nudge is one row instead of four. Nothing can match them — there is no
 * single event for "the arrows" — and `matchesChord` says so out loud rather
 * than quietly returning false for a chord someone expected to work.
 */
export const DISPLAY_ONLY_KEYS: ReadonlySet<string> = new Set(['Arrows']);

function capFor(token: string, mac: boolean): KeyCap {
  if (token === 'Mod') return { text: mac ? '⌘' : 'Ctrl' };
  if (token === 'Alt') return { text: mac ? '⌥' : 'Alt' };
  // ⇧ is printed on the Mac key itself; on every other keyboard the cap is a
  // word, and in Spanish that word is Mayús.
  if (token === 'Shift') return mac ? { text: '⇧' } : { text: 'Shift', localeKey: 'shortcuts.key.shift' };
  return KEY_CAPS[token] ?? { text: token };
}

/** One chord, split into the caps to print, left to right. */
export function chordCaps(chord: string, mac: boolean = isMacPlatform()): KeyCap[] {
  return chord.split('+').map((token) => capFor(token, mac));
}

/**
 * Every chord of one shortcut, by id, already split into caps — for the badges
 * printed outside the panel, such as the top bar's ⌘K. An unknown id gives an
 * empty list, so a mistyped id costs a badge and not the header.
 */
export function shortcutCaps(id: string, mac: boolean = isMacPlatform()): KeyCap[][] {
  const shortcut = getShortcut(id);
  if (!shortcut) return [];
  return shortcutChords(shortcut, mac).map((chord) => chordCaps(chord, mac));
}

// ---------------------------------------------------------------------------
// Recognising the keys
// ---------------------------------------------------------------------------

/**
 * Layout-independent fallbacks for the punctuation this table binds. Same idea
 * as `editorShortcuts`' `KeyF`: the physical key, for when the character does
 * not survive the layout.
 */
const PUNCTUATION_CODES: Readonly<Record<string, string | undefined>> = {
  '/': 'Slash',
  '[': 'BracketLeft',
  ']': 'BracketRight',
};

/**
 * Punctuation that is a SHIFTED key on layouts this app is used on — `/` is
 * Shift+7 in Spain, and half this app's writers are there. A chord that does
 * not ask for Shift must still fire when Shift is what produced the character,
 * or Ctrl+/ would be unreachable for them.
 */
const SHIFT_MAY_PRODUCE: ReadonlySet<string> = new Set(['/', '[', ']']);

function matchesKey(event: KeyboardEvent, key: string): boolean {
  if (/^[A-Za-z]$/.test(key)) {
    return event.key.toLowerCase() === key.toLowerCase() || event.code === `Key${key.toUpperCase()}`;
  }
  if (key === 'Space') return event.key === ' ' || event.code === 'Space';
  if (event.key === key) return true;
  return event.code === PUNCTUATION_CODES[key];
}

/** Whether a keystroke is this chord. */
export function matchesChord(event: KeyboardEvent, chord: string): boolean {
  const tokens = chord.split('+');
  const key = tokens[tokens.length - 1];
  if (DISPLAY_ONLY_KEYS.has(key)) return false;
  const wanted = new Set(tokens.slice(0, -1));

  // `Mod` is either modifier, the way every handler in this app already reads
  // it — a writer moving between a Mac and a PC keeps their muscle memory.
  // `Ctrl` means Ctrl and nothing else: it is in this table only for the
  // Windows/Linux replace chord, which must not answer to ⌘.
  const mod = event.metaKey || event.ctrlKey;
  const wantsMod = wanted.has('Mod');
  const wantsCtrl = wanted.has('Ctrl');
  if (wantsMod && !mod) return false;
  if (wantsCtrl && (!event.ctrlKey || event.metaKey)) return false;
  if (!wantsMod && !wantsCtrl && mod) return false;
  if (wanted.has('Alt') !== event.altKey) return false;
  if (wanted.has('Shift') && !event.shiftKey) return false;
  if (!wanted.has('Shift') && event.shiftKey && !SHIFT_MAY_PRODUCE.has(key)) return false;

  return matchesKey(event, key);
}

/**
 * Whether a keystroke is the shortcut with this id, on this platform. The
 * handlers that can reach this module call it instead of spelling the chord
 * out a second time; an unknown id matches nothing, and the critical test
 * checks that the ids the code names are really in the table.
 */
export function matchesShortcut(event: KeyboardEvent, id: string, mac: boolean = isMacPlatform()): boolean {
  const shortcut = getShortcut(id);
  if (!shortcut) return false;
  return shortcutChords(shortcut, mac).some((chord) => matchesChord(event, chord));
}
