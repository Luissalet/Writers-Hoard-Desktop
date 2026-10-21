import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { drawStamp, isStampGlyph, STAMP_CATEGORIES, STAMPS, type StampCategory, type StampGlyph, type StampSize } from '../cartography/stampGlyphs';

/** One stamp drawn exactly as the map will draw it. */
function StampPreview({ glyph, px = 26 }: { glyph: StampGlyph; px?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(px * ratio); canvas.height = Math.round(px * ratio);
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, px, px);
    drawStamp(ctx, glyph, px / 2, px / 2, { px: px * 0.72, halo: true });
  }, [glyph, px]);
  return <canvas ref={ref} style={{ width: px, height: px }} aria-hidden="true" />;
}

/**
 * The stamp library for the Point tool: categories, a grid of pictures, a size
 * and an optional name. The chosen stamp goes where the reader clicks.
 */
export default function StampPicker({ glyph, size, name, onGlyph, onSize, onName }: {
  glyph: string; size: StampSize; name: string;
  onGlyph: (glyph: StampGlyph) => void; onSize: (size: StampSize) => void; onName: (name: string) => void;
}) {
  const { t } = useTranslation();
  const current = isStampGlyph(glyph) ? glyph : 'inn';
  const [category, setCategory] = useState<StampCategory>(() => STAMPS.find((stamp) => stamp.id === current)?.category ?? 'places');
  return (
    <div className="flex flex-col gap-2" data-testid="stamp-picker">
      <div className="grid grid-cols-4 gap-1" role="tablist" aria-label={t('worldgen.stamp.categories')}>
        {STAMP_CATEGORIES.map((id) => (
          <button key={id} type="button" role="tab" aria-selected={category === id} onClick={() => setCategory(id)}
            className={`px-1 py-1 rounded text-[10px] border ${category === id ? 'bg-amber-400/25 border-amber-400/60 text-amber-100' : 'bg-black/30 border-white/10 text-white/70 hover:bg-white/10'}`}>
            {t(`worldgen.stamp.category.${id}`)}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label={t('worldgen.stamp.choose')}>
        {STAMPS.filter((stamp) => stamp.category === category).map((stamp) => (
          <button key={stamp.id} type="button" role="radio" aria-checked={current === stamp.id} data-testid={`stamp-${stamp.id}`}
            title={t(`worldgen.stamp.${stamp.id}`)} onClick={() => onGlyph(stamp.id)}
            className={`flex flex-col items-center gap-0.5 rounded border px-1 py-1 text-[9px] leading-tight ${current === stamp.id ? 'border-amber-400/70 bg-amber-400/15 text-amber-100' : 'border-white/10 bg-black/30 text-white/70 hover:bg-white/10'}`}>
            <StampPreview glyph={stamp.id} />
            <span className="truncate max-w-full">{t(`worldgen.stamp.${stamp.id}`)}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1" role="radiogroup" aria-label={t('worldgen.stamp.size')}>
        <span className="text-[10px] text-white/45 mr-1">{t('worldgen.stamp.size')}</span>
        {(['S', 'M', 'L'] as const).map((id) => (
          <button key={id} type="button" role="radio" aria-checked={size === id} onClick={() => onSize(id)} data-testid={`stamp-size-${id}`}
            className={`w-8 rounded border py-0.5 text-[10px] ${size === id ? 'border-amber-400/70 bg-amber-400/15 text-amber-100' : 'border-white/10 bg-black/30 text-white/70'}`}>{id}</button>
        ))}
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-white/45">{t('worldgen.stamp.name')}</span>
        <input value={name} onChange={(event) => onName(event.target.value)} placeholder={t('worldgen.stamp.namePlaceholder')} data-testid="stamp-name"
          className="w-full px-2 py-1 rounded bg-black/40 border border-white/15 text-[11px] text-white/90 outline-none focus:border-amber-400/60" />
      </label>
    </div>
  );
}
