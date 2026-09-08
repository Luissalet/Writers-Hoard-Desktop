import { useState } from 'react';
import { CheckCircle2, Loader2, LogIn, RefreshCw, UserRound } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAiRuntimeStore } from '@/stores/aiRuntimeStore';
import { aiApi } from '@/services/aiRuntime/client';
import type { AiConnectionSummary } from '@/services/aiRuntime/types';
import { ConfirmDialog } from '@/engines/_shared';

type SubscriptionKind = 'claude-subscription' | 'codex-subscription';
const PROVIDERS: { kind: SubscriptionKind; name: string; command: string; install: string }[] = [
  { kind: 'claude-subscription', name: 'Claude', command: 'claude auth login', install: 'https://code.claude.com/docs/en/setup' },
  { kind: 'codex-subscription', name: 'Codex · ChatGPT', command: 'codex login', install: 'https://developers.openai.com/codex/cli' },
];
const button = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-text-primary hover:border-accent-gold focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50 disabled:cursor-wait';

function SubscriptionRow({ provider, connection }: { provider: typeof PROVIDERS[number]; connection?: AiConnectionSummary }) {
  const { t } = useTranslation();
  const { saveConnection, probe, loadModels, setDefault, deleteConnection, defaults } = useAiRuntimeStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const savedModels = connection?.pinnedModels.filter((id) => id !== 'client-default').join(', ') ?? '';
  const [previousModels, setPreviousModels] = useState(savedModels);
  const [model, setModel] = useState(savedModels);
  if (previousModels !== savedModels) {
    setPreviousModels(savedModels);
    setModel(savedModels);
  }
  const [confirmRemove, setConfirmRemove] = useState(false);
  const connected = connection?.enabled && connection.status === 'online';
  const isDefault = connection && defaults.chat?.connectionId === connection.id;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try { await action(); }
    catch (err) { setError(err instanceof Error ? err.message : t('settings.ai.subscription.failed')); }
    finally { setBusy(false); }
  };

  const connect = () => run(async () => {
    const result = await saveConnection({
      id: connection?.id, name: provider.name, kind: provider.kind, baseUrl: '', enabled: true,
      modelTypes: ['chat'], pinnedModels: model.split(',').map((id) => id.trim()).filter(Boolean),
    });
    if (!result.ok) throw new Error(result.error);
    const checked = await probe(result.connection.id);
    if (!checked.ok) throw new Error(checked.error ?? t('settings.ai.subscription.failed'));
    await loadModels(result.connection.id, true);
    setNotice(t('settings.ai.subscription.ready'));
  });

  return (
    <div className="py-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-text-primary">{provider.name}</h3>
        <span className={`inline-flex items-center gap-1.5 text-xs ${connected ? 'text-success' : 'text-text-muted'}`}>
          {connected && <CheckCircle2 size={13} aria-hidden="true" />}
          {connected ? t('settings.ai.subscription.connected') : t('settings.ai.subscription.notConnected')}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-text-muted">{t('settings.ai.subscription.setup')} <a href={provider.install} target="_blank" rel="noreferrer" className="text-accent-gold underline underline-offset-2">{t('settings.ai.subscription.install')}</a></p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={button} disabled={busy} onClick={() => void run(async () => {
          const result = await aiApi()?.subscriptionLogin(provider.kind);
          if (!result?.ok) throw new Error(result?.error ?? t('settings.ai.subscription.failed'));
          setNotice(t('settings.ai.subscription.loginOpened'));
        })}><LogIn size={13} aria-hidden="true" />{t('settings.ai.subscription.login')}</button>
        <button type="button" className={`${button} border-accent-gold/40`} disabled={busy} onClick={() => void connect()}>
          {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={13} aria-hidden="true" />}
          {connection ? t('settings.ai.subscription.check') : t('settings.ai.subscription.import')}
        </button>
        {connected && <button type="button" className={button} disabled={busy || Boolean(isDefault)} onClick={() => void run(async () => {
          await setDefault('chat', { connectionId: connection!.id, modelId: 'client-default' });
          setNotice(t('settings.ai.subscription.defaultSet'));
        })}>{isDefault ? t('settings.ai.subscription.defaultActive') : t('settings.ai.subscription.useDefault')}</button>}
      </div>
      <details className="text-xs text-text-muted">
        <summary className="cursor-pointer py-1 focus-visible:outline-2 focus-visible:outline-accent-gold">{t('settings.ai.subscription.options')}</summary>
        <div className="pt-2 space-y-2">
          <p>{t('settings.ai.subscription.manualLogin')} <code className="select-all font-mono text-text-primary">{provider.command}</code></p>
          <label className="block space-y-1">
            <span>{t('settings.ai.subscription.models')}</span>
            <input value={model} onChange={(event) => setModel(event.target.value)} disabled={busy} className="w-full rounded-lg border border-border bg-elevated px-3 py-2 text-text-primary focus:outline-none focus:border-accent-gold" />
          </label>
          <p className="leading-relaxed">{t('settings.ai.subscription.modelsHint')}</p>
          {connection && <button type="button" className={button} disabled={busy} onClick={() => setConfirmRemove(true)}>{t('settings.ai.subscription.remove')}</button>}
        </div>
      </details>
      {(error || connection?.lastError) && <p role="alert" className="text-xs text-danger break-words">{error || connection?.lastError}</p>}
      {notice && <p role="status" className="text-xs text-text-primary">{notice}</p>}
      <ConfirmDialog open={confirmRemove} title={t('settings.ai.subscription.remove')} message={t('settings.ai.subscription.removeHint')} confirmLabel={t('settings.ai.subscription.remove')} onCancel={() => setConfirmRemove(false)} onConfirm={() => {
        setConfirmRemove(false);
        if (connection) void run(() => deleteConnection(connection.id));
      }} />
    </div>
  );
}

export default function SubscriptionsSection() {
  const { t } = useTranslation();
  const connections = useAiRuntimeStore((state) => state.connections);
  return (
    <section aria-labelledby="subscription-heading" className="space-y-2">
      <div className="flex items-start gap-2">
        <UserRound size={16} className="mt-0.5 text-accent-gold shrink-0" aria-hidden="true" />
        <div>
          <h2 id="subscription-heading" className="text-sm font-medium text-text-primary">{t('settings.ai.subscription.title')}</h2>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">{t('settings.ai.subscription.subtitle')}</p>
        </div>
      </div>
      <div className="divide-y divide-border">
        {PROVIDERS.map((provider) => <SubscriptionRow key={provider.kind} provider={provider} connection={connections.find((connection) => connection.kind === provider.kind)} />)}
      </div>
      <p className="text-xs leading-relaxed text-text-muted">{t('settings.ai.subscription.scope')}</p>
    </section>
  );
}
