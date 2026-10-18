import { FICTION_TOOLS } from '../manifestFiction';
import { storyFetch } from '@/engines/fiction/native/lib/api';
import { BridgeError, type ToolArgs } from './shared';

// Native UI and renderer tool callers use the same IPC/ASGI operations.
export const FICTION_HANDLERS = Object.fromEntries(FICTION_TOOLS.map(tool => [tool.name, async (args: ToolArgs) => {
  const bridge = window.electronAPI?.fiction;
  if (!bridge) throw new BridgeError('desktop-required', 'Interactive fiction needs Writer Desktop.');
  if (tool.name === 'wh_story_modules') return bridge.status();
  if (tool.name === 'wh_story_module_set') return bridge.setModule(String(args.module), args.enabled as boolean, args.dataDir as string | undefined);
  // A request through the exact same API helper as the visible fiction pages.
  const reply = await storyFetch(`/api/agent/${tool.name}`, { method: 'POST', body: JSON.stringify(args) });
  const result = await reply.json();
  if (reply.status >= 400) throw new BridgeError(result.error || 'failed', result.message || result.error);
  return tool.name === 'story_worlds' ? { worlds: result } : result;
}])) as Record<string, (args: ToolArgs) => Promise<unknown>>;
