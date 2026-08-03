// ============================================
// Regional worker — WEB entry
// ============================================
// The browser home of the regional core: a Web Worker inside the renderer
// process. Kept as the universal fallback (plain browsers, harnesses, and
// any desktop where the Forge is unavailable). All logic lives in
// region/workerCore.ts; this file only supplies the host: postMessage and
// OffscreenCanvas.

import { createRegionWorkerCore, type RegionWorkerHost } from './region/workerCore';
import type { RegionWorkerReply, RegionWorkerRequest } from './region/workerProtocol';

const ctx = self as unknown as {
  postMessage(message: RegionWorkerReply, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<RegionWorkerRequest>) => void) | null;
};

const host: RegionWorkerHost = {
  post: (message, transfer) => ctx.postMessage(message, transfer),
  renderTile: (px, draw) => {
    const surface = new OffscreenCanvas(px, px);
    const c2d = surface.getContext('2d');
    if (!c2d) throw new Error('OffscreenCanvas 2D context unavailable.');
    draw(c2d as unknown as CanvasRenderingContext2D);
    const bitmap = surface.transferToImageBitmap();
    return { bitmap, transfer: [bitmap] };
  },
};

const handle = createRegionWorkerCore(host);
ctx.onmessage = (event) => handle(event.data);
