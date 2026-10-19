import { PUBLISHING_TOOLS } from '../manifestPublishing';
import { publishingFetch } from '@/engines/publishing/transport';
import { BridgeError, type ToolArgs } from './shared';

export const PUBLISHING_HANDLERS = Object.fromEntries(PUBLISHING_TOOLS.map(tool => [tool.name, async (args: ToolArgs) => {
  const bridge = window.electronAPI?.publishing;
  if (!bridge) throw new BridgeError('desktop-required', 'This function needs Writer Desktop.');
  if (tool.name === 'wh_publishing_modules' || tool.name === 'borges_modules') return bridge.status();
  if (tool.name === 'wh_publishing_module_set' || tool.name === 'borges_set_module') return bridge.setModule(String(args.module), args.enabled as boolean, args.automatic as boolean | undefined);
  const reply = await publishingFetch('/api/agent/call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: tool.name, arguments: args }) });
  const result = await reply.json();
  if (!reply.ok) throw new BridgeError(result.error || 'failed', result.message || result.detail || result.error);
  return result;
}])) as Record<string, (args: ToolArgs) => Promise<unknown>>;
