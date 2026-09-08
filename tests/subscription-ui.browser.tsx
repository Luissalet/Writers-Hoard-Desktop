import { act } from 'react';
import { createRoot } from 'react-dom/client';
import SubscriptionsSection from '../src/components/ai-settings/SubscriptionsSection';
import ConnectionsSection from '../src/components/ai-settings/ConnectionsSection';
import AiBridgePane from '../src/components/settings/AiBridgePane';
import type { AiBridgeInfo } from '../src/electron-env';
import { useAiRuntimeStore } from '../src/stores/aiRuntimeStore';
import { useLocaleStore } from '../src/stores/localeStore';
import { t } from '../src/i18n/useTranslation';
import type { AiConnectionSummary, AiDefaults, AiConnectionInput } from '../src/services/aiRuntime/types';

function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label); }
export async function testSubscriptionUi() {
  let connections: AiConnectionSummary[] = [];
  let defaults: AiDefaults = {};
  let probeFails = true;
  const logins: string[] = [];
  const saved: AiConnectionInput[] = [];
  const models = (id: string) => [{ connectionId: id, id: 'client-default', type: 'chat' as const, capabilities: ['chat' as const, 'tools' as const] }];
  const api = {
    listConnections: async () => structuredClone(connections),
    saveConnection: async (input: AiConnectionInput) => {
      saved.push(structuredClone(input));
      const connection: AiConnectionSummary = { ...input, id: input.id ?? input.kind, enabled: true, hasSecret: false, locality: 'remote', modelTypes: ['chat'], pinnedModels: input.pinnedModels ?? [], status: 'unknown', createdAt: 1, updatedAt: 1 };
      connections = [...connections.filter((item) => item.id !== connection.id), connection];
      return { ok: true, connection };
    },
    probe: async (id: string) => {
      connections = connections.map((item) => item.id === id ? { ...item, status: probeFails ? 'error' : 'online', lastError: probeFails ? 'La sesión ha caducado. Inicia sesión de nuevo.' : undefined } : item);
      return probeFails ? { ok: false, code: 'unauthorized', error: 'La sesión ha caducado. Inicia sesión de nuevo.' } : { ok: true, models: models(id) };
    },
    listModels: async (id: string) => ({ ok: true, models: models(id) }),
    getDefaults: async () => defaults,
    setDefault: async (kind: 'chat' | 'image', route: AiDefaults['chat']) => { defaults = { ...defaults, [kind]: route }; return defaults; },
    subscriptionLogin: async (kind: string) => { logins.push(kind); return { ok: true }; },
  };
  const bridgeInfo: AiBridgeInfo = { enabled: true, running: true, writesEnabled: false, port: 8766, url: 'http://127.0.0.1:8766', token: 'test-only-token', adapterPath: 'C:\\Users\\Writer Name\\Writers Hoard\\mcpStdio.cjs', auditPath: 'audit.jsonl', toolCount: 50 };
  window.electronAPI = { ai: api, aiBridge: { getInfo: async () => ({ ...bridgeInfo }), readAudit: async () => [] } } as unknown as NonNullable<Window['electronAPI']>;
  useLocaleStore.setState({ locale: 'es', loaded: true });
  useAiRuntimeStore.setState({ available: true, connections: [], connectionsLoaded: true, defaults: {}, modelsByConnection: {} });
  const host = document.getElementById('root')!;
  const root = createRoot(host);
  const render = () => root.render(<main className="max-w-3xl mx-auto p-6 space-y-8"><h1 className="text-xl text-text-primary">Inteligencia artificial</h1><SubscriptionsSection /><div id="server-connections"><ConnectionsSection /></div><div id="external-bridge" className="border-t border-border pt-6"><AiBridgePane /></div></main>);
  await act(async () => render());
  const section = () => host.querySelector('section[aria-labelledby="subscription-heading"]')!;
  const buttons = (label: string) => [...section().querySelectorAll('button')].filter((item) => item.textContent === label);
  const click = async (label: string, index = 0) => {
    const target = buttons(t(label))[index];
    check(target, `Missing button: ${label}`);
    await act(async () => { target.click(); });
  };
  await click('settings.ai.subscription.import');
  check(saved[0].kind === 'claude-subscription' && saved[0].baseUrl === '', 'Imports subscription without API URL');
  check(section().querySelector('[role="alert"]')?.textContent?.includes('caducado'), 'Probe failure visible');
  await click('settings.ai.subscription.login');
  check(logins[0] === 'claude-subscription', 'Official client login requested');
  probeFails = false;
  await click('settings.ai.subscription.check');
  check(!section().querySelector('[role="alert"]'), 'Successful probe clears stale failure');
  await click('settings.ai.subscription.useDefault');
  check(defaults.chat?.connectionId === 'claude-subscription' && defaults.chat.modelId === 'client-default', 'Subscription default saved');
  check(useAiRuntimeStore.getState().defaults.chat?.connectionId === 'claude-subscription', 'Default store refreshed');
  const details = section().querySelector('details')!;
  details.open = true;
  const input = details.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'sonnet, opus');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('settings.ai.subscription.check');
  check(JSON.stringify(saved.at(-1)?.pinnedModels) === '["sonnet","opus"]', 'Pinned models saved');
  await act(async () => { root.render(<div />); });
  await act(async () => render());
  check(section().querySelector('input')?.value === 'sonnet, opus', 'Pinned models survive remount');
  check(!section().querySelector('input[type="password"],input[type="url"]'), 'No subscription API-key or URL input');
  check(!host.querySelector('#server-connections')?.textContent?.includes('Claude'), 'Subscription excluded from generic API editor');
  host.querySelector('#server-connections')?.remove();
  return ['subscription import and failure recovery', 'official login action and persisted chat default', 'pinned model save and remount', 'subscription connections excluded from URL/API editors'];
}
