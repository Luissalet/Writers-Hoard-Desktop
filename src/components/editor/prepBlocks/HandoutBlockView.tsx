import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { lazy, Suspense, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ImagePlus, Pencil, ScrollText } from 'lucide-react';
import { db } from '@/db';
import { useTranslation } from '@/i18n/useTranslation';
import GalleryAssetPicker from '@/components/gallery/GalleryAssetPicker';
import { handoutText, normalizeHandout, whileTyping } from '@/engines/prepBlocks/model';
import type { CodexBlockHost } from '../codexBlocks/model';
import { prepCopy } from './copy';
import { prepBoxClass, prepButtonClass, prepFieldClass, usePrepEditable, usePrepProject } from './shared';

const HandoutStudio = lazy(() => import('./HandoutStudio'));

export default function HandoutBlockView({ node, updateAttributes, extension, editor, selected }: NodeViewProps) {
  const { locale } = useTranslation(), lang = locale === 'en' ? 'en' : 'es', c = prepCopy[lang];
  const projectId = usePrepProject(extension.options as CodexBlockHost);
  const data = whileTyping(() => normalizeHandout(node.attrs.data)), editable = usePrepEditable(editor);
  const [picking, setPicking] = useState(false), [studio, setStudio] = useState<'new' | 'edit' | null>(null);
  const image = useLiveQuery(async () => (data.imageId && projectId ? (await db.inspirationImages.get(data.imageId)) ?? null : null), [data.imageId, projectId]);
  const set = (patch: Partial<typeof data>) => updateAttributes({ data: { ...data, ...patch } });
  const shown = image && image.projectId === projectId ? image : null;
  return <NodeViewWrapper as="figure" contentEditable={false} data-testid="prep-handout" data-prep-kind="handout" className={prepBoxClass(selected)}>
    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{c.handout}</p>
    <div className="flex flex-wrap gap-3">
      <div className="flex h-28 w-36 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-deep">
        {shown ? <img src={shown.thumbnailData || shown.imageData} alt={data.label || shown.name || c.handout} className="max-h-full max-w-full object-contain" data-testid="prep-handout-image" /> : <ScrollText size={28} className="text-text-muted" aria-hidden="true" />}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {editable ? <>
          <input className={`${prepFieldClass} w-full`} aria-label={c.handoutLabel} placeholder={c.handoutLabel} data-testid="prep-handout-label" value={data.label} onChange={event => set({ label: event.target.value })} />
          <input className={`${prepFieldClass} w-full`} aria-label={c.handoutWhen} placeholder={c.handoutWhen} data-testid="prep-handout-when" value={data.when} onChange={event => set({ when: event.target.value })} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={prepButtonClass} data-testid="prep-handout-pick" disabled={!projectId} onClick={() => setPicking(true)}><ImagePlus size={14} aria-hidden="true" />{c.chooseImage}</button>
            <button type="button" className={prepButtonClass} data-testid="prep-handout-template" disabled={!projectId} onClick={() => setStudio('new')}><ScrollText size={14} aria-hidden="true" />{c.fromTemplate}</button>
            {shown?.handout && <button type="button" className={prepButtonClass} data-testid="prep-handout-edit" onClick={() => setStudio('edit')}><Pencil size={14} aria-hidden="true" />{c.editHandout}</button>}
          </div>
        </> : <p className="text-sm text-text-primary">{handoutText(data)}</p>}
        {data.imageId && image === null && <p className="text-xs text-text-muted" data-testid="prep-handout-missing">{c.missingImage}</p>}
        {!data.imageId && <p className="text-xs text-text-muted">{c.noImage}</p>}
      </div>
    </div>
    {editable && projectId && <GalleryAssetPicker projectId={projectId} open={picking} onClose={() => setPicking(false)} onSelect={selection => { setPicking(false); void db.inspirationImages.get(selection.id).then(row => set({ imageId: selection.id, label: data.label || row?.name || '' })); }} />}
    {studio && projectId && <Suspense fallback={null}><HandoutStudio open projectId={projectId} lang={lang} existingId={studio === 'edit' ? data.imageId : undefined} onClose={() => setStudio(null)} onSaved={(imageId, title) => { setStudio(null); set({ imageId, label: data.label || title }); }} /></Suspense>}
  </NodeViewWrapper>;
}
