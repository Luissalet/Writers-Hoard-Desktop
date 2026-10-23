import { useState } from 'react';
import { NodeSelection } from '@tiptap/pm/state';
import { useEditorState, type Editor } from '@tiptap/react';
import { Copy, EyeOff, FileOutput, FoldVertical, ScanEye } from 'lucide-react';
import type { CodexEntry } from '@/types';
import { createCodexEntry } from '@/db/operations';
import { generateId } from '@/utils/idGenerator';
import { copyBlock, extractBlock, outerBlockAt, toggleFold } from './blockActions';
import { WIKI_HIDDEN_BLOCK_TYPES } from './marks';

const wikiMarkCopy = {
  en: { fold: 'Fold block under a title', unfold: 'Unfold block', copy: 'Copy block', copied: 'Block copied: paste it into any card or chapter.', copyFailed: 'The clipboard is not available.', extract: 'Extract block to a new card', extracted: 'Moved to the new card “{title}”; a live reference stands in its place.', extractEra: 'Extracting works in the shared base, not inside an era.', fragment: 'Fragment', block: 'Hide this block from wiki', title: 'Wiki visibility', hidden: 'Hide selection from wiki', spoiler: 'Cover selection as spoiler', help: 'Hidden text is omitted from the exported wiki. Spoilers are included behind a reveal button. Both stay readable here.' },
  es: { fold: 'Plegar bloque bajo un título', unfold: 'Desplegar bloque', copy: 'Copiar bloque', copied: 'Bloque copiado: pégalo en cualquier ficha o capítulo.', copyFailed: 'El portapapeles no está disponible.', extract: 'Extraer bloque a una ficha nueva', extracted: 'Movido a la ficha nueva «{title}»; en su lugar queda una referencia viva.', extractEra: 'Extraer funciona en la base compartida, no dentro de una era.', fragment: 'Fragmento', block: 'Ocultar este bloque de la wiki', title: 'Visibilidad en la wiki', hidden: 'Ocultar selección de la wiki', spoiler: 'Cubrir selección como spoiler', help: 'El texto oculto se elimina de la wiki exportada. Los spoilers se incluyen con un botón para revelarlos. Aquí puedes leer ambos.' },
};

/** The outermost block around the cursor that can be kept out of the wiki. */
function wikiBlockAt(editor: Editor): { pos: number; hidden: boolean } | null {
  const { $from } = editor.state.selection;
  // A selected whole block (an image, a prep block) is the block itself.
  const selected = editor.state.selection instanceof NodeSelection ? editor.state.selection.node : null;
  if (selected && (WIKI_HIDDEN_BLOCK_TYPES as readonly string[]).includes(selected.type.name)) return { pos: editor.state.selection.from, hidden: !!selected.attrs.wikiHidden };
  for (let depth = 1; depth <= $from.depth; depth++) {
    const node = $from.node(depth);
    if ((WIKI_HIDDEN_BLOCK_TYPES as readonly string[]).includes(node.type.name)) return { pos: $from.before(depth), hidden: !!node.attrs.wikiHidden };
  }
  return null;
}

export function WikiMarksControls({ editor, locale, extract }: { editor: Editor; locale: 'es' | 'en'; extract?: { projectId?: string; eraId?: string } }) {
  const copy = wikiMarkCopy[locale];
  const [status, setStatus] = useState('');
  const state = useEditorState({ editor, selector: ({ editor: current }) => ({ outer: outerBlockAt(current)?.node.type.name ?? null, block: wikiBlockAt(current), hidden: current.isActive('wikiHidden'), spoiler: current.isActive('wikiSpoiler'), editable: current.isEditable, empty: current.state.selection.empty }) });
  const button = 'inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50';
  return <details><summary className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded border border-border bg-surface px-3 py-2 text-xs text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold"><ScanEye size={14} aria-hidden="true" />{copy.title}</summary><div className="flex flex-wrap gap-2 py-3">
    <button type="button" className={button} disabled={!state.editable || state.empty && !state.hidden} aria-pressed={state.hidden} onMouseDown={event => event.preventDefault()} onClick={() => editor.chain().focus().toggleMark('wikiHidden').run()}><EyeOff size={15} />{copy.hidden}</button>
    <button type="button" className={button} disabled={!state.editable || state.empty && !state.spoiler} aria-pressed={state.spoiler} onMouseDown={event => event.preventDefault()} onClick={() => editor.chain().focus().toggleMark('wikiSpoiler').run()}><ScanEye size={15} />{copy.spoiler}</button>
    <button type="button" data-testid="wiki-hide-block" className={button} disabled={!state.editable || !state.block} aria-pressed={!!state.block?.hidden} onMouseDown={event => event.preventDefault()} onClick={() => { const block = wikiBlockAt(editor); if (block) editor.view.dispatch(editor.state.tr.setNodeMarkup(block.pos, undefined, { ...editor.state.doc.nodeAt(block.pos)!.attrs, wikiHidden: !block.hidden })); }}><EyeOff size={15} />{copy.block}</button>
    <button type="button" data-testid="block-fold" className={button} disabled={!state.editable || !state.outer} onMouseDown={event => event.preventDefault()} onClick={() => { toggleFold(editor, copy.fragment); setStatus(''); }}><FoldVertical size={15} />{state.outer === 'toggleBlock' ? copy.unfold : copy.fold}</button>
    <button type="button" data-testid="block-copy" className={button} disabled={!state.outer} onMouseDown={event => event.preventDefault()} onClick={() => { void copyBlock(editor).then(done => setStatus(done ? copy.copied : copy.copyFailed)); }}><Copy size={15} />{copy.copy}</button>
    {extract?.projectId && <button type="button" data-testid="block-extract" className={button} disabled={!state.editable || !state.outer || state.outer === 'codexLiveBlock' || !!extract.eraId} title={extract.eraId ? copy.extractEra : undefined} onMouseDown={event => event.preventDefault()} onClick={() => {
      const projectId = extract.projectId!, taken = extractBlock(editor, copy.fragment);
      if (!taken) return;
      const now = Date.now(), entry = { id: generateId(), projectId, type: 'concept', title: taken.title, content: taken.html, fields: {}, tags: [], relations: [], createdAt: now, updatedAt: now } as unknown as CodexEntry;
      void createCodexEntry(entry).then(() => { if (taken.replace(projectId, entry.id)) setStatus(copy.extracted.replace('{title}', taken.title)); });
    }}><FileOutput size={15} />{copy.extract}</button>}
    {status && <p role="status" data-testid="block-action-status" className="basis-full text-xs text-text-muted">{status}</p>}
    <p className="basis-full text-xs leading-relaxed text-text-muted">{copy.help}</p>
  </div></details>;
}
