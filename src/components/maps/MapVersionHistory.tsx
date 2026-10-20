import { useRef, useState } from 'react';
import { Clock3, History, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ConfirmDialog } from '@/engines/_shared';
import type { MapVersion } from '@/types';
import type { MapVersionMetadata } from '@/engines/maps/operations';
import { mapHistoryCopy } from './mapHistoryCopy';

const control = 'rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-text-primary disabled:opacity-50';
interface Props {
  versions: MapVersion[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCapture: (metadata: MapVersionMetadata) => Promise<unknown>;
  onUpdate: (id: string, metadata: MapVersionMetadata) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  onRestore: (id: string, recoveryName: string) => Promise<unknown>;
}

function VersionMetadata({ version, busy, onSave }: { version: MapVersion; busy: boolean; onSave: (metadata: MapVersionMetadata) => Promise<void> }) {
  const { locale } = useTranslation(); const copy = mapHistoryCopy[locale];
  const [metadata, setMetadata] = useState<MapVersionMetadata>({ name: version.name, date: version.date, description: version.description });
  return <details className="text-xs text-text-muted"><summary className="cursor-pointer">{copy.save}</summary><form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void onSave(metadata); }}>
    <label className="space-y-1.5">{copy.name}<input className={`${control} block`} value={metadata.name} disabled={busy} onChange={event => setMetadata(previous => ({ ...previous, name: event.target.value }))} /></label>
    <label className="space-y-1.5">{copy.date}<input className={`${control} block`} value={metadata.date} disabled={busy} onChange={event => setMetadata(previous => ({ ...previous, date: event.target.value }))} /></label>
    <label className="space-y-1.5 flex-1 min-w-48">{copy.description}<input className={`${control} block w-full`} value={metadata.description ?? ''} disabled={busy} onChange={event => setMetadata(previous => ({ ...previous, description: event.target.value }))} /></label>
    <button type="submit" className={`${control} text-accent-gold`} disabled={busy || !metadata.name.trim()}>{copy.save}</button>
  </form></details>;
}

