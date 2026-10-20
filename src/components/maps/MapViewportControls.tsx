import { useEffect, useRef, type RefObject } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { useControls } from 'react-zoom-pan-pinch';
import { useTranslation } from '@/i18n/useTranslation';
import { mapFeatureCopy } from './mapFeatureCopy';

export default function MapViewportControls({ mapRef, imageWidth, imageHeight }: { mapRef: RefObject<HTMLDivElement | null>; imageWidth: number; imageHeight: number }) {
  const controls = useControls();
  const latest = useRef(controls);
  const { locale } = useTranslation(); const copy = mapFeatureCopy[locale];
  useEffect(() => { latest.current = controls; });
  const fit = () => {
    const content = mapRef.current, wrapper = content?.closest<HTMLElement>('.react-transform-wrapper');
    if (!content || !wrapper || !content.offsetWidth || !content.offsetHeight) return;
    const scale = Math.max(.05, Math.min(5, wrapper.clientWidth / content.offsetWidth, wrapper.clientHeight / content.offsetHeight) * .96);
    latest.current.centerView(scale, 0);
  };
  useEffect(() => {
    const content = mapRef.current, wrapper = content?.closest<HTMLElement>('.react-transform-wrapper');
    if (!content || !wrapper) return;
    const observer = new ResizeObserver(() => {
      if (!content.offsetWidth || !content.offsetHeight) return;
      const scale = Math.max(.05, Math.min(5, wrapper.clientWidth / content.offsetWidth, wrapper.clientHeight / content.offsetHeight) * .96);
      latest.current.centerView(scale, 0);
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [mapRef, imageWidth, imageHeight]);
  return <div className="absolute right-3 top-3 z-10 flex gap-1 rounded-lg border border-border bg-surface/95 p-1 shadow-sm" role="group" aria-label={copy.fit}>
    <button type="button" title={copy.zoomOut} aria-label={copy.zoomOut} className="rounded p-2 text-text-primary hover:bg-elevated" onClick={() => controls.zoomOut()}><Minus size={16} /></button>
    <button type="button" title={copy.fit} aria-label={copy.fit} className="rounded p-2 text-text-primary hover:bg-elevated" onClick={fit} data-testid="map-fit-view"><Maximize2 size={16} /></button>
    <button type="button" title={copy.zoomIn} aria-label={copy.zoomIn} className="rounded p-2 text-text-primary hover:bg-elevated" onClick={() => controls.zoomIn()}><Plus size={16} /></button>
  </div>;
}
