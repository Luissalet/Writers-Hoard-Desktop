// Width and frame for the image selected in the editor, in a small bar over it.
import { useEffect, useState, type RefObject } from 'react';
import type { Editor } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { IMAGE_FRAMES, IMAGE_WIDTHS } from './extensions';

export default function ImageControls({ editor, wrapperRef, locale }: { editor: Editor | null; wrapperRef: RefObject<HTMLDivElement | null>; locale: string }) {
  const [state, setState] = useState<{ left: number; top: number; width: string | null; frame: string | null } | null>(null);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const update = () => {
      const selection = editor.state.selection;
      if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'image' || !wrapperRef.current || !editor.isEditable) { setState(null); return; }
      const dom = editor.view.nodeDOM(selection.from) as HTMLElement | null;
      if (!dom) { setState(null); return; }
      const box = dom.getBoundingClientRect(), host = wrapperRef.current.getBoundingClientRect();
      setState({ left: Math.max(4, box.left - host.left), top: Math.max(4, box.top - host.top - 40), width: selection.node.attrs.width ?? null, frame: selection.node.attrs.frame ?? null });
    };
    editor.on('selectionUpdate', update); editor.on('transaction', update);
    return () => { editor.off('selectionUpdate', update); editor.off('transaction', update); };
  }, [editor, wrapperRef]);
  if (!editor || !state) return null;
  const set = (attrs: Record<string, string | null>) => editor.chain().focus().updateAttributes('image', attrs).run();
  const frameLabel = (frame: string) => (locale === 'en' ? { none: 'No frame', border: 'Border', rounded: 'Rounded', polaroid: 'Polaroid' } : { none: 'Sin marco', border: 'Borde', rounded: 'Redondeada', polaroid: 'Polaroid' })[frame as 'none'];
  return <div data-testid="image-controls" className="absolute z-40 flex flex-wrap items-center gap-1 rounded-lg border border-border bg-surface p-1 text-[11px] shadow-xl" style={{ left: state.left, top: state.top }} onMouseDown={event => event.preventDefault()}>
    {IMAGE_WIDTHS.map(width => <button key={width} type="button" data-testid={`image-width-${width}`} aria-pressed={state.width === width} onClick={() => set({ width: state.width === width ? null : width })} className={`rounded px-1.5 py-0.5 ${state.width === width ? 'bg-accent-gold/20 text-accent-gold' : 'text-text-muted hover:text-text-primary'}`}>{width === 'page' ? '↔' : `${width}%`}</button>)}
    <span className="mx-1 h-4 w-px bg-border" />
    {IMAGE_FRAMES.map(frame => <button key={frame} type="button" data-testid={`image-frame-${frame}`} aria-pressed={(state.frame ?? 'none') === frame} onClick={() => set({ frame: frame === 'none' ? null : frame })} className={`rounded px-1.5 py-0.5 ${(state.frame ?? 'none') === frame ? 'bg-accent-gold/20 text-accent-gold' : 'text-text-muted hover:text-text-primary'}`}>{frameLabel(frame)}</button>)}
  </div>;
}
