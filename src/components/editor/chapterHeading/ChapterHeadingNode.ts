// ============================================
// Chapter heading — "Heading 1 is a chapter", as in Word
// ============================================
//
// The book editor shows every chapter of a manuscript as one document, and
// this node is what a chapter boundary looks like inside it: an `h1` carrying
// the chapter's writing id. Everything between one heading and the next is
// that chapter's prose, and the save (`engines/writings/bookSave.ts`) writes it
// back to that chapter's row. A heading with no id is a chapter that does not
// exist yet — the save creates the row and stamps the id on the node.
//
// The node is built to be hard to lose by accident, because losing one is not
// a formatting change: the chapter's prose would silently become the tail of
// the chapter before it. So it is `isolating` (Backspace and Delete never join
// across it), not `selectable` (no node selection to delete in one press),
// Enter inside it opens a paragraph below rather than a second heading, it
// belongs to a content group of its own that only the book's document node
// admits (a quote or a list cannot wrap it), and a guard plugin refuses any
// transaction that drops a top-level heading it was not told about —
// including a range deletion and Select-all + Delete. The one way a heading
// goes is the merge button on the heading itself, which asks first.
//
// The title is plain text: it is persisted as the row's `title`, a string,
// so anything richer than text in it (a footnote, a mark) would be lost on
// the first save. Refusing it in the schema keeps what is on screen honest.

import {
  Node,
  isNodeActive,
  mergeAttributes,
  textblockTypeInputRule,
  type Editor,
} from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { ReactNodeViewRenderer } from '@tiptap/react';
import ChapterHeadingView from './ChapterHeadingView';
import {
  CHAPTER_GROUP,
  CHAPTER_HEADING_ATTR,
  CHAPTER_HEADING_NAME,
  CHAPTER_HEADING_REMOVAL_META,
  chapterBlocks,
  freshClientId,
  topLevelHeadingCounts,
} from './chapterBlocks';

/**
 * The book's document node: blocks and chapter headings at the top level.
 * The same node as `@tiptap/extension-document` (`doc`, the top node) with
 * the one difference in its content expression. Handed to the editor beside
 * `ChapterHeadingNode`; `TiptapEditor` takes StarterKit's own `doc` out when
 * it sees one named `doc` among the host's extensions. Without it the
 * heading, being in no `block` group, would have nowhere to go and every
 * chapter would parse into its prose.
 */
export const BookDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: `(block | ${CHAPTER_GROUP})+`,
});

export type ChapterMoveDirection = 'up' | 'down';

export interface ChapterHeadingOptions {
  HTMLAttributes: Record<string, string>;
  /**
   * `false` renders the heading as a plain `h1` with no React node view — for
   * a headless editor (tests, an exporter) that has no `EditorContent` to
   * mount React into.
   */
  nodeView: boolean;
  /** "Open chapter" on the heading. */
  onOpenChapter: ((writingId: string) => void) | null;
  /** "Merge with the previous chapter" on the heading; `pos` is the heading's. */
  onMergeWithPrevious: ((pos: number) => void) | null;
  /** The grip's up/down; `pos` is the heading's. */
  onMoveChapter: ((pos: number, direction: ChapterMoveDirection) => void) | null;
  /** A transaction that would have dropped a heading was refused. */
  onRemovalRefused: (() => void) | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    chapterHeading: {
      /** Turn the current block into a new chapter's heading (Word's Heading 1). */
      setChapterHeading: () => ReturnType;
      /** Move the whole chapter block whose heading sits at `pos` past its neighbour. */
      moveChapterAt: (pos: number, direction: ChapterMoveDirection) => ReturnType;
      /**
       * Drop the heading at `pos`, folding its prose into the previous chapter.
       * The only transaction the guard lets a heading disappear in.
       */
      removeChapterHeadingAt: (pos: number) => ReturnType;
    };
  }
}

/** Attributes of a heading made in the editor: no row yet, a fresh identity. */
function newChapterAttrs(): { writingId: null; chapter: null; clientId: string } {
  return { writingId: null, chapter: null, clientId: freshClientId() };
}

/**
 * Enter inside a heading. In the middle or at the end, the text after the
 * caret becomes a paragraph below — never a second heading, which would be a
 * second chapter with the same id. At the very start of a titled heading a
 * paragraph is opened ABOVE instead, so Enter cannot turn a title into body
 * text by pushing it down.
 */
