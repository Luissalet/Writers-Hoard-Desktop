// ============================================
// La Forja — world generator, PROCESS entry
// ============================================
// Full world generation in its own OS process. The 38 MB packed world is
// structured-cloned back across the boundary — a copy, but one that buys the
// renderer total immunity from generation memory and generation crashes.

import { generateWorld } from '../core/pipeline';
import { packWorld } from '../core/types';
import type { GenerateRequest, WorkerReply } from '../worldgen.worker';

interface ForgePortEvent { data: unknown; ports?: ForgePort[] }
interface ForgePort {
  on(event: 'message', handler: (e: ForgePortEvent) => void): void;
  postMessage(message: unknown): void;
  start?(): void;
  close?(): void;
}

const parentPort = (process as unknown as { parentPort: ForgePort }).parentPort;

parentPort.on('message', (e) => {
  const port = e.ports?.[0];
  if (!port) return;
  const post = (msg: WorkerReply) => port.postMessage(msg);

  port.on('message', (ev) => {
    const msg = ev.data as GenerateRequest | { type: '__close' };
    if (msg.type === '__close') {
      process.exit(0);
      return;
    }
    if (msg.type !== 'generate') return;
    try {
      let lastSent = 0;
      const world = generateWorld(msg.params, (stage, overall) => {
        if (overall - lastSent >= 0.005 || overall >= 1) {
          lastSent = overall;
          post({ type: 'progress', stage, overall });
        }
      });
      const { transfer } = packWorld(world);
      post({ type: 'done', world: transfer });
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  });
  port.start?.();
});
