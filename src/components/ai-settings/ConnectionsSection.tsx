// ============================================================================
// AI settings — connections by IP/URL
// ============================================================================
//
// Add a server (Ollama on another machine, LM Studio, llama.cpp, vLLM, a
// proxy exposing an OpenAI-style API, Odysseus's image server…), test it,
// see its models and latency, keep an API key encrypted. "Detect on this
// computer" probes a short allowlist of loopback ports — never the LAN.

import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Globe,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Radar,
  RefreshCw,
  Server,
  Trash2,
  Wifi,
  XCircle,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ConfirmDialog } from '@/engines/_shared';
import { useAiRuntimeStore } from '@/stores/aiRuntimeStore';
import { normaliseBaseUrl } from '@/services/aiRuntime/urlPolicy';
import type { AiConnectionInput, AiConnectionSummary, AiDiscoveredServer, AiProbeResult } from '@/services/aiRuntime/types';
import { toast } from '@/components/common/toast';

type Draft = AiConnectionInput & { secret: string };

const EMPTY_DRAFT: Draft = {
  name: '',
  kind: 'openai-compatible',
  baseUrl: '',
  enabled: true,
  modelTypes: ['chat'],
  pinnedModels: [],
  allowInsecureRemote: false,
  secret: '',
};

function LocalityBadge({ locality }: { locality: AiConnectionSummary['locality'] }) {
  const { t } = useTranslation();
  const tone =
    locality === 'remote'
      ? 'bg-warning/15 text-warning'
      : locality === 'lan'
        ? 'bg-yarn-blue/15 text-yarn-blue'
        : 'bg-success/15 text-success';
  return <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide ${tone}`}>{t(`settings.ai.locality.${locality}`)}</span>;
}

function StatusDot({ connection }: { connection: AiConnectionSummary }) {
  const { t } = useTranslation();
  const color =
    connection.status === 'online'
      ? 'bg-success'
      : connection.status === 'loading'
        ? 'bg-accent-gold animate-pulse'
        : connection.status === 'offline' || connection.status === 'error'
          ? 'bg-danger'
          : 'bg-text-dim';
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] text-text-dim" title={connection.lastError ?? ''}>
      <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
      {t(`settings.ai.status.${connection.status}`)}
      {connection.status === 'online' && typeof connection.latencyMs === 'number' ? ` · ${connection.latencyMs} ms` : ''}
    </span>
  );
}

export default function ConnectionsSection() {
  const { t } = useTranslation();
  const {
    connections,
    modelsByConnection,
    loadConnections,
    saveConnection,
    deleteConnection,
    setSecret,
    probe,
    loadModels,
    discoverLocal,
    discovering,
    discovered,
    defaults,
    setDefault,
  } = useAiRuntimeStore();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [testResult, setTestResult] = useState<AiProbeResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [showDiscovered, setShowDiscovered] = useState(false);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  const preview = useMemo(() => (editing ? normaliseBaseUrl(editing.baseUrl) : null), [editing]);

  const startAdd = (seed?: Partial<Draft>) => {
    setError(null);
    setTestResult(null);
    setEditing({ ...EMPTY_DRAFT, ...seed });
  };

  const startEdit = (connection: AiConnectionSummary) => {
    setError(null);
    setTestResult(null);
    setEditing({
      id: connection.id,
      name: connection.name,
      kind: connection.kind,
      baseUrl: connection.baseUrl,
      enabled: connection.enabled,
      modelTypes: connection.modelTypes,
      pinnedModels: connection.pinnedModels,
      allowInsecureRemote: connection.allowInsecureRemote ?? false,
      secret: '',
    });
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const { secret, ...input } = editing;
      const result = await saveConnection(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (secret.trim()) {
        const secretResult = await setSecret(result.connection.id, secret);
        if (!secretResult.ok) {
          setError(secretResult.error ?? 'error');
          return;
        }
      }
      setEditing(null);
      toast.success(t('settings.ai.connections.saved'));
      void probe(result.connection.id);
    } finally {
      setSaving(false);
    }
  };

  /** Test the draft without saving: a throwaway save is not acceptable, so the
   * draft is saved only when it is already an existing connection; a brand
   * new one is saved first, then probed — the user asked for it to exist. */
  const testDraft = async () => {
    if (!editing) return;
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const { secret, ...input } = editing;
      const result = await saveConnection(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (secret.trim()) await setSecret(result.connection.id, secret);
      setEditing((d) => (d ? { ...d, id: result.connection.id, secret: '' } : d));
      const probed = await probe(result.connection.id);
      setTestResult(probed);
    } finally {
      setTesting(false);
    }
  };

  const clearSecret = async () => {
    if (!editing?.id) return;
    const result = await setSecret(editing.id, '');
    if (!result.ok) setError(result.error ?? 'error');
  };

  const addDiscovered = (server: AiDiscoveredServer) => {
    startAdd({ name: server.label, kind: server.kind, baseUrl: server.baseUrl, modelTypes: /image/i.test(server.label) ? ['image'] : ['chat'] });
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-start gap-2">
          <Server size={14} className="text-accent-gold mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm text-text-primary font-medium">{t('settings.ai.connections.title')}</p>
            <p className="text-[10px] text-text-dim mt-0.5">{t('settings.ai.connections.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            type="button"
            onClick={() => {
              setShowDiscovered(true);
              void discoverLocal();
            }}
            disabled={discovering}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-border text-text-muted hover:text-text-primary hover:border-accent-gold/30 transition disabled:opacity-50"
          >
            {discovering ? <Loader2 size={12} className="animate-spin" /> : <Radar size={12} />}
            {t('settings.ai.connections.detect')}
          </button>
          <button
            type="button"
            onClick={() => startAdd()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-accent-gold text-deep font-semibold hover:bg-accent-amber transition"
          >
            <Plus size={12} />
            {t('settings.ai.connections.add')}
          </button>
        </div>
      </div>

      {showDiscovered && (
        <div className="rounded-lg border border-border bg-elevated p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-text-primary">{t('settings.ai.connections.detectTitle')}</p>
            <button type="button" onClick={() => setShowDiscovered(false)} className="text-[10px] text-text-dim hover:text-text-primary">
              {t('common.close')}
            </button>
          </div>
          {discovering ? (
            <p className="text-[11px] text-text-dim flex items-center gap-1.5">
              <Loader2 size={11} className="animate-spin" />
              {t('settings.ai.connections.detecting')}
            </p>
          ) : discovered.length === 0 ? (
            <p className="text-[11px] text-text-dim">{t('settings.ai.connections.detectNone')}</p>
          ) : (
            discovered.map((server) => (
              <div key={server.baseUrl} className="flex items-center gap-2 text-xs">
                <Wifi size={12} className="text-success flex-shrink-0" />
                <span className="text-text-primary">{server.label}</span>
                <span className="font-mono text-text-dim">{server.baseUrl}</span>
                <span className="text-text-dim">· {server.modelCount} {t('settings.ai.connections.models')} · {server.latencyMs} ms</span>
                {server.known ? (
                  <span className="ml-auto text-[10px] text-text-dim">{t('settings.ai.connections.alreadyAdded')}</span>
                ) : (
                  <button type="button" onClick={() => addDiscovered(server)} className="ml-auto text-[11px] text-accent-gold hover:underline">
                    {t('settings.ai.connections.add')}
                  </button>
                )}
              </div>
            ))
          )}
          <p className="text-[10px] text-text-dim">{t('settings.ai.connections.detectNote')}</p>
        </div>
      )}

      {editing && (
        <div className="rounded-lg border border-accent-gold/40 bg-accent-gold/5 p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[11px] text-text-muted mb-1">{t('settings.ai.connections.name')}</span>
              <input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder={t('settings.ai.connections.namePlaceholder')}
                className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold transition"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] text-text-muted mb-1">{t('settings.ai.connections.kind')}</span>
              <select
                value={editing.kind}
                onChange={(e) => setEditing({ ...editing, kind: e.target.value === 'ollama' ? 'ollama' : 'openai-compatible' })}
                className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold transition"
              >
                <option value="openai-compatible">{t('settings.ai.connections.kind.openai')}</option>
                <option value="ollama">{t('settings.ai.connections.kind.ollama')}</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="block text-[11px] text-text-muted mb-1">{t('settings.ai.connections.address')}</span>
            <input
              value={editing.baseUrl}
              onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })}
              placeholder="192.168.1.20:1234  ·  http://host:8080/v1  ·  https://api.example.com"
              className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold transition font-mono"
            />
            <span className="block text-[10px] text-text-dim mt-1 font-mono">
              {preview?.ok
                ? `→ ${preview.baseUrl}${editing.kind === 'openai-compatible' && !/\/v\d+$/.test(preview.baseUrl) ? '/v1' : ''}  (${t(`settings.ai.locality.${preview.locality}`)})`
                : editing.baseUrl
                  ? t('settings.ai.connections.badAddress')
                  : t('settings.ai.connections.addressHint')}
            </span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[11px] text-text-muted mb-1 flex items-center gap-1">
                <KeyRound size={11} />
                {t('settings.ai.connections.apiKey')}
              </span>
              <input
                type="password"
                value={editing.secret}
                onChange={(e) => setEditing({ ...editing, secret: e.target.value })}
                placeholder={
                  editing.id && connections.find((c) => c.id === editing.id)?.hasSecret
                    ? `${t('settings.ai.connections.keyStored')} ${connections.find((c) => c.id === editing.id)?.secretHint ?? ''}`
                    : t('settings.ai.connections.keyOptional')
                }
                autoComplete="off"
                className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold transition font-mono"
              />
              {editing.id && connections.find((c) => c.id === editing.id)?.hasSecret && (
                <button type="button" onClick={() => void clearSecret()} className="text-[10px] text-text-dim hover:text-danger mt-1">
                  {t('settings.ai.connections.clearKey')}
                </button>
              )}
            </label>
            <label className="block">
              <span className="block text-[11px] text-text-muted mb-1">{t('settings.ai.connections.pinned')}</span>
              <input
                value={(editing.pinnedModels ?? []).join(', ')}
                onChange={(e) => setEditing({ ...editing, pinnedModels: e.target.value.split(',').map((m) => m.trim()).filter(Boolean) })}
                placeholder={t('settings.ai.connections.pinnedPlaceholder')}
                className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold transition font-mono"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-[11px] text-text-muted">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={(editing.modelTypes ?? []).includes('chat')}
                onChange={(e) => {
                  const set = new Set(editing.modelTypes ?? []);
                  if (e.target.checked) set.add('chat');
                  else set.delete('chat');
                  setEditing({ ...editing, modelTypes: [...set] });
                }}
              />
              {t('settings.ai.connections.servesChat')}
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={(editing.modelTypes ?? []).includes('image')}
                onChange={(e) => {
                  const set = new Set(editing.modelTypes ?? []);
                  if (e.target.checked) set.add('image');
                  else set.delete('image');
                  setEditing({ ...editing, modelTypes: [...set] });
                }}
              />
              {t('settings.ai.connections.servesImages')}
            </label>
            {preview?.ok && preview.locality === 'remote' && preview.protocol === 'http:' && (
              <label className="flex items-center gap-1.5 text-warning">
                <input
                  type="checkbox"
                  checked={editing.allowInsecureRemote === true}
                  onChange={(e) => setEditing({ ...editing, allowInsecureRemote: e.target.checked })}
                />
                {t('settings.ai.connections.allowInsecure')}
              </label>
            )}
          </div>

          {testResult && (
            <div
              className={`flex items-start gap-2 px-3 py-2 text-xs rounded-lg ${
                testResult.ok ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
              }`}
            >
              {testResult.ok ? <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" /> : <XCircle size={14} className="mt-0.5 flex-shrink-0" />}
              <span className="break-words">
                {testResult.ok
                  ? t('settings.ai.connections.testOk')
                      .replace('{count}', String(testResult.models?.length ?? 0))
                      .replace('{ms}', String(testResult.latencyMs ?? 0))
                  : testResult.error}
              </span>
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 bg-danger/10 text-danger text-xs rounded-lg">
              <XCircle size={14} />
              <span>{error}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void testDraft()}
              disabled={testing || !preview?.ok}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border text-text-muted hover:text-text-primary hover:border-accent-gold/30 transition disabled:opacity-50"
            >
              {testing ? <Loader2 size={12} className="animate-spin" /> : <Wifi size={12} />}
              {t('settings.ai.connections.test')}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !preview?.ok}
              className="px-3 py-1.5 text-xs rounded-lg bg-accent-gold text-deep font-semibold hover:bg-accent-amber transition disabled:opacity-50"
            >
              {t('common.save')}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="px-3 py-1.5 text-xs rounded-lg text-text-muted hover:text-text-primary transition">
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {connections.map((connection) => {
          const models = modelsByConnection[connection.id];
          const isChatDefault = defaults.chat?.connectionId === connection.id;
          const isImageDefault = defaults.image?.connectionId === connection.id;
          return (
            <div key={connection.id} className={`rounded-lg border px-3 py-2.5 ${connection.enabled ? 'border-border' : 'border-border/50 opacity-60'}`}>
              <div className="flex items-center gap-2 flex-wrap">
                {connection.builtin ? <Globe size={13} className="text-accent-gold" /> : <Server size={13} className="text-text-muted" />}
                <span className="text-sm text-text-primary font-medium">{connection.name}</span>
                <span className="px-1.5 py-0.5 rounded bg-elevated text-[9px] text-text-dim uppercase tracking-wide">
                  {connection.kind === 'ollama' ? 'Ollama' : connection.kind === 'sdcpp' ? t('settings.ai.kind.sdcpp') : 'OpenAI API'}
                </span>
                <LocalityBadge locality={connection.locality} />
                {connection.hasSecret && (
                  <span className="text-[9px] text-text-dim flex items-center gap-0.5" title={connection.secretHint}>
                    <KeyRound size={9} />
                    {connection.secretHint}
                  </span>
                )}
                {(isChatDefault || isImageDefault) && (
                  <span className="text-[9px] text-accent-gold">
                    {[isChatDefault ? t('settings.ai.defaults.chatShort') : null, isImageDefault ? t('settings.ai.defaults.imageShort') : null].filter(Boolean).join(' · ')}
                  </span>
                )}
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void probe(connection.id).then(() => loadModels(connection.id, true))}
                    title={t('settings.ai.connections.test')}
                    className="p-1.5 rounded text-text-dim hover:text-accent-gold transition"
                  >
                    <RefreshCw size={12} className={connection.status === 'loading' ? 'animate-spin' : ''} />
                  </button>
                  {!connection.builtin && (
                    <>
                      <button type="button" onClick={() => startEdit(connection)} title={t('common.edit')} className="p-1.5 rounded text-text-dim hover:text-accent-gold transition">
                        <Pencil size={12} />
                      </button>
                      <button type="button" onClick={() => setPendingDelete(connection.id)} title={t('common.delete')} className="p-1.5 rounded text-text-dim hover:text-danger transition">
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="mt-1 flex items-center gap-3 flex-wrap text-[10px] text-text-dim">
                <span className="font-mono">{connection.baseUrl}</span>
                <StatusDot connection={connection} />
                {models && !models.loading && (
                  <span>
                    {models.models.length} {t('settings.ai.connections.models')}
                  </span>
                )}
                {models?.error && <span className="text-danger break-all">{models.error}</span>}
              </div>
              {models && models.models.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {models.models.slice(0, 12).map((model) => {
                    const isDefault =
                      (defaults.chat?.connectionId === connection.id && defaults.chat.modelId === model.id) ||
                      (defaults.image?.connectionId === connection.id && defaults.image.modelId === model.id);
                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => void setDefault(model.type === 'image' ? 'image' : 'chat', { connectionId: connection.id, modelId: model.id })}
                        title={t('settings.ai.connections.useAsDefault')}
                        className={`px-1.5 py-0.5 rounded border text-[10px] font-mono transition ${
                          isDefault ? 'border-accent-gold/50 text-accent-gold bg-accent-gold/10' : 'border-border text-text-muted hover:text-text-primary hover:border-accent-gold/30'
                        }`}
                      >
                        {model.id}
                        {model.type === 'image' ? ' 🖼' : model.capabilities.includes('tools') ? '' : ' ·'}
                      </button>
                    );
                  })}
                  {models.models.length > 12 && <span className="text-[10px] text-text-dim self-center">+{models.models.length - 12}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        destructive
        message={t('settings.ai.connections.deleteConfirm').replace('{name}', connections.find((c) => c.id === pendingDelete)?.name ?? '')}
        onConfirm={() => {
          const id = pendingDelete;
          setPendingDelete(null);
          if (id) void deleteConnection(id);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}