export default function MapVersionHistory({ versions, selectedId, onSelect, onCapture, onUpdate, onDelete, onRestore }: Props) {
  const { locale } = useTranslation(); const copy = mapHistoryCopy[locale];
  const [creating, setCreating] = useState(false);
  const [metadata, setMetadata] = useState<MapVersionMetadata>({ name: '', date: '' });
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState<'restore' | 'delete' | null>(null);
  const lock = useRef(false);
  const selectedIndex = versions.findIndex(version => version.id === selectedId);
  const selected = versions[selectedIndex];
  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setFailed(false);
    try { await action(); return true; }
    catch { setFailed(true); return false; }
    finally { lock.current = false; setBusy(false); }
  };
  return <section className="rounded-xl border border-border bg-surface/60 p-3 space-y-3" aria-label={copy.title} data-testid="map-version-history">
    <div className="flex flex-wrap items-center gap-3"><h3 className="flex items-center gap-2 text-sm text-text-primary font-semibold"><History size={16} className="text-accent-gold" />{copy.title}</h3>
      {!!versions.length && <select aria-label={copy.title} value={selected?.id ?? ''} disabled={busy} onChange={event => onSelect(event.target.value || null)} className={`${control} min-w-0 max-w-sm`} data-testid="map-version-select"><option value="">{copy.current}</option>{versions.map(version => <option key={version.id} value={version.id}>{version.date ? `${version.date} · ` : ''}{version.name}</option>)}</select>}
      <span className="flex-1" />
      {!selected && <button type="button" className={`${control} flex items-center gap-1.5 text-accent-gold`} disabled={busy} onClick={() => setCreating(!creating)} data-testid="map-version-new"><Plus size={14} />{copy.showForm}</button>}
      {selected && <button type="button" className={`${control} text-accent-gold`} onClick={() => onSelect(null)} disabled={busy} data-testid="map-version-current">{copy.return}</button>}
    </div>
    {!versions.length && <p className="text-xs text-text-muted">{copy.empty}</p>}
    {!!versions.length && <div className="flex items-center gap-3 text-xs text-text-muted"><Clock3 size={14} /><input type="range" min="0" max={versions.length} step="1" value={selectedIndex < 0 ? versions.length : selectedIndex} aria-label={copy.scrub} disabled={busy} onChange={event => onSelect(versions[Number(event.target.value)]?.id ?? null)} className="min-w-0 flex-1 accent-accent-gold" data-testid="map-version-scrubber" /><span>{selected ? `${selected.date || copy.noDate} · ${selected.name}` : copy.current}</span></div>}
    {creating && !selected && <form className="border-t border-border pt-3 space-y-3" onSubmit={event => { event.preventDefault(); void (async () => { if (await run(() => onCapture(metadata))) { setCreating(false); setMetadata({ name: '', date: '' }); } })(); }}>
      <div className="grid gap-3 md:grid-cols-2"><label className="text-xs text-text-muted space-y-1.5">{copy.name}<input className={`${control} block w-full`} value={metadata.name} onChange={event => setMetadata(previous => ({ ...previous, name: event.target.value }))} disabled={busy} data-testid="map-version-name" /></label><label className="text-xs text-text-muted space-y-1.5">{copy.date}<input className={`${control} block w-full`} value={metadata.date} onChange={event => setMetadata(previous => ({ ...previous, date: event.target.value }))} placeholder={copy.noDate} disabled={busy} data-testid="map-version-date" /></label></div>
      <p className="text-xs text-text-muted">{copy.dateHint} {copy.savedOnly}</p>
      <label className="block text-xs text-text-muted space-y-1.5">{copy.description}<textarea className={`${control} block w-full`} rows={2} value={metadata.description ?? ''} onChange={event => setMetadata(previous => ({ ...previous, description: event.target.value }))} disabled={busy} /></label>
      <div className="flex gap-2"><button type="submit" disabled={busy || !metadata.name.trim()} className="rounded-lg bg-accent-gold px-3 py-2 text-sm font-semibold text-deep disabled:opacity-50" data-testid="map-version-capture">{busy ? copy.working : copy.capture}</button><button type="button" className={control} onClick={() => setCreating(false)} disabled={busy}>{copy.cancel}</button></div>
    </form>}
    {selected && <div className="border-t border-border pt-3 space-y-3"><div className="flex flex-wrap items-center gap-3"><p role="status" className="text-sm text-accent-gold flex-1">{copy.preview}</p><button type="button" className={`${control} inline-flex items-center gap-1.5`} disabled={busy} onClick={() => setConfirming('restore')} data-testid="map-version-restore"><RotateCcw size={14} />{copy.restore}</button><button type="button" className="rounded p-2 text-danger hover:bg-danger/10" disabled={busy} aria-label={copy.delete} title={copy.delete} onClick={() => setConfirming('delete')} data-testid="map-version-delete"><Trash2 size={14} /></button></div>{selected.description && <p className="text-sm text-text-muted whitespace-pre-wrap">{selected.description}</p>}<VersionMetadata key={selected.id} version={selected} busy={busy} onSave={async next => { await run(() => onUpdate(selected.id, next)); }} /></div>}
    {failed && <p role="alert" className="text-sm text-danger">{copy.failed}</p>}
    <ConfirmDialog open={!!selected && !!confirming} destructive title={confirming === 'restore' ? copy.restore : copy.delete} confirmLabel={confirming === 'restore' ? copy.restore : copy.delete} message={confirming === 'restore' ? copy.restoreHelp : copy.deleteHelp} onCancel={() => setConfirming(null)} onConfirm={async () => { if (!selected) return; if (await run(() => confirming === 'restore' ? onRestore(selected.id, copy.recovery) : onDelete(selected.id))) { setConfirming(null); onSelect(null); } }} />
  </section>;
}
