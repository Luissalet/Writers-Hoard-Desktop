import TiptapEditor from '@/components/editor/TiptapEditor';
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Editor } from '@tiptap/core';
import NoteImageControls, { type NoteImageActivity } from './NoteImageControls';
import { GLOBAL_NOTES_SCOPE } from '../types';
import { normalizeNoteContent } from '../content';

/** The normal native editor; note writes keep its plain projection alongside HTML. */
export default function NoteRichEditor({ html, onChange, projectId = GLOBAL_NOTES_SCOPE, eraId, noteId = 'composer', activity }: { html: string; onChange: (text: string, richHtml: string) => void; projectId?: string; eraId?: string; noteId?: string; activity?: RefObject<NoteImageActivity> }) {
  const [editor, setEditor] = useState<Editor | null>(null), localActivity = useRef<NoteImageActivity>({ epoch: 0, blocked: false });
  const ready = useCallback((value: Editor | null) => setEditor(value), []);
  const owner = JSON.stringify([projectId, eraId ?? null, noteId]);
  const guard = activity ?? localActivity;
  // Sanitization may reorder semantic attributes. Feeding that echo back as an
  // external setContent would add a whole-document history event after each edit.
  const [emitted, setEmitted] = useState<{ raw: string; normalized: string } | null>(null);
  const content = html === emitted?.normalized ? emitted.raw : html;
  useLayoutEffect(() => () => { guard.current.epoch++; }, [owner, guard]);
  return <div className="tiptap-editor min-w-0 rounded-lg border border-border" data-note-rich-editor>
    <TiptapEditor key={owner} content={content} onEditorReady={ready} toolbarExtra={<NoteImageControls key={owner} editor={editor} owner={owner} projectId={projectId} activity={guard}/>} onChange={value=>{const next=normalizeNoteContent({richHtml:value});setEmitted({raw:value,normalized:next.richHtml!});onChange(next.text??'',next.richHtml!);}}/>
  </div>;
}
