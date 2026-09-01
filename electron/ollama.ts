// ============================================================================
// Writers Hoard — embedded local AI runtime (portable Ollama, main process)
// ============================================================================
//
// "One click → a big free local model" for the AI features. This module owns
// the WHOLE local runtime lifecycle so the renderer never talks HTTP to
// Ollama directly — the packaged renderer is file:// (null origin) and
// Ollama's CORS would reject it (the open item recorded in
// tasks/desktop-transition.md). Everything crosses IPC instead.
//
//   • If a SYSTEM Ollama answers on 127.0.0.1:11434, it is adopted as-is and
//     nothing is downloaded ('external' state).
//   • Otherwise a pinned official standalone zip (CLI + NVIDIA CUDA libraries)
//     is downloaded to staging, SHA-256 verified, extracted with Windows' bundled
//     tar.exe (PowerShell Expand-Archive as fallback), and `ollama serve` is
//     spawned as a TRACKED child on the fixed alternative port 11500 — never
//     clashing with a future system install. Models live in their own
//     userData folder via OLLAMA_MODELS.
//   • Model pulls stream Ollama's NDJSON progress; cancellation aborts the
//     request (partial layers persist — Ollama itself resumes on retry).
//   • Chat uses the NATIVE /api/chat (not /v1: the OpenAI-compat endpoint
//     accepts no `options`, and Ollama's default context is 4096 — manuscript
//     text would be silently front-truncated). num_ctx 32768 ≈ 120K chars.
//
// House rules honored: children are tracked, cancellable and tree-killed on
// will-quit (tasks/lessons.md #15, killProcessTree from media/ytdlp.ts);
// results are `{ ok, error }` objects, never throws across IPC.

import { app, net } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { killProcessTree } from './media/ytdlp';
import { catalogSizeBytes } from '@/services/aiRuntime/catalog';
import {
  isCurrentOllamaRuntimeReceipt,
  isOllamaRuntimeArtifactConfigured,
  matchesOllamaRuntimeDigest,
  OLLAMA_RUNTIME_ARTIFACT,
  type OllamaRuntimeReceipt,
} from './ollamaRuntimeManifest';

// ── Constants ───────────────────────────────────────────────────────────────

const EMBEDDED_PORT = 11500;
const EMBEDDED_URL = `http://127.0.0.1:${EMBEDDED_PORT}`;
const SYSTEM_URL = 'http://127.0.0.1:11434';

const runtimeDir = (): string => path.join(app.getPath('userData'), 'ollama');
const modelsDir = (): string => path.join(app.getPath('userData'), 'ollama-models');
const binPath = (): string => path.join(runtimeDir(), 'ollama.exe');
const runtimeReceiptPath = (): string => path.join(runtimeDir(), 'writers-hoard-runtime.json');
const runtimeStagingDir = (): string => path.join(app.getPath('userData'), 'ollama-runtime-staging');
const stagedArchivePath = (): string =>
  path.join(runtimeStagingDir(), `${OLLAMA_RUNTIME_ARTIFACT.fileName}.part`);
const stagedRuntimeDir = (): string => path.join(runtimeStagingDir(), 'extracted');

// ── Types (duplicated by hand in preload.ts / electron-env.d.ts, as ever) ───

export type OllamaState =
  | 'absent'
  | 'downloading-runtime'
  | 'extracting'
  | 'starting'
  | 'running'
  | 'external'
  | 'error';

export interface OllamaModelInfo {
  name: string;
  sizeBytes: number;
}

export interface OllamaStatus {
  state: OllamaState;
  /** Embedded runtime install is Windows-only; detection works everywhere. */
  supported: boolean;
  runtimeInstalled: boolean;
  url: string | null;
  models: OllamaModelInfo[];
  /** Tag currently being pulled, if any. */
  pulling: string | null;
  runtimeBytes?: number;
  error?: string;
}

export interface OllamaOpResult {
  ok: boolean;
  error?: string;
}

