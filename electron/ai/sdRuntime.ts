// ============================================================================
// AI runtime — managed local image server (stable-diffusion.cpp, main process)
// ============================================================================
//
// The image-side twin of electron/ollama.ts: a pinned release archive is
// downloaded, SHA-256 verified, extracted and kept under userData; catalogue
// weights are downloaded the same way (resumable, hashed, refused when they
// disagree with the pin); `sd-server` is spawned on a fixed loopback port
// with exactly one model loaded and swapped when another is asked for.
//
// Nothing here is reachable from the renderer except through the IPC in
// ./ipc.ts, and nothing here ever leaves the machine: the only network
// traffic is the two download hosts pinned in the manifest and catalogue.
// Models live outside every backup — they are re-downloadable by design.

import { app, net } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { killProcessTree } from '../media/ytdlp';
import { imageCatalogEntry, LOCAL_IMAGE_CATALOG, type ImageCatalogModel, type ImageFileRole } from '@/services/aiRuntime/imageCatalog';
import {
  buildSdServerArgs,
  computeImageFit,
  SD_SERVER_PORT,
  SD_SERVER_URL,
  type SdBackend,
  type SdInstalledModel,
  type SdOpResult,
  type SdProgress,
  type SdRuntimeState,
  type SdRuntimeStatus,
} from '@/services/aiRuntime/sdServer';
import { downloadVerified, DownloadError, verifyFile } from './download';
import { detectHardware } from './hardware';
import { makeRoomForImageModel } from './vramRoom';
import {
  isCurrentSdRuntimeReceipt,
  sdBackendsFor,
  sdRuntimeArtifact,
  sdRuntimeTotalBytes,
  type SdRuntimeReceipt,
} from './sdRuntimeManifest';

// ── Types live in src/services/aiRuntime/sdServer.ts (shared with the renderer)

export type { SdInstalledModel, SdOpResult, SdProgress, SdRuntimeState, SdRuntimeStatus } from '@/services/aiRuntime/sdServer';

// ── Paths ───────────────────────────────────────────────────────────────────

const aiDir = (): string => path.join(app.getPath('userData'), 'ai');
const runtimeRoot = (): string => path.join(aiDir(), 'sd-runtime');
const runtimeDir = (backend: SdBackend): string => path.join(runtimeRoot(), backend);
const receiptPath = (backend: SdBackend): string => path.join(runtimeDir(backend), 'writers-hoard-runtime.json');
const stagingDir = (): string => path.join(aiDir(), 'sd-staging');
const modelsRoot = (): string => path.join(aiDir(), 'image-models');
const modelDir = (id: string): string => path.join(modelsRoot(), id);
const modelReceiptPath = (id: string): string => path.join(modelDir(id), 'writers-hoard-model.json');

// ── Module state ────────────────────────────────────────────────────────────

let state: SdRuntimeState = 'absent';
let lastError: string | null = null;
let installedBackend: SdBackend | null = null;
let runtimeBytes: number | null = null;
let serverChild: ChildProcess | null = null;
let loadedModelId: string | null = null;
let serverReady = false;
let ensureChain: Promise<unknown> = Promise.resolve();
let installAbort: AbortController | null = null;
let modelAbort: { id: string; controller: AbortController } | null = null;
let cachedModels: SdInstalledModel[] = [];
let idleTimer: NodeJS.Timeout | null = null;
/** The card is shared with the text models: give the VRAM back after a quiet spell. */
const IDLE_STOP_MS = 5 * 60_000;
const logRing: string[] = [];
let emit: (channel: string, payload: unknown) => void = () => {};

export function initSdRuntime(sink: (channel: string, payload: unknown) => void): void {
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

function artifactFor(backend: SdBackend) {
  return sdRuntimeArtifact(backend);
}

function snapshot(): SdRuntimeStatus {
  return {
    supported: sdBackendsFor().length > 0,
    backends: sdBackendsFor(),
    installedBackend,
    state,
    runtimeBytes: runtimeBytes ?? undefined,
    loadedModelId: serverReady ? loadedModelId : null,
    url: serverReady ? SD_SERVER_URL : null,
    models: cachedModels,
    downloading: modelAbort?.id ?? null,
    error: lastError ?? undefined,
    version: artifactFor('vulkan')?.version ?? 'unpinned',
  };
}

function setState(next: SdRuntimeState, error?: string | null): void {
  state = next;
  lastError = error ?? (next === 'error' ? lastError : null);
  emit('sd:status', snapshot());
}

function progress(payload: SdProgress): void {
  emit('sd:progress', payload);
}

// ── Disk helpers ────────────────────────────────────────────────────────────

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else if (e.isFile()) total += (await fs.stat(p)).size;
  }
  return total;
}