function splitOutOfHeading(editor: Editor): boolean {
  const { state } = editor;
  const { $from, $to } = state.selection;
  if ($from.parent.type.name !== CHAPTER_HEADING_NAME || !$from.sameParent($to)) return false;
  const paragraph = state.schema.nodes.paragraph;
  if (!paragraph) return false;
  return editor.commands.command(({ tr, dispatch }) => {
    if (dispatch) {
      if ($from.parentOffset === 0 && $to.parentOffset === 0 && $from.parent.content.size > 0) {
        tr.insert($from.before(), paragraph.create());
      } else {
        tr.deleteRange($from.pos, $to.pos);
        tr.split($from.pos, 1, [{ type: paragraph }]);
        tr.setSelection(TextSelection.create(tr.doc, $from.pos + 2));
      }
      tr.scrollIntoView();
    }
    return true;
  });
}

/** Backspace at the start of a heading: nothing. The chapter before is not joined. */
function guardBackspace(editor: Editor): boolean {
  const { $from, empty } = editor.state.selection;
  return empty && $from.parent.type.name === CHAPTER_HEADING_NAME && $from.parentOffset === 0;
}

/** Delete at the end of a heading: nothing. The paragraph below is not pulled up. */
function guardDelete(editor: Editor): boolean {
  const { $from, empty } = editor.state.selection;
  return (
    empty &&
    $from.parent.type.name === CHAPTER_HEADING_NAME &&
    $from.parentOffset === $from.parent.content.size
  );
}

