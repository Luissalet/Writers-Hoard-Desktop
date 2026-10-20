import { useEditorState, type Editor } from '@tiptap/react';
import { EyeOff, ScanEye } from 'lucide-react';

const wikiMarkCopy = {
  en: { title: 'Wiki visibility', hidden: 'Hide selection from wiki', spoiler: 'Cover selection as spoiler', help: 'Hidden text is omitted from the exported wiki. Spoilers are included behind a reveal button. Both stay readable here.' },
  es: { title: 'Visibilidad en la wiki', hidden: 'Ocultar selección de la wiki', spoiler: 'Cubrir selección como spoiler', help: 'El texto oculto se elimina de la wiki exportada. Los spoilers se incluyen con un botón para revelarlos. Aquí puedes leer ambos.' },
};

export function WikiMarksControls({ editor, locale }: { editor: Editor; locale: 'es' | 'en' }) {
  const copy = wikiMarkCopy[locale];
  const state = useEditorState({ editor, selector: ({ editor: current }) => ({ hidden: current.isActive('wikiHidden'), spoiler: current.isActive('wikiSpoiler'), editable: current.isEditable, empty: current.state.selection.empty }) });
  const button = 'inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50';
  return <details><summary className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded border border-border bg-surface px-3 py-2 text-xs text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold"><ScanEye size={14} aria-hidden="true" />{copy.title}</summary><div className="flex flex-wrap gap-2 py-3">
    <button type="button" className={button} disabled={!state.editable || state.empty && !state.hidden} aria-pressed={state.hidden} onMouseDown={event => event.preventDefault()} onClick={() => editor.chain().focus().toggleMark('wikiHidden').run()}><EyeOff size={15} />{copy.hidden}</button>
    <button type="button" className={button} disabled={!state.editable || state.empty && !state.spoiler} aria-pressed={state.spoiler} onMouseDown={event => event.preventDefault()} onClick={() => editor.chain().focus().toggleMark('wikiSpoiler').run()}><ScanEye size={15} />{copy.spoiler}</button>
    <p className="basis-full text-xs leading-relaxed text-text-muted">{copy.help}</p>
  </div></details>;
}
