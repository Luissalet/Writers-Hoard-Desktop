import TiptapEditor from '@/components/editor/TiptapEditor';
import { normalizeNoteContent } from '../content';

/** The normal native editor; note writes keep its plain projection alongside HTML. */
export default function NoteRichEditor({ html, onChange }: { html: string; onChange: (text: string, richHtml: string) => void }) {
  return <div className="tiptap-editor min-w-0 rounded-lg border border-border" data-note-rich-editor>
    <TiptapEditor content={html} onChange={value=>{const next=normalizeNoteContent({richHtml:value});onChange(next.text??'',next.richHtml!);}}/>
  </div>;
}