export const ChapterHeadingNode = Node.create<ChapterHeadingOptions>({
  name: CHAPTER_HEADING_NAME,
  // Above StarterKit's Heading (100) so this node's `h1` rule, keymap and
  // input rule are consulted first when both are in the schema.
  priority: 1000,
  group: CHAPTER_GROUP,
  content: 'text*',
  marks: '',
  defining: true,
  isolating: true,
  selectable: false,

  addOptions() {
    return {
      HTMLAttributes: {},
      nodeView: true,
      onOpenChapter: null,
      onMergeWithPrevious: null,
      onMoveChapter: null,
      onRemovalRefused: null,
    };
  },

  addAttributes() {
    return {
      writingId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-writing-id'),
        renderHTML: (attributes) =>
          attributes.writingId ? { 'data-writing-id': attributes.writingId } : {},
      },
      // Display only. The number the row carries is decided by the save, which
      // renumbers along the document's order and writes it back here.
      chapter: {
        default: null,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-chapter');
          const parsed = raw === null ? NaN : Number.parseInt(raw, 10);
          return Number.isFinite(parsed) ? parsed : null;
        },
        renderHTML: (attributes) =>
          typeof attributes.chapter === 'number' ? { 'data-chapter': String(attributes.chapter) } : {},
      },
      clientId: {
        default: null,
        rendered: false,
        parseHTML: () => freshClientId(),
      },
    };
  },

  parseHTML() {
    // Only an `h1` that says it is a chapter: the one the book composes for
    // a row (`data-writing-id`) and the one this node serialises
    // (`data-chapter-heading`, so a heading copied and pasted stays one). A
    // bare `h1` inside a chapter — a scene heading — is StarterKit's
    // heading, and stays part of the chapter's prose. Both above the
    // default 50, ahead of the Heading extension's own `h1` rule.
    return [
      { tag: `h1[${CHAPTER_HEADING_ATTR}]`, priority: 60 },
      { tag: 'h1[data-writing-id]', priority: 60 },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'h1',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'wh-chapter-heading',
        // The hook a page layout reads: a chapter starts on a new sheet.
        'data-page-break-before': '',
        [CHAPTER_HEADING_ATTR]: '',
      }),
      0,
    ];
  },

  addNodeView() {
    if (!this.options.nodeView) return null;
    return ReactNodeViewRenderer(ChapterHeadingView, {
      className: 'wh-chapter-heading',
      contentDOMElementTag: 'span',
      attrs: ({ node }) => {
        const attrs: Record<string, string> = { 'data-page-break-before': '', [CHAPTER_HEADING_ATTR]: '' };
        if (typeof node.attrs.writingId === 'string') attrs['data-writing-id'] = node.attrs.writingId;
        if (typeof node.attrs.chapter === 'number') attrs['data-chapter'] = String(node.attrs.chapter);
        return attrs;
      },
    });
  },

  addCommands() {
    return {
      setChapterHeading:
        () =>
        ({ state, chain }) => {
          // A heading that already exists keeps its id; "make this a chapter"
          // on a chapter is not a request to forget which one it is.
          if (isNodeActive(state, this.name)) return false;
          // `clearNodes` first: a paragraph inside a list or a quote is lifted
          // out, so every heading is a top-level node and a chapter boundary.
          return chain().clearNodes().setNode(this.name, newChapterAttrs()).run();
        },

      moveChapterAt:
        (pos, direction) =>
        ({ state, tr, dispatch }) => {
          const blocks = chapterBlocks(state.doc, this.type);
          const index = blocks.findIndex((block) => block.headingPos === pos);
          if (index < 0) return false;
          const neighbour = blocks[direction === 'up' ? index - 1 : index + 1];
          // Never past the prose before the first heading: a chapter moved
          // above it would swallow it.
          if (!neighbour || neighbour.headingPos === null) return false;
          const block = blocks[index];
          const first = direction === 'up' ? neighbour : block;
          const second = direction === 'up' ? block : neighbour;
          if (dispatch) {
            const firstContent = state.doc.slice(first.from, first.to).content;
            const secondContent = state.doc.slice(second.from, second.to).content;
            // One replace step, so one undo puts the chapter back.
            tr.replaceWith(first.from, second.to, Fragment.from(secondContent).append(firstContent));
            const movedHeadingPos =
              direction === 'up' ? neighbour.from : block.from + (neighbour.to - neighbour.from);
            tr.setSelection(TextSelection.create(tr.doc, movedHeadingPos + 1));
            tr.scrollIntoView();
          }
          return true;
        },

      removeChapterHeadingAt:
        (pos) =>
        ({ state, tr, dispatch }) => {
          const node = state.doc.nodeAt(pos);
          if (!node || node.type !== this.type) return false;
          if (dispatch) {
            const writingId = typeof node.attrs.writingId === 'string' ? [node.attrs.writingId] : [];
            tr.delete(pos, pos + node.nodeSize);
            tr.setMeta(CHAPTER_HEADING_REMOVAL_META, writingId);
            tr.scrollIntoView();
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-1': () => this.editor.commands.setChapterHeading(),
      Enter: () => splitOutOfHeading(this.editor),
      // A line break inside a title is not a title: same answer as Enter.
      'Shift-Enter': () => splitOutOfHeading(this.editor),
      Backspace: () => guardBackspace(this.editor),
      Delete: () => guardDelete(this.editor),
    };
  },

  addInputRules() {
    return [
      textblockTypeInputRule({
        find: /^#\s$/,
        type: this.type,
        getAttributes: () => newChapterAttrs(),
      }),
    ];
  },

  addProseMirrorPlugins() {
    const type = this.type;
    const options = this.options;
    return [
      new Plugin({
        key: new PluginKey('chapterHeadingGuard'),
        // A heading that carries a row id may only leave the document in a
        // transaction that names it. Everything else — a range deletion that
        // happened to cover it, Select-all + Delete, a paste over it, the
        // redo of a merge — is dropped whole, and the host may say why.
        // Counted, not merely listed: with a pasted copy of a heading beside
        // its original, losing either one is still losing a heading.
        filterTransaction(transaction) {
          if (!transaction.docChanged) return true;
          const before = topLevelHeadingCounts(transaction.before, type);
          if (before.size === 0) return true;
          const after = topLevelHeadingCounts(transaction.doc, type);
          const allowed: unknown = transaction.getMeta(CHAPTER_HEADING_REMOVAL_META);
          const allowedIds = Array.isArray(allowed) ? new Set<unknown>(allowed) : null;
          for (const [id, count] of before) {
            if ((after.get(id) ?? 0) >= count || allowedIds?.has(id)) continue;
            options.onRemovalRefused?.();
            return false;
          }
          return true;
        },
      }),
    ];
  },
});

export default ChapterHeadingNode;
