import { useState } from 'react';
import { Ruler } from 'lucide-react';
import type { MapPin, MapPoint } from '@/types';
import { useTranslation } from '@/i18n/useTranslation';
import { SCALE_REFERENCES } from '@/engines/worldgen/core/scaleReference';
import MapTravelReadout from './MapTravelReadout';
import { formatKm, lineLengthKm, matchMapKey, MAP_WIDTH_KM_RANGE, parseMapKey, validWidthKm, type KeyMatch } from './mapScale';
import { mapScaleCopy } from './mapScaleCopy';

interface Props {
  widthKm?: number;
  aspect: number;
  readOnly: boolean;
  onSetScale?: (widthKm: number | undefined) => Promise<void> | void;
  measure: MapPoint[] | null;
  onMeasure: (points: MapPoint[] | null) => void;
  realId: string;
  onRealId: (id: string) => void;
  realSize: { widthKm: number; heightKm: number } | null;
  pins: MapPin[];
  onRenamePins?: (matches: KeyMatch[]) => Promise<void>;
}

const field = 'rounded-md border border-border bg-deep px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-accent-gold';
const button = 'inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-50';

/** Scale, measuring, real places at the same scale and a pasted key for a classic map. */
export default function MapScalePanel({ widthKm, aspect, readOnly, onSetScale, measure, onMeasure, realId, onRealId, realSize, pins, onRenamePins }: Props) {
  const { t, locale } = useTranslation();
  const copy = mapScaleCopy[locale === 'en' ? 'en' : 'es'];
  const [width, setWidth] = useState('');
  const [known, setKnown] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [keyText, setKeyText] = useState('');
  const [preview, setPreview] = useState<ReturnType<typeof matchMapKey> | null>(null);
  const [named, setNamed] = useState<number | null>(null);
  // The controls are only built while the panel is open, so a closed panel adds no fields to the page.
  const [open, setOpen] = useState(false);
  const save = async (km: number | undefined) => {
    if (!onSetScale || busy) return;
    setBusy(true); setFailed(false);
    try { await onSetScale(km); setWidth(''); setKnown(''); }
    catch { setFailed(true); }
    finally { setBusy(false); }
  };
  const typed = Number(width.replace(',', '.'));
  const knownKm = Number(known.replace(',', '.'));
  const units = measure && measure.length > 1 ? lineLengthKm(measure, 1, aspect) : 0;
  const measuredKm = widthKm && units ? units * widthKm : null;
  return <details className="rounded-lg border border-border px-3 py-2 text-xs text-text-muted" data-testid="map-scale-panel" onToggle={event => { const now = event.currentTarget.open; setOpen(now); if (!now && measure) onMeasure(null); }}>
    <summary className="cursor-pointer select-none"><Ruler size={12} className="mr-1 inline" />{copy.panel}{widthKm ? ` · ${formatKm(widthKm, locale)}` : ''}</summary>
    {open && <div className="mt-3 grid gap-4 lg:grid-cols-3">
      <section className="space-y-2">
        <p data-testid="map-scale-status">{widthKm ? copy.scaleIs.replace('{km}', formatKm(widthKm, locale)) : copy.noScale}</p>
        {!readOnly && onSetScale && <div className="flex flex-wrap items-end gap-2">
          <label className="block">{copy.widthKm}<input type="number" inputMode="decimal" min={MAP_WIDTH_KM_RANGE.min} max={MAP_WIDTH_KM_RANGE.max} step="any" value={width} onChange={event => setWidth(event.target.value)} className={`${field} mt-1 block w-36`} data-testid="map-scale-width" /></label>
          <button type="button" className={button} disabled={busy || !validWidthKm(typed)} onClick={() => void save(typed)} data-testid="map-scale-set">{copy.setScale}</button>
          {widthKm && <button type="button" className={button} disabled={busy} onClick={() => void save(undefined)} data-testid="map-scale-clear">{copy.clearScale}</button>}
        </div>}
        {failed && <p role="alert" className="text-danger">{copy.failed}</p>}
      </section>
      <section className="space-y-2">
        <button type="button" className={button} aria-pressed={!!measure} onClick={() => onMeasure(measure ? null : [])} data-testid="map-measure-toggle"><Ruler size={13} />{measure ? copy.stopMeasure : copy.measure}</button>
        {measure && <>
          <p>{copy.measureHelp}</p>
          {measure.length < 2 ? <p>{copy.needTwo}</p> : <>
            {measuredKm !== null && <p className="text-sm text-text-primary">{copy.measured}: <strong data-testid="map-measure-km" data-km={measuredKm.toFixed(3)}>{formatKm(measuredKm, locale)}</strong></p>}
            {measuredKm !== null && <div><p className="mb-1 text-[10px] uppercase tracking-wide">{copy.travel}</p><MapTravelReadout km={measuredKm} testId="map-measure-travel" /></div>}
            {!readOnly && onSetScale && <div className="flex flex-wrap items-end gap-2"><label className="block">{copy.knownIs}<input type="number" inputMode="decimal" min={0} step="any" value={known} onChange={event => setKnown(event.target.value)} className={`${field} mt-1 block w-28`} data-testid="map-measure-known" /></label><span className="pb-2">km</span>
              <button type="button" className={button} disabled={busy || !(knownKm > 0) || !validWidthKm(knownKm / units)} onClick={() => void save(knownKm / units)} data-testid="map-measure-calibrate">{copy.calibrate}</button></div>}
          </>}
          <button type="button" className={button} disabled={!measure.length} onClick={() => onMeasure([])} data-testid="map-measure-clear">{copy.clearMeasure}</button>
        </>}
      </section>
      <section className="space-y-2">
        <label className="block">{copy.realPlace}<select value={realId} disabled={!widthKm} onChange={event => onRealId(event.target.value)} className={`${field} mt-1 block w-full`} data-testid="map-real-place"><option value="">{copy.realNone}</option>{SCALE_REFERENCES.map(ref => <option key={ref.id} value={ref.id}>{t(`worldgen.scaleRef.${ref.id}`)}</option>)}</select></label>
        {!widthKm && <p>{copy.realNeedsScale}</p>}
        {realId && realSize && <p data-testid="map-real-size">{copy.realSize.replace('{w}', formatKm(realSize.widthKm, locale)).replace('{h}', formatKm(realSize.heightKm, locale))} · {copy.realHelp}</p>}
      </section>
      {!readOnly && onRenamePins && <section className="space-y-2 lg:col-span-3">
        <label className="block">{copy.key}<textarea rows={3} value={keyText} onChange={event => { setKeyText(event.target.value); setPreview(null); setNamed(null); }} className={`${field} mt-1 block w-full`} data-testid="map-key-text" /></label>
        <p className="text-[11px]">{copy.keyHelp}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={button} disabled={!keyText.trim()} onClick={() => setPreview(matchMapKey(pins, parseMapKey(keyText)))} data-testid="map-key-preview">{copy.keyPreview}</button>
          {preview && preview.matches.length > 0 && <button type="button" className={button} disabled={busy} onClick={async () => { setBusy(true); setFailed(false); try { await onRenamePins(preview.matches); setNamed(preview.matches.length); setPreview(null); setKeyText(''); } catch { setFailed(true); } finally { setBusy(false); } }} data-testid="map-key-apply">{copy.keyApply.replace('{n}', String(preview.matches.length))}</button>}
          {named !== null && <span role="status" data-testid="map-key-done">{copy.keyDone.replace('{n}', String(named))}</span>}
        </div>
        {preview && <ul className="space-y-0.5" data-testid="map-key-matches">
          {preview.matches.map(match => <li key={match.pinId}><span className="font-mono">{match.from}</span> → <span className="text-text-primary">{match.to}</span></li>)}
          {!preview.matches.length && <li>{copy.keyNone}</li>}
          {preview.unmatched.length > 0 && <li data-testid="map-key-unmatched">{copy.keyUnmatched.replace('{list}', preview.unmatched.map(line => `${line.key}. ${line.name}`).join(', '))}</li>}
        </ul>}
      </section>}
    </div>}
  </details>;
}