export interface OllamaChatRequest {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}

export interface OllamaChatResult {
  ok: boolean;
  content?: string;
  error?: string;
}

// ── Module state (single-writer per phase) ──────────────────────────────────

let state: OllamaState = 'absent';
let baseUrl: string | null = null;
let lastError: string | null = null;
let serveChild: ChildProcess | null = null;
/** Pid of a serve adopted from a previous session — our only handle on it. */
let adoptedPid: number | null = null;
let ensureInFlight: Promise<OllamaOpResult> | null = null;
let runtimeAbort: AbortController | null = null;
const activePulls = new Map<string, AbortController>();
const activeChats = new Set<AbortController>();
const logRing: string[] = [];
let cachedModels: OllamaModelInfo[] = [];
let cachedRuntimeBytes: number | null = null;
let emit: (channel: string, payload: unknown) => void = () => {};

/** Wire the main→renderer event sink once, from registerIpc(). */
export function initOllama(sink: (channel: string, payload: unknown) => void): void {
  emit = sink;
}

function pushLog(line: string): void {
  for (const l of line.split('\n')) {
    const trimmed = l.trim();
    if (!trimmed) continue;
    logRing.push(trimmed);
  }
  while (logRing.length > 120) logRing.shift();
}

function logTail(n: number): string {
  return logRing.slice(-n).join('\n');
}

function snapshotStatus(): OllamaStatus {
  return {
    state,
    supported: process.platform === 'win32',
    runtimeInstalled: cachedRuntimeInstalled,
    url: baseUrl,
    models: cachedModels,
    pulling: activePulls.size > 0 ? [...activePulls.keys()][0] : null,
    runtimeBytes: cachedRuntimeBytes ?? undefined,
    error: lastError ?? undefined,
  };
}

let cachedRuntimeInstalled = false;

function setState(next: OllamaState, error?: string | null): void {
  state = next;
  lastError = error ?? (next === 'error' ? lastError : null);
  emit('ollama:status', snapshotStatus());
}

/** ≤10 events/s progress throttle; always lets the caller force the final one. */
function makeThrottle(minGapMs = 100): (force?: boolean) => boolean {
  let last = 0;
  return (force = false) => {
    const now = Date.now();
    if (!force && now - last < minGapMs) return false;
    last = now;
    return true;
  };
}

// ── HTTP helpers (all through net.fetch — precedented in main.ts) ───────────

async function probe(url: string, timeoutMs = 800): Promise<boolean> {
  try {
    const res = await net.fetch(`${url}/api/version`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Pid of whatever listens on a loopback port, or null when it cannot be
 * resolved. `netstat`'s state column is localised, the "no peer" foreign
 * address is not, so the row is recognised by that instead.
 */
async function listenerPid(port: number): Promise<number | null> {
  const isWin = process.platform === 'win32';
  const output = await new Promise<string>((resolve) => {
    const child = isWin
      ? spawn('netstat', ['-a', '-n', '-o'], { windowsHide: true })
      : spawn('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { windowsHide: true });
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve('');
    }, 5000);
    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString();
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve('');
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(out);
    });
  });
  for (const line of output.split('\n')) {
    if (!isWin) {
      const pid = Number(line.trim());
      if (Number.isInteger(pid) && pid > 0) return pid;
      continue;
    }
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5 || parts[0].toUpperCase() !== 'TCP') continue;
    if (!parts[1].endsWith(`:${port}`)) continue;
    if (parts[2] !== '0.0.0.0:0' && parts[2] !== '[::]:0' && parts[2] !== '*:*') continue;
    const pid = Number(parts[parts.length - 1]);
    if (Number.isInteger(pid) && pid > 0) return pid;
  }
  return null;
}

/**
 * Take over a serve already listening on the EMBEDDED port (an orphan from a
 * crashed session, never the system install on 11434). Its pid is looked up
 * now because `shutdownOllama` runs on will-quit and cannot wait for one.
 */
