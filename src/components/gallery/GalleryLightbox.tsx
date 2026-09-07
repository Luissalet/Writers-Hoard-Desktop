// ============================================
// GalleryLightbox — fullscreen image viewer with linked-entity chips
// ============================================
//
// Extracted from `InspirationGallery` (previously ~40 LOC of inline JSX).
// Renders a dismissible fullscreen image with optional chips for the codex
// entries the image is linked to. Kept deliberately dumb — it knows nothing
// about the gallery's state, just how to show one image (and, when the host
// wires `onEditNotes`, let the author caption it: `InspirationImage.notes`
// was displayed and searched everywhere but no input ever wrote it).

import { useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import type { InspirationImage, CodexEntry } from '@/types';
import { codexTypeIcons, codexTypeColors } from '@/components/codex/codexTypeMeta';
import { useTranslation } from '@/i18n/useTranslation';
import Modal from '@/components/common/Modal';

interface GalleryLightboxProps {
  image: InspirationImage;
  linkedEntries: CodexEntry[];
  onClose: () => void;
  /** Persist a new caption for this image. Omit to render read-only. */
  onEditNotes?: (notes: string) => void;
  /** Hand the image to the Image Studio as an img2img reference. Omit to hide the action. */
  onUseAsReference?: () => void;
}

export default function GalleryLightbox({ image, linkedEntries, onClose, onEditNotes, onUseAsReference }: GalleryLightboxProps) {
  const { t } = useTranslation();
  const [draftNotes, setDraftNotes] = useState(image.notes);

  const commitNotes = () => {
    const next = draftNotes.trim();
    if (onEditNotes && next !== image.notes) onEditNotes(next);
  };

  return (
    <Modal open onClose={onClose} ariaLabel={t('gallery.lightbox.title')} fullscreen>
      <div className="relative flex min-h-[70vh] flex-col items-center justify-center gap-3 px-12 py-8">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-2 right-2 p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label={t('common.close')}
          title={t('common.close')}
        >
          <X size={24} className="text-white" aria-hidden="true" />
        </button>
        <img
          src={image.imageData}
          alt={image.notes || t('gallery.lightbox.imageAlt')}
          className="max-w-[90vw] max-h-[80vh] rounded-lg shadow-2xl"
        />
        {onEditNotes ? (
          <input
            value={draftNotes}
            onChange={(e) => setDraftNotes(e.target.value)}
            onBlur={commitNotes}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            placeholder={t('gallery.imageNotes')}
            className="w-[min(90vw,28rem)] px-3 py-1.5 bg-white/10 border border-white/20 rounded-lg text-sm text-white placeholder-white/40 text-center outline-none focus:border-accent-gold transition"
          />
        ) : (
          image.notes && <p className="text-sm text-white/80 max-w-[90vw] text-center">{image.notes}</p>
        )}
        {onUseAsReference && (
          <button
            type="button"
            onClick={onUseAsReference}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-white/10 text-white/90 hover:bg-accent-gold/30 hover:text-white transition"
          >
            <ImagePlus size={12} />
            {t('gallery.useAsReference')}
          </button>
        )}
        {linkedEntries.length > 0 && (
          <div className="flex gap-2 flex-wrap justify-center">
            {linkedEntries.map((entry) => {
              const Icon = codexTypeIcons[entry.type];
              const color = codexTypeColors[entry.type];
              return (
                <span
                  key={entry.id}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full"
                  style={{ backgroundColor: `${color}30`, color }}
                >
                  <Icon size={12} />
                  {entry.title}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
