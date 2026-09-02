import { Node } from '@tiptap/core';
import type { NodeType } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { ReplaceAroundStep, ReplaceStep } from '@tiptap/pm/transform';
import { generateId } from '@/utils/idGenerator';
import {
  FOOTNOTE_ID_ATTR,
  FOOTNOTE_NODE_NAME,
  FOOTNOTE_REF_CLASS,
  FOOTNOTE_REF_SELECTOR,
  FOOTNOTE_TEXT_ATTR,
  findFootnote,
} from './footnoteModel';

/**
 * The footnote node.
 *
 * An inline atom: it sits in the text like a character, is selected as one
 * unit, and Backspace right after it removes the whole note (ProseMirror's
 * own rule for a non-text node before the cursor). It renders as an EMPTY
 * `<sup>` — the number is a CSS counter (`index.css`, "footnotes"), so the
 * editor, the reading view and the exported HTML all number in document
 * order without anyone keeping the numbers in sync.
 *
 * The body is an attribute rather than content for the reasons given in
 * `footnoteModel.ts`; the editing surface for it is `FootnoteLayer`.
 */

/** The chord the keymap answers to, in the shortcut table's spelling. */
export const FOOTNOTE_SHORTCUT_CHORD = 'Mod+Alt+F';

/**
 * Transaction meta set by `insertFootnote`, so the UI can open the editor for
 * a note the instant it exists — `editor.on('transaction')` sees it before
 * any listener could ask which of the notes is the new one.
 */
export const FOOTNOTE_INSERTED_META = 'whFootnoteInserted';

export interface FootnoteInsertedMeta {
  id: string;
}

/**
 * Transaction meta set by Enter on a selected reference: the keyboard's way
 * into the note, since arrowing onto a footnote must not steal focus from
 * the prose — a writer stepping through a sentence would otherwise land in
 * the note's field on the way past.
 */
export const FOOTNOTE_OPEN_META = 'whFootnoteOpen';

export interface FootnoteStorage {
  /** Id of the note the last `insertFootnote` created; `null` before any. */
  lastInsertedId: string | null;
}

declare module '@tiptap/core' {
  interface Storage {
    footnote: FootnoteStorage;
  }
  interface Commands<ReturnType> {
    footnote: {
      /** Insert a note at the cursor, replacing any selection. */
      insertFootnote: (text?: string) => ReturnType;
      /** Replace the body of the note with this id. False when it is gone. */
      setFootnoteText: (id: string, text: string) => ReturnType;
      /** Delete the reference — and with it the note. False when it is gone. */
      removeFootnote: (id: string) => ReturnType;
    };
  }
}

/** The meta of an insert, if this transaction was one. */
export function footnoteInsertedIn(tr: Transaction): FootnoteInsertedMeta | null {
  const meta = tr.getMeta(FOOTNOTE_INSERTED_META) as FootnoteInsertedMeta | undefined;
  return meta ?? null;
}

/** The id Enter asked to open, if this transaction was that request. */
export function footnoteOpenedIn(tr: Transaction): string | null {
  const meta = tr.getMeta(FOOTNOTE_OPEN_META) as FootnoteInsertedMeta | undefined;
  return meta?.id ?? null;
}

/** Whether a step puts a footnote node into the document (paste, drop, `insertContent`, `setContent`). */
function stepInsertsFootnote(step: unknown, type: NodeType): boolean {
  if (!(step instanceof ReplaceStep) && !(step instanceof ReplaceAroundStep)) return false;
  let found = false;
  step.slice.content.descendants((node) => {
    if (found) return false;
    if (node.type === type) found = true;
    return !found;
  });
  return found;
}

/**
 * A transaction giving a fresh id to every footnote whose id an earlier one
 * in the document already carries (or that has none), or null when every
 * id is its own. The id is how the panel, the popover and project-wide
 * replace name a note: two notes sharing one would be edited and deleted
 * as one, and always the first.
 */
export function restampDuplicateFootnotes(state: EditorState, type: NodeType): Transaction | null {
  const seen = new Set<string>();
  let tr: Transaction | null = null;
  state.doc.descendants((node, pos) => {
    if (node.type !== type) return true;
    const id = String(node.attrs.id ?? '');
    if (id && !seen.has(id)) {
      seen.add(id);
      return false;
    }
    tr ??= state.tr;
    const fresh = generateId();
    seen.add(fresh);
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: fresh });
    return false;
  });
  return tr;
}

