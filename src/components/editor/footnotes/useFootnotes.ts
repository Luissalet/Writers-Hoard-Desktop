import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { Transaction } from '@tiptap/pm/state';
import { collectFootnotes, sameFootnotes, type FootnoteRef } from './footnoteModel';

/**
 * The document's footnotes, in order, refreshed on every change to the
 * document and handed back by the same reference for as long as no id or
 * text has changed — so a panel built on it does not re-render while the
 * writer types prose.
 *
 * `transaction`, not `update`: a version restored from history arrives as
 * `setContent(…, { emitUpdate: false })`, which changes the document without
 * an `update` event, and the list would go on showing the notes of the text
 * that just left the screen.
 */
export function useFootnotes(editor: Editor | null): FootnoteRef[] {
  const [notes, setNotes] = useState<FootnoteRef[]>(() =>
    editor ? collectFootnotes(editor.state.doc) : [],
  );
  // A new editor (or none) resets the list during render — the sanctioned
  // shape for state derived from a prop, and the reason there is no setState
  // in the effect below.
  const [source, setSource] = useState(editor);
  if (source !== editor) {
    setSource(editor);
    setNotes(editor ? collectFootnotes(editor.state.doc) : []);
  }

  useEffect(() => {
    if (!editor) return;
    const refresh = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.docChanged) return;
      const next = collectFootnotes(editor.state.doc);
      setNotes((current) => (sameFootnotes(current, next) ? current : next));
    };
    editor.on('transaction', refresh);
    return () => {
      editor.off('transaction', refresh);
    };
  }, [editor]);

  return notes;
}
