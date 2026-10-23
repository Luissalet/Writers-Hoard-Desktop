// ============================================================================
// Settings — AI bridge, named access keys
// ============================================================================
//
// One key per client, so a single client can be cut off without touching the
// rest. The main key is the token the app has always had (its token is shown
// above, as before). A key made here shows its token ONCE, in the reveal
// panel; the app keeps only a hash, so the list can never show it again.

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Pencil, Ban } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ConfirmDialog } from '@/engines/_shared';
import type { AiBridgeInfo, AiBridgeKey, AiBridgeKeyResult } from '@/electron-env';
import { bridgeClientConfig, type BridgeClient } from '@/services/aiBridge/connectionGuide';
import CopyButton from './AiBridgeCopyButton';

interface BridgeKeysApi {
  listKeys: () => Promise<AiBridgeKey[]>;
  createKey: (label: string) => Promise<AiBridgeKeyResult<{ key: AiBridgeKey; token: string }>>;
  renameKey: (id: string, label: string) => Promise<AiBridgeKeyResult<{ key: AiBridgeKey }>>;
  revokeKey: (id: string) => Promise<AiBridgeKeyResult<{ key: AiBridgeKey }>>;
}

interface Props {
  api: BridgeKeysApi;
  info: AiBridgeInfo;
  client: BridgeClient;
}

function fmt(at: number): string {
  return new Date(at).toLocaleString();
}

