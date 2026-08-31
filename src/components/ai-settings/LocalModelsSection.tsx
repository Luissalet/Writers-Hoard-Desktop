// ============================================================================
// AI settings — local models: hardware, runtime, catalogue with fit
// ============================================================================
//
// The managed Ollama (embedded on Windows, or the system one) and a curated
// catalogue of models, each with a badge saying how it would run on THIS
// machine — perfecto / bien / justo / no cabe — computed from the GPU and RAM
// detected by the main process. Download with real progress, cancel, delete
// with confirmation, and "Use" to make one the default for the copilot and
// the classic features.

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Cpu, Download, HardDrive, Loader2, MemoryStick, RefreshCw, Trash2, X, XCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ConfirmDialog } from '@/engines/_shared';
import { useAiStore } from '@/stores/aiStore';
import { BUILTIN_OLLAMA_ID, useAiRuntimeStore } from '@/stores/aiRuntimeStore';
import { LOCAL_MODEL_CATALOG, type CatalogModel } from '@/services/aiRuntime/catalog';
import { computeFit, fitRank, formatBytes, formatBinaryBytes, quantBitsFromLabel, type FitInput } from '@/services/aiRuntime/fit';
import type { AiModelDescriptor, FitEstimate, HardwareProfile } from '@/services/aiRuntime/types';
import { DEFAULT_CONTEXT_TOKENS } from '@/services/aiRuntime/constants';
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

function HardwareStrip({ hardware, onRefresh }: { hardware: HardwareProfile | null; onRefresh: () => void }) {
  const { t } = useTranslation();
  if (!hardware) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-[11px] text-text-dim">
        <Loader2 size={12} className="animate-spin" />
        {t('settings.ai.hardware.detecting')}
      </div>
    );
  }
  const gpu = hardware.gpus[0];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 rounded-lg border border-border text-[11px] text-text-muted">
      <span className="flex items-center gap-1.5">
        <Cpu size={12} className="text-text-dim" />
        {hardware.cpuModel} · {hardware.cpuCores} {t('settings.ai.hardware.cores')}
      </span>
      <span className="flex items-center gap-1.5">
        <MemoryStick size={12} className="text-text-dim" />
        {t('settings.ai.hardware.ram')} {formatBinaryBytes(hardware.ramTotalBytes)}
      </span>
      <span className="flex items-center gap-1.5">
        <HardDrive size={12} className="text-text-dim" />
        {gpu ? (
          <>
            {gpu.name} · {gpu.vramTotalBytes ? formatBinaryBytes(gpu.vramTotalBytes) : '?'} VRAM
            {hardware.gpuConfidence === 'estimated' ? ` (${t('settings.ai.fit.estimated')})` : ''}
          </>
        ) : (
          t('settings.ai.hardware.noGpu')
        )}
      </span>
      <button type="button" onClick={onRefresh} title={t('common.refresh')} className="ml-auto p-1 text-text-dim hover:text-accent-gold transition">
        <RefreshCw size={11} />
      </button>
    </div>
  );
}

interface Row {
  tag: string;
  label: string;
  pitch?: string;
  sizeBytes: number | undefined;
  installedBytes?: number;
  installed: boolean;
  fit: FitEstimate | null;
  capabilities: string[];
  recommended?: boolean;
  catalog?: CatalogModel;
}

