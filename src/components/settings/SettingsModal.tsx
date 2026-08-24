import { useState, useEffect } from 'react';
import { Settings, Loader2, CheckCircle2, XCircle, Wifi, Globe, Download, Trash2, X, Cpu } from 'lucide-react';
import Modal from '@/components/common/Modal';
import { useAiStore } from '@/stores/aiStore';
import { useLocaleStore, type Locale } from '@/stores/localeStore';
import { AVAILABLE_MODELS, LOCAL_MODELS } from '@/config/ai';
import { ConfirmDialog } from '@/engines/_shared';
import { useTranslation } from '@/i18n/useTranslation';
import type { AiConfig } from '@/types';

function fmtGB(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const LANGUAGES: { id: Locale; label: string; flag: string }[] = [
  { id: 'es', label: 'Español (Castellano)', flag: '🇪🇸' },
  { id: 'en', label: 'English', flag: '🇬🇧' },
];

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { t } = useTranslation();
  const { locale, setLocale } = useLocaleStore();
  const { config, isConnected, availableModels, isLoading, error, loadSettings, saveSettings, checkConnection } = useAiStore();

  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [model, setModel] = useState(config.model);
  const [enabled, setEnabled] = useState(config.enabled);
  const [provider, setProviderMirror] = useState<AiConfig['provider']>(config.provider);
  const setProvider = useAiStore((s) => s.setProvider);

  useEffect(() => {
    if (open) {
      loadSettings().then(() => {
        const s = useAiStore.getState();
        setBaseUrl(s.config.baseUrl);
        setModel(s.config.model);
        setEnabled(s.config.enabled);
        setProviderMirror(s.config.provider);
        // Idempotent probe — safe under StrictMode's double-invoke.
        if (s.config.provider === 'local' && s.config.enabled) {
          void s.refreshLocalStatus();
        }
      });
    }
  }, [open, loadSettings]);

  const handleSave = async () => {
    await saveSettings({ baseUrl, model, enabled });
  };

  const handleTestConnection = () => {
    saveSettings({ baseUrl }).then(() => checkConnection());
  };

  return (
    <Modal open={open} onClose={onClose} title={t('settings.title')}>
      <div className="space-y-6">

        {/* ── Language ── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Globe size={14} className="text-accent-gold" />
            <h3 className="text-sm font-medium text-text-primary">{t('settings.language')}</h3>
          </div>
          <p className="text-[10px] text-text-dim mb-2">{t('settings.language.subtitle')}</p>
          <div className="space-y-1.5">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.id}
                onClick={() => setLocale(lang.id)}
                className={`w-full text-left px-4 py-2.5 rounded-lg border transition text-sm flex items-center gap-3 ${
                  locale === lang.id
                    ? 'border-accent-gold/40 bg-accent-gold/5'
                    : 'border-border hover:border-accent-gold/20'
                }`}
              >
                <span className="text-base">{lang.flag}</span>
                <span className={`font-medium ${locale === lang.id ? 'text-accent-gold' : 'text-text-primary'}`}>
                  {lang.label}
                </span>
              </button>
            ))}
          </div>
        </section>

        <div className="border-t border-border" />

        {/* ── AI Assistant ── */}
        <section>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-primary font-medium">{t('settings.ai.title')}</p>
              <p className="text-[10px] text-text-dim mt-0.5">{t('settings.ai.subtitle')}</p>
            </div>
            <button
              onClick={() => { setEnabled(!enabled); saveSettings({ enabled: !enabled }); }}
              className={`relative w-11 h-6 rounded-full transition ${
                enabled ? 'bg-accent-gold' : 'bg-elevated'
              }`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  enabled ? 'translate-x-5.5 left-0' : 'left-0.5'
                }`}
                style={{ transform: enabled ? 'translateX(22px)' : 'translateX(0)' }}
              />
            </button>
          </div>

          {enabled && (
            <div className="mt-4 space-y-4">
              {/* Provider selector — Claude via CLIProxyAPI, or the embedded
                  local runtime ("one click → a big free local model"). */}
              <div>
                <label className="block text-sm text-text-muted mb-1.5">{t('settings.ai.provider')}</label>
                <div className="space-y-1.5">
                  {([
                    { id: 'proxy' as const, label: t('settings.ai.provider.proxy'), desc: t('settings.ai.provider.proxyDesc') },
                    { id: 'local' as const, label: t('settings.ai.provider.local'), desc: t('settings.ai.provider.localDesc') },
                  ]).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setProviderMirror(p.id);
                        void setProvider(p.id);
                      }}
                      className={`w-full text-left px-4 py-2.5 rounded-lg border transition text-sm ${
                        provider === p.id
                          ? 'border-accent-gold/40 bg-accent-gold/5'
                          : 'border-border hover:border-accent-gold/20'
                      }`}
                    >
                      <span className={`font-medium ${provider === p.id ? 'text-accent-gold' : 'text-text-primary'}`}>
                        {p.label}
                      </span>
                      <span className="text-[10px] text-text-dim ml-2">{p.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {provider === 'local' ? (
                <LocalAiPane />
              ) : (
                <>
              {/* Proxy URL */}
              <div>
                <label className="block text-sm text-text-muted mb-1.5">{t('settings.ai.proxyUrl')}</label>
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  onBlur={handleSave}
                  placeholder="http://localhost:8317"
                  className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold transition font-mono"
                />
              </div>

              {/* Model selector */}
              <div>
                <label className="block text-sm text-text-muted mb-1.5">{t('settings.ai.model')}</label>
                <div className="space-y-1.5">
                  {AVAILABLE_MODELS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => { setModel(m.id); saveSettings({ model: m.id }); }}
                      className={`w-full text-left px-4 py-2.5 rounded-lg border transition text-sm ${
                        model === m.id
                          ? 'border-accent-gold/40 bg-accent-gold/5'
                          : 'border-border hover:border-accent-gold/20'
                      }`}
                    >
                      <span className={`font-medium ${model === m.id ? 'text-accent-gold' : 'text-text-primary'}`}>
                        {m.label}
                      </span>
                      <span className="text-[10px] text-text-dim ml-2">{m.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Test connection */}
              <div className="space-y-2">
                <button
                  onClick={handleTestConnection}
                  disabled={isLoading}
                  className="w-full py-2.5 bg-elevated border border-border rounded-lg text-sm text-text-muted hover:text-text-primary hover:border-accent-gold/30 transition inline-flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isLoading ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      {t('settings.ai.testing')}
                    </>
                  ) : (
                    <>
                      <Wifi size={14} />
                      {t('settings.ai.testConnection')}
                    </>
                  )}
                </button>

                {!isLoading && isConnected && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 text-green-400 text-xs rounded-lg">
                    <CheckCircle2 size={14} />
                    <span>
                      {t('settings.ai.connected')} — {availableModels.length}{' '}
                      {availableModels.length !== 1 ? t('settings.ai.modelsAvailablePlural') : t('settings.ai.modelsAvailable')}{' '}
                      {availableModels.length !== 1 ? t('settings.ai.availablePlural') : t('settings.ai.available')}
                    </span>
                  </div>
                )}

                {!isLoading && error && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 text-red-400 text-xs rounded-lg">
                    <XCircle size={14} />
                    <span>{error}</span>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="px-3 py-2 bg-elevated rounded-lg text-[10px] text-text-dim space-y-1">
                <p className="flex items-center gap-1.5">
                  <Settings size={10} />
                  {t('settings.ai.requirement')}
                </p>
                <p>{t('settings.ai.quotaNote')}</p>
              </div>
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// LocalAiPane — the embedded Ollama runtime + curated model catalog
// ---------------------------------------------------------------------------
//
// Renders by runtime state (absent → downloading → extracting → starting →
// running/external/error). Progress bars copy the worldgen overlay's look.
// All actions go through aiStore → IPC → electron/ollama.ts.

function ProgressBar({ progress, indeterminate }: { progress: number; indeterminate?: boolean }) {
  return (
    <div className="h-1.5 rounded-full bg-elevated overflow-hidden">
      {indeterminate ? (
        <div className="h-full w-full bg-accent-gold/60 animate-pulse" />
      ) : (
        <div
          className="h-full bg-accent-gold transition-[width] duration-200"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      )}
    </div>
  );
}

function LocalAiPane() {
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
  const [pendingDeleteTag, setPendingDeleteTag] = useState<string | null>(null);

  const state = localStatus?.state ?? 'absent';
  const supported = localStatus?.supported ?? false;
  const installedModels = localStatus?.models ?? [];
  const installedNames = new Set(installedModels.map((m) => m.name));
  const live = state === 'running' || state === 'external';
  const busyRuntime = state === 'downloading-runtime' || state === 'extracting' || state === 'starting';

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

  // Catalog cards + any extra models an external Ollama already has.
  const extraModels = installedModels.filter(
    (m) => !LOCAL_MODELS.some((c) => c.tag === m.name),
  );
  const pendingDeleteInfo = pendingDeleteTag
    ? installedModels.find((m) => m.name === pendingDeleteTag)
    : undefined;

  return (
    <div className="space-y-3">
      {/* Runtime status strip */}
      {!supported && !live && (
        <div className="px-3 py-2 bg-elevated rounded-lg text-[10px] text-text-dim space-y-2">
          <p>{t('settings.ai.local.notWindows')}</p>
          <button
            onClick={() => void refreshLocalStatus()}
            className="px-3 py-1.5 text-xs bg-surface border border-border rounded-lg text-text-muted hover:text-text-primary hover:border-accent-gold/30 transition"
          >
            {t('settings.ai.local.retryDetect')}
          </button>
        </div>
      )}

      {supported && state === 'absent' && !localStatus?.runtimeInstalled && (
        <div className="space-y-2">
          <button
            onClick={() => void downloadRuntime()}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-accent-gold text-deep font-semibold rounded-lg hover:bg-accent-amber transition"
          >
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
          <ProgressBar
            progress={runtimeProgress.progress}
            indeterminate={runtimeProgress.stage !== 'downloading' || runtimeProgress.progress === 0}
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-text-muted tabular-nums">
              {runtimeProgress.stage === 'downloading' && runtimeProgress.progress > 0
                ? `${Math.round(runtimeProgress.progress * 100)}%`
                : ''}
            </span>
            {runtimeProgress.stage === 'downloading' && (
              <button
                onClick={() => void cancelRuntimeDownload()}
                className="text-[11px] text-text-dim hover:text-danger transition flex items-center gap-1"
              >
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
          <span>
            {state === 'external' ? t('settings.ai.local.external') : t('settings.ai.local.running')}
          </span>
        </div>
      )}

      {/* Model catalog */}
      <div>
        <label className="block text-sm text-text-muted mb-1.5 flex items-center gap-1.5">
          <Cpu size={13} />
          {t('settings.ai.local.models')}
        </label>
        <div className="space-y-1.5">
          {LOCAL_MODELS.map((m) => {
            const isInstalled = installedNames.has(m.tag);
            const isSelected = config.localModel === m.tag;
            const isPulling = pullProgress.running && pullProgress.tag === m.tag;
            const pullError = !pullProgress.running && pullProgress.tag === m.tag ? pullProgress.error : null;
            const installedInfo = installedModels.find((im) => im.name === m.tag);
            return (
              <div
                key={m.tag}
                className={`px-4 py-2.5 rounded-lg border transition text-sm ${
                  isSelected && isInstalled
                    ? 'border-accent-gold/40 bg-accent-gold/5'
                    : 'border-border'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-medium ${isSelected && isInstalled ? 'text-accent-gold' : 'text-text-primary'}`}>
                    {m.label}
                  </span>
                  <span className="text-[10px] text-text-dim flex-shrink-0">{m.sizeLabel}</span>
                </div>
                <p className="text-[10px] text-text-dim mt-0.5">{m.description}</p>

                {isPulling ? (
                  <div className="mt-2 space-y-1.5">
                    <ProgressBar progress={pullProgress.progress} />
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-text-muted tabular-nums">
                        {pullStageLabel(pullProgress.stage)}
                        {pullProgress.totalBytes > 0 &&
                          ` · ${fmtGB(pullProgress.completedBytes)} / ${fmtGB(pullProgress.totalBytes)}`}
                      </span>
                      <button
                        onClick={() => void cancelPull(m.tag)}
                        className="text-[11px] text-text-dim hover:text-danger transition flex items-center gap-1"
                      >
                        <X size={11} />
                        {t('settings.ai.local.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-text-dim">
                      {isInstalled && installedInfo && installedInfo.sizeBytes > 0
                        ? t('settings.ai.local.installedSize').replace('{size}', fmtGB(installedInfo.sizeBytes))
                        : ''}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {isInstalled ? (
                        <>
                          {isSelected ? (
                            <span className="text-[11px] px-2 py-1 rounded bg-accent-gold/15 text-accent-gold font-medium">
                              {t('settings.ai.local.inUse')}
                            </span>
                          ) : (
                            <button
                              onClick={() => void setLocalModel(m.tag)}
                              className="text-[11px] px-2 py-1 rounded bg-elevated text-text-muted hover:text-accent-gold transition"
                            >
                              {t('settings.ai.local.use')}
                            </button>
                          )}
                          <button
                            onClick={() => setPendingDeleteTag(m.tag)}
                            title={t('settings.ai.local.delete')}
                            className="p-1.5 rounded text-text-dim hover:text-danger hover:bg-danger/10 transition"
                          >
                            <Trash2 size={12} />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => void pullModel(m.tag)}
                          disabled={pullProgress.running || (!live && !supported)}
                          className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded bg-accent-gold/10 text-accent-gold hover:bg-accent-gold/20 transition disabled:opacity-50"
                        >
                          <Download size={11} />
                          {t('settings.ai.local.download')}
                        </button>
                      )}
                    </div>
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

          {/* Models an external/system Ollama already has beyond the catalog */}
          {extraModels.map((m) => {
            const isSelected = config.localModel === m.name;
            return (
              <button
                key={m.name}
                onClick={() => void setLocalModel(m.name)}
                className={`w-full text-left px-4 py-2 rounded-lg border transition text-sm flex items-center justify-between gap-2 ${
                  isSelected
                    ? 'border-accent-gold/40 bg-accent-gold/5'
                    : 'border-border hover:border-accent-gold/20'
                }`}
              >
                <span className={`font-mono text-xs ${isSelected ? 'text-accent-gold' : 'text-text-primary'}`}>
                  {m.name}
                </span>
                <span className="text-[10px] text-text-dim flex-shrink-0">
                  {m.sizeBytes > 0 ? fmtGB(m.sizeBytes) : ''}
                  {isSelected ? ` · ${t('settings.ai.local.inUse')}` : ''}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-[10px] text-text-dim">{t('settings.ai.local.diskNote')}</p>

      <ConfirmDialog
        open={pendingDeleteTag !== null}
        destructive
        message={t('settings.ai.local.deleteConfirm')
          .replace('{model}', pendingDeleteTag ?? '')
          .replace('{size}', pendingDeleteInfo && pendingDeleteInfo.sizeBytes > 0 ? fmtGB(pendingDeleteInfo.sizeBytes) : '—')}
        onConfirm={() => {
          const tag = pendingDeleteTag;
          setPendingDeleteTag(null);
          if (tag) void deleteModel(tag);
        }}
        onCancel={() => setPendingDeleteTag(null)}
      />
    </div>
  );
}
