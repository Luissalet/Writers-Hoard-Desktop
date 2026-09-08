import type { AiBridgeInfo } from '@/electron-env';

export type BridgeClient = 'claude' | 'codex' | 'gemini' | 'web';

export const BRIDGE_CLIENT_DOCS: Record<Exclude<BridgeClient, 'web'>, string> = {
  claude: 'https://modelcontextprotocol.io/docs/develop/connect-local-servers',
  codex: 'https://developers.openai.com/codex/mcp',
  gemini: 'https://geminicli.com/docs/tools/mcp-server/',
};

/** Local client configuration contains credentials; never include it in a chat prompt. */
export function bridgeClientConfig(info: AiBridgeInfo, client: BridgeClient): string {
  if (client === 'web') return '';
  if (client === 'codex') {
    // JSON basic strings also escape Windows paths correctly in TOML.
    return [
      '[mcp_servers.writers-hoard]',
      'command = "node"',
      `args = [${JSON.stringify(info.adapterPath)}]`,
      '',
      '[mcp_servers.writers-hoard.env]',
      `WH_BRIDGE_TOKEN = ${JSON.stringify(info.token)}`,
      `WH_BRIDGE_URL = ${JSON.stringify(info.url)}`,
    ].join('\n');
  }
  return JSON.stringify({ mcpServers: { 'writers-hoard': {
    command: 'node', args: [info.adapterPath],
    env: { WH_BRIDGE_TOKEN: info.token, WH_BRIDGE_URL: info.url },
  } } }, null, 2);
}

/** Deliberately accepts no connection info, so secrets cannot leak into the handoff. */
export function bridgeOnboardingPrompt(t: (key: string) => string): string {
  return ['intro', 'verify', 'context', 'read', 'write', 'finish']
    .map(part => t(`settings.bridge.connect.prompt.${part}`)).join('\n\n');
}
