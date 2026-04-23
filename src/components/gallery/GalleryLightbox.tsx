// ============================================
// GalleryLightbox — fullscreen image viewer with linked-entity chips
// ============================================
//
// Extracted from `InspirationGallery` (previously ~40 LOC of inline JSX).
// Renders a dismissible fullscreen image with optional chips for the codex
// entries the image is linked to. Kept deliberately dumb — it knows nothing
// about the gallery's state, just how to show one image.

import { X } from 'lucide-react';
import type { InspirationImage, CodexEntry } from '@/types';
import { codexTypeIcons, codexTypeColors } from '@/components/codex/codexTypeMeta';

interface GalleryLightboxProps {
  image: InspirationImage;
  linkedEntries: CodexEntry[];
  onClose: () => void;
}

export default function GalleryLightbox({ image, linkedEntries, onClose }: GalleryLightboxProps) {
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