async function assertDiskSpace(dir: string, needed: number): Promise<void> {
  try {
    const s = await fs.statfs(dir);
    const free = Number(s.bavail) * Number(s.bsize);
    if (free < needed) throw new Error(`no-space:${Math.ceil(needed / 1e9)}`);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('no-space:')) throw err;
  }
}

function runTool(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().split('\n').slice(-2).join('\n') || `${cmd} exited ${code}`));
    });
  });
}

function powershellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function extractZip(archivePath: string, destinationPath: string): Promise<void> {
  await fs.mkdir(destinationPath, { recursive: true });
  // macOS ships bsdtar (libarchive), which reads zip; Windows 10+ ships bsdtar
  // too. GNU tar (the Linux default) does NOT read zip, so there the fallback
  // is `unzip`, not a re-throw — otherwise every Linux install fails here.
  try {
    await runTool('tar', ['-xf', archivePath, '-C', destinationPath]);
  } catch (err) {
    if (process.platform === 'win32') {
      await runTool('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath ${powershellLiteral(archivePath)} -DestinationPath ${powershellLiteral(destinationPath)} -Force`,
      ]);
    } else {
      await runTool('unzip', ['-o', archivePath, '-d', destinationPath]).catch(() => {
        throw err;
      });
    }
  }
}

// ── Runtime install ─────────────────────────────────────────────────────────

async function refreshInstalled(): Promise<void> {
  installedBackend = null;
  runtimeBytes = null;
  for (const backend of sdBackendsFor()) {
    const artifact = artifactFor(backend);
    if (!artifact) continue;
    try {
      const receipt = JSON.parse(await fs.readFile(receiptPath(backend), 'utf8')) as unknown;
      if (!isCurrentSdRuntimeReceipt(receipt, artifact)) continue;
      await fs.access(path.join(runtimeDir(backend), artifact.serverBinary));
      installedBackend = backend;
      runtimeBytes = await dirSize(runtimeDir(backend));
      break;
    } catch {
      // not this one
    }
  }
}

export async function installSdRuntime(backend: SdBackend): Promise<SdOpResult> {
  const artifact = artifactFor(backend);
  if (!artifact) return { ok: false, error: 'unsupported-platform' };
  if (state === 'downloading-runtime' || state === 'extracting') return { ok: false, error: 'busy' };
  if (installedBackend === backend) return { ok: true };

  // Claim synchronously, before any await, so a double-click can't launch two
  // installs sharing the staging dir and abort controller.
  installAbort = new AbortController();
  const { signal } = installAbort;
  setState('downloading-runtime');

  const total = sdRuntimeTotalBytes(artifact);
  try {
    await assertDiskSpace(app.getPath('userData'), total * 2.5);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'no-space:3';
    setState('error', msg);
    installAbort = null;
    return { ok: false, error: msg };
  }

  const extracted = path.join(stagingDir(), 'extracted');
  try {
    await stopSdServer();
    await fs.rm(stagingDir(), { recursive: true, force: true });
    await fs.mkdir(stagingDir(), { recursive: true });
    let doneBytes = 0;
    for (let i = 0; i < artifact.assets.length; i += 1) {
      const asset = artifact.assets[i];
      await downloadVerified(
        { url: asset.url, target: path.join(stagingDir(), asset.fileName), sizeBytes: asset.sizeBytes, sha256: asset.sha256 },
        {
          signal,
          onProgress: (p) => progress({ kind: 'runtime', id: backend, phase: 'downloading', receivedBytes: doneBytes + p.receivedBytes, totalBytes: total, fileIndex: i, fileCount: artifact.assets.length }),
        },
      );
      doneBytes += asset.sizeBytes;
    }
    setState('extracting');
    progress({ kind: 'runtime', id: backend, phase: 'extracting', receivedBytes: total, totalBytes: total, fileIndex: artifact.assets.length, fileCount: artifact.assets.length });
    for (const asset of artifact.assets) {
      await extractZip(path.join(stagingDir(), asset.fileName), extracted);
      if (signal.aborted) throw new DownloadError('cancelled', 'Cancelled.');
    }
    // The server binary and its libraries must end up in one flat directory —
    // sd-server.exe loads stable-diffusion.dll (and, for CUDA, cudart64_12.dll
    // from a SEPARATE zip) from beside itself. Flattening every extracted file
    // into the runtime dir guarantees that regardless of how each zip nests,
    // instead of moving only the folder that happened to hold the binary and
    // deleting the DLLs that lived in a sibling.
    const binaryDir = await findFileDir(extracted, artifact.serverBinary);
    if (!binaryDir) throw new Error('bad-archive');
    const target = runtimeDir(backend);
    await fs.mkdir(runtimeRoot(), { recursive: true });
    await fs.rm(target, { recursive: true, force: true });
    await fs.mkdir(target, { recursive: true });
    await flattenInto(extracted, target);
    const receipt: SdRuntimeReceipt = { version: artifact.version, backend, sha256s: artifact.assets.map((a) => a.sha256) };
    await fs.writeFile(path.join(target, 'writers-hoard-runtime.json'), JSON.stringify(receipt, null, 2), 'utf8');
    if (process.platform !== 'win32') {
      await fs.chmod(path.join(target, artifact.serverBinary), 0o755).catch(() => undefined);
    }
    await fs.rm(stagingDir(), { recursive: true, force: true });
    await refreshInstalled();
    if (installedBackend !== backend) throw new Error('runtime-install-verification-failed');
    setState('ready');
    return { ok: true };
  } catch (err) {
    await fs.rm(stagingDir(), { recursive: true, force: true }).catch(() => undefined);
    if (signal.aborted || (err instanceof DownloadError && err.code === 'cancelled')) {
      setState(installedBackend ? 'ready' : 'absent');
      return { ok: false, error: 'cancelled' };
    }
    const msg = err instanceof Error ? err.message : 'install failed';
    setState('error', msg);
    return { ok: false, error: msg };
  } finally {
    installAbort = null;
  }
}