async function adoptEmbeddedServe(): Promise<void> {
  baseUrl = EMBEDDED_URL;
  if (serveChild) return;
  adoptedPid = await listenerPid(EMBEDDED_PORT);
  if (adoptedPid === null) {
    pushLog(`adopted a serve on port ${EMBEDDED_PORT} with no resolvable pid — it cannot be reaped on quit`);
  }
}

async function refreshModels(): Promise<void> {
  if (!baseUrl) {
    cachedModels = [];
    return;
  }
  try {
    const res = await net.fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return;
    const data = (await res.json()) as { models?: Array<{ name?: string; size?: number }> };
    cachedModels = (data.models ?? [])
      .filter((m): m is { name: string; size?: number } => typeof m.name === 'string')
      .map((m) => ({ name: m.name, sizeBytes: typeof m.size === 'number' ? m.size : 0 }));
  } catch {
    /* keep the previous cache; a live server will answer next time */
  }
}

async function refreshRuntimeInstalled(): Promise<void> {
  try {
    const receipt = JSON.parse(await fs.readFile(runtimeReceiptPath(), 'utf8')) as unknown;
    if (!isCurrentOllamaRuntimeReceipt(receipt)) throw new Error('unverified-runtime');
    await fs.access(binPath());
    cachedRuntimeInstalled = true;
    if (cachedRuntimeBytes === null) {
      cachedRuntimeBytes = await dirSize(runtimeDir()).catch(() => null as never);
    }
  } catch {
    cachedRuntimeInstalled = false;
    cachedRuntimeBytes = null;
  }
}

function runtimeReceipt(): OllamaRuntimeReceipt {
  return {
    version: OLLAMA_RUNTIME_ARTIFACT.version,
    fileName: OLLAMA_RUNTIME_ARTIFACT.fileName,
    sha256: OLLAMA_RUNTIME_ARTIFACT.sha256,
  };
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else if (e.isFile()) total += (await fs.stat(p)).size;
  }
  return total;
}

