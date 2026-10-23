// ============================================================================
// Assets library — pictures, sounds, videos and 3D models of the project in
// one list. Search, sort, filter by kind, select several, download, rename,
// delete (after reading where it is used) and, on the desktop app, compress a
// heavy sound or video. Each kind is still stored and removed by its own
// engine; this panel only puts them side by side.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Download, Film, Image as ImageIcon, Loader2, Minimize2, Music, Pencil, Search, Trash2 } from 'lucide-react';
import { db } from '@/db';
import { toast } from '@/components/common/toast';
import GalleryLightbox from '@/components/gallery/GalleryLightbox';
import { onDataChanged } from '@/engines/_shared/dataChanged';
import { mediaAsset } from '@/engines/media/scope';
import { useTranslation } from '@/i18n/useTranslation';
import { ASSET_KINDS, ASSET_SORTS, filterAssets, formatBytes, listProjectAssets, type AssetKind, type AssetSort, type LibraryAsset } from '@/services/assetsLibrary/catalog';
import { canCompress, savedPercent, startCompress, type CompressOutcome, type CompressPreset, type CompressRun } from '@/services/assetsLibrary/compressClient';
import { deleteAssets, downloadAsset, renameAsset, replaceWithCompressed, saveCompressedCopy, usageWarning } from '@/services/assetsLibrary/operations';
import { findAssetUsage, type AssetPlace } from '@/services/assetsLibrary/usage';
import type { InspirationImage } from '@/types';

const PAGE = 60;
const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
const KIND_ICON = { image: ImageIcon, audio: Music, video: Film, model: Box } as const;

function Thumb({ asset }: { asset: LibraryAsset }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    if (asset.kind !== 'image') return;
    let alive = true;
    void db.inspirationImages.get(asset.id).then(row => { if (alive) setSrc(row?.thumbnailData || row?.imageData); });
    return () => { alive = false; };
  }, [asset.id, asset.kind]);
  const Icon = KIND_ICON[asset.kind];
  return src
    ? <img src={src} alt="" loading="lazy" className="h-10 w-10 flex-none rounded object-cover" />
    : <span className="flex h-10 w-10 flex-none items-center justify-center rounded bg-background text-text-dim"><Icon size={18} aria-hidden="true" /></span>;
}

interface DeletePrompt { assets: LibraryAsset[]; used: Array<{ asset: LibraryAsset; places: AssetPlace[] }> }
interface CompressState { asset: LibraryAsset; preset: CompressPreset; run?: CompressRun; outcome?: CompressOutcome }