export const FootnoteNode = Node.create<Record<string, never>, FootnoteStorage>({
  name: FOOTNOTE_NODE_NAME,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addStorage() {
    return { lastInsertedId: null };
  },

  addAttributes() {
    // `rendered: false` on both: `renderHTML` below writes the element by
    // hand so the attribute order — and so the persisted bytes — are fixed.
    return {
      id: {
        default: null,
        rendered: false,
        parseHTML: (element: HTMLElement) => element.getAttribute(FOOTNOTE_ID_ATTR),
      },
      text: {
        default: '',
        rendered: false,
        parseHTML: (element: HTMLElement) => element.getAttribute(FOOTNOTE_TEXT_ATTR) ?? '',
      },
    };
  },

  parseHTML() {
    return [{ tag: FOOTNOTE_REF_SELECTOR }];
  },

  renderHTML({ node }) {
    return [
      'sup',
      {
        [FOOTNOTE_ID_ATTR]: String(node.attrs.id ?? ''),
        [FOOTNOTE_TEXT_ATTR]: String(node.attrs.text ?? ''),
        class: FOOTNOTE_REF_CLASS,
      },
    ];
  },

  addCommands() {
    return {
      insertFootnote:
        (text = '') =>
        ({ tr, dispatch }) => {
          // On a selected note the button and the chord mean "edit this
          // one": replacing it with an empty note would throw the body away.
          if (tr.selection instanceof NodeSelection && tr.selection.node.type === this.type) {
            if (dispatch) {
              const id = String(tr.selection.node.attrs.id ?? '');
              tr.setMeta(FOOTNOTE_OPEN_META, { id } satisfies FootnoteInsertedMeta);
            }
            return true;
          }
          // Nowhere to put one inside a code block: its content is text only,
          // and ProseMirror would otherwise drop the node somewhere outside.
          const { $from } = tr.selection;
          if (!$from.parent.canReplaceWith($from.index(), $from.index(), this.type)) return false;
          const id = generateId();
          if (dispatch) {
            const node = this.type.create({ id, text });
            // The cursor lands after the reference, so closing the note's
            // editor puts the writer back where the sentence continues.
            tr.replaceSelectionWith(node, false).scrollIntoView();
            tr.setMeta(FOOTNOTE_INSERTED_META, { id } satisfies FootnoteInsertedMeta);
            this.storage.lastInsertedId = id;
          }
          return true;
        },
      setFootnoteText:
        (id, text) =>
        ({ tr, dispatch }) => {
          const found = findFootnote(tr.doc, id);
          if (!found) return false;
          if (found.node.attrs.text === text) return true;
          if (dispatch) {
            // Replacing the node would turn a node selection on it into a
            // cursor (the mapping counts the old node as deleted), and the
            // highlight would vanish on the first keystroke of the note.
            const keepSelected =
              tr.selection instanceof NodeSelection && tr.selection.from === found.pos;
            tr.setNodeMarkup(found.pos, undefined, { ...found.node.attrs, text });
            if (keepSelected) tr.setSelection(NodeSelection.create(tr.doc, found.pos));
          }
          return true;
        },
      removeFootnote:
        (id) =>
        ({ tr, dispatch }) => {
          const found = findFootnote(tr.doc, id);
          if (!found) return false;
          if (dispatch) tr.delete(found.pos, found.pos + found.node.nodeSize);
          return true;
        },
    };
  },

  onCreate() {
    // Persisted HTML with a duplicated id (a copy made before this guard
    // existed) is mended on load, off the history and silently to the host:
    // the next edit carries the fresh ids out.
    const tr = restampDuplicateFootnotes(this.editor.state, this.type);
    if (tr) this.editor.view.dispatch(tr.setMeta('addToHistory', false).setMeta('preventUpdate', true));
  },

  addProseMirrorPlugins() {
    const type = this.type;
    return [
      new Plugin({
        key: new PluginKey('whFootnoteIds'),
        // Copy and paste inside one document — or a drop, or `insertContent`
        // — brings a note in with the id of the one it was copied from.
        // Watched here rather than in `transformPasted`, which a drag within
        // the editor does not go through.
        appendTransaction(transactions, _previous, state) {
          const inserted = transactions.some(
            (tr) => tr.docChanged && tr.steps.some((step) => stepInsertsFootnote(step, type)),
          );
          return inserted ? restampDuplicateFootnotes(state, type) : null;
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    // Same chord as `FOOTNOTE_SHORTCUT_CHORD`, in ProseMirror's spelling.
    return {
      'Mod-Alt-f': () => this.editor.commands.insertFootnote(),
      // On a Mac ⌘⌥F is "replace" (see `isReplaceShortcut`, which takes it in
      // the capture phase before this keymap sees it), so the Mac gets a
      // chord of its own as well.
      'Mod-Alt-Shift-f': () => this.editor.commands.insertFootnote(),
      Enter: () => {
        const { selection, tr } = this.editor.state;
        if (!(selection instanceof NodeSelection) || selection.node.type.name !== this.name) {
          return false;
        }
        // No document change: the meta is the whole message. Without this,
        // Enter on a selected reference would split the paragraph around it.
        const id = String(selection.node.attrs.id ?? '');
        this.editor.view.dispatch(tr.setMeta(FOOTNOTE_OPEN_META, { id } satisfies FootnoteInsertedMeta));
        return true;
      },
    };
  },
});