/** Throws Error('no-space:<gb>') when the volume lacks `needed` free bytes. */
async function assertDiskSpace(dir: string, needed: number): Promise<void> {
  try {
    const s = await fs.statfs(dir);
    const free = Number(s.bavail) * Number(s.bsize);
    if (free < needed) {
      throw new Error(`no-space:${Math.ceil(needed / 1e9)}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('no-space:')) throw err;
    /* statfs unsupported → skip the guard rather than block the feature */
  }
}

/** Live base URL of whichever Ollama answers (system or embedded), or null. */
export function ollamaBaseUrl(): string | null {
  return baseUrl;
}

// ── Status ──────────────────────────────────────────────────────────────────

export async function getOllamaStatus(): Promise<OllamaStatus> {
  // An async op owns the state while it runs — report it untouched.
  if (state === 'downloading-runtime' || state === 'extracting' || state === 'starting') {
    return snapshotStatus();
  }
  await refreshRuntimeInstalled();
  if (await probe(SYSTEM_URL)) {
    baseUrl = SYSTEM_URL;
    if (state !== 'external') setState('external');
  } else if (await probe(EMBEDDED_URL)) {
    // Also adopts an orphan serve from a crashed previous session — same
    // models dir, so this is the correct behavior.
    baseUrl = EMBEDDED_URL;
    if (state !== 'running') {
      await adoptEmbeddedServe();
      setState('running');
    }
  } else {
    baseUrl = null;
    adoptedPid = null;
    if (state !== 'error') state = 'absent';
    cachedModels = [];
  }
  if (baseUrl) await refreshModels();
  return snapshotStatus();
}

// ── Serve lifecycle ─────────────────────────────────────────────────────────

async function spawnServe(): Promise<OllamaOpResult> {
  await fs.mkdir(modelsDir(), { recursive: true });
  setState('starting');
  emit('ollama:runtime-progress', { phase: 'starting', receivedBytes: 0, totalBytes: null });

  const child = spawn(binPath(), ['serve'], {
    windowsHide: true,
    detached: false,
    env: {
      ...process.env,
      OLLAMA_HOST: `127.0.0.1:${EMBEDDED_PORT}`,
      OLLAMA_MODELS: modelsDir(),
      // Keep the loaded model warm between feature calls (default is 5m).
      OLLAMA_KEEP_ALIVE: '30m',
      // Smaller KV cache at 32K context — matters on the 12GB card.
      OLLAMA_FLASH_ATTENTION: '1',
    },
  });
  serveChild = child;
  adoptedPid = null;
  child.stdout?.on('data', (d: Buffer) => pushLog(d.toString()));
  child.stderr?.on('data', (d: Buffer) => pushLog(d.toString()));
  child.on('error', (err) => {
    pushLog(`spawn error: ${err.message}`);
  });
  child.on('exit', (code) => {
    const wasLive = state === 'starting' || state === 'running';
    if (serveChild === child) serveChild = null;
    if (wasLive) {
      setState('error', `ollama exited (code ${code ?? '?'})\n${logTail(5)}`);
    }
  });

  // Health poll: first run creates dirs; a normal start answers in < 2s.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (serveChild !== child) {
      return { ok: false, error: lastError ?? 'ollama exited during startup' };
    }
    if (await probe(EMBEDDED_URL, 600)) {
      baseUrl = EMBEDDED_URL;
      setState('running');
      await refreshModels();
      emit('ollama:status', snapshotStatus());
      return { ok: true };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (child.pid != null) killProcessTree(child.pid);
  serveChild = null;
  setState('error', `ollama did not answer within 30s\n${logTail(5)}`);
  return { ok: false, error: lastError ?? 'startup timeout' };
}

/** Idempotent lazy ensure: adopt a live server, else spawn, else ask for the download. */
export async function startOllama(): Promise<OllamaOpResult> {
  if (ensureInFlight) return ensureInFlight;
  ensureInFlight = (async (): Promise<OllamaOpResult> => {
    if ((state === 'running' || state === 'external') && baseUrl && (await probe(baseUrl))) {
      return { ok: true };
    }
    if (await probe(SYSTEM_URL)) {
      baseUrl = SYSTEM_URL;
      setState('external');
      await refreshModels();
      return { ok: true };
    }
    if (await probe(EMBEDDED_URL)) {
      await adoptEmbeddedServe();
      setState('running');
      await refreshModels();
      return { ok: true };
    }
    await refreshRuntimeInstalled();
    if (!cachedRuntimeInstalled) {
      return { ok: false, error: 'runtime-missing' };
    }
    return spawnServe();
  })().finally(() => {
    ensureInFlight = null;
  });
  return ensureInFlight;
}

// ── Runtime download ────────────────────────────────────────────────────────

async function runTool(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().split('\n').slice(-2).join('\n') || `${cmd} exited ${code}`));
    });
  });
}

function powershellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function extractRuntimeZip(archivePath: string, destinationPath: string): Promise<void> {
  await fs.mkdir(destinationPath, { recursive: true });
  try {
    // Windows 10+ bundles bsdtar in System32; it reads zip archives.
    await runTool('tar', ['-xf', archivePath, '-C', destinationPath]);
  } catch {
    await fs.rm(destinationPath, { recursive: true, force: true });
    await fs.mkdir(destinationPath, { recursive: true });
    await runTool('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath ${powershellLiteral(archivePath)} -DestinationPath ${powershellLiteral(destinationPath)} -Force`,
    ]);
  }
}

async function installStagedRuntime(): Promise<void> {
  const destination = runtimeDir();
  const backup = `${destination}.previous`;
  await fs.rm(backup, { recursive: true, force: true });
  let hadPrevious = false;
  try {
    await fs.access(destination);
    await fs.rename(destination, backup);
    hadPrevious = true;
  } catch {
    // A missing previous runtime is the normal first-install path.
  }
  try {
    await fs.rename(stagedRuntimeDir(), destination);
  } catch (error) {
    if (hadPrevious) await fs.rename(backup, destination).catch(() => undefined);
    throw error;
  }
  await fs.rm(backup, { recursive: true, force: true });
}

