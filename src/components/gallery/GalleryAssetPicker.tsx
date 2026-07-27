import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { Image, Loader2 } from 'lucide-react';
import { db } from '@/db';
import Modal from '@/components/common/Modal';
import type { InspirationImage } from '@/types';
import { useTranslation } from '@/i18n/useTranslation';

export interface GalleryAssetSelection {
  id: string;
  imageData: string;
  imageDataOriginal: string;
}

export default function GalleryAssetPicker({
  projectId,
  open,
  onClose,
  onSelect,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onSelect: (selection: GalleryAssetSelection) => void;
}) {
  const { t } = useTranslation();
  const [images, setImages] = useState<InspirationImage[] | null>(null);
  useEffect(() => {
    if (!open) return;
    const subscription = liveQuery(() =>
      db.inspirationImages.where('projectId').equals(projectId).reverse().sortBy('createdAt'),
    ).subscribe({
      next: setImages,
      error: error => {
        console.error('Gallery assets could not be loaded', error);
        setImages([]);
      },
    });
    return () => subscription.unsubscribe();
  }, [open, projectId]);

  return (
    <Modal open={open} onClose={onClose} title={t('gallery.assetPicker.title')}>
      <div className="min-h-56 max-w-3xl">
        {!images ? (
          <div className="flex min-h-56 items-center justify-center">
            <Loader2 className="animate-spin text-accent-gold" />
          </div>
        ) : images.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center text-center">
            <Image className="text-text-dim" size={32} />
            <p className="mt-3 text-sm text-text-muted">{t('gallery.assetPicker.empty')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {images.map(image => (
              <button
                key={image.id}
                type="button"
                onClick={() => {
                  onSelect({
                    id: image.id,
                    imageData: image.imageData,
                    imageDataOriginal: image.imageDataOriginal || image.imageData,
                  });
                  onClose();
                }}
                className="group overflow-hidden rounded-lg border border-border bg-background text-left transition hover:border-accent-gold"
              >
                <img src={image.thumbnailData || image.imageData} alt="" className="aspect-square w-full object-cover" />
                <span className="block truncate px-2 py-1.5 text-xs text-text-muted">
                  {image.notes || image.tags.join(', ') || t('gallery.assetPicker.image')}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
