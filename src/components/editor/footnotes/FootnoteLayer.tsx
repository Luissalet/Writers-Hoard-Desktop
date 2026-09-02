import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { NodeSelection, type Transaction } from '@tiptap/pm/state';
import { Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { footnoteInsertedIn, footnoteOpenedIn } from './FootnoteNode';
import { FOOTNOTE_NODE_NAME, FOOTNOTE_REF_CLASS, findFootnote } from './footnoteModel';

/**
 * The popover a footnote is written in.
 *
 * Mounted inside the editor's wrapper (`relative overflow-hidden`), which is
 * what it positions against: the reference's rectangle is measured on screen
 * and translated into that box, the same way the floating selection menu in
 * `TiptapEditor` places itself. It opens on a click on a reference, on the
 * selection becoming a footnote node (arrow keys reach it too), and by itself
 * when `insertFootnote` has just run, with the field focused so the writer
 * types the note and presses Escape to carry on with the sentence.
 *
 * Every keystroke is written to the node straight away through
 * `setFootnoteText`: the transaction is a `setNodeMarkup`, the history
 * plugin groups consecutive ones, and there is no draft anywhere to lose.
 */

const POPOVER_WIDTH = 320;
/** Enough for the field at its smallest plus the button row. */
const POPOVER_MIN_HEIGHT = 150;
const GAP = 6;

interface OpenNote {
  id: string;
  /**
   * Whether the field takes focus. True for an insert, a click and Enter —
   * the writer asked to edit the note. False when the selection merely
   * arrived on the reference by keyboard, which must not pull the caret out
   * of the prose.
   */
  focus: boolean;
  /** Vertical placement: `top` from the wrapper, or `bottom` when flipped above. */
  top?: number;
  bottom?: number;
  left: number;
}

function isFootnoteSelection(editor: Editor): string | null {
  const selection = editor.state.selection;
  if (!(selection instanceof NodeSelection)) return null;
  if (selection.node.type.name !== FOOTNOTE_NODE_NAME) return null;
  return String(selection.node.attrs.id ?? '');
}

/**
 * Where to put the popover for this note, in the wrapper's coordinates. Below
 * the reference when the wrapper has room for it, above otherwise — the
 * wrapper clips, so a note on the last line would otherwise open into
 * nothing.
 */
function placeFor(editor: Editor, wrapper: HTMLElement, id: string, focus: boolean): OpenNote | null {
  const found = findFootnote(editor.state.doc, id);
  if (!found) return null;
  const dom = editor.view.nodeDOM(found.pos);
  const box = wrapper.getBoundingClientRect();
  const ref = dom instanceof HTMLElement
    ? dom.getBoundingClientRect()
    : (() => {
        const coords = editor.view.coordsAtPos(found.pos);
        return { top: coords.top, bottom: coords.bottom, left: coords.left, right: coords.right };
      })();
  const left = Math.max(4, Math.min(ref.left - box.left, box.width - POPOVER_WIDTH - 4));
  const below = box.bottom - ref.bottom - GAP;
  const above = ref.top - box.top - GAP;
  if (below >= POPOVER_MIN_HEIGHT || below >= above) {
    return { id, focus, top: ref.bottom - box.top + GAP, left };
  }
  return { id, focus, bottom: box.bottom - ref.top + GAP, left };
}

interface FootnoteLayerProps {
  editor: Editor;
}

export default function FootnoteLayer({ editor }: FootnoteLayerProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState<OpenNote | null>(null);
  const [draft, setDraft] = useState('');
  // The open note's id, for the editor listeners below: they are bound once
  // per editor, and a ref is how they see the current one without rebinding.
  const openIdRef = useRef<string | null>(null);
  useEffect(() => {
    openIdRef.current = open?.id ?? null;
  }, [open]);

  // Open, close and re-place, all driven by the editor. Nothing in here
  // touches React state outside an event callback.
  useEffect(() => {
    const wrapper = rootRef.current?.parentElement;
    if (!wrapper || editor.isDestroyed) return;
    // Captured now: by the time this cleans up the editor may be unmounted,
    // and an unmounted editor has no `view` to ask.
    const dom = editor.view.dom;
    // An insert leaves the cursor AFTER the new node, so the selection event
    // that follows it in the same dispatch would close what it just opened.
    let opening = false;

    const show = (id: string, focus: boolean) => {
      const placed = placeFor(editor, wrapper, id, focus);
      if (!placed) {
        setOpen(null);
        return;
      }
      const found = findFootnote(editor.state.doc, id);
      setDraft(String(found?.node.attrs.text ?? ''));
      setOpen(placed);
    };

    // The note can change under an open popover — edited in the panel,
    // deleted there, undone with Ctrl+Z, swept away by a restored version
    // (a `setContent` that emits no `update`, which is why this reads the
    // transaction). The field follows unless it is the one doing the
    // writing, and a note that is gone takes its popover with it.
    const follow = () => {
      const id = openIdRef.current;
      if (!id) return;
      const found = findFootnote(editor.state.doc, id);
      if (!found) {
        setOpen(null);
        return;
      }
      if (fieldRef.current === document.activeElement) return;
      setDraft(String(found.node.attrs.text ?? ''));
    };
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged) follow();
      const opened = footnoteOpenedIn(transaction);
      if (opened) show(opened, true);
      const inserted = footnoteInsertedIn(transaction);
      if (!inserted) return;
      opening = true;
      show(inserted.id, true);
    };
    const onSelection = () => {
      if (opening) {
        opening = false;
        return;
      }
      const id = isFootnoteSelection(editor);
      if (id) {
        show(id, false);
        return;
      }
      // The selection moved into the prose: the note's own field, if it
      // holds focus, keeps the popover; anything else closes it.
      setOpen((current) => (current && fieldRef.current === document.activeElement ? current : null));
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const ref = target?.closest<HTMLElement>(`sup.${FOOTNOTE_REF_CLASS}`);
      if (!ref) return;
      const id = ref.dataset.footnoteId;
      if (id) show(id, true);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(`sup.${FOOTNOTE_REF_CLASS}`)) return;
      setOpen(null);
    };
    const onResize = () => {
      setOpen((current) => (current ? placeFor(editor, wrapper, current.id, false) : null));
    };
    editor.on('transaction', onTransaction);
    editor.on('selectionUpdate', onSelection);
    dom.addEventListener('click', onClick);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', onResize);
    return () => {
      editor.off('transaction', onTransaction);
      editor.off('selectionUpdate', onSelection);
      dom.removeEventListener('click', onClick);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', onResize);
    };
  }, [editor]);

  // The field grows with the note. DOM only, no state.
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, 240)}px`;
  }, [draft, open]);

  // Focus is taken here rather than with `autoFocus`, which only acts on
  // mount: Enter on a note whose popover is already showing has to reach
  // the field too. The caret goes to the end, where a note is continued.
  useEffect(() => {
    const field = fieldRef.current;
    if (!open?.focus || !field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, [open]);

  if (!open) return <div ref={rootRef} hidden />;

  const closeAndReturn = () => {
    const id = open.id;
    setOpen(null);
    const found = findFootnote(editor.state.doc, id);
    // Back into the prose, just after the reference: that is where the
    // sentence the note hangs off continues.
    if (found) editor.chain().focus().setTextSelection(found.pos + found.node.nodeSize).run();
    else editor.commands.focus();
  };

  const remove = () => {
    const id = open.id;
    setOpen(null);
    editor.chain().focus().removeFootnote(id).run();
  };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={t('writings.footnotes.editNote')}
      className="absolute z-30 rounded-lg border border-accent-gold/40 bg-surface shadow-lg p-2 space-y-1.5"
      style={{ top: open.top, bottom: open.bottom, left: open.left, width: POPOVER_WIDTH }}
    >
      <textarea
        ref={fieldRef}
        value={draft}
        rows={2}
        placeholder={t('writings.footnotes.placeholder')}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          editor.commands.setFootnoteText(open.id, text);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeAndReturn();
          }
        }}
        className="w-full resize-none bg-elevated border border-border rounded px-2 py-1.5 text-sm text-text-primary leading-snug outline-none focus:border-accent-gold transition"
      />
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={remove}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-text-muted hover:text-danger hover:bg-elevated transition"
        >
          <Trash2 size={12} />
          {t('common.delete')}
        </button>
        <button
          type="button"
          onClick={closeAndReturn}
          className="px-2.5 py-1 rounded text-[11px] font-semibold bg-accent-gold text-deep hover:bg-accent-amber transition"
        >
          {t('common.done')}
        </button>
      </div>
    </div>
  );
}