export async function downloadOllamaRuntime(): Promise<OllamaOpResult> {
  if (process.platform !== 'win32') return { ok: false, error: 'unsupported-platform' };
  if (!isOllamaRuntimeArtifactConfigured()) {
    const error = 'runtime-integrity-config-missing';
    setState('error', error);
    return { ok: false, error };
  }
  if (state === 'downloading-runtime' || state === 'extracting' || state === 'starting') {
    return { ok: false, error: 'busy' };
  }
  if (state === 'running' || state === 'external') return { ok: true };

  try {
    await assertDiskSpace(app.getPath('userData'), OLLAMA_RUNTIME_ARTIFACT.sizeBytes * 2.5);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'no-space:4';
    setState('error', msg);
    return { ok: false, error: msg };
  }

  runtimeAbort = new AbortController();
  const { signal } = runtimeAbort;
  setState('downloading-runtime');
  const throttle = makeThrottle();

  try {
    await fs.rm(runtimeStagingDir(), { recursive: true, force: true });
    await fs.mkdir(runtimeStagingDir(), { recursive: true });
    const res = await net.fetch(OLLAMA_RUNTIME_ARTIFACT.url, { signal });
    if (!res.ok || !res.body) {
      throw new Error(`http ${res.status}`);
    }
    const total = Number(res.headers.get('content-length')) || null;
    if (total && total !== OLLAMA_RUNTIME_ARTIFACT.sizeBytes) {
      throw new Error('runtime-size-mismatch');
    }

    const stagedFile = await fs.open(stagedArchivePath(), 'wx');
    const reader = res.body.getReader();
    const digest = createHash('sha256');
    let received = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        digest.update(value);
        let offset = 0;
        while (offset < value.byteLength) {
          const result = await stagedFile.write(value, offset, value.byteLength - offset);
          if (result.bytesWritten <= 0) throw new Error('runtime-write-failed');
          offset += result.bytesWritten;
        }
        if (throttle()) {
          emit('ollama:runtime-progress', {
            phase: 'downloading',
            receivedBytes: received,
            totalBytes: OLLAMA_RUNTIME_ARTIFACT.sizeBytes,
          });
        }
      }
    } finally {
      await stagedFile.close();
    }
    emit('ollama:runtime-progress', {
      phase: 'downloading',
      receivedBytes: received,
      totalBytes: OLLAMA_RUNTIME_ARTIFACT.sizeBytes,
    });

    if (received !== OLLAMA_RUNTIME_ARTIFACT.sizeBytes) throw new Error('runtime-size-mismatch');
    if (!matchesOllamaRuntimeDigest(digest.digest('hex'))) {
      throw new Error('runtime-integrity-check-failed');
    }
    if (signal.aborted) throw new Error('cancelled');

    setState('extracting');
    emit('ollama:runtime-progress', {
      phase: 'extracting',
      receivedBytes: received,
      totalBytes: OLLAMA_RUNTIME_ARTIFACT.sizeBytes,
    });
    await extractRuntimeZip(stagedArchivePath(), stagedRuntimeDir());
    if (signal.aborted) throw new Error('cancelled');

    // Only a verified archive reaches extraction; validate its expected layout
    // before replacing any previously installed runtime.
    try {
      await fs.access(path.join(stagedRuntimeDir(), 'ollama.exe'));
    } catch {
      throw new Error('bad-archive');
    }
    await fs.writeFile(
      path.join(stagedRuntimeDir(), 'writers-hoard-runtime.json'),
      JSON.stringify(runtimeReceipt(), null, 2),
      'utf8',
    );
    await installStagedRuntime();
    if (signal.aborted) throw new Error('cancelled');
    await fs.rm(runtimeStagingDir(), { recursive: true, force: true });
    await refreshRuntimeInstalled();
    if (!cachedRuntimeInstalled) throw new Error('runtime-install-verification-failed');

    return await spawnServe();
  } catch (err) {
    await fs.rm(runtimeStagingDir(), { recursive: true, force: true }).catch(() => undefined);
    if (signal.aborted) {
      // A cancel is not an error — back to square one, silently.
      setState('absent');
      return { ok: false, error: 'cancelled' };
    }
    const msg = err instanceof Error ? err.message : 'download failed';
    setState('error', msg);
    return { ok: false, error: msg };
  } finally {
    runtimeAbort = null;
  }
}