/** Move every file anywhere under `root` into `dest`, flat. Later files win a name clash. */
async function flattenInto(root: string, dest: string): Promise<void> {
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const from = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(from);
      else if (entry.isFile()) await fs.rename(from, path.join(dest, entry.name)).catch(async () => {
        // A cross-device rename (staging on another volume) falls back to copy.
        await fs.copyFile(from, path.join(dest, entry.name));
      });
    }
  };
  await walk(root);
}

async function findFileDir(root: string, fileName: string): Promise<string | null> {
  const queue = [root];
  while (queue.length) {
    const dir = queue.shift() as string;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    if (entries.some((e) => e.isFile() && e.name === fileName)) return dir;
    for (const e of entries) if (e.isDirectory()) queue.push(path.join(dir, e.name));
  }
  return null;
}

export function cancelSdRuntimeInstall(): void {
  installAbort?.abort();
}

/** Uninstall the binaries; models are kept. */
export async function removeSdRuntime(): Promise<SdOpResult> {
  if (state === 'downloading-runtime' || state === 'extracting') return { ok: false, error: 'busy' };
  await stopSdServer();
  await fs.rm(runtimeRoot(), { recursive: true, force: true }).catch(() => undefined);
  await refreshInstalled();
  setState('absent');
  return { ok: true };
}

// ── Models ──────────────────────────────────────────────────────────────────

interface ModelReceipt {
  id: string;
  files: Array<{ role: ImageFileRole; fileName: string; sizeBytes: number; sha256: string }>;
}

async function refreshModels(): Promise<void> {
  const out: SdInstalledModel[] = [];
  for (const entry of LOCAL_IMAGE_CATALOG) {
    try {
      const receipt = JSON.parse(await fs.readFile(modelReceiptPath(entry.id), 'utf8')) as ModelReceipt;
      if (receipt.id !== entry.id) continue;
      // Sizes only: the hash was checked when the bytes arrived.
      let bytes = 0;
      let complete = true;
      for (const file of entry.files) {
        const recorded = receipt.files.find((f) => f.role === file.role && f.sha256 === file.sha256);
        if (!recorded) {
          complete = false;
          break;
        }
        const stat = await fs.stat(path.join(modelDir(entry.id), file.fileName)).catch(() => null);
        if (!stat || stat.size !== file.sizeBytes) {
          complete = false;
          break;
        }
        bytes += stat.size;
      }
      if (complete) out.push({ id: entry.id, installedBytes: bytes });
    } catch {
      // no receipt: not installed (a partial download is not a model)
    }
  }
  cachedModels = out;
}

