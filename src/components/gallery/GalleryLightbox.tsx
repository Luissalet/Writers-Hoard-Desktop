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
import { X } from 'lucide-react';
import type { InspirationImage, CodexEntry } from '@/types';
import { codexTypeIcons, codexTypeColors } from '@/components/codex/codexTypeMeta';
import { useTranslation } from '@/i18n/useTranslation';

interface GalleryLightboxProps {
  image: InspirationImage;
  linkedEntries: CodexEntry[];
  onClose: () => void;
  /** Persist a new caption for this image. Omit to render read-only. */
  onEditNotes?: (notes: string) => void;
}

export default function GalleryLightbox({ image, linkedEntries, onClose, onEditNotes }: GalleryLightboxProps) {
  const { t } = useTranslation();
  const [draftNotes, setDraftNotes] = useState(image.notes);

  const commitNotes = () => {
    const next = draftNotes.trim();
    if (onEditNotes && next !== image.notes) onEditNotes(next);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        className="absolute top-4 right-4 p-2 bg-white/10 rounded-full hover:bg-white/20 transition"
        aria-label="Close"
      >
        <X size={24} className="text-white" />
      </button>
      <div className="flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        <img
          src={image.imageData}
          alt=""
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
    </div>
  );
}
