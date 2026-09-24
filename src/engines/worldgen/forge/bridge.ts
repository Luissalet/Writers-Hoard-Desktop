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

/**
 * El mensaje del `onerror` que emite una forja muerta a media faena. Exportado
 * para que la interfaz lo reconozca y cuente algo útil en su lugar: el código
 * de salida del proceso NO llega aquí (sólo el proceso principal lo ve, en su
 * `child-process-gone`), así que la causa probable —memoria— es una pista, no
 * un diagnóstico.
 */
export const FORGE_CLOSED_MESSAGE = 'La Forja se cerró inesperadamente.';

/** Cuánto espera un puerto cerrado al código de salida que manda el principal. */
const FORGE_EXIT_CODE_WAIT_MS = 400;

/**
 * El código de salida que acompaña a un `FORGE_CLOSED_MESSAGE`, si llegó, o
 * `null` si el mensaje no es de una forja muerta o el código no llegó a tiempo.
 */
export function forgeCrashExitCode(message: string | null | undefined): number | null {
  if (!message?.startsWith(FORGE_CLOSED_MESSAGE)) return null;
  const match = /\[exit (-?\d+)\]$/.exec(message);
  return match ? Number(match[1]) : null;
}

/** True cuando el mensaje es el de una forja que murió a media faena. */
export function isForgeCrash(message: string | null | undefined): boolean {
  return Boolean(message?.startsWith(FORGE_CLOSED_MESSAGE));
}

/** True cuando una forja murió sin contestar; los clientes vuelven al Web Worker. */
export function forgeDegraded(): boolean {
  return degraded;
}

let nextToken = 1;
const pending = new Map<string, (port: MessagePort) => void>();
/** Códigos de salida por token, y quien los espera (el `close` suele ganar la carrera). */
const exitCodes = new Map<string, number>();
const exitWaiters = new Map<string, (code: number) => void>();
let listening = false;

function waitForExitCode(token: string): Promise<number | null> {
  const known = exitCodes.get(token);
  if (known !== undefined) {
    exitCodes.delete(token);
    return Promise.resolve(known);
  }
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      exitWaiters.delete(token);
      resolve(null);
    }, FORGE_EXIT_CODE_WAIT_MS);
    exitWaiters.set(token, (code) => {
      window.clearTimeout(timer);
      exitWaiters.delete(token);
      resolve(code);
    });
  });
}

function listen(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('message', (event) => {
    const exit = event.data as { __forgeExit?: string; code?: number } | null;
    if (exit && typeof exit === 'object' && typeof exit.__forgeExit === 'string' && typeof exit.code === 'number') {
      const waiter = exitWaiters.get(exit.__forgeExit);
      if (waiter) waiter(exit.code);
      else exitCodes.set(exit.__forgeExit, exit.code);
      return;
    }
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

  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

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
    /**
     * EL PROCESO QUE MUERE DESPUÉS DE CONTESTAR. El vigilante de arriba sólo
     * cubre el silencio ANTES de la primera respuesta: una forja que revienta
     * a media generación (sin memoria, módulo nativo que peta) dejaba la
     * generación del mundo en «forjando…» para siempre — su cliente no tiene
     * otro reloj — y la petición regional colgada hasta que el vigía de la
     * granja la retirara minutos después. El puerto enlazado emite `close`
     * cuando el otro extremo desaparece (medido en Electron: un hijo de
     * `utilityProcess` que peta tras su primer `progress` lo dispara en el
     * renderer); aquí se convierte en el `onerror` que todos los clientes ya
     * saben atender. Un cierre pedido por nosotros (`terminate`) llega con
     * `closed` puesto y no dice nada.
     */
    port.addEventListener('close', () => {
      if (this.closed) return;
      // Morir sin haber contestado nunca es el mismo diagnóstico que el
      // vigilante: esta instalación no sabe forjar, el resto va a Web Workers.
      if (!this.heard) degraded = true;
      const onerror = this.onerror;
      this.terminate();
      // El cierre del puerto suele llegar antes que el código de salida que
      // manda el principal: se le espera un momento, nunca indefinidamente.
      void waitForExitCode(this.token).then((code) => {
        console.warn(`[worldgen] La Forja se cerró sin avisar (código ${code ?? '?'}); el trabajo en curso falla.`);
        const message = code === null ? FORGE_CLOSED_MESSAGE : `${FORGE_CLOSED_MESSAGE} [exit ${code}]`;
        onerror?.(new ErrorEvent('error', { message }));
      });
    });
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
  const shim = new PortWorker(token);
  pending.set(token, (port) => shim.attach(port));
  api.spawn(kind, token);
  return shim;
}
