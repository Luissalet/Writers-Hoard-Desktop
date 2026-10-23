import { act } from 'react';
import { createRoot } from 'react-dom/client';
import AiBridgePane from '../src/components/settings/AiBridgePane';
import type { AiBridgeInfo, AiBridgeKey } from '../src/electron-env';
import en from '../src/locales/en';
import es from '../src/locales/es';
import { useLocaleStore } from '../src/stores/localeStore';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/** The keys section of the AI bridge pane, driven through a stubbed main process. */
export async function testAiBridgeKeys() {
  const info: AiBridgeInfo = { enabled: true, writesEnabled: true, running: true,
    port: 8766, url: 'http://127.0.0.1:8766', token: 'main-key-private-token',
    adapterPath: '/opt/wh/mcpStdio.cjs', auditPath: 'audit.jsonl', toolCount: 50 };
  let seq = 0;
  const keys: AiBridgeKey[] = [{ id: 'default', label: 'Principal', createdAt: 1_700_000_000_000, isDefault: true, status: 'active' }];
  const calls: string[] = [];
  const api = {
    getInfo: async () => ({ ...info }),
    readAudit: async () => [{ index: 0, at: 1_700_000_100_000, tool: 'wh_update_entry', summary: 'edited an entry', ok: true, keyLabel: 'Claude Desktop' }],
    setEnabled: async () => ({ ...info }),
    listKeys: async () => keys.map((key) => ({ ...key })),
    createKey: async (label: string) => {
      calls.push(`create:${label}`);
      if (!label.trim()) return { ok: false as const, code: 'bad-label', error: 'x' };
      if (keys.some((key) => key.status === 'active' && key.label.toLowerCase() === label.toLowerCase())) {
        return { ok: false as const, code: 'duplicate-label', error: 'dup' };
      }
      seq += 1;
      const key: AiBridgeKey = { id: `key_${seq}`, label, createdAt: 1_700_000_050_000, isDefault: false, status: 'active' };
      keys.push(key);
      return { ok: true as const, key, token: `token-for-${seq}`.padEnd(64, '0') };
    },
    renameKey: async (id: string, label: string) => {
      calls.push(`rename:${id}:${label}`);
      const key = keys.find((k) => k.id === id)!;
      key.label = label;
      return { ok: true as const, key };
    },
    revokeKey: async (id: string) => {
      calls.push(`revoke:${id}`);
      const key = keys.find((k) => k.id === id)!;
      if (key.isDefault) return { ok: false as const, code: 'default-key', error: 'no' };
      key.status = 'revoked';
      key.revokedAt = 1_700_000_200_000;
      return { ok: true as const, key };
    },
  };
  const oldApi = window.electronAPI;
  let copied = '';
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { copied = value; } } });
  window.electronAPI = { aiBridge: api } as unknown as typeof window.electronAPI;
  useLocaleStore.setState({ locale: 'en' });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const q = <T extends Element>(selector: string) => host.querySelector<T>(selector);
  const click = async (selector: string) => {
    const el = q<HTMLElement>(selector);
    assert(el, `Missing ${selector}`);
    await act(async () => el.click());
  };
  const type = async (selector: string, value: string) => {
    const el = q<HTMLInputElement>(selector);
    assert(el, `Missing ${selector}`);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  try {
    await act(async () => root.render(<AiBridgePane />));
    await settle();

    // The default key is listed, marked as main, with created/last used.
    assert(q('[data-testid="bridge-key-default"]'), 'the default key is not listed');
    assert(q('[data-testid="bridge-key-label-default"]')?.textContent === 'Principal', 'default key label');
    assert(q('[data-testid="bridge-key-default"]')?.textContent?.includes(en['settings.bridge.keys.main']), 'default key not marked as main');
    assert(q('[data-testid="bridge-key-dates-default"]')?.textContent?.includes(en['settings.bridge.keys.neverUsed']), 'last used shown for an unused key');
    assert(!q('[data-testid="bridge-key-revoke-default"]'), 'the main key offers revoke');
    assert(q('[data-testid="bridge-key-rename-default"]'), 'the main key cannot be renamed');
    // The audit row says which key wrote.
    assert(q('[data-testid="bridge-audit-key-0"]')?.textContent?.includes('Claude Desktop'), 'audit row does not name the key');
    // Config snippet for the main key, as before.
    await click('[data-testid="bridge-key-copy-config-default"]');
    assert(copied.includes('main-key-private-token') && copied.includes('WH_BRIDGE_TOKEN'), 'main key config not copied');

    // New key: validation, reveal once, copy.
    assert(q<HTMLButtonElement>('[data-testid="bridge-key-create"]')?.disabled === true, 'create is enabled with an empty name');
    await type('[data-testid="bridge-key-new-label"]', 'Claude Desktop');
    await click('[data-testid="bridge-key-create"]');
    await settle();
    assert(q('[data-testid="bridge-key-key_1"]'), 'new key not listed');
    const revealed = q('[data-testid="bridge-key-created-token"]')?.textContent ?? '';
    assert(revealed.startsWith('token-for-1'), 'new token not shown on creation');
    assert(q('[data-testid="bridge-key-key_1"]')?.textContent?.includes(revealed) === false, 'the key row repeats the token');
    await click('[data-testid="bridge-key-created-copy-token"]');
    assert(copied === revealed, 'token copy failed');
    await click('[data-testid="bridge-key-created-copy-config"]');
    assert(copied.includes(revealed) && copied.includes('mcpStdio.cjs'), 'per-key config snippet missing the new token');
    await click('[data-testid="bridge-key-created-done"]');
    assert(!q('[data-testid="bridge-key-created-token"]') && !host.textContent?.includes(revealed), 'the token is still visible after dismissing');
    // A duplicate name shows an error, not a key.
    await type('[data-testid="bridge-key-new-label"]', 'claude desktop');
    await click('[data-testid="bridge-key-create"]');
    await settle();
    assert(q('[data-testid="bridge-keys-form-error"]')?.textContent === en['settings.bridge.keys.error.duplicate-label'], 'duplicate error not shown');
    assert(host.querySelectorAll('[data-testid^="bridge-key-key_"]').length === 1, 'duplicate key was created');

    // Rename.
    await click('[data-testid="bridge-key-rename-key_1"]');
    await type('[data-testid="bridge-key-rename-input-key_1"]', 'Portátil');
    await click('[data-testid="bridge-key-rename-save-key_1"]');
    await settle();
    assert(q('[data-testid="bridge-key-label-key_1"]')?.textContent === 'Portátil', 'rename not reflected');
    assert(calls.includes('rename:key_1:Portátil'), 'rename not sent to main');

    // Revoke: asks first, cancel keeps the key, confirm revokes.
    await click('[data-testid="bridge-key-revoke-key_1"]');
    assert(document.body.textContent?.includes(en['settings.bridge.keys.revokeConfirm'].replace('{name}', 'Portátil')), 'no revoke confirmation');
    assert(!calls.some((c) => c.startsWith('revoke:')), 'revoked before confirming');
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
    const cancel = buttons.find((b) => b.textContent?.trim() === en['common.cancel']);
    assert(cancel, 'confirm dialog has no cancel');
    await act(async () => cancel.click());
    await settle();
    assert(!calls.some((c) => c.startsWith('revoke:')) && q('[data-testid="bridge-key-status-key_1"]')?.textContent === en['settings.bridge.keys.active'], 'cancel revoked the key');
    await click('[data-testid="bridge-key-revoke-key_1"]');
    const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === en['settings.bridge.keys.revoke'] && !b.hasAttribute('data-testid'));
    assert(confirm, 'confirm dialog has no revoke button');
    await act(async () => confirm.click());
    await settle();
    assert(calls.includes('revoke:key_1'), 'revoke not sent');
    assert(q('[data-testid="bridge-key-status-key_1"]')?.textContent?.startsWith('Revoked'), 'revoked status not shown');
    assert(!q('[data-testid="bridge-key-revoke-key_1"]') && !q('[data-testid="bridge-key-rename-key_1"]'), 'a revoked key still offers actions');

    // Spanish copy exists for every key string used.
    for (const k of Object.keys(en).filter((key) => key.startsWith('settings.bridge.keys.'))) {
      assert(typeof es[k as keyof typeof es] === 'string' && es[k as keyof typeof es] !== en[k as keyof typeof en], `missing Spanish copy for ${k}`);
    }
    await act(async () => root.unmount());
  } finally { window.electronAPI = oldApi; host.remove(); }
  return ['Keys list: main key marked, dates, no revoke on the main key', 'New key: validated, token shown once, per-key config copied, dismissed',
    'Rename and revoke with confirmation; revoked key loses its actions', 'Audit rows name the key; keys strings in Spanish and English'];
}