export async function downloadSdModel(id: string): Promise<SdOpResult> {
  const entry = imageCatalogEntry(id);
  if (!entry) return { ok: false, error: 'unknown-model' };
  if (modelAbort) return { ok: false, error: 'busy' };
  if (cachedModels.some((m) => m.id === id)) return { ok: true };
  // Claim the slot synchronously, before any await, so a double-click can't get
  // two downloads past the `modelAbort` check and write the same files at once.
  const controller = new AbortController();
  modelAbort = { id, controller };
  emit('sd:status', snapshot());
  try {
    try {
      await assertDiskSpace(app.getPath('userData'), entry.totalBytes * 1.1);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'no-space:8' };
    }
    await fs.mkdir(modelDir(id), { recursive: true });
    let doneBytes = 0;
    for (let i = 0; i < entry.files.length; i += 1) {
      const file = entry.files[i];
      const target = path.join(modelDir(id), file.fileName);
      if (await verifyFile(target, file.sizeBytes, file.sha256)) {
        doneBytes += file.sizeBytes;
        continue;
      }
      progress({ kind: 'model', id, phase: 'downloading', receivedBytes: doneBytes, totalBytes: entry.totalBytes, fileIndex: i, fileCount: entry.files.length });
      await downloadVerified(
        { url: file.url, target, sizeBytes: file.sizeBytes, sha256: file.sha256 },
        {
          signal: controller.signal,
          onProgress: (p) => progress({ kind: 'model', id, phase: 'downloading', receivedBytes: doneBytes + p.receivedBytes, totalBytes: entry.totalBytes, fileIndex: i, fileCount: entry.files.length }),
        },
      );
      doneBytes += file.sizeBytes;
    }
    const receipt: ModelReceipt = { id, files: entry.files.map((f) => ({ role: f.role, fileName: f.fileName, sizeBytes: f.sizeBytes, sha256: f.sha256 })) };
    await fs.writeFile(modelReceiptPath(id), JSON.stringify(receipt, null, 2), 'utf8');
    await refreshModels();
    return { ok: true };
  } catch (err) {
    if (controller.signal.aborted || (err instanceof DownloadError && err.code === 'cancelled')) {
      // Partial files stay: the next attempt resumes them.
      return { ok: false, error: 'cancelled' };
    }
    return { ok: false, error: err instanceof Error ? err.message : 'download failed' };
  } finally {
    modelAbort = null;
    emit('sd:status', snapshot());
  }
}

export function cancelSdModelDownload(id: string): void {
  if (modelAbort?.id === id) modelAbort.controller.abort();
}

export async function deleteSdModel(id: string): Promise<SdOpResult> {
  if (!imageCatalogEntry(id)) return { ok: false, error: 'unknown-model' };
  if (modelAbort?.id === id) return { ok: false, error: 'busy' };
  if (loadedModelId === id) await stopSdServer();
  await fs.rm(modelDir(id), { recursive: true, force: true }).catch(() => undefined);
  await refreshModels();
  emit('sd:status', snapshot());
  return { ok: true };
}

export function installedSdModels(): SdInstalledModel[] {
  return cachedModels;
}

export function isSdRuntimeInstalled(): boolean {
  return installedBackend !== null;
}

/** Catalogue entries with weights on disk, as the gateway lists them. */
export function installedSdCatalogEntries(): ImageCatalogModel[] {
  return cachedModels.map((m) => imageCatalogEntry(m.id)).filter((e): e is ImageCatalogModel => Boolean(e));
}

// ── Server lifecycle ────────────────────────────────────────────────────────

