// ============================================================================
// The training-set export
// ============================================================================
//
// Writers Hoard does not train. It prepares — and the preparation is where a
// writing app has an advantage nobody else has, because the captions can be
// drafted from the prose the writer already wrote about this character.
//
// The captioning rule is on screen, not only in the README, because a writer
// meeting LoRA training for the first time will otherwise caption her eyes and
// wonder for two hours of GPU time why the trained character has new ones.

import { useMemo, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import Modal from '@/components/common/Modal';
import type { CodexEntry, InspirationImage } from '@/types';
import type { VisualRef } from '@/types/visualRef';
import { stripHtml } from '@/utils/text';
import { buildDataset, datasetTrigger, draftCaption } from '@/services/visualRef';
import { toast } from '@/components/common/toast';
import { downloadDataset } from '../datasetExport';

export interface DatasetExportDialogProps {
  open: boolean;
  visual: VisualRef;
  entry?: CodexEntry;
  images: readonly InspirationImage[];
  onClose: () => void;
}

export default function DatasetExportDialog({ open, visual, entry, images, onClose }: DatasetExportDialogProps) {
  const { t } = useTranslation();
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const trigger = datasetTrigger(visual);

  const sources = useMemo(() => {
    if (!entry) return [visual.promptFragment ?? ''];
    return [
      entry.fields.physicalDescription ?? '',
      stripHtml(entry.content ?? ''),
      visual.promptFragment ?? '',
    ];
  }, [entry, visual.promptFragment]);

  const drafted = useMemo(() => draftCaption(trigger, sources), [trigger, sources]);

  // Drafting is what the dialog is for: the writer arrives to EDIT captions,
  // not to type them, so the drafts are in the boxes when it opens. Seeded with
  // the render-adjust pattern rather than an effect (lessons.md #17): a
  // synchronous setState inside an effect cascades a second render, and the
  // writer would see empty boxes fill in a frame later.
  const seedKey = open ? `${images.map((image) => image.id).join(',')}|${drafted.caption}` : null;
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (seedKey !== null && seedKey !== seededFor) {
    setSeededFor(seedKey);
    setCaptions(Object.fromEntries(images.map((image) => [image.id, drafted.caption])));
  }

  const download = async () => {
    setBusy(true);
    try {
      const bundle = buildDataset({
        ref: visual,
        items: images.map((image) => ({
          imageId: image.id,
          dataUrl: image.imageDataOriginal ?? image.imageData,
          caption: captions[image.id] ?? drafted.caption,
        })),
      });
      await downloadDataset(bundle);
      toast.success(t('visualRef.export.done').replace('{count}', String(images.length)));
      onClose();
    } catch (error) {
      toast.error(t('visualRef.export.failed').replace('{error}', error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('visualRef.export.title')} wide>
      <div className="space-y-3">
        <p className="text-[11px] text-text-muted">{t('visualRef.export.hint')}</p>
        <p className="text-[11px] text-accent-amber">{t('visualRef.export.rule')}</p>
        <p className="text-[11px] text-text-dim">
          {t('visualRef.export.trigger')} <span className="font-mono text-accent-gold">{trigger}</span>
        </p>
        {drafted.omitted.length > 0 && (
          <p className="text-[10px] text-text-dim">
            {t('visualRef.export.omitted').replace('{words}', drafted.omitted.join(', '))}
          </p>
        )}
        {images.length === 0 ? (
          <p className="text-[11px] text-text-dim">{t('visualRef.export.empty')}</p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {images.map((image) => (
              <div key={image.id} className="flex items-start gap-2">
                <img src={image.thumbnailData ?? image.imageData} alt="" className="w-14 h-14 rounded border border-border object-cover flex-shrink-0" />
                <textarea
                  value={captions[image.id] ?? ''}
                  onChange={(event) => setCaptions((current) => ({ ...current, [image.id]: event.target.value }))}
                  rows={2}
                  className="flex-1 resize-y px-2 py-1.5 bg-elevated border border-border rounded-lg text-[11px] text-text-primary outline-none focus:border-accent-gold"
                />
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void download()}
            disabled={busy || images.length === 0}
            title={images.length === 0 ? t('visualRef.reason.noReferenceImages') : t('visualRef.export.download')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-gold text-deep text-xs font-semibold hover:bg-accent-amber transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            {t('visualRef.export.download')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
