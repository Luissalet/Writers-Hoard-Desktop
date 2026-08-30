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

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
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
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      title={label}
      className="p-1.5 rounded border border-border hover:border-accent-gold/40 text-text-muted hover:text-accent-gold transition flex-shrink-0"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

/** The exact stdio entry an MCP client wants, ready to paste. */
function mcpConfigJson(info: AiBridgeInfo): string {
  return JSON.stringify(
    {
      mcpServers: {
        'writers-hoard': {
          command: 'node',
          args: [info.adapterPath],
          env: { WH_BRIDGE_TOKEN: info.token, WH_BRIDGE_URL: info.url },
        },
      },
    },
    null,
    2,
  );
}

export default function AiBridgePane() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<AiBridgeInfo | null>(null);
  const [audit, setAudit] = useState<AiBridgeAuditEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const bridge = typeof window !== 'undefined' ? window.electronAPI?.aiBridge : undefined;

  const refresh = useCallback(() => {
    if (!bridge) return;
    void Promise.all([bridge.getInfo(), bridge.readAudit(20)]).then(([next, entries]) => {
      setInfo(next);
      setAudit(entries);
    });
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    // Settled in a promise callback, never synchronously inside the effect.
    let alive = true;
    void Promise.all([bridge.getInfo(), bridge.readAudit(20)]).then(([next, entries]) => {
      if (!alive) return;
      setInfo(next);
      setAudit(entries);
    });
    return () => {
      alive = false;
    };
  }, [bridge]);

  // Web build: there is no port to expose.
  if (!bridge) return null;

  const run = (action: () => Promise<AiBridgeInfo>) => {
    setBusy(true);
    void action()
      .then(setInfo)
      .finally(() => {
        setBusy(false);
        refresh();
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
          onClick={() => !busy && info && run(() => bridge.setEnabled(!info.enabled))}
        />
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
                className="p-1.5 rounded border border-border hover:border-accent-gold/40 text-text-muted hover:text-accent-gold transition"
              >
                <RefreshCw size={12} />
              </button>
            </div>
            <p className="text-[10px] text-text-dim mt-1">{t('settings.bridge.tokenNote')}</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-text-muted">{t('settings.bridge.clientConfig')}</label>
              <CopyButton value={mcpConfigJson(info)} label={t('common.copy')} />
            </div>
            <pre className="px-2 py-1.5 rounded border border-border bg-elevated text-[10px] font-mono text-text-muted overflow-x-auto max-h-40">
              {mcpConfigJson(info)}
            </pre>
            <p className="text-[10px] text-text-dim mt-1">{t('settings.bridge.clientConfigNote')}</p>
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
                  <div key={entry.index} className="flex items-baseline gap-2 text-[10px]">
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
                    {/* Only a change that actually landed, and is not already
                        reverted, has anything to turn back. */}
                    {entry.ok && !entry.undone && entry.kind && entry.kind !== 'undo' && (
                      <button
                        onClick={() => {
                          setBusy(true);
                          void bridge
                            .undo(entry.index)
                            .then((result) => setUndoError(result.ok ? null : result.error ?? null))
                            .finally(() => {
                              setBusy(false);
                              refresh();
                            });
                        }}
                        disabled={busy}
                        className="ml-auto flex-shrink-0 text-text-dim hover:text-accent-gold transition disabled:opacity-40"
                        title={t('settings.bridge.undo')}
                      >
                        <Undo2 size={11} />
                      </button>
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