export function cancelRuntimeDownload(): void {
  runtimeAbort?.abort();
}

// ── Model pulls ─────────────────────────────────────────────────────────────

// No slash: a name component would carry a registry host, and Ollama would
// pull the manifest, the blobs and the Modelfile from it.
const TAG_RE = /^[a-z0-9][a-z0-9._-]*(?::[a-z0-9][a-z0-9._-]*)?$/i;

export async function pullOllamaModel(tag: string): Promise<OllamaOpResult> {
  if (typeof tag !== 'string' || !TAG_RE.test(tag)) return { ok: false, error: 'bad-tag' };
  // Sizes come from the shared catalogue (src/services/aiRuntime/catalog.ts)
  // — one list for the cards and the disk guard, instead of two that drift.
  // A tag that is not on it is refused: the registry serving an unknown model
  // chooses its weights, its template and its system prompt.
  const known = catalogSizeBytes(tag);
  if (!known) return { ok: false, error: 'bad-tag' };
  if (activePulls.has(tag)) return { ok: false, error: 'already-pulling' };
  if (activePulls.size > 0) return { ok: false, error: 'busy' };

  const started = await startOllama();
  if (!started.ok || !baseUrl) return { ok: false, error: started.error ?? 'not-ready' };

  try {
    await assertDiskSpace(app.getPath('userData'), known * 1.2);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'no-space:24' };
  }

  const controller = new AbortController();
  activePulls.set(tag, controller);
  emit('ollama:status', snapshotStatus());
  const throttle = makeThrottle();
  // Per-digest aggregation: overall = Σcompleted / Σtotal across every layer
  // seen so far, clamped monotonic so a late small layer never bounces the bar.
  const layers = new Map<string, { total: number; completed: number }>();
  let shown = 0;

  try {
    const res = await net.fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: tag, stream: true }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) return { ok: false, error: `http ${res.status}` };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let parsed: { status?: string; error?: string; digest?: string; total?: number; completed?: number };
        try {
          parsed = JSON.parse(trimmed) as typeof parsed;
        } catch {
          continue;
        }
        if (parsed.error) return { ok: false, error: parsed.error };
        if (parsed.digest && typeof parsed.total === 'number') {
          layers.set(parsed.digest, {
            total: parsed.total,
            completed: typeof parsed.completed === 'number' ? parsed.completed : 0,
          });
        }
        let sumTotal = 0;
        let sumDone = 0;
        for (const l of layers.values()) {
          sumTotal += l.total;
          sumDone += l.completed;
        }
        const overall = sumTotal > 0 ? sumDone / sumTotal : 0;
        shown = Math.max(shown, Math.min(overall, 1));
        const isTerminal = parsed.status === 'success';
        if (throttle(isTerminal)) {
          emit('ollama:pull-progress', {
            tag,
            status: parsed.status ?? '',
            completedBytes: sumDone,
            totalBytes: sumTotal,
            percent: isTerminal ? 1 : shown,
          });
        }
        if (isTerminal) {
          await refreshModels();
          return { ok: true };
        }
      }
    }
    // Stream ended without a success line — treat as failure.
    return { ok: false, error: 'pull ended unexpectedly' };
  } catch (err) {
    if (controller.signal.aborted) return { ok: false, error: 'cancelled' };
    return { ok: false, error: err instanceof Error ? err.message : 'pull failed' };
  } finally {
    activePulls.delete(tag);
    emit('ollama:status', snapshotStatus());
  }
}

