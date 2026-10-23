// The fields of the story block the cursor is in: for a text message, which
// side it is on and who sends it; for an email, from, to, subject and date.
// A small bar over the block, like the image controls.
import { useEffect, useState, type RefObject } from 'react';
import type { Editor } from '@tiptap/react';

type Found = { kind: 'messageBubble' | 'emailBlock'; pos: number; attrs: Record<string, string>; left: number; top: number };

function enclosing(editor: Editor): { kind: Found['kind']; pos: number; attrs: Record<string, string> } | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === 'messageBubble' || node.type.name === 'emailBlock') return { kind: node.type.name, pos: $from.before(depth), attrs: node.attrs as Record<string, string> };
  }
  return null;
}

export default function BlockFieldControls({ editor, wrapperRef, locale }: { editor: Editor | null; wrapperRef: RefObject<HTMLDivElement | null>; locale: string }) {
  const [found, setFound] = useState<Found | null>(null);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const update = () => {
      const block = editor.isEditable && wrapperRef.current ? enclosing(editor) : null;
      if (!block) { setFound(null); return; }
      const dom = editor.view.nodeDOM(block.pos) as HTMLElement | null;
      if (!dom || !wrapperRef.current) { setFound(null); return; }
      const box = dom.getBoundingClientRect(), host = wrapperRef.current.getBoundingClientRect();
      setFound({ ...block, left: Math.max(4, box.left - host.left), top: Math.max(4, box.top - host.top - 40) });
    };
    editor.on('selectionUpdate', update); editor.on('transaction', update);
    return () => { editor.off('selectionUpdate', update); editor.off('transaction', update); };
  }, [editor, wrapperRef]);
  if (!editor || !found) return null;
  const es = locale !== 'en';
  const set = (attrs: Record<string, string>) => {
    const { tr } = editor.state;
    const node = tr.doc.nodeAt(found.pos);
    if (!node || node.type.name !== found.kind) return;
    editor.view.dispatch(tr.setNodeMarkup(found.pos, undefined, { ...node.attrs, ...attrs }));
  };
  const input = (name: string, label: string, width: string) => <input key={name} data-testid={`block-field-${name}`} aria-label={label} placeholder={label} defaultValue={found.attrs[name] ?? ''} maxLength={found.kind === 'messageBubble' ? 60 : 120}
    onChange={event => set({ [name]: event.target.value })} className={`rounded border border-border bg-elevated px-1.5 py-0.5 text-[11px] text-text-primary ${width}`} />;
  return <div key={`${found.kind}:${found.pos}`} data-testid="block-field-controls" className="absolute z-40 flex flex-wrap items-center gap-1 rounded-lg border border-border bg-surface p-1 text-[11px] shadow-xl" style={{ left: found.left, top: found.top }}>
    {found.kind === 'messageBubble' ? <>
      {(['received', 'sent'] as const).map(side => <button key={side} type="button" data-testid={`block-field-side-${side}`} aria-pressed={found.attrs.side === side} onMouseDown={event => event.preventDefault()} onClick={() => set({ side })}
        className={`rounded px-1.5 py-0.5 ${found.attrs.side === side ? 'bg-accent-gold/20 text-accent-gold' : 'text-text-muted hover:text-text-primary'}`}>{side === 'sent' ? (es ? 'Enviado' : 'Sent') : (es ? 'Recibido' : 'Received')}</button>)}
      {input('sender', es ? 'Quién lo envía' : 'Sender', 'w-32')}
    </> : <>
      {input('from', es ? 'De' : 'From', 'w-28')}
      {input('to', es ? 'Para' : 'To', 'w-28')}
      {input('subject', es ? 'Asunto' : 'Subject', 'w-40')}
      {input('date', es ? 'Fecha' : 'Date', 'w-24')}
    </>}
  </div>;
}
