// ============================================
// La Forja — regional worker, PROCESS entry
// ============================================
// Runs the exact same core as region.worker.ts, but as an Electron
// utilityProcess: a real OS process with its own memory space, its own V8,
// its own crash boundary. The renderer talks to it over a MessagePort wired
// by the main process; if this process dies of appetite the window never
// blinks. Tiles cross the boundary as raw RGBA (there is no zero-copy across
// processes); the client rebuilds ImageBitmaps on arrival.
//
// Bundled to CommonJS for node by electron/build.mjs — never imported by the
// renderer bundle.

import { createCanvas } from '@napi-rs/canvas';
import { createRegionWorkerCore, type RegionWorkerHost } from '../region/workerCore';
import type { RegionWorkerRequest } from '../region/workerProtocol';

interface ForgePortEvent { data: unknown; ports?: ForgePort[] }
interface ForgePort {
  on(event: 'message', handler: (e: ForgePortEvent) => void): void;
  postMessage(message: unknown): void;
  start?(): void;
  close?(): void;
}

// Electron's utilityProcess exposes its channel to the main process here.
const parentPort = (process as unknown as { parentPort: ForgePort }).parentPort;

parentPort.on('message', (e) => {
  const port = e.ports?.[0];
  if (!port) return;

  const host: RegionWorkerHost = {
    // MessagePortMain has no transferables beyond ports; typed arrays are
    // structured-cloned across the process boundary, which is the honest
    // cost of true isolation.
    post: (message) => port.postMessage(message),
    renderTile: (px, draw) => {
      const surface = createCanvas(px, px);
      const c2d = surface.getContext('2d');
      draw(c2d as unknown as CanvasRenderingContext2D);
      const img = c2d.getImageData(0, 0, px, px);
      // Copy into a tight buffer: getImageData's backing store belongs to the
      // canvas and must not be detached from under it.
      const rgba = new Uint8ClampedArray(img.data).buffer as ArrayBuffer;
      return { rgba, width: px, height: px, transfer: [] };
    },
  };

  const handle = createRegionWorkerCore(host);
  port.on('message', (ev) => {
    const msg = ev.data as RegionWorkerRequest | { type: '__close' };
    if ((msg as { type: string }).type === '__close') {
      process.exit(0);
      return;
    }
    handle(msg as RegionWorkerRequest);
  });
  port.start?.();
});
