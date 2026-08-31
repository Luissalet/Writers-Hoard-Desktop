// ============================================================================
// AI settings — local image models: runtime, catalogue with fit, downloads
// ============================================================================
//
// The managed stable-diffusion.cpp server and a curated catalogue of weights,
// each with the same perfecto / bien / justo / no cabe badge as the text
// models — here the question is the GPU at the model's native resolution.
// Downloads are verified against pinned checksums and resume after a cancel;
// "Use" makes a model the studio's default; one server process serves the
// model last asked for and is swapped on demand.

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Download, ExternalLink, Image as ImageIcon, Loader2, Square, Trash2, X, XCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ConfirmDialog } from '@/engines/_shared';
import { useAiRuntimeStore } from '@/stores/aiRuntimeStore';
import { useImageRuntimeStore } from '@/stores/imageRuntimeStore';
import { LOCAL_IMAGE_CATALOG, type ImageCatalogModel } from '@/services/aiRuntime/imageCatalog';
import { BUILTIN_SD_ID } from '@/services/aiRuntime/constants';
import { computeImageFit, type SdBackend } from '@/services/aiRuntime/sdServer';
import { fitRank, formatBytes } from '@/services/aiRuntime/fit';
import type { FitEstimate } from '@/services/aiRuntime/types';
import FitBadge from './FitBadge';

function ProgressBar({ progress, indeterminate }: { progress: number; indeterminate?: boolean }) {
  return (
    <div className="h-1.5 rounded-full bg-elevated overflow-hidden">
      {indeterminate ? (
        <div className="h-full w-full bg-accent-gold/60 animate-pulse" />
      ) : (
        <div className="h-full bg-accent-gold transition-[width] duration-200" style={{ width: `${Math.round(progress * 100)}%` }} />
      )}
    </div>
  );
}

const BACKEND_BYTES: Record<SdBackend, number> = { vulkan: 42_275_413, cuda12: 916_000_860, cpu: 21_195_454 };

interface Row {
  entry: ImageCatalogModel;
  installed: boolean;
  installedBytes?: number;
  fit: FitEstimate | null;
}

