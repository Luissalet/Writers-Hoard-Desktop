import { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { routeFogEdits } from '../core/readerFog';
import type { WorldEdit } from '../core/edits';

/**
 * "Paint in as they travel": mark the ground along this route as seen on the
 * reader's-eye map, within a sight radius, from a chapter on.
 */
export default function RouteReveal({ cells, worldWidth, cellKm, onReveal }: {
  cells: readonly number[];
  worldWidth: number;
  /** Km one cell measures (a sheet's own, or the planet's). */
  cellKm?: number;
  onReveal: (edits: WorldEdit[]) => void;
}) {
  const { t } = useTranslation();
  const [km, setKm] = useState(30);
  const [chapter, setChapter] = useState('');
  const [done, setDone] = useState(false);
  const kmPerCell = cellKm ?? 40075 / Math.max(1, worldWidth);
  const reveal = () => {
    const n = chapter.trim() === '' ? null : Math.max(0, Math.floor(Number(chapter)));
    const edits = routeFogEdits(cells, worldWidth, Math.max(0.5, km / kmPerCell), n !== null && Number.isFinite(n) ? n : null);
    if (!edits.length) return;
    onReveal(edits);
    setDone(true);
  };
  return (
    <div className="mt-2 rounded bg-white/[0.05] px-2 py-1.5 text-[10px] text-white/60" data-testid="journey-reveal">
      <div className="mb-1 font-semibold uppercase tracking-wider text-white/50">{t('worldgen.journey.reveal.title')}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="flex items-center gap-1">
          {t('worldgen.journey.reveal.sight')}
          <input type="number" min={1} max={2000} step={1} value={km} data-testid="journey-reveal-km"
            onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 1 && v <= 2000) { setKm(v); setDone(false); } }}
            className="w-14 rounded bg-white/10 px-1 py-0.5 text-right text-white tabular-nums" /> km
        </label>
        <label className="flex items-center gap-1">
          {t('worldgen.journey.reveal.chapter')}
          <input type="number" min={0} step={1} value={chapter} placeholder={t('worldgen.paint.fog.chapterAlways')} data-testid="journey-reveal-chapter"
            onChange={(e) => { setChapter(e.target.value); setDone(false); }}
            className="w-16 rounded bg-white/10 px-1 py-0.5 text-right text-white tabular-nums" />
        </label>
        <button type="button" onClick={reveal} data-testid="journey-reveal-go"
          className="ml-auto rounded bg-amber-400/85 px-2 py-0.5 text-[10px] font-medium text-black hover:bg-amber-300">
          {t('worldgen.journey.reveal.go')}
        </button>
      </div>
      {done && <div className="mt-1 text-emerald-300/80" role="status">{t('worldgen.journey.reveal.done')}</div>}
    </div>
  );
}