export default function LocalModelsSection() {
  const { t } = useTranslation();
  const {
    config,
    localStatus,
    runtimeProgress,
    pullProgress,
    refreshLocalStatus,
    downloadRuntime,
    cancelRuntimeDownload,
    pullModel,
    cancelPull,
    deleteModel,
    setLocalModel,
  } = useAiStore();
  const hardware = useAiRuntimeStore((s) => s.hardware);
  const loadHardware = useAiRuntimeStore((s) => s.loadHardware);
  const builtinModels = useAiRuntimeStore((s) => s.modelsByConnection[BUILTIN_OLLAMA_ID]?.models);
  const loadModels = useAiRuntimeStore((s) => s.loadModels);
  const defaults = useAiRuntimeStore((s) => s.defaults);
  const setDefault = useAiRuntimeStore((s) => s.setDefault);
  const [pendingDeleteTag, setPendingDeleteTag] = useState<string | null>(null);
  const [onlyFits, setOnlyFits] = useState(false);

  useEffect(() => {
    void loadHardware();
    void refreshLocalStatus();
  }, [loadHardware, refreshLocalStatus]);

  const state = localStatus?.state ?? 'absent';
  const supported = localStatus?.supported ?? false;
  const live = state === 'running' || state === 'external';
  const busyRuntime = state === 'downloading-runtime' || state === 'extracting' || state === 'starting';
  const installed = useMemo(() => new Map((localStatus?.models ?? []).map((m) => [m.name, m.sizeBytes])), [localStatus?.models]);

  useEffect(() => {
    if (live) void loadModels(BUILTIN_OLLAMA_ID, true);
  }, [live, installed.size, loadModels]);

  const byId = useMemo(() => new Map((builtinModels ?? []).map((m) => [m.id, m])), [builtinModels]);
  const defaultTag = defaults.chat?.connectionId === BUILTIN_OLLAMA_ID ? defaults.chat.modelId : config.provider === 'local' ? config.localModel : null;

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const fitFor = (input: FitInput): FitEstimate | null => (hardware ? computeFit(hardware, input, DEFAULT_CONTEXT_TOKENS) : null);
    for (const entry of LOCAL_MODEL_CATALOG) {
      const installedBytes = installed.get(entry.tag);
      const descriptor = byId.get(entry.tag);
      out.push({
        tag: entry.tag,
        label: entry.label,
        pitch: t(`settings.ai.catalog.${entry.pitchKey}`),
        sizeBytes: entry.sizeBytes,
        installedBytes,
        installed: installedBytes !== undefined,
        recommended: entry.recommended,
        capabilities: descriptor?.capabilities ?? entry.capabilities,
        catalog: entry,
        fit: fitFor({
          sizeBytes: installedBytes && installedBytes > 0 ? installedBytes : entry.sizeBytes,
          paramsB: entry.paramsB,
          activeParamsB: entry.activeParamsB,
          layers: entry.layers,
          quantBits: entry.quantBits,
          family: entry.family,
          vision: entry.capabilities.includes('vision'),
          measured: installedBytes !== undefined && installedBytes > 0,
          measuredTokensPerSecond: descriptor?.measuredTokensPerSecond,
        }),
      });
    }
    for (const [tag, bytes] of installed) {
      if (LOCAL_MODEL_CATALOG.some((c) => c.tag === tag)) continue;
      const descriptor: AiModelDescriptor | undefined = byId.get(tag);
      out.push({
        tag,
        label: tag,
        sizeBytes: bytes,
        installedBytes: bytes,
        installed: true,
        capabilities: descriptor?.capabilities ?? ['chat'],
        fit: fitFor({
          sizeBytes: bytes,
          paramsB: descriptor?.parameterCountB,
          activeParamsB: descriptor?.activeParameterCountB,
          quantBits: quantBitsFromLabel(descriptor?.quantization),
          family: descriptor?.family,
          tag,
          vision: descriptor?.capabilities.includes('vision'),
          measured: bytes > 0,
          measuredTokensPerSecond: descriptor?.measuredTokensPerSecond,
        }),
      });
    }
    out.sort((a, b) => {
      if (a.installed !== b.installed) return a.installed ? -1 : 1;
      const fa = a.fit ? fitRank(a.fit.label) : 9;
      const fb = b.fit ? fitRank(b.fit.label) : 9;
      if (fa !== fb) return fa - fb;
      if (Boolean(a.recommended) !== Boolean(b.recommended)) return a.recommended ? -1 : 1;
      return (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0);
    });
    return out;
  }, [byId, hardware, installed, t]);

  const visible = onlyFits ? rows.filter((r) => r.installed || (r.fit && r.fit.label !== 'no-fit')) : rows;

  const stageLabel = (stage: string): string => {
    if (stage === 'downloading') return t('settings.ai.local.downloading');
    if (stage === 'extracting') return t('settings.ai.local.extracting');
    if (stage === 'starting') return t('settings.ai.local.starting');
    return stage;
  };
  const pullStageLabel = (status: string): string => {
    if (status === 'pulling manifest' || status === '') return t('settings.ai.local.preparing');
    if (status.startsWith('pulling')) return t('settings.ai.local.downloading');
    if (status.startsWith('verifying')) return t('settings.ai.local.verifying');
    if (status.startsWith('writing') || status === 'success') return t('settings.ai.local.finishing');
    return status;
  };

  const adoptModel = async (tag: string) => {
    await setDefault('chat', { connectionId: BUILTIN_OLLAMA_ID, modelId: tag });
    await setLocalModel(tag);
  };

  const pendingDeleteInfo = pendingDeleteTag ? installed.get(pendingDeleteTag) : undefined;

  return (
    <section className="space-y-3">
      <div className="flex items-start gap-2">
        <Cpu size={14} className="text-accent-gold mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-sm text-text-primary font-medium">{t('settings.ai.localModels.title')}</p>
          <p className="text-[10px] text-text-dim mt-0.5">{t('settings.ai.localModels.subtitle')}</p>
        </div>
      </div>

      <HardwareStrip hardware={hardware} onRefresh={() => void loadHardware(true)} />

      {/* Runtime state */}
      {!supported && !live && (
        <div className="px-3 py-2 bg-elevated rounded-lg text-[10px] text-text-dim space-y-2">
          <p>{t('settings.ai.local.notWindows')}</p>
          <button type="button" onClick={() => void refreshLocalStatus()} className="px-3 py-1.5 text-xs bg-surface border border-border rounded-lg text-text-muted hover:text-text-primary hover:border-accent-gold/30 transition">
            {t('settings.ai.local.retryDetect')}
          </button>
        </div>
      )}
      {supported && state === 'absent' && !localStatus?.runtimeInstalled && (
        <div className="space-y-2">
          <button type="button" onClick={() => void downloadRuntime()} className="w-full flex items-center justify-center gap-2 py-2.5 bg-accent-gold text-deep font-semibold rounded-lg hover:bg-accent-amber transition">
            <Download size={15} />
            {t('settings.ai.local.downloadRuntime')}
          </button>
          <p className="text-[10px] text-text-dim">{t('settings.ai.local.runtimeNote')}</p>
          {runtimeProgress.error && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 text-red-400 text-xs rounded-lg">
              <XCircle size={14} />
              <span>{runtimeProgress.error}</span>
            </div>
          )}
        </div>
      )}
      {busyRuntime && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin text-accent-gold" />
            <span className="text-sm text-text-primary">{stageLabel(runtimeProgress.stage)}</span>
          </div>
          <ProgressBar progress={runtimeProgress.progress} indeterminate={runtimeProgress.stage !== 'downloading' || runtimeProgress.progress === 0} />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-text-muted tabular-nums">
              {runtimeProgress.stage === 'downloading' && runtimeProgress.progress > 0 ? `${Math.round(runtimeProgress.progress * 100)}%` : ''}
            </span>
            {runtimeProgress.stage === 'downloading' && (
              <button type="button" onClick={() => void cancelRuntimeDownload()} className="text-[11px] text-text-dim hover:text-danger transition flex items-center gap-1">
                <X size={11} />
                {t('settings.ai.local.cancel')}
              </button>
            )}
          </div>
        </div>
      )}
      {state === 'error' && (
        <div className="space-y-2">
          <div className="flex items-start gap-2 px-3 py-2 bg-red-500/10 text-red-400 text-xs rounded-lg">
            <XCircle size={14} className="mt-0.5 flex-shrink-0" />
            <span className="whitespace-pre-wrap break-all">
              {t('settings.ai.local.stateError')}
              {localStatus?.error ? ` — ${localStatus.error}` : ''}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (localStatus?.runtimeInstalled) void refreshLocalStatus();
              else void downloadRuntime();
            }}
            className="px-3 py-1.5 text-xs bg-surface border border-border rounded-lg text-text-muted hover:text-text-primary hover:border-accent-gold/30 transition"
          >
            {t('settings.ai.local.retry')}
          </button>
        </div>
      )}
      {live && (
        <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 text-green-400 text-xs rounded-lg">
          <CheckCircle2 size={14} />
          <span>{state === 'external' ? t('settings.ai.local.external') : t('settings.ai.local.running')}</span>
        </div>
      )}

      {/* Catalogue */}
      <div className="flex items-center justify-between">
        <label className="text-sm text-text-muted flex items-center gap-1.5">
          <Cpu size={13} />
          {t('settings.ai.local.models')}
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
          <input type="checkbox" checked={onlyFits} onChange={(e) => setOnlyFits(e.target.checked)} />
          {t('settings.ai.localModels.onlyFits')}
        </label>
      </div>
      <div className="space-y-1.5">
        {visible.map((row) => {
          const isSelected = defaultTag === row.tag;
          const isPulling = pullProgress.running && pullProgress.tag === row.tag;
          const pullError = !pullProgress.running && pullProgress.tag === row.tag ? pullProgress.error : null;
          return (
            <div key={row.tag} className={`px-4 py-2.5 rounded-lg border transition text-sm ${isSelected && row.installed ? 'border-accent-gold/40 bg-accent-gold/5' : 'border-border'}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`font-medium truncate ${isSelected && row.installed ? 'text-accent-gold' : 'text-text-primary'}`}>{row.label}</span>
                  {row.recommended && !row.installed && <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent-plum/20 text-accent-plum-light uppercase tracking-wide">{t('settings.ai.localModels.recommended')}</span>}
                  <FitBadge fit={row.fit} />
                </div>
                <span className="text-[10px] text-text-dim flex-shrink-0 tabular-nums">
                  {row.installed && row.installedBytes ? t('settings.ai.local.installedSize').replace('{size}', formatBytes(row.installedBytes)) : formatBytes(row.sizeBytes)}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 flex-wrap text-[10px] text-text-dim">
                <span className="font-mono">{row.tag}</span>
                {row.capabilities.includes('tools') && <span className="px-1 rounded bg-elevated">{t('settings.ai.cap.tools')}</span>}
                {row.capabilities.includes('vision') && <span className="px-1 rounded bg-elevated">{t('settings.ai.cap.vision')}</span>}
                {row.catalog && <span>{Math.round(row.catalog.contextWindow / 1024)}K ctx</span>}
              </div>
              {row.pitch && <p className="text-[10px] text-text-dim mt-0.5">{row.pitch}</p>}

              {isPulling ? (
                <div className="mt-2 space-y-1.5">
                  <ProgressBar progress={pullProgress.progress} />
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-text-muted tabular-nums">
                      {pullStageLabel(pullProgress.stage)}
                      {pullProgress.totalBytes > 0 && ` · ${formatBytes(pullProgress.completedBytes)} / ${formatBytes(pullProgress.totalBytes)}`}
                    </span>
                    <button type="button" onClick={() => void cancelPull(row.tag)} className="text-[11px] text-text-dim hover:text-danger transition flex items-center gap-1">
                      <X size={11} />
                      {t('settings.ai.local.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex items-center justify-end gap-1.5">
                  {row.installed ? (
                    <>
                      {isSelected ? (
                        <span className="text-[11px] px-2 py-1 rounded bg-accent-gold/15 text-accent-gold font-medium">{t('settings.ai.local.inUse')}</span>
                      ) : (
                        <button type="button" onClick={() => void adoptModel(row.tag)} className="text-[11px] px-2 py-1 rounded bg-elevated text-text-muted hover:text-accent-gold transition">
                          {t('settings.ai.local.use')}
                        </button>
                      )}
                      <button type="button" onClick={() => setPendingDeleteTag(row.tag)} title={t('settings.ai.local.delete')} className="p-1.5 rounded text-text-dim hover:text-danger hover:bg-danger/10 transition">
                        <Trash2 size={12} />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void pullModel(row.tag)}
                      disabled={pullProgress.running || (!live && !supported) || row.fit?.label === 'no-fit'}
                      title={row.fit?.label === 'no-fit' ? t('settings.ai.fit.no-fit.hint') : undefined}
                      className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded bg-accent-gold/10 text-accent-gold hover:bg-accent-gold/20 transition disabled:opacity-50"
                    >
                      <Download size={11} />
                      {t('settings.ai.local.download')}
                    </button>
                  )}
                </div>
              )}
              {pullError && (
                <div className="mt-2 flex items-center gap-2 px-2 py-1.5 bg-red-500/10 text-red-400 text-[11px] rounded">
                  <XCircle size={12} className="flex-shrink-0" />
                  <span className="break-all">{pullError}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-text-dim">{t('settings.ai.localModels.fitNote')}</p>
      <p className="text-[10px] text-text-dim">{t('settings.ai.local.diskNote')}</p>

      <ConfirmDialog
        open={pendingDeleteTag !== null}
        destructive
        message={t('settings.ai.local.deleteConfirm')
          .replace('{model}', pendingDeleteTag ?? '')
          .replace('{size}', pendingDeleteInfo && pendingDeleteInfo > 0 ? formatBytes(pendingDeleteInfo) : '—')}
        onConfirm={() => {
          const tag = pendingDeleteTag;
          setPendingDeleteTag(null);
          if (tag) void deleteModel(tag);
        }}
        onCancel={() => setPendingDeleteTag(null)}
      />
    </section>
  );
}