export default function AiBridgeKeys({ api, info, client }: Props) {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<AiBridgeKey[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ key: AiBridgeKey; token: string } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<AiBridgeKey | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    void api.listKeys().then((next) => {
      setKeys(next);
      setLoadError(false);
    }).catch(() => setLoadError(true));
  }, [api]);

  useEffect(() => {
    let alive = true;
    void api.listKeys().then((next) => {
      if (alive) setKeys(next);
    }).catch(() => { if (alive) setLoadError(true); });
    return () => { alive = false; };
  }, [api]);

  const explain = (code: string): string => {
    const key = `settings.bridge.keys.error.${code}`;
    const text = t(key);
    return text === key ? t('settings.bridge.keys.error.generic') : text;
  };

  const create = () => {
    if (busy) return;
    setBusy(true);
    setFormError(null);
    void api.createKey(newLabel).then((result) => {
      if (result.ok) {
        setCreated({ key: result.key, token: result.token });
        setNewLabel('');
        reload();
      } else {
        setFormError(explain(result.code));
      }
    }).catch(() => setFormError(t('settings.bridge.keys.error.generic'))).finally(() => setBusy(false));
  };

  const saveRename = () => {
    if (!renaming || busy) return;
    setBusy(true);
    setFormError(null);
    void api.renameKey(renaming.id, renaming.value).then((result) => {
      if (result.ok) {
        setRenaming(null);
        reload();
      } else {
        setFormError(explain(result.code));
      }
    }).catch(() => setFormError(t('settings.bridge.keys.error.generic'))).finally(() => setBusy(false));
  };

  const confirmRevoke = () => {
    const target = revokeTarget;
    setRevokeTarget(null);
    if (!target) return;
    setBusy(true);
    setFormError(null);
    void api.revokeKey(target.id).then((result) => {
      if (!result.ok) setFormError(explain(result.code));
      reload();
    }).catch(() => setFormError(t('settings.bridge.keys.error.generic'))).finally(() => setBusy(false));
  };

  const configFor = (token: string) => bridgeClientConfig({ ...info, token }, client);

  return (
    <div data-testid="bridge-keys" className="space-y-2">
      <div className="flex items-start gap-2">
        <KeyRound size={12} className="text-accent-gold mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-xs text-text-primary font-medium">{t('settings.bridge.keys.title')}</p>
          <p className="text-[10px] text-text-dim mt-0.5">{t('settings.bridge.keys.intro')}</p>
        </div>
      </div>

      {loadError && (
        <p role="status" data-testid="bridge-keys-error" className="text-[10px] text-red-400">
          {t('settings.bridge.keys.loadError')}
          <button onClick={reload} className="ml-2 underline">{t('settings.bridge.connect.retry')}</button>
        </p>
      )}
      {!keys && !loadError && <p role="status" className="text-[10px] text-text-muted">{t('settings.bridge.keys.empty')}</p>}

      {keys && (
        <ul className="space-y-1.5" data-testid="bridge-keys-list">
          {keys.map((key) => {
            const revoked = key.status === 'revoked';
            const editing = renaming?.id === key.id;
            return (
              <li
                key={key.id}
                data-testid={`bridge-key-${key.id}`}
                className={`px-3 py-2 rounded-lg border border-border text-[10px] ${revoked ? 'opacity-60' : ''}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  {editing ? (
                    <input
                      value={renaming.value}
                      maxLength={60}
                      aria-label={t('settings.bridge.keys.nameLabel')}
                      data-testid={`bridge-key-rename-input-${key.id}`}
                      onChange={(event) => setRenaming({ id: key.id, value: event.target.value })}
                      onKeyDown={(event) => { if (event.key === 'Enter') saveRename(); if (event.key === 'Escape') setRenaming(null); }}
                      className="flex-1 min-w-0 rounded border border-border bg-elevated px-2 py-1 text-xs text-text-primary"
                    />
                  ) : (
                    <span data-testid={`bridge-key-label-${key.id}`} className={`text-xs text-text-primary font-medium ${revoked ? 'line-through' : ''}`}>
                      {key.label}
                    </span>
                  )}
                  {key.isDefault && <span className="px-1.5 rounded border border-border text-text-muted">{t('settings.bridge.keys.main')}</span>}
                  <span
                    data-testid={`bridge-key-status-${key.id}`}
                    className={revoked ? 'text-red-400' : 'text-accent-gold'}
                  >
                    {revoked && key.revokedAt !== undefined
                      ? t('settings.bridge.keys.revoked').replace('{date}', fmt(key.revokedAt))
                      : t('settings.bridge.keys.active')}
                  </span>
                  <span className="ml-auto flex items-center gap-1">
                    {editing ? (
                      <button
                        onClick={saveRename}
                        disabled={busy}
                        data-testid={`bridge-key-rename-save-${key.id}`}
                        className="px-2 py-1 rounded border border-border hover:border-accent-gold/40 text-text-muted hover:text-accent-gold transition"
                      >
                        {t('settings.bridge.keys.save')}
                      </button>
                    ) : (
                      <>
                        {!revoked && (
                          <button
                            onClick={() => { setFormError(null); setRenaming({ id: key.id, value: key.label }); }}
                            title={t('settings.bridge.keys.rename')}
                            aria-label={`${t('settings.bridge.keys.rename')} ${key.label}`}
                            data-testid={`bridge-key-rename-${key.id}`}
                            disabled={busy}
                            className="p-1.5 rounded border border-border hover:border-accent-gold/40 text-text-muted hover:text-accent-gold transition"
                          >
                            <Pencil size={12} />
                          </button>
                        )}
                        {!revoked && !key.isDefault && (
                          <button
                            onClick={() => setRevokeTarget(key)}
                            title={t('settings.bridge.keys.revoke')}
                            aria-label={`${t('settings.bridge.keys.revoke')} ${key.label}`}
                            data-testid={`bridge-key-revoke-${key.id}`}
                            disabled={busy}
                            className="p-1.5 rounded border border-border hover:border-red-400/50 text-text-muted hover:text-red-400 transition"
                          >
                            <Ban size={12} />
                          </button>
                        )}
                        {key.isDefault && !revoked && client !== 'web' && (
                          <CopyButton
                            value={configFor(info.token)}
                            label={t('settings.bridge.keys.copyConfig')}
                            testId={`bridge-key-copy-config-${key.id}`}
                          />
                        )}
                      </>
                    )}
                  </span>
                </div>
                <p className="text-text-dim mt-1" data-testid={`bridge-key-dates-${key.id}`}>
                  {t('settings.bridge.keys.created').replace('{date}', fmt(key.createdAt))}
                  {' · '}
                  {key.lastUsedAt !== undefined
                    ? t('settings.bridge.keys.lastUsed').replace('{date}', fmt(key.lastUsedAt))
                    : t('settings.bridge.keys.neverUsed')}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {created && (
        <div role="status" data-testid="bridge-key-created" className="px-3 py-2 rounded-lg border border-accent-gold/50 space-y-1.5">
          <p className="text-xs text-text-primary font-medium">
            {t('settings.bridge.keys.createdTitle').replace('{name}', created.key.label)}
          </p>
          <p className="text-[10px] text-text-muted">{t('settings.bridge.keys.shownOnce')}</p>
          <div className="flex items-center gap-2">
            <code data-testid="bridge-key-created-token" className="flex-1 px-2 py-1.5 rounded border border-border bg-elevated text-[10px] font-mono text-text-muted truncate">
              {created.token}
            </code>
            <CopyButton value={created.token} label={t('settings.bridge.keys.copyToken')} testId="bridge-key-created-copy-token" />
          </div>
          {client !== 'web' && (
            <div className="flex items-center justify-between gap-2">
              <pre className="flex-1 px-2 py-2 rounded border border-border bg-elevated text-[10px] font-mono text-text-muted overflow-x-auto max-h-32">{configFor(created.token)}</pre>
              <CopyButton value={configFor(created.token)} label={t('settings.bridge.keys.copyConfig')} testId="bridge-key-created-copy-config" />
            </div>
          )}
          <button
            onClick={() => setCreated(null)}
            data-testid="bridge-key-created-done"
            className="px-2 py-1 rounded border border-border hover:border-accent-gold/40 text-text-muted hover:text-accent-gold text-[10px] transition"
          >
            {t('settings.bridge.keys.done')}
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          value={newLabel}
          maxLength={60}
          placeholder={t('settings.bridge.keys.namePlaceholder')}
          aria-label={t('settings.bridge.keys.nameLabel')}
          data-testid="bridge-key-new-label"
          onChange={(event) => setNewLabel(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') create(); }}
          className="flex-1 min-w-0 rounded border border-border bg-elevated px-2 py-1.5 text-xs text-text-primary"
        />
        <button
          onClick={create}
          disabled={busy || !newLabel.trim()}
          data-testid="bridge-key-create"
          className="px-2 py-1.5 rounded border border-border hover:border-accent-gold/40 text-xs text-text-muted hover:text-accent-gold transition disabled:opacity-40"
        >
          {t('settings.bridge.keys.new')}
        </button>
      </div>
      {formError && <p role="alert" data-testid="bridge-keys-form-error" className="text-[10px] text-red-400">{formError}</p>}

      <ConfirmDialog
        open={revokeTarget !== null}
        destructive
        title={t('settings.bridge.keys.revokeTitle')}
        confirmLabel={t('settings.bridge.keys.revoke')}
        message={t('settings.bridge.keys.revokeConfirm').replace('{name}', revokeTarget?.label ?? '')}
        onConfirm={confirmRevoke}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  );
}