export default function LocalImageModelsSection() {
  const { t } = useTranslation();
  const { status, progress, errors, refresh, installRuntime, cancelInstall, removeRuntime, downloadModel, cancelDownload, deleteModel, stopServer } = useImageRuntimeStore();
  const hardware = useAiRuntimeStore((s) => s.hardware);
  const loadHardware = useAiRuntimeStore((s) => s.loadHardware);
  const defaults = useAiRuntimeStore((s) => s.defaults);
  const setDefault = useAiRuntimeStore((s) => s.setDefault);
  const [backend, setBackend] = useState<SdBackend | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingRemoveRuntime, setPendingRemoveRuntime] = useState(false);

  useEffect(() => {
    void loadHardware();
    void refresh();
  }, [loadHardware, refresh]);

  const state = status?.state ?? 'absent';
  const supported = status?.supported ?? false;
  const runtimeInstalled = Boolean(status?.installedBackend);
  const busyRuntime = state === 'downloading-runtime' || state === 'extracting';
  const backends = status?.backends ?? [];
  const chosenBackend: SdBackend | null = backend ?? backends[0] ?? null;
  const installed = useMemo(() => new Map((status?.models ?? []).map((m) => [m.id, m.installedBytes])), [status?.models]);

  const rows = useMemo<Row[]>(() => {
    const out = LOCAL_IMAGE_CATALOG.map((entry) => ({
      entry,
      installed: installed.has(entry.id),
      installedBytes: installed.get(entry.id),
      fit: hardware ? computeImageFit(hardware, entry) : null,
    }));
    out.sort((a, b) => {
      if (a.installed !== b.installed) return a.installed ? -1 : 1;
      const fa = a.fit ? fitRank(a.fit.label) : 9;
      const fb = b.fit ? fitRank(b.fit.label) : 9;
      if (fa !== fb) return fa - fb;
      if (Boolean(a.entry.recommended) !== Boolean(b.entry.recommended)) return a.entry.recommended ? -1 : 1;
      return a.entry.totalBytes - b.entry.totalBytes;
    });
    return out;
  }, [hardware, installed]);

  const runtimeProgress = chosenBackend ? progress[chosenBackend] : undefined;
  const runtimeError = chosenBackend ? errors[chosenBackend] : '';
  const defaultModelId = defaults.image?.connectionId === BUILTIN_SD_ID ? defaults.image.modelId : null;

  const adopt = async (id: string) => {
    await setDefault('image', { connectionId: BUILTIN_SD_ID, modelId: id });
  };

  return (
    <section className="space-y-3">
      <div className="flex items-start gap-2">
        <ImageIcon size={14} className="text-accent-gold mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-sm text-text-primary font-medium">{t('settings.ai.imageModels.title')}</p>
          <p className="text-[10px] text-text-dim mt-0.5">{t('settings.ai.imageModels.subtitle')}</p>
        </div>
      </div>

      {/* Runtime */}
      {!supported && (
        <div className="px-3 py-2 bg-elevated rounded-lg text-[10px] text-text-dim">{t('settings.ai.imageModels.unsupported')}</div>
      )}
      {supported && !runtimeInstalled && !busyRuntime && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={chosenBackend ?? ''}
              onChange={(e) => setBackend(e.target.value as SdBackend)}
              className="px-2 py-1.5 bg-elevated border border-border rounded-lg text-xs text-text-primary outline-none focus:border-accent-gold"
            >
              {backends.map((b) => (
                <option key={b} value={b}>
                  {t(`settings.ai.imageModels.backend.${b}`)} · {formatBytes(BACKEND_BYTES[b])}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void installRuntime(chosenBackend ?? undefined)}
              className="flex items-center gap-2 px-3 py-1.5 bg-accent-gold text-deep text-xs font-semibold rounded-lg hover:bg-accent-amber transition"
            >
              <Download size={13} />
              {t('settings.ai.imageModels.installRuntime')}
            </button>
          </div>
          <p className="text-[10px] text-text-dim">{t('settings.ai.imageModels.runtimeNote')}</p>
          {(runtimeError || (state === 'error' && status?.error)) && (
            <div className="flex items-start gap-2 px-3 py-2 bg-red-500/10 text-red-400 text-xs rounded-lg">
              <XCircle size={14} className="mt-0.5 flex-shrink-0" />
              <span className="whitespace-pre-wrap break-all">{runtimeError || status?.error}</span>
            </div>
          )}
        </div>
      )}
      {busyRuntime && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin text-accent-gold" />
            <span className="text-sm text-text-primary">
              {state === 'extracting' ? t('settings.ai.local.extracting') : t('settings.ai.local.downloading')}
            </span>
          </div>
          <ProgressBar
            progress={runtimeProgress && runtimeProgress.totalBytes > 0 ? runtimeProgress.receivedBytes / runtimeProgress.totalBytes : 0}
            indeterminate={state === 'extracting' || !runtimeProgress}
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-text-muted tabular-nums">
              {runtimeProgress && state !== 'extracting' ? `${formatBytes(runtimeProgress.receivedBytes)} / ${formatBytes(runtimeProgress.totalBytes)}` : ''}
            </span>
            {state === 'downloading-runtime' && (
              <button type="button" onClick={() => void cancelInstall()} className="text-[11px] text-text-dim hover:text-danger transition flex items-center gap-1">
                <X size={11} />
                {t('settings.ai.local.cancel')}
              </button>
            )}
          </div>
        </div>
      )}
      {runtimeInstalled && !busyRuntime && (
        <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 text-green-400 text-xs rounded-lg flex-wrap">
          <CheckCircle2 size={14} />
          <span>
            {state === 'running' && status?.loadedModelId
              ? t('settings.ai.imageModels.running').replace('{model}', status.loadedModelId)
              : state === 'starting'
                ? t('settings.ai.imageModels.starting')
                : t('settings.ai.imageModels.ready').replace('{backend}', t(`settings.ai.imageModels.backend.${status?.installedBackend ?? 'vulkan'}`))}
          </span>
          {state === 'error' && status?.error && <span className="text-red-400 break-all">{status.error}</span>}
          <span className="ml-auto flex items-center gap-2">
            {state === 'running' && (
              <button type="button" onClick={() => void stopServer()} className="text-[11px] text-text-dim hover:text-text-primary transition flex items-center gap-1" title={t('settings.ai.imageModels.stopHint')}>
                <Square size={10} />
                {t('settings.ai.imageModels.stop')}
              </button>
            )}
            <button type="button" onClick={() => setPendingRemoveRuntime(true)} className="text-[11px] text-text-dim hover:text-danger transition">
              {t('settings.ai.imageModels.removeRuntime')}
            </button>
          </span>
        </div>
      )}

      {/* Catalogue */}
      <div className="space-y-1.5">
        {rows.map(({ entry, installed: isInstalled, installedBytes, fit }) => {
          const modelProgress = progress[entry.id];
          const isDownloading = status?.downloading === entry.id;
          const error = errors[entry.id];
          const isDefault = defaultModelId === entry.id;
          const isLoaded = status?.loadedModelId === entry.id;
          return (
            <div key={entry.id} className={`px-4 py-2.5 rounded-lg border transition text-sm ${isDefault && isInstalled ? 'border-accent-gold/40 bg-accent-gold/5' : 'border-border'}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`font-medium truncate ${isDefault && isInstalled ? 'text-accent-gold' : 'text-text-primary'}`}>{entry.label}</span>
                  {entry.recommended && !isInstalled && <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent-plum/20 text-accent-plum-light uppercase tracking-wide">{t('settings.ai.localModels.recommended')}</span>}
                  <FitBadge fit={fit} compact />
                  {isLoaded && <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 uppercase tracking-wide">{t('settings.ai.imageModels.loaded')}</span>}
                </div>
                <span className="text-[10px] text-text-dim flex-shrink-0 tabular-nums">
                  {isInstalled && installedBytes ? t('settings.ai.local.installedSize').replace('{size}', formatBytes(installedBytes)) : formatBytes(entry.totalBytes)}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 flex-wrap text-[10px] text-text-dim">
                <span className="font-mono">{entry.id}</span>
                <span className="px-1 rounded bg-elevated uppercase">{entry.family}</span>
                <span>{entry.nativeWidth}×{entry.nativeHeight}</span>
                <span>{entry.defaults.steps} {t('settings.ai.imageModels.steps')}</span>
                <a href={entry.licenseUrl} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 hover:text-accent-gold transition" title={t('settings.ai.imageModels.licenseHint')}>
                  {entry.license}
                  <ExternalLink size={9} />
                </a>
              </div>
              <p className="text-[10px] text-text-dim mt-0.5">{t(`settings.ai.imageCatalog.${entry.pitchKey}`)}</p>

              {isDownloading ? (
                <div className="mt-2 space-y-1.5">
                  <ProgressBar progress={modelProgress && modelProgress.totalBytes > 0 ? modelProgress.receivedBytes / modelProgress.totalBytes : 0} indeterminate={!modelProgress} />
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-text-muted tabular-nums">
                      {modelProgress
                        ? `${formatBytes(modelProgress.receivedBytes)} / ${formatBytes(modelProgress.totalBytes)}${modelProgress.fileCount > 1 ? ` · ${modelProgress.fileIndex + 1}/${modelProgress.fileCount}` : ''}`
                        : t('settings.ai.local.preparing')}
                    </span>
                    <button type="button" onClick={() => void cancelDownload(entry.id)} className="text-[11px] text-text-dim hover:text-danger transition flex items-center gap-1">
                      <X size={11} />
                      {t('settings.ai.local.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex items-center justify-end gap-1.5">
                  {isInstalled ? (
                    <>
                      {isDefault ? (
                        <span className="text-[11px] px-2 py-1 rounded bg-accent-gold/15 text-accent-gold font-medium">{t('settings.ai.local.inUse')}</span>
                      ) : (
                        <button type="button" onClick={() => void adopt(entry.id)} className="text-[11px] px-2 py-1 rounded bg-elevated text-text-muted hover:text-accent-gold transition">
                          {t('settings.ai.local.use')}
                        </button>
                      )}
                      <button type="button" onClick={() => setPendingDelete(entry.id)} title={t('settings.ai.local.delete')} className="p-1.5 rounded text-text-dim hover:text-danger hover:bg-danger/10 transition">
                        <Trash2 size={12} />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void downloadModel(entry.id)}
                      disabled={Boolean(status?.downloading) || !runtimeInstalled || fit?.label === 'no-fit'}
                      title={!runtimeInstalled ? t('settings.ai.imageModels.needRuntime') : fit?.label === 'no-fit' ? t('settings.ai.fit.no-fit.hint') : undefined}
                      className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded bg-accent-gold/10 text-accent-gold hover:bg-accent-gold/20 transition disabled:opacity-50"
                    >
                      <Download size={11} />
                      {t('settings.ai.local.download')}
                    </button>
                  )}
                </div>
              )}
              {error && (
                <div className="mt-2 flex items-center gap-2 px-2 py-1.5 bg-red-500/10 text-red-400 text-[11px] rounded">
                  <XCircle size={12} className="flex-shrink-0" />
                  <span className="break-all">{error}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-text-dim">{t('settings.ai.imageModels.note')}</p>

      <ConfirmDialog
        open={pendingDelete !== null}
        destructive
        message={t('settings.ai.imageModels.deleteConfirm')
          .replace('{model}', pendingDelete ?? '')
          .replace('{size}', formatBytes(pendingDelete ? installed.get(pendingDelete) : undefined))}
        onConfirm={() => {
          const id = pendingDelete;
          setPendingDelete(null);
          if (id) void deleteModel(id);
        }}
        onCancel={() => setPendingDelete(null)}
      />
      <ConfirmDialog
        open={pendingRemoveRuntime}
        destructive
        message={t('settings.ai.imageModels.removeRuntimeConfirm').replace('{size}', formatBytes(status?.runtimeBytes))}
        onConfirm={() => {
          setPendingRemoveRuntime(false);
          void removeRuntime();
        }}
        onCancel={() => setPendingRemoveRuntime(false)}
      />
    </section>
  );
}