async function probeServer(timeoutMs = 800): Promise<boolean> {
  try {
    const res = await net.fetch(`${SD_SERVER_URL}/sdcpp/v1/capabilities`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

async function spawnServer(entry: ImageCatalogModel): Promise<SdOpResult> {
  const backend = installedBackend;
  const artifact = backend ? artifactFor(backend) : undefined;
  if (!backend || !artifact) return { ok: false, error: 'runtime-missing' };
  const paths: Partial<Record<ImageFileRole, string>> = {};
  for (const file of entry.files) paths[file.role] = path.join(modelDir(entry.id), file.fileName);
  const hardware = await detectHardware(false);
  const fit = computeImageFit(hardware, entry);
  const args = buildSdServerArgs(entry, {
    paths,
    port: SD_SERVER_PORT,
    offloadToCpu: fit.placement === 'split',
    flashAttention: backend === 'cuda12',
  });
  setState('starting');
  progress({ kind: 'model', id: entry.id, phase: 'starting', receivedBytes: 0, totalBytes: 0, fileIndex: 0, fileCount: 0 });
  const bin = path.join(runtimeDir(backend), artifact.serverBinary);
  const child = spawn(bin, args, { cwd: runtimeDir(backend), windowsHide: true, detached: false });
  serverChild = child;
  serverReady = false;
  loadedModelId = entry.id;
  // A failure to spawn at all (missing/non-executable binary) fires 'error' but
  // never 'exit', so without this the startup loop would poll for four minutes.
  let spawnFailed: string | null = null;
  child.stdout?.on('data', (d: Buffer) => pushLog(d.toString()));
  child.stderr?.on('data', (d: Buffer) => pushLog(d.toString()));
  child.on('error', (err) => {
    pushLog(`spawn error: ${err.message}`);
    spawnFailed = err.message;
    if (serverChild === child) {
      serverChild = null;
      serverReady = false;
      loadedModelId = null;
    }
  });
  child.on('exit', (code) => {
    const wasLive = serverChild === child && (state === 'starting' || state === 'running');
    if (serverChild === child) {
      serverChild = null;
      serverReady = false;
      loadedModelId = null;
    }
    if (wasLive) setState('error', `sd-server exited (code ${code ?? '?'})\n${logTail(6)}`);
  });
  // Loading FLUX-sized weights can take a couple of minutes on a slow disk.
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (spawnFailed) {
      setState('error', `sd-server could not start: ${spawnFailed}`);
      return { ok: false, error: `spawn-failed: ${spawnFailed}` };
    }
    if (serverChild !== child) return { ok: false, error: lastError ?? 'sd-server exited during startup' };
    if (await probeServer(600)) {
      serverReady = true;
      setState('running');
      touchSdServer();
      return { ok: true };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (child.pid != null) killProcessTree(child.pid);
  serverChild = null;
  loadedModelId = null;
  setState('error', `sd-server did not answer within 4 minutes\n${logTail(6)}`);
  return { ok: false, error: lastError ?? 'startup timeout' };
}

/** A generation started or finished: push the idle shutdown back. */
export function touchSdServer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (serverChild && serverReady) void stopSdServer();
  }, IDLE_STOP_MS);
  idleTimer.unref?.();
}

/** Make sure the server is up with `modelId` loaded; swaps models when needed. */
export function ensureSdServer(modelId: string): Promise<SdOpResult> {
  const run = ensureChain.then(async (): Promise<SdOpResult> => {
    const entry = imageCatalogEntry(modelId);
    if (!entry) return { ok: false, error: 'unknown-model' };
    if (!installedBackend) {
      await refreshInstalled();
      if (!installedBackend) return { ok: false, error: 'runtime-missing' };
    }
    if (!cachedModels.some((m) => m.id === modelId)) {
      await refreshModels();
      if (!cachedModels.some((m) => m.id === modelId)) return { ok: false, error: 'model-missing' };
    }
    if (serverChild && serverReady && loadedModelId === modelId && (await probeServer())) return { ok: true };
    await stopSdServer();
    // The image model is about to take the card: ask a resident chat model to
    // step off first when they would not fit together (see vramRoom.ts).
    try {
      const room = await makeRoomForImageModel(entry.vramBytes);
      if (room.released.length) {
        console.info('[sd] unloaded resident chat models to make room:', room.released.map((r) => r.models.join(', ')).join('; '));
      }
    } catch (err) {
      console.warn('[sd] could not make room on the GPU:', err instanceof Error ? err.message : err);
    }
    return spawnServer(entry);
  });
  ensureChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function stopSdServer(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const child = serverChild;
  serverChild = null;
  serverReady = false;
  loadedModelId = null;
  if (child?.pid != null) {
    killProcessTree(child.pid);
    await new Promise((r) => setTimeout(r, 300));
  }
  if (state === 'running' || state === 'starting') setState(installedBackend ? 'ready' : 'absent');
}

export function sdServerUrl(): string | null {
  return serverReady ? SD_SERVER_URL : null;
}

// ── Status / shutdown ───────────────────────────────────────────────────────

export async function getSdRuntimeStatus(): Promise<SdRuntimeStatus> {
  if (state === 'downloading-runtime' || state === 'extracting' || state === 'starting') return snapshot();
  await refreshInstalled();
  await refreshModels();
  if (serverChild && serverReady) {
    if (!(await probeServer())) {
      serverReady = false;
      state = installedBackend ? 'ready' : 'absent';
    }
  } else if (state !== 'error') {
    state = installedBackend ? 'ready' : 'absent';
  }
  return snapshot();
}

export function shutdownSdRuntime(): void {
  installAbort?.abort();
  modelAbort?.controller.abort();
  if (serverChild?.pid != null) {
    killProcessTree(serverChild.pid);
    serverChild = null;
  }
  void fs.rm(stagingDir(), { recursive: true, force: true }).catch(() => undefined);
}
