// ============================================
// Scrapper Engine — Media Gallery (photo/carousel viewer)
// ============================================
//
// Renders a snapshot's downloaded media items. One item → shown directly;
// several → a carousel with prev/next and a counter. Images use <img>, videos
// use <video controls>. Files are served from disk via the wh-media:// scheme.

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { snapshotMediaUrl } from '@/services/scrapperMedia';

interface MediaGalleryProps {
  items: { relPath: string; kind: 'image' | 'video' }[];
}

export default function MediaGallery({ items }: MediaGalleryProps) {
  const [idx, setIdx] = useState(0);
  if (items.length === 0) return null;

  const safeIdx = Math.min(idx, items.length - 1);
  const current = items[safeIdx];
  const go = (delta: number) => setIdx((i) => (i + delta + items.length) % items.length);

  return (
    <div className="relative rounded-lg overflow-hidden bg-black">
      <div className="w-full max-h-[60vh] flex items-center justify-center">
        {current.kind === 'image' ? (
          <img
            src={snapshotMediaUrl(current.relPath)}
            alt=""
            className="max-h-[60vh] max-w-full object-contain"
          />
        ) : (
          <video
            key={current.relPath}
            src={snapshotMediaUrl(current.relPath)}
            controls
            className="max-h-[60vh] max-w-full object-contain"
          />
        )}
      </div>

      {items.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Anterior"
            className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Siguiente"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
          >
            <ChevronRight size={20} />
          </button>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-black/60 text-white text-xs">
            {safeIdx + 1} / {items.length}
          </div>
        </>
      )}
    </div>
  );
}