export function cancelOllamaPull(tag: string): void {
  activePulls.get(tag)?.abort();
}

// Removing a model never contacts a registry, and a system Ollama may hold
// namespaced tags the pull path would refuse — so delete keeps the wider shape.
const INSTALLED_TAG_RE = /^[a-z0-9][a-z0-9._\-:/]*$/i;

export async function deleteOllamaModel(tag: string): Promise<OllamaOpResult> {
  if (typeof tag !== 'string' || !INSTALLED_TAG_RE.test(tag)) return { ok: false, error: 'bad-tag' };
  if (!baseUrl || !(await probe(baseUrl))) {
    const started = await startOllama();
    if (!started.ok || !baseUrl) return { ok: false, error: started.error ?? 'not-ready' };
  }
  try {
    const res = await net.fetch(`${baseUrl}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: tag }),
    });
    if (!res.ok && res.status !== 404) return { ok: false, error: `http ${res.status}` };
    await refreshModels();
    emit('ollama:status', snapshotStatus());
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'delete failed' };
  }
}

// ── Chat ────────────────────────────────────────────────────────────────────

interface OllamaChatHttpResponse {
  message?: { role?: string; content?: string; thinking?: string };
  done?: boolean;
}

export async function ollamaChat(req: OllamaChatRequest): Promise<OllamaChatResult> {
  if (!req || typeof req.model !== 'string' || typeof req.user !== 'string') {
    return { ok: false, error: 'bad-request' };
  }
  const started = await startOllama();
  if (!started.ok || !baseUrl) return { ok: false, error: started.error ?? 'not-ready' };

  const controller = new AbortController();
  activeChats.add(controller);
  // 10 min: a 20GB first load plus hybrid-offload generation can be slow.
  const timer = setTimeout(() => controller.abort(), 600_000);

  const doRequest = async (withThink: boolean): Promise<Response> => {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      stream: false,
      keep_alive: '30m',
      options: { num_ctx: 32768, num_predict: req.maxTokens ?? 4096 },
    };
    // Qwen3.5 is a thinking family — ask for clean, fast answers. Older
    // servers/models reject the field; the caller retries without it.
    if (withThink) body.think = false;
    return net.fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  };

  try {
    let res = await doRequest(true);
    if (res.status === 400) {
      const text = await res.text();
      if (/think/i.test(text)) {
        res = await doRequest(false);
      } else {
        return { ok: false, error: `http 400: ${text.slice(0, 200)}` };
      }
    }
    if (res.status === 404) return { ok: false, error: 'model-missing' };
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (/not found/i.test(text)) return { ok: false, error: 'model-missing' };
      return { ok: false, error: `http ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as OllamaChatHttpResponse;
    return { ok: true, content: data.message?.content ?? '' };
  } catch (err) {
    if (controller.signal.aborted) return { ok: false, error: 'timeout' };
    return { ok: false, error: err instanceof Error ? err.message : 'chat failed' };
  } finally {
    clearTimeout(timer);
    activeChats.delete(controller);
  }
}

// ── Shutdown (will-quit) ────────────────────────────────────────────────────

export function shutdownOllama(): void {
  runtimeAbort?.abort();
  for (const c of activePulls.values()) c.abort();
  for (const c of activeChats) c.abort();
  // A serve adopted from a previous session has no ChildProcess of ours; left
  // alone it keeps a 7-20 GB model resident through every quit from here on.
  const pids = new Set([serveChild?.pid, adoptedPid].filter((p): p is number => typeof p === 'number'));
  serveChild = null;
  adoptedPid = null;
  // Detached taskkill survives our own exit and reaps the whole tree.
  for (const pid of pids) killProcessTree(pid);
  void fs.rm(runtimeStagingDir(), { recursive: true, force: true }).catch(() => {});
}
