import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { getWorldScale, saveWorldScale, revertWorldScale, type WorldScaleReceipt } from '../worldScale';
import { isSheet, resolveWorldScale } from '../core/geoScale';
import type { GeneratedWorld } from '../types';

export default function WorldScalePanel({ world, eraId, onChanged }: { world: GeneratedWorld; eraId?: string; onChanged: () => void | Promise<void> }) {
  const { locale } = useTranslation(), es = locale === 'es';
  const owner = `${world.id}:${eraId ?? ''}`, current = useRef(owner); current.current = owner;
  useEffect(() => { current.current = owner; return () => { current.current = ''; }; }, [owner]);
  const [draft, setDraft] = useState<{ owner: string; width: string; revision: number }>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [undo, setUndo] = useState<WorldScaleReceipt>();
  const scale = resolveWorldScale(world), active = draft?.owner === owner ? draft : undefined;
  if (!isSheet(world.params)) return null;
  const scope = { projectId: world.projectId, eraId };
  const button = 'min-h-10 rounded-lg border border-border px-2.5 py-1.5 text-xs text-text-primary disabled:opacity-40 hover:border-accent-gold';
  const open = async () => {
    setBusy(true); setError('');
    try { const saved = await getWorldScale(scope, world.id); if (current.current === owner) setDraft({ owner, width: String(saved.widthKm), revision: saved.revision }); }
    catch (reason) { if (current.current === owner) setError(String(reason)); }
    finally { if (current.current === owner) setBusy(false); }
  };
  const apply = async (reset = false) => {
    if (busy || !active) return; setBusy(true); setError('');
    try {
      const receipt = await saveWorldScale(scope, world.id, reset ? null : Number(active.width), active.revision);
      if (current.current === owner) { setUndo(receipt.changed ? receipt : undefined); setDraft(undefined); await onChanged(); }
    } catch { if (current.current === owner) setError(es ? 'No se ha aplicado la escala. Tus datos siguen aquí; comprueba el ancho o vuelve a abrir la escala si el mapa ha cambiado.' : 'Scale was not applied. Your data is still here; check the width or reopen the scale if the map changed.'); }
    finally { if (current.current === owner) setBusy(false); }
  };
  const revert = async () => {
    if (busy || !undo || undo.worldId !== world.id) return; setBusy(true); setError('');
    try { await revertWorldScale(scope, world.id, undo); if (current.current === owner) { setUndo(undefined); setDraft(undefined); await onChanged(); } }
    catch { if (current.current === owner) setError(es ? 'Hay una escala más reciente. Se ha conservado.' : 'A newer scale exists and has been preserved.'); }
    finally { if (current.current === owner) setBusy(false); }
  };
  const width = active ? Number(active.width) : scale.widthKm;
  return <section className="mb-4 space-y-2 rounded-lg border border-border p-3" aria-busy={busy}>
    <button type="button" className={button} disabled={busy} onClick={() => void open()}>{es ? 'Escala de este mapa' : 'Scale of this map'}</button>
    <p className="text-xs text-text-muted">{scale.widthKm.toLocaleString(locale)} × {scale.heightKm.toLocaleString(locale)} km · {scale.cellKm.toLocaleString(locale)} km/{es ? 'celda' : 'cell'}</p>
    {active && <div className="space-y-2">
      <label className="block text-xs text-text-muted">{es ? 'Ancho del mapa (km)' : 'Map width (km)'}<input type="number" step="any" value={active.width} disabled={busy} onChange={event => setDraft({ ...active, width: event.target.value })} className="mt-1 min-h-10 w-full rounded border border-border bg-background px-2 py-1.5 text-base text-text-primary" /></label>
      <p className="text-xs text-text-muted">{es ? 'Alto del mapa (km)' : 'Map height (km)'}: <output>{Number.isFinite(width) ? (width * scale.height / scale.width).toLocaleString(locale) : '—'}</output></p>
      <p className="text-xs text-text-muted">{es ? 'Tamaño de celda (km)' : 'Cell size (km)'}: <output>{Number.isFinite(width) ? (width / scale.width).toLocaleString(locale) : '—'}</output></p>
      <p className="text-xs text-text-dim">{es ? 'Cambia las medidas de esta hoja conservando su terreno y posiciones. La altura sigue la proporción existente.' : 'Changes this sheet’s measurements while retaining terrain and positions. Height follows the existing aspect ratio.'}</p>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className={button} onClick={() => void apply()}>{es ? 'Aplicar escala' : 'Apply scale'}</button><button type="button" disabled={busy} className={button} onClick={() => { setDraft(undefined); setError(''); }}>{es ? 'Cancelar escala' : 'Cancel scale'}</button><button type="button" disabled={busy} className={button} onClick={() => void apply(true)}>{es ? 'Restablecer escala' : 'Reset scale'}</button></div>
    </div>}
    {undo?.worldId === world.id && <button type="button" disabled={busy} className={button} onClick={() => void revert()}>{es ? 'Deshacer escala' : 'Undo scale'}</button>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </section>;
}
