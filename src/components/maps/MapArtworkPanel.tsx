import { useState } from 'react';
import { Layers } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { MapAmbience, MapArtwork } from '@/types';
import { db } from '@/db';
import { useTranslation } from '@/i18n/useTranslation';
import { mediaKind } from '@/engines/media/types';
import { MAP_ARTWORK_LAYERS, MAP_ARTWORK_LIMITS, isMapRaster, validateMapArtwork, type MapArtworkLayer } from '@/engines/maps/mapArtwork';
import { mapArtworkCopy } from './mapArtworkCopy';

interface Props {
  projectId: string;
  artwork?: MapArtwork;
  ambience?: MapAmbience;
  readOnly: boolean;
  onChange: (change: { artwork?: MapArtwork; ambience?: MapAmbience }) => Promise<void> | void;
}

const field = 'rounded-md border border-border bg-deep px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-accent-gold';
const button = 'inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-50';

/** Optional illustration layers, cloud switch and ambience of a map, for the exported wiki. */
export default function MapArtworkPanel({ projectId, artwork, ambience, readOnly, onChange }: Props) {
  const { locale } = useTranslation();
  const copy = mapArtworkCopy[locale === 'en' ? 'en' : 'es'];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sounds = useLiveQuery(async () => open ? (await db.localMediaAssets.where('projectId').equals(projectId).toArray()).filter(asset => mediaKind(asset.mime) === 'audio').map(asset => ({ id: asset.id, title: asset.title })) : [], [projectId, open], []);
  const run = async (work: () => Promise<void> | void) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await work(); } catch { setError(copy.failed); } finally { setBusy(false); }
  };
  const save = (next: MapArtwork) => run(() => onChange({ artwork: Object.keys(next).length ? next : undefined }));
  const pick = (layer: MapArtworkLayer, file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const picture = reader.result;
      if (!isMapRaster(picture)) { setError(copy.notImage); return; }
      try { void save(validateMapArtwork({ ...(artwork ?? {}), [layer]: picture })); setError(''); } catch (failure) { setError(failure instanceof Error && failure.message === 'map_artwork_too_large' ? copy.tooBig : copy.notImage); }
    };
    reader.readAsDataURL(file);
  };
  const present = MAP_ARTWORK_LAYERS.filter(layer => artwork?.[layer]).length;
  return <details className="rounded-lg border border-border px-3 py-2 text-xs text-text-muted" data-testid="map-artwork-panel" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer select-none"><Layers size={12} className="mr-1 inline" />{copy.panel}{present ? ` · ${present}` : ''}{ambience ? ' · ♪' : ''}</summary>
    {open && <div className="mt-3 space-y-3">
      <p>{copy.help}</p>
      <div className="grid gap-3 md:grid-cols-3">
        {MAP_ARTWORK_LAYERS.map(layer => <section key={layer} className="space-y-2" data-testid={`map-artwork-${layer}`}>
          <p className="text-text-primary">{copy[layer]}</p>
          {artwork?.[layer] ? <img src={artwork[layer]} alt={copy.preview} className="h-20 w-full rounded border border-border object-cover" data-testid={`map-artwork-${layer}-preview`} /> : <p>{copy.none}</p>}
          {!readOnly && <div className="flex flex-wrap gap-2">
            <label className={`${button} cursor-pointer`}>{artwork?.[layer] ? copy.replace : copy.choose}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" className="sr-only" disabled={busy} data-testid={`map-artwork-${layer}-file`} onChange={event => { pick(layer, event.target.files?.[0]); event.target.value = ''; }} /></label>
            {artwork?.[layer] && <button type="button" className={button} disabled={busy} data-testid={`map-artwork-${layer}-remove`} onClick={() => { const next = { ...artwork }; delete next[layer]; void save(next); }}>{copy.remove}</button>}
          </div>}
        </section>)}
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <label className="inline-flex items-center gap-2 text-text-primary"><input type="checkbox" className="accent-accent-gold" disabled={readOnly || busy} checked={artwork?.clouds === true} data-testid="map-artwork-clouds" onChange={event => void save({ ...(artwork ?? {}), clouds: event.target.checked || undefined })} />{copy.clouds}</label>
        <label className="block">{copy.ambience}
          <select className={`${field} mt-1 block w-56`} disabled={readOnly || busy} value={ambience?.assetId ?? ''} data-testid="map-ambience-select" onChange={event => void run(() => onChange({ ambience: event.target.value ? { assetId: event.target.value, volume: ambience?.volume } : undefined }))}>
            <option value="">{copy.noAmbience}</option>
            {ambience && !(sounds ?? []).some(sound => sound.id === ambience.assetId) && <option value={ambience.assetId}>{ambience.assetId}</option>}
            {(sounds ?? []).map(sound => <option key={sound.id} value={sound.id}>{sound.title}</option>)}
          </select>
        </label>
      </div>
      <p>{copy.ambienceHelp} ({Math.round(MAP_ARTWORK_LIMITS.layerChars / 1_000_000)} MB)</p>
      {error && <p role="alert" className="text-danger" data-testid="map-artwork-error">{error}</p>}
    </div>}
  </details>;
}