export default function AssetsLibrary({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [assets, setAssets] = useState<LibraryAsset[] | null>(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<AssetKind | 'all'>('all');
  const [sort, setSort] = useState<AssetSort>('date-desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [prompt, setPrompt] = useState<DeletePrompt | null>(null);
  const [compress, setCompress] = useState<CompressState | null>(null);
  const [preview, setPreview] = useState<InspirationImage | null>(null);
  const [busy, setBusy] = useState(false);
  const desktop = canCompress();
  const alive = useRef(true);
  // A compression still running when the panel goes away is cancelled, so no encoder is left working for nobody.
  const activeRun = useRef<CompressRun | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; activeRun.current?.cancel(); }; }, []);

  const reload = useCallback(async () => {
    const rows = await listProjectAssets(projectId);
    if (!alive.current) return;
    setAssets(rows);
    setSelected(current => new Set([...current].filter(id => rows.some(row => row.id === id))));
  }, [projectId]);
  useEffect(() => {
    void reload();
    return onDataChanged(detail => { if (!detail.projectId || detail.projectId === projectId) void reload(); });
  }, [projectId, reload]);

  const rows = useMemo(() => filterAssets(assets ?? [], { kind, query, sort }), [assets, kind, query, sort]);
  const visible = rows.slice(0, shown);
  const counts = useMemo(() => {
    const out: Record<AssetKind, number> = { image: 0, audio: 0, video: 0, model: 0 };
    for (const asset of assets ?? []) out[asset.kind]++;
    return out;
  }, [assets]);
  const chosen = (assets ?? []).filter(asset => selected.has(asset.id));

  const toggle = (id: string) => setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const guarded = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); } catch (error) { console.error('Assets library action failed', error); toast.error(t('assetsLibrary.failed')); } finally { if (alive.current) setBusy(false); }
  };

  const download = (list: LibraryAsset[]) => guarded(async () => {
    for (const asset of list) await downloadAsset(projectId, asset);
    toast.success(fill(t('assetsLibrary.downloaded'), { count: String(list.length) }));
  });

  const commitRename = () => {
    const edit = renaming; const target = assets?.find(asset => asset.id === edit?.id);
    setRenaming(null);
    if (!edit || !target || !edit.value.trim() || edit.value.trim() === target.name) return;
    void guarded(async () => { await renameAsset(projectId, target, edit.value); await reload(); });
  };

  const askDelete = (list: LibraryAsset[]) => guarded(async () => {
    const used: DeletePrompt['used'] = [];
    for (const asset of list) { const places = await findAssetUsage(projectId, asset); if (places.length) used.push({ asset, places }); }
    setPrompt({ assets: list, used });
  });

  const confirmDelete = () => {
    const current = prompt; setPrompt(null);
    if (!current) return;
    void guarded(async () => {
      const report = await deleteAssets(projectId, current.assets, { force: true });
      if (report.failed.length) toast.error(fill(t('assetsLibrary.deleteFailed'), { count: String(report.failed.length) }));
      setSelected(new Set());
      await reload();
    });
  };

  const beginCompress = (asset: LibraryAsset) => setCompress({ asset, preset: 'balanced' });
  const runCompress = async () => {
    if (!compress || (compress.asset.kind !== 'audio' && compress.asset.kind !== 'video')) return;
    const { asset, preset } = compress;
    const row = await mediaAsset(projectId, asset.id);
    if (!row) { toast.error(t('assetsLibrary.failed')); setCompress(null); return; }
    const run = startCompress(await row.blob.arrayBuffer(), asset.kind as 'audio' | 'video', preset);
    activeRun.current = run;
    setCompress({ asset, preset, run });
    const outcome = await run.result;
    if (activeRun.current === run) activeRun.current = null;
    if (!alive.current) return;
    setCompress(outcome.status === 'cancelled' ? null : { asset, preset, outcome });
  };
  const keepCompressed = (mode: 'copy' | 'replace') => {
    const current = compress;
    if (!current?.outcome || current.outcome.status !== 'done') return;
    const result = current.outcome;
    setCompress(null);
    void guarded(async () => {
      if (mode === 'copy') await saveCompressedCopy(projectId, current.asset, result);
      else await replaceWithCompressed(projectId, current.asset, result);
      toast.success(t(mode === 'copy' ? 'assetsLibrary.savedCopy' : 'assetsLibrary.replaced'));
      await reload();
    });
  };

  const openPreview = (asset: LibraryAsset) => {
    if (asset.kind !== 'image') return;
    void db.inspirationImages.get(asset.id).then(row => { if (row && alive.current) setPreview(row); });
  };

  const sizeTotal = rows.reduce((sum, asset) => sum + asset.size, 0);

  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface p-4" data-testid="assets-library" aria-label={t('assetsLibrary.title')}>
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-semibold text-text-primary">{t('assetsLibrary.title')}</h3>
        <label className="relative">
          <span className="sr-only">{t('assetsLibrary.search')}</span>
          <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-dim" />
          <input data-testid="assets-search" value={query} onChange={event => { setQuery(event.target.value); setShown(PAGE); }} placeholder={t('assetsLibrary.search')} className="w-48 rounded-lg border border-border bg-background py-1.5 pl-7 pr-2 text-sm text-text-primary" />
        </label>
        <label className="text-xs text-text-dim">
          <span className="sr-only">{t('assetsLibrary.sort')}</span>
          <select data-testid="assets-sort" value={sort} onChange={event => setSort(event.target.value as AssetSort)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-text-primary">
            {ASSET_SORTS.map(option => <option key={option} value={option}>{t(`assetsLibrary.sort.${option}`)}</option>)}
          </select>
        </label>
      </header>

      <div className="flex flex-wrap gap-2" role="group" aria-label={t('assetsLibrary.kinds')}>
        {(['all', ...ASSET_KINDS] as const).map(option => (
          <button key={option} type="button" data-testid={`assets-kind-${option}`} aria-pressed={kind === option} onClick={() => { setKind(option); setShown(PAGE); }}
            className={`rounded-full px-3 py-1 text-xs transition ${kind === option ? 'bg-accent-gold text-background font-semibold' : 'bg-background text-text-muted hover:text-text-primary'}`}>
            {t(`assetsLibrary.kind.${option}`)} · {option === 'all' ? (assets?.length ?? 0) : counts[option]}
          </button>
        ))}
      </div>

      {chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-background px-3 py-2 text-sm" data-testid="assets-selection">
          <span className="mr-auto text-text-primary">{fill(t('assetsLibrary.selected'), { count: String(chosen.length) })}</span>
          <button type="button" data-testid="assets-download-selected" disabled={busy} onClick={() => void download(chosen)} className="rounded-lg border border-border px-3 py-1 text-text-primary hover:border-accent-gold">{t('assetsLibrary.download')}</button>
          <button type="button" data-testid="assets-delete-selected" disabled={busy} onClick={() => void askDelete(chosen)} className="rounded-lg border border-border px-3 py-1 text-red-400 hover:border-red-400">{t('assetsLibrary.delete')}</button>
          <button type="button" data-testid="assets-clear-selection" onClick={() => setSelected(new Set())} className="rounded-lg px-2 py-1 text-text-dim hover:text-text-primary">{t('assetsLibrary.clear')}</button>
        </div>
      )}

      {prompt && (
        <div role="alertdialog" aria-label={t('assetsLibrary.confirmTitle')} data-testid="assets-delete-prompt" className="space-y-2 rounded-lg border border-red-400/60 bg-background p-3 text-sm">
          <p className="font-medium text-text-primary">{fill(t(prompt.assets.length === 1 ? 'assetsLibrary.confirmOne' : 'assetsLibrary.confirmMany'), { count: String(prompt.assets.length), name: prompt.assets[0]?.name ?? '' })}</p>
          {prompt.used.map(({ asset, places }) => (
            <p key={asset.id} data-testid="assets-usage-warning" className="text-amber-300">{asset.name}: {usageWarning(places)}</p>
          ))}
          <div className="flex gap-2">
            <button type="button" data-testid="assets-delete-confirm" onClick={confirmDelete} className="rounded-lg bg-red-500 px-3 py-1 font-medium text-white">{t(prompt.used.length ? 'assetsLibrary.deleteAnyway' : 'assetsLibrary.delete')}</button>
            <button type="button" data-testid="assets-delete-cancel" onClick={() => setPrompt(null)} className="rounded-lg border border-border px-3 py-1 text-text-primary">{t('assetsLibrary.cancel')}</button>
          </div>
        </div>
      )}

      {compress && (
        <div role="dialog" aria-label={t('assetsLibrary.compress')} data-testid="assets-compress-panel" className="space-y-2 rounded-lg border border-border bg-background p-3 text-sm">
          <p className="font-medium text-text-primary">{fill(t('assetsLibrary.compressTitle'), { name: compress.asset.name })}</p>
          {!compress.run && !compress.outcome && (
            <>
              <p className="text-text-muted">{fill(t('assetsLibrary.compressIntro'), { size: formatBytes(compress.asset.size) })}</p>
              <div className="flex flex-wrap items-center gap-2">
                {(['balanced', 'small'] as const).map(preset => (
                  <button key={preset} type="button" data-testid={`assets-compress-preset-${preset}`} aria-pressed={compress.preset === preset} onClick={() => setCompress({ ...compress, preset })}
                    className={`rounded-full px-3 py-1 text-xs ${compress.preset === preset ? 'bg-accent-gold text-background font-semibold' : 'bg-surface text-text-muted'}`}>{t(`assetsLibrary.preset.${preset}`)}</button>
                ))}
                <button type="button" data-testid="assets-compress-start" onClick={() => void runCompress()} className="rounded-lg bg-accent-gold px-3 py-1 font-medium text-background">{t('assetsLibrary.compressStart')}</button>
                <button type="button" data-testid="assets-compress-close" onClick={() => setCompress(null)} className="rounded-lg border border-border px-3 py-1 text-text-primary">{t('assetsLibrary.cancel')}</button>
              </div>
            </>
          )}
          {compress.run && !compress.outcome && (
            <div className="flex items-center gap-3" data-testid="assets-compress-running">
              <Loader2 size={16} className="animate-spin text-accent-gold" aria-hidden="true" />
              <span className="text-text-muted">{t('assetsLibrary.compressing')}</span>
              <button type="button" data-testid="assets-compress-cancel" onClick={() => compress.run?.cancel()} className="rounded-lg border border-border px-3 py-1 text-text-primary">{t('assetsLibrary.cancel')}</button>
            </div>
          )}
          {compress.outcome?.status === 'done' && (
            <div className="space-y-2" data-testid="assets-compress-result">
              <p className="text-text-primary">{fill(t('assetsLibrary.compressResult'), { before: formatBytes(compress.outcome.beforeBytes), after: formatBytes(compress.outcome.afterBytes), percent: String(savedPercent(compress.outcome.beforeBytes, compress.outcome.afterBytes)) })}</p>
              {compress.outcome.afterBytes >= compress.outcome.beforeBytes && <p className="text-amber-300">{t('assetsLibrary.notSmaller')}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" data-testid="assets-compress-copy" onClick={() => keepCompressed('copy')} className="rounded-lg bg-accent-gold px-3 py-1 font-medium text-background">{t('assetsLibrary.saveCopy')}</button>
                <button type="button" data-testid="assets-compress-replace" onClick={() => keepCompressed('replace')} className="rounded-lg border border-border px-3 py-1 text-text-primary">{t('assetsLibrary.replaceOriginal')}</button>
                <button type="button" data-testid="assets-compress-discard" onClick={() => setCompress(null)} className="rounded-lg px-3 py-1 text-text-dim">{t('assetsLibrary.discard')}</button>
              </div>
            </div>
          )}
          {compress.outcome && compress.outcome.status !== 'done' && (
            <div className="flex items-center gap-3" data-testid="assets-compress-error">
              <span className="text-red-400">{compress.outcome.status === 'error' ? compress.outcome.message : t('assetsLibrary.compressUnavailable')}</span>
              <button type="button" onClick={() => setCompress(null)} className="rounded-lg border border-border px-3 py-1 text-text-primary">{t('assetsLibrary.close')}</button>
            </div>
          )}
        </div>
      )}

      {assets === null ? (
        <p className="text-sm text-text-dim" data-testid="assets-loading">{t('assetsLibrary.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-dim" data-testid="assets-empty">{t((assets.length ? 'assetsLibrary.noMatches' : 'assetsLibrary.empty'))}</p>
      ) : (
        <>
          <p className="text-xs text-text-dim" data-testid="assets-total">{fill(t('assetsLibrary.total'), { count: String(rows.length), size: formatBytes(sizeTotal) })}</p>
          <ul className="max-h-[55vh] divide-y divide-border overflow-auto rounded-lg border border-border" data-testid="assets-list">
            {visible.map(asset => (
              <li key={asset.id} data-testid="assets-row" data-asset-id={asset.id} data-asset-kind={asset.kind} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <input type="checkbox" data-testid="assets-select" checked={selected.has(asset.id)} onChange={() => toggle(asset.id)} aria-label={fill(t('assetsLibrary.select'), { name: asset.name })} />
                <button type="button" onClick={() => openPreview(asset)} disabled={asset.kind !== 'image'} aria-label={fill(t('assetsLibrary.open'), { name: asset.name })} className="flex-none disabled:cursor-default"><Thumb asset={asset} /></button>
                <div className="min-w-0 flex-1">
                  {renaming?.id === asset.id ? (
                    <input data-testid="assets-rename-input" autoFocus value={renaming.value} onChange={event => setRenaming({ id: asset.id, value: event.target.value })} onBlur={commitRename}
                      onKeyDown={event => { if (event.key === 'Enter') commitRename(); else if (event.key === 'Escape') setRenaming(null); }}
                      className="w-full rounded border border-accent-gold bg-background px-2 py-1 text-text-primary" />
                  ) : (
                    <span className="block truncate text-text-primary" data-testid="assets-name" title={asset.name}>{asset.name}</span>
                  )}
                  <span className="block truncate text-xs text-text-dim">
                    {t(`assetsLibrary.kind.${asset.kind}`)} · {formatBytes(asset.size)} · {new Date(asset.createdAt).toLocaleDateString()}{asset.tags.length ? ` · ${asset.tags.join(', ')}` : ''}
                  </span>
                </div>
                <div className="flex flex-none items-center gap-1">
                  {desktop && asset.oversize && (
                    <button type="button" data-testid="assets-compress" disabled={busy || !!compress} onClick={() => beginCompress(asset)} title={t('assetsLibrary.compress')} aria-label={fill(t('assetsLibrary.compressNamed'), { name: asset.name })} className="rounded p-1.5 text-text-muted hover:text-accent-gold"><Minimize2 size={15} aria-hidden="true" /></button>
                  )}
                  <button type="button" data-testid="assets-download" disabled={busy} onClick={() => void download([asset])} title={t('assetsLibrary.download')} aria-label={fill(t('assetsLibrary.downloadNamed'), { name: asset.name })} className="rounded p-1.5 text-text-muted hover:text-accent-gold"><Download size={15} aria-hidden="true" /></button>
                  <button type="button" data-testid="assets-rename" disabled={busy} onClick={() => setRenaming({ id: asset.id, value: asset.name })} title={t('assetsLibrary.rename')} aria-label={fill(t('assetsLibrary.renameNamed'), { name: asset.name })} className="rounded p-1.5 text-text-muted hover:text-accent-gold"><Pencil size={15} aria-hidden="true" /></button>
                  <button type="button" data-testid="assets-delete" disabled={busy} onClick={() => void askDelete([asset])} title={t('assetsLibrary.delete')} aria-label={fill(t('assetsLibrary.deleteNamed'), { name: asset.name })} className="rounded p-1.5 text-text-muted hover:text-red-400"><Trash2 size={15} aria-hidden="true" /></button>
                </div>
              </li>
            ))}
          </ul>
          {rows.length > shown && (
            <button type="button" data-testid="assets-more" onClick={() => setShown(count => count + PAGE)} className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-primary hover:border-accent-gold">{fill(t('assetsLibrary.more'), { count: String(rows.length - shown) })}</button>
          )}
        </>
      )}
      {preview && <GalleryLightbox image={preview} linkedEntries={[]} onClose={() => setPreview(null)} />}
    </section>
  );
}
