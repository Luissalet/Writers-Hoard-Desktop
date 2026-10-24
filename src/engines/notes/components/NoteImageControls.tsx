import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Editor } from '@tiptap/core';
import { NodeSelection, type SelectionBookmark, type Transaction } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { ReplaceStep } from '@tiptap/pm/transform';
import { Image as ImageIcon } from 'lucide-react';
import GalleryAssetPicker from '@/components/gallery/GalleryAssetPicker';
import { readFileAsDataUrl } from '@/components/gallery/prepareImportFile';
import { IMAGE_ALIGNS, ensureNoteImageLayout, isInlineRaster } from '@/components/editor/blocks/imageLayout';
import { db } from '@/db';
import { useTranslation } from '@/i18n/useTranslation';
import { GLOBAL_NOTES_SCOPE } from '../types';

/** Hosts advance epoch synchronously before Save/Cancel, before any async IO. */
export interface NoteImageActivity { epoch: number; blocked: boolean }
interface Ticket { id: number; epoch: number; editor: Editor; abort: AbortController; bookmark: SelectionBookmark; position?: number; src?: string; alt?: unknown; title?: unknown }

export default function NoteImageControls({ editor, owner, projectId, activity }: { editor: Editor | null; owner: string; projectId: string; activity: RefObject<NoteImageActivity> }) {
  const { t } = useTranslation(), input = useRef<HTMLInputElement>(null), ticket = useRef<Ticket | null>(null), serial = useRef(0), mounted = useRef(false), acquiring = useRef(false);
  const [menu, setMenu] = useState(false), [gallery, setGallery] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(false), [selected, setSelected] = useState<string | null | false>(false);
  const cancel = () => { ticket.current?.abort.abort(); ticket.current = null; acquiring.current = false; setBusy(false); setMenu(false); setGallery(false); };
  const valid = (current: Ticket) => mounted.current && ticket.current === current && activity.current.epoch === current.epoch && !activity.current.blocked && !current.abort.signal.aborted && !current.editor.isDestroyed && current.editor.isEditable && current.editor.view.dom.isConnected && !current.editor.view.dom.closest('[inert],[hidden],[aria-hidden="true"]');
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; ticket.current?.abort.abort(); ticket.current = null; acquiring.current = false; };
  }, [owner, editor]);
  useEffect(() => {
    if (!editor) return;
    const fileInput = input.current, canceled = () => { cancel(); editor.view.focus(); };
    fileInput?.addEventListener('cancel', canceled);
    const update = ({ transaction }: { transaction: Transaction }) => {
      const current = ticket.current;
      if (current && transaction.docChanged) {
        current.bookmark = current.bookmark.map(transaction.mapping);
        if (current.position !== undefined) {
          let position = current.position, removed = false;
          for (let index = 0; index < transaction.mapping.maps.length; index++) {
            const mapped = transaction.mapping.maps[index].mapResult(position, 1);
            if (mapped.deleted) {
              // setNodeMarkup on a leaf is a ReplaceStep too. Admit precisely a
              // layout edit of this node; deletion must never fall onto a twin.
              const step = transaction.steps[index], before = transaction.docs[index].nodeAt(position);
              const after = step instanceof ReplaceStep && step.slice.content.childCount === 1 ? step.slice.content.firstChild : null;
              const layoutOnly = before?.type.name === 'image' && after?.type.name === 'image' && step instanceof ReplaceStep && step.from === position && step.to === position + before.nodeSize && ['width', 'frame', 'align'].some(key => before.attrs[key] !== after.attrs[key]) && Object.keys(before.attrs).every(key => ['width', 'frame', 'align'].includes(key) || before.attrs[key] === after.attrs[key]);
              if (!layoutOnly) { removed = true; break; }
            } else position = mapped.pos;
          }
          const node = transaction.doc.nodeAt(position);
          if (removed || node?.type.name !== 'image' || node.attrs.src !== current.src || node.attrs.alt !== current.alt || node.attrs.title !== current.title) cancel();
          else current.position = position;
        }
      }
      const selection = editor.state.selection;
      setSelected(selection instanceof NodeSelection && selection.node.type.name === 'image' ? selection.node.attrs.align ?? null : false);
      if (editor.view.dom.querySelector('img[data-wh-align]')) ensureNoteImageLayout(editor.view.dom.ownerDocument);
    };
    editor.on('transaction', update);
    // The control can mount after a selection was already established.
    update({ transaction: editor.state.tr });
    return () => { editor.off('transaction', update); fileInput?.removeEventListener('cancel', canceled); };
  }, [editor]);
  if (!editor) return null;
  const begin = (replace: boolean) => {
    cancel(); setError(false);
    if (activity.current.blocked || editor.isDestroyed || !editor.isEditable) return;
    const selection = editor.state.selection;
    if (replace && (!(selection instanceof NodeSelection) || selection.node.type.name !== 'image')) return;
    ticket.current = { id: ++serial.current, epoch: activity.current.epoch, editor, abort: new AbortController(), bookmark: selection.getBookmark(), ...(replace && selection instanceof NodeSelection ? { position: selection.from, src: selection.node.attrs.src, alt: selection.node.attrs.alt, title: selection.node.attrs.title } : {}) };
    setMenu(true);
  };
  const load = async (current: Ticket, source: () => Promise<{ src: string; alt: string }>) => {
    acquiring.current = true; setBusy(true); setMenu(false); setError(false);
    try {
      const image = await source(); if (!valid(current)) return;
      if (!isInlineRaster(image.src)) throw Error('raster');
      const decoded = new (editor.view.dom.ownerDocument.defaultView!.Image)(); decoded.src = image.src;
      await decoded.decode(); if (!valid(current)) return;
      if (!decoded.naturalWidth || !decoded.naturalHeight) throw Error('decode');
      const tr = closeHistory(editor.state.tr);
      if (current.position !== undefined) {
        const node = tr.doc.nodeAt(current.position);
        if (node?.type.name !== 'image' || node.attrs.src !== current.src || node.attrs.alt !== current.alt || node.attrs.title !== current.title) return;
        tr.setNodeMarkup(current.position, undefined, { ...node.attrs, src: image.src });
        tr.setSelection(NodeSelection.create(tr.doc, current.position));
      } else {
        tr.setSelection(current.bookmark.resolve(tr.doc));
        tr.replaceSelectionWith(editor.schema.nodes.image.create({ src: image.src, alt: image.alt, width: '100', frame: null, align: 'left' }));
      }
      // Clear before dispatch, so the command does not invalidate its own ticket.
      ticket.current = null; editor.view.dispatch(tr.scrollIntoView()); editor.view.dispatch(closeHistory(editor.state.tr));
      ensureNoteImageLayout(editor.view.dom.ownerDocument); editor.view.focus();
    } catch {
      if (valid(current)) { setError(true); editor.view.focus(); }
    } finally {
      if (mounted.current && (ticket.current === current || ticket.current === null)) { ticket.current = null; acquiring.current = false; setBusy(false); }
    }
  };
  const change = (attrs?: Record<string, string>) => {
    cancel(); const selection = editor.state.selection;
    if (activity.current.blocked || !(selection instanceof NodeSelection) || selection.node.type.name !== 'image') return;
    const tr = closeHistory(editor.state.tr);
    if (attrs) tr.setNodeMarkup(selection.from, undefined, { ...selection.node.attrs, ...attrs });
    else tr.delete(selection.from, selection.to);
    editor.view.dispatch(tr); editor.view.dispatch(closeHistory(editor.state.tr)); editor.view.focus();
  };
  const cls = 'rounded px-2 py-1 text-xs text-text-muted hover:bg-elevated hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50';
  return <span className="flex flex-wrap items-center gap-1" data-note-image-controls aria-busy={busy}>
    <button type="button" className={cls} disabled={activity.current.blocked} aria-expanded={menu} onMouseDown={event => event.preventDefault()} onClick={() => menu ? cancel() : begin(false)}><ImageIcon size={14} className="mr-1 inline" aria-hidden="true"/>{t('notes.image')}</button>
    {selected !== false && <>
      {IMAGE_ALIGNS.map(align => <button key={align} type="button" className={cls} disabled={activity.current.blocked} aria-pressed={selected === align} onMouseDown={event => event.preventDefault()} onClick={() => change({ align })}>{t(`notes.imageAlign.${align}`)}</button>)}
      <button type="button" className={cls} disabled={activity.current.blocked} onMouseDown={event => event.preventDefault()} onClick={() => begin(true)}>{t('notes.imageReplace')}</button>
      <button type="button" className={cls} disabled={activity.current.blocked} onMouseDown={event => event.preventDefault()} onClick={() => change()}>{t('notes.imageRemove')}</button>
    </>}
    {menu && <span role="group" aria-label={t('notes.image')} className="flex flex-wrap items-center gap-1 rounded border border-border px-1">
      <button type="button" className={cls} onClick={() => input.current?.click()}>{t('notes.imageFile')}</button>
      {projectId !== GLOBAL_NOTES_SCOPE && <button type="button" className={cls} onClick={() => { setMenu(false); setGallery(true); }}>{t('notes.imageGallery')}</button>}
      <button type="button" className={cls} onClick={() => { cancel(); editor.view.focus(); }}>{t('common.cancel')}</button>
    </span>}
    {busy && <><span role="status" className="text-xs text-text-muted">{t('notes.imageLoading')}</span><button type="button" className={cls} onClick={() => { cancel(); editor.view.focus(); }}>{t('common.cancel')}</button></>}
    {error && <span role="alert" className="text-xs text-danger">{t('notes.imageError')}</span>}
    <input ref={input} type="file" className="sr-only" tabIndex={-1} aria-label={t('notes.imageFile')} accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp" onChange={event => {
      const file = event.target.files?.[0], current = ticket.current; event.target.value = '';
      if (!file || !current) { cancel(); return; }
      void load(current, async () => ({ src: await readFileAsDataUrl(file, current.abort.signal), alt: file.name }));
    }}/>
    {gallery && ticket.current && <GalleryAssetPicker key={`${owner}:${ticket.current.id}`} projectId={projectId} open onClose={() => { setGallery(false); if (!acquiring.current) { cancel(); editor.view.focus(); } }} onSelect={selection => {
      const current = ticket.current; if (!current) return;
      void load(current, async () => { const row = await db.inspirationImages.get(selection.id); if (!valid(current)) throw Error('expired'); if (!row || row.projectId !== projectId) throw Error('owner'); return { src: row.imageDataOriginal || row.imageData, alt: row.notes || row.tags.join(', ') || t('notes.image') }; });
    }}/>}
  </span>;
}
