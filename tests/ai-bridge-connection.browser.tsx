import { act } from 'react';
import { createRoot } from 'react-dom/client';
import AiBridgePane from '../src/components/settings/AiBridgePane';
import { bridgeClientConfig, bridgeOnboardingPrompt } from '../src/services/aiBridge/connectionGuide';
import type { AiBridgeInfo } from '../src/electron-env';
import en from '../src/locales/en';
import es from '../src/locales/es';
import { useLocaleStore } from '../src/stores/localeStore';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

export async function testAiBridgeConnection() {
  const info: AiBridgeInfo = { enabled: false, writesEnabled: false, running: false,
    port: 8766, url: 'http://127.0.0.1:8766', token: 'test-private-token',
    adapterPath: 'C:\\Users\\Writer Name\\Writers Hoard\\mcpStdio.cjs', auditPath: 'audit.jsonl', toolCount: 50 };
  for (const client of ['claude', 'gemini'] as const) {
    const config = JSON.parse(bridgeClientConfig(info, client)).mcpServers['writers-hoard'];
    assert(config.args[0] === info.adapterPath && config.env.WH_BRIDGE_TOKEN === info.token, `${client} config preserves Windows paths and credentials`);
  }
  const toml = bridgeClientConfig(info, 'codex');
  assert(toml.includes('[mcp_servers.writers-hoard.env]'), 'Codex receives TOML');
  assert(toml.includes(JSON.stringify(info.adapterPath)), 'TOML escapes path backslashes');
  assert(bridgeClientConfig(info, 'web') === '', 'No misleading web connector URL');
  for (const locale of [en, es]) {
    const prompt = bridgeOnboardingPrompt(key => locale[key]);
    assert(prompt.includes('wh_get_context') && prompt.includes('wh_get_editorial_context'), 'Prompt supplies real discovery and editorial tools');
    assert(!prompt.includes(info.token) && !prompt.includes(info.adapterPath), 'Chat prompt excludes connection secrets');
    assert(!prompt.includes('undefined'), 'All prompt copy translated');
  }

  const oldApi = window.electronAPI;
  let failRead = false;
  let copied = '';
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async (value: string) => { copied = value; },
  } });
  window.electronAPI = { aiBridge: {
    getInfo: async () => { if (failRead) throw new Error('offline'); return { ...info }; },
    readAudit: async () => [],
    setEnabled: async (enabled: boolean) => { info.enabled = enabled; info.running = enabled; return { ...info }; },
  } } as unknown as typeof window.electronAPI;
  useLocaleStore.setState({ locale: 'en' });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const click = async (selector: string) => {
    const button = host.querySelector<HTMLButtonElement>(selector);
    assert(button, `Missing ${selector}`);
    await act(async () => button.click());
  };
  try {
    await act(async () => root.render(<AiBridgePane />));
    assert(host.textContent?.includes(en['settings.bridge.connect.title']), 'Onboarding discoverable before bridge enabled');
    assert(!host.querySelector('pre'), 'No configuration exposed while disabled');
    await click('[aria-label="Copy starter message"]');
    assert(copied.includes('wh_get_context') && !copied.includes(info.token), 'UI copies only safe prompt');
    await click('[role="switch"]');
    assert(host.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'true', 'Accessible bridge toggle reflects enabled state');
    const select = host.querySelector('select')!;
    await act(async () => { select.value = 'codex'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await click('[aria-label="Copy client configuration"]');
    assert(copied.startsWith('[mcp_servers.'), 'Client selector copies the right format');
    await act(async () => { select.value = 'web'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    assert(host.textContent?.includes(en['settings.bridge.connect.webNote']) && !host.querySelector('pre'), 'Web choice explains local transport limitation');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } });
    await click('[aria-label="Copy starter message"], [aria-label="Copied"]');
    assert(host.textContent?.includes(en['settings.bridge.connect.copyError']), 'Clipboard failure gives recovery');
    await act(async () => root.unmount());
    failRead = true;
    const retryRoot = createRoot(host);
    await act(async () => retryRoot.render(<AiBridgePane />));
    assert(host.querySelector('[role="alert"]'), 'IPC failure is visible');
    failRead = false;
    await act(async () => host.querySelector<HTMLButtonElement>('[role="alert"] button')!.click());
    assert(!host.querySelector('[role="alert"]'), 'Read failure can recover without reopening settings');
    await act(async () => retryRoot.unmount());
  } finally { window.electronAPI = oldApi; host.remove(); }
  return ['MCP client formats and escaped paths', 'Secret-free bilingual onboarding', 'Bridge onboarding, selection, copy and recoverable errors'];
}
