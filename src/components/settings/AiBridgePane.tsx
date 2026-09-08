// ============================================================================
// Settings — AI bridge
// ============================================================================
//
// The port that lets an external model (Odysseus, Claude Desktop, OpenCode…)
// read and write this app's projects. Off by default; writing is a second,
// separate switch. Everything an MCP client needs to connect is generated
// here so nothing has to be typed by hand.

import { useCallback, useEffect, useState } from 'react';
import { Plug, Copy, Check, RefreshCw, ShieldAlert, Undo2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { AiBridgeAuditEntry, AiBridgeInfo } from '@/electron-env';
import { BRIDGE_CLIENT_DOCS, bridgeClientConfig, bridgeOnboardingPrompt, type BridgeClient } from '@/services/aiBridge/connectionGuide';

function Toggle({ on, onClick, label, disabled }: { on: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      role="switch"
      aria-checked={on}
      disabled={disabled}
      className={`w-10 h-5 rounded-full transition relative flex-shrink-0 ${
        on ? 'bg-accent-gold' : 'bg-elevated border border-border'
      }`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-surface transition-[left] ${
          on ? 'left-[22px]' : 'left-0.5'
        }`}
      />
    </button>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span className="flex items-center gap-1">
    <button
      onClick={() => {
        setFailed(false);
        setCopied(false);
        void Promise.resolve().then(() => navigator.clipboard.writeText(value)).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }).catch(() => setFailed(true));
      }}
      title={label}
      aria-label={copied ? t('settings.bridge.connect.copied') : label}
      className="p-1.5 rounded border border-border hover:border-accent-gold/40 text-text-muted hover:text-accent-gold transition flex-shrink-0"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
    <span role="status" className={failed ? 'text-[10px] text-red-400' : 'sr-only'}>
      {failed ? t('settings.bridge.connect.copyError') : copied ? t('settings.bridge.connect.copied') : ''}
    </span>
    </span>
  );
}

/**
 * Whether an entry names anything undo could act on.
 *
 * `entityIds` is not in the shared type — it is written by handlers that make
 * several rows at once and read straight off the JSONL — so it is read here
 * defensively rather than declared.
 */
function hasUndoTarget(entry: AiBridgeAuditEntry & { entityIds?: string[] }): boolean {
  return Boolean(entry.entityId) || Boolean(entry.entityIds?.length);
}

export default function AiBridgePane() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<AiBridgeInfo | null>(null);
  const [audit, setAudit] = useState<AiBridgeAuditEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [client, setClient] = useState<BridgeClient>('claude');
  const [undoError, setUndoError] = useState<string | null>(null);
  // What each reversal could NOT put back, by audit line. A partial undo that
  // said nothing left the line reading "undone" with half the change still on
  // disk — the one outcome nobody would think to check.
  const [undoCaveats, setUndoCaveats] = useState<Record<number, string>>({});
  const bridge = typeof window !== 'undefined' ? window.electronAPI?.aiBridge : undefined;

  const refresh = useCallback(() => {
    if (!bridge) return;
    void Promise.all([bridge.getInfo(), bridge.readAudit(20)]).then(([next, entries]) => {
      setInfo(next);
      setAudit(entries);
      setError(false);
    }).catch(() => setError(true));
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    // Settled in a promise callback, never synchronously inside the effect.
    let alive = true;
    void Promise.all([bridge.getInfo(), bridge.readAudit(20)]).then(([next, entries]) => {
      if (!alive) return;
      setInfo(next);
      setAudit(entries);
    }).catch(() => { if (alive) setError(true); });
    return () => {
      alive = false;
    };
  }, [bridge]);

  // Web build: there is no port to expose.
  if (!bridge) return null;

  const run = (action: () => Promise<AiBridgeInfo>) => {
    setBusy(true);
    setError(false);
    void action()
      .then(setInfo)
      .catch(() => setError(true))
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <section>
      <div className="flex items-center justify-between">
        <div className="flex items-start gap-2">
          <Plug size={14} className="text-accent-gold mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm text-text-primary font-medium">{t('settings.bridge.title')}</p>
            <p className="text-[10px] text-text-dim mt-0.5">{t('settings.bridge.subtitle')}</p>
          </div>
        </div>
        <Toggle
          on={info?.enabled === true}
          label={t('settings.bridge.title')}
          disabled={busy || !info}
          onClick={() => !busy && info && run(() => bridge.setEnabled(!info.enabled))}
        />
      </div>

      {error && <div role="alert" className="mt-2 text-xs text-red-400">
        {t('settings.bridge.connect.loadError')}
        <button onClick={refresh} className="ml-2 underline">{t('settings.bridge.connect.retry')}</button>
      </div>}
      {!info && !error && <p role="status" className="mt-2 text-xs text-text-muted">{t('settings.bridge.connect.loading')}</p>}
      <div className="mt-3 border-t border-border pt-3 space-y-2">
        <h3 className="text-sm font-medium text-text-primary">{t('settings.bridge.connect.title')}</h3>
        <p className="text-xs text-text-muted leading-relaxed">{t('settings.bridge.connect.intro')}</p>
        <label htmlFor="bridge-client" className="block text-xs text-text-muted">{t('settings.bridge.connect.client')}</label>
        <select id="bridge-client" value={client} onChange={event => setClient(event.target.value as BridgeClient)}
          className="w-full rounded border border-border bg-elevated px-2 py-2 text-xs text-text-primary">
          <option value="claude">Claude Desktop</option>
          <option value="codex">Codex (OpenAI)</option>
          <option value="gemini">Gemini CLI</option>
          <option value="web">ChatGPT / Claude / Gemini — {t('settings.bridge.connect.web')}</option>
        </select>
        {client === 'web' ? <p className="text-xs text-text-muted leading-relaxed">{t('settings.bridge.connect.webNote')}</p> : <>
          <ol className="list-decimal pl-5 space-y-2 text-xs text-text-muted leading-relaxed">
            <li>{t('settings.bridge.connect.prepare')}</li>
            <li>{t(`settings.bridge.connect.${client}`)}</li>
            <li>{t('settings.bridge.connect.restart')}</li>
          </ol>
          <a href={BRIDGE_CLIENT_DOCS[client]} target="_blank" rel="noreferrer" className="inline-block text-xs text-accent-gold underline underline-offset-2">{t('settings.bridge.connect.docs')}</a>
          {info?.enabled && <details>
            <summary className="cursor-pointer text-xs text-text-primary py-1">{t('settings.bridge.clientConfig')}</summary>
            <div className="flex items-center justify-between gap-2 my-1">
              <p className="text-[10px] text-text-muted">{t('settings.bridge.connect.privateConfig')}</p>
              <CopyButton value={bridgeClientConfig(info, client)} label={t('settings.bridge.connect.copyConfig')} />
            </div>
            <pre className="px-2 py-2 rounded border border-border bg-elevated text-[10px] font-mono text-text-muted overflow-x-auto max-h-48">{bridgeClientConfig(info, client)}</pre>
          </details>}
        </>}
        <div className="flex items-center justify-between gap-2 pt-1">
          <p className="text-xs font-medium text-text-primary">{t('settings.bridge.connect.promptTitle')}</p>
          <CopyButton value={bridgeOnboardingPrompt(t)} label={t('settings.bridge.connect.copyPrompt')} />
        </div>
        <p className="text-[10px] text-text-muted">{t('settings.bridge.connect.promptNote')}</p>
        <details>
          <summary className="cursor-pointer text-xs text-text-muted">{t('settings.bridge.connect.preview')}</summary>
          <p className="mt-2 text-xs text-text-muted whitespace-pre-wrap leading-relaxed select-text">{bridgeOnboardingPrompt(t)}</p>
        </details>
      </div>

      {info?.enabled && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-border">
            <div>
              <p className="text-xs text-text-primary">{t('settings.bridge.writes')}</p>
              <p className="text-[10px] text-text-dim mt-0.5">{t('settings.bridge.writesDesc')}</p>
            </div>
            <Toggle
              on={info.writesEnabled}
              label={t('settings.bridge.writes')}
              disabled={busy}
              onClick={() => !busy && run(() => bridge.setWritesEnabled(!info.writesEnabled))}
            />
          </div>

          <div className="text-[10px] text-text-dim flex items-center gap-2">
            <span className={info.running ? 'text-accent-gold' : 'text-text-muted'}>
              {info.running
                ? t('settings.bridge.running').replace('{url}', info.url)
                : t('settings.bridge.notRunning')}
            </span>
            <span>·</span>
            <span>{t('settings.bridge.toolCount').replace('{count}', String(info.toolCount))}</span>
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1.5">
              {t('settings.bridge.token')}
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-2 py-1.5 rounded border border-border bg-elevated text-[10px] font-mono text-text-muted truncate">
                {info.token}
              </code>
              <CopyButton value={info.token} label={t('common.copy')} />
              <button
                onClick={() => !busy && run(() => bridge.regenerateToken())}
                title={t('settings.bridge.regenerate')}
                aria-label={t('settings.bridge.regenerate')}
                disabled={busy}
                className="p-1.5 rounded border border-border hover:border-accent-gold/40 text-text-muted hover:text-accent-gold transition"
              >
                <RefreshCw size={12} />
              </button>
            </div>
            <p className="text-[10px] text-text-dim mt-1">{t('settings.bridge.tokenNote')}</p>
          </div>

          <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-border text-[10px] text-text-dim">
            <ShieldAlert size={12} className="text-accent-gold mt-0.5 flex-shrink-0" />
            <span>{t('settings.bridge.safetyNote')}</span>
          </div>

          <div>
            <p className="text-xs text-text-muted mb-1.5">{t('settings.bridge.activity')}</p>
            {audit.length === 0 ? (
              <p className="text-[10px] text-text-dim">{t('settings.bridge.activityEmpty')}</p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {audit.map((entry) => (
                  <div key={entry.index}>
                    <div className="flex items-baseline gap-2 text-[10px]">
                      <span className="text-text-dim flex-shrink-0 font-mono">
                        {new Date(entry.at).toLocaleTimeString()}
                      </span>
                      <span
                        className={
                          entry.undone
                            ? 'text-text-dim line-through'
                            : entry.ok
                              ? 'text-text-muted'
                              : 'text-red-400'
                        }
                      >
                        {entry.summary ?? entry.tool}
                        {entry.ok ? '' : ` — ${entry.error ?? ''}`}
                      </span>
                      {/* Only a change that actually landed, is not already
                          reverted, and names a row to put back. Offering the
                          button on an entry with no entity was a button that
                          could only ever fail. */}
                      {entry.ok && !entry.undone && entry.kind && entry.kind !== 'undo' && hasUndoTarget(entry) && (
                        <button
                          onClick={() => {
                            setBusy(true);
                            void bridge
                              .undo(entry.index)
                              .then((result) => {
                                setUndoError(result.ok ? null : result.error ?? null);
                                const caveat = result.ok
                                  ? (result.result as { caveat?: string } | undefined)?.caveat
                                  : undefined;
                                if (caveat) setUndoCaveats((prev) => ({ ...prev, [entry.index]: caveat }));
                              })
                              .catch(() => setUndoError(t('settings.bridge.connect.undoError')))
                              .finally(() => {
                                setBusy(false);
                                refresh();
                              });
                          }}
                          disabled={busy}
                          className="ml-auto flex-shrink-0 text-text-dim hover:text-accent-gold transition disabled:opacity-40"
                          title={t('settings.bridge.undo')}
                          aria-label={t('settings.bridge.undo')}
                        >
                          <Undo2 size={11} />
                        </button>
                      )}
                    </div>
                    {undoCaveats[entry.index] && (
                      <p className="text-[10px] text-accent-gold pl-2 break-words">
                        {undoCaveats[entry.index]}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {undoError && <p className="text-[10px] text-red-400 mt-1">{undoError}</p>}
            <p className="text-[10px] text-text-dim mt-1 break-all">
              {t('settings.bridge.auditPath').replace('{path}', info.auditPath)}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
