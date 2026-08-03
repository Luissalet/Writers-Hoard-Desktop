// ============================================
// La Forja — renderer-side bridge
// ============================================
// The renderer's view of the Forge. `spawnForgeWorker(kind)` returns an
// object with the Worker surface the existing clients already speak
// (postMessage / onmessage / onerror / terminate), backed by a MessagePort
// into a dedicated OS process instead of a thread of this one.
//
// Plumbing, because contextIsolation is on and MessagePorts cannot cross the
// contextBridge: the preload script creates a MessageChannel, ships one end
// to the main process (which hands it to a fresh utilityProcess), and posts
// the other end INTO this world via window.postMessage — the one documented
// lane that carries transferables into an isolated page. The port arrives a
// tick after the spawn call, so the shim queues outgoing messages until it
// does; the clients never notice.
//
// No Forge (plain browser, harness, degraded desktop) → `forgeAvailable()`
// is false and every caller falls back to the classic Web Worker.

interface ForgeApi {
  available: boolean;
  spawn(kind: 'region' | 'worldgen', token: string): void;
}

declare global {
  interface Window {
    whForge?: ForgeApi;
  }
}

/** Worker-shaped, which is the whole point: the session pool, the tile
 *  store and the generation hook all keep their code untouched. */
export interface ForgeWorker {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}

export function forgeAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.whForge?.available;
}

/**
 * Una forja que muere al NACER (bundle ausente, módulo nativo sin instalar,
 * antivirus caprichoso) no produce ningún error observable: el puerto existe,
 * nadie contesta, y sin este seguro cada petición regional esperaría PARA
 * SIEMPRE — el pool ve la sesión "ocupada" y encola detrás de un muerto.
 * Medido en el contenedor: exactamente ese cuelgue, con @napi-rs/canvas
 * ausente. El vigilante da 20 s a la PRIMERA respuesta (un configure contesta
 * en milisegundos; el primer progress de un generate, en ~2 s); si no llega,
 * el worker emite onerror, se cierra, y la fábrica degrada a Web Workers
 * para el resto de la sesión.
 */
const FORGE_FIRST_REPLY_MS = 20_000;
let degraded = false;

/** True cuando una forja murió sin contestar; los clientes vuelven al Web Worker. */
export function forgeDegraded(): boolean {
  return degraded;
}

let nextToken = 1;
const pending = new Map<string, (port: MessagePort) => void>();
let listening = false;

function listen(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('message', (event) => {
    const data = event.data as { __forgePort?: string } | null;
    if (!data || typeof data !== 'object' || !data.__forgePort) return;
    const resolve = pending.get(data.__forgePort);
    const port = event.ports?.[0];
    if (resolve && port) {
      pending.delete(data.__forgePort);
      resolve(port);
    }
  });
}

class PortWorker implements ForgeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  private port: MessagePort | null = null;
  private queue: unknown[] = [];
  private closed = false;
  /** Cualquier respuesta desarma el vigilante para siempre: los silencios
   *  largos posteriores son cómputo legítimo, no un proceso muerto. */
  private heard = false;
  private watchdog = 0;

  attach(port: MessagePort): void {
    if (this.closed) {
      port.postMessage({ type: '__close' });
      port.close();
      return;
    }
    this.port = port;
    port.onmessage = (event) => {
      if (!this.heard) {
        this.heard = true;
        if (this.watchdog) {
          window.clearTimeout(this.watchdog);
          this.watchdog = 0;
        }
      }
      this.onmessage?.(event);
    };
    port.onmessageerror = (event) => this.onmessageerror?.(event);
    port.start();
    for (const message of this.queue) port.postMessage(message);
    this.queue = [];
  }

  postMessage(message: unknown): void {
    if (this.closed) return;
    if (this.port) this.port.postMessage(message);
    else this.queue.push(message);
    this.armWatchdog();
  }

  /** Cuenta desde el PRIMER envío: cubre el puerto que nunca llega y el
   *  proceso que murió antes de escuchar. */
  private armWatchdog(): void {
    if (this.heard || this.watchdog || this.closed) return;
    this.watchdog = window.setTimeout(() => {
      this.watchdog = 0;
      if (this.heard || this.closed) return;
      degraded = true;
      console.warn('[worldgen] La Forja no contestó; este trabajo falla y los siguientes usan Web Workers.');
      const event = new ErrorEvent('error', {
        message: 'La Forja no respondió a tiempo; se degrada a Web Workers.',
      });
      this.onerror?.(event);
      this.terminate();
    }, FORGE_FIRST_REPLY_MS);
  }

  terminate(): void {
    if (this.closed) return;
    this.closed = true;
    this.queue = [];
    if (this.watchdog) {
      window.clearTimeout(this.watchdog);
      this.watchdog = 0;
    }
    if (this.port) {
      // The process exits itself on __close; the main process reaps strays.
      this.port.postMessage({ type: '__close' });
      this.port.close();
      this.port = null;
    }
  }
}

export function spawnForgeWorker(kind: 'region' | 'worldgen'): ForgeWorker {
  const api = window.whForge;
  if (!api?.available) throw new Error('Forge unavailable.');
  listen();
  const token = `forge-${kind}-${nextToken++}`;
  const shim = new PortWorker();
  pending.set(token, (port) => shim.attach(port));
  api.spawn(kind, token);
  return shim;
}
