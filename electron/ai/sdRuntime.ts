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
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  imageCatalogEntry,
  imageCompanionAsset,
  LOCAL_IMAGE_CATALOG,
  LOCAL_IMAGE_COMPANIONS,
  type ImageCatalogModel,
  type ImageCompanionKind,
  type ImageFileRole,
} from '@/services/aiRuntime/imageCatalog';
import {
  buildSdServerArgs,
  computeImageFit,
  isSdLoraName,
  SD_LORA_EXTENSIONS,
  SD_SERVER_PORT,
  SD_SERVER_URL,
  type SdBackend,
  type SdCompanionFile,
  type SdInstalledModel,
  type SdLoraFile,
  type SdOpResult,
  type SdProgress,
  type SdRuntimeState,
  type SdRuntimeStatus,
} from '@/services/aiRuntime/sdServer';
import { readBounded } from './adapters/http';
import { downloadVerified, DownloadError, verifyFile } from './download';
import { detectHardware } from './hardware';
import { cachedVramReport, makeRoomForImageModel, readVramReport } from './vramRoom';
import {
  isCurrentSdRuntimeReceipt,
  sdBackendsFor,
  sdRuntimeArtifact,
  sdRuntimeTotalBytes,
  type SdRuntimeReceipt,
} from './sdRuntimeManifest';

// ── Types live in src/services/aiRuntime/sdServer.ts (shared with the renderer)

export type { SdCompanionFile, SdInstalledModel, SdLoraFile, SdOpResult, SdProgress, SdRuntimeState, SdRuntimeStatus } from '@/services/aiRuntime/sdServer';

// ── Paths ───────────────────────────────────────────────────────────────────

const aiDir = (): string => path.join(app.getPath('userData'), 'ai');
const runtimeRoot = (): string => path.join(aiDir(), 'sd-runtime');
const runtimeDir = (backend: SdBackend): string => path.join(runtimeRoot(), backend);
const receiptPath = (backend: SdBackend): string => path.join(runtimeDir(backend), 'writers-hoard-runtime.json');
const stagingDir = (): string => path.join(aiDir(), 'sd-staging');
const modelsRoot = (): string => path.join(aiDir(), 'image-models');
/**
 * Where LoRAs live. stable-diffusion.cpp has no way to load one by path at
 * request time: it resolves `lora[].path` against its own listing of the single
 * folder the server was launched with, so the app owns one folder and the
 * reader drops files into it. Never backed up — re-downloadable by design.
 */
const lorasDir = (): string => path.join(aiDir(), 'loras');
/**
 * ControlNets and hires upscalers. Both are launch arguments rather than
 * request fields, which is why they get folders of their own rather than
 * riding along with the model they are used with.
 */
const controlNetsDir = (): string => path.join(aiDir(), 'controlnets');
const upscalersDir = (): string => path.join(aiDir(), 'upscalers');
const companionDir = (kind: ImageCompanionKind): string => (kind === 'controlnet' ? controlNetsDir() : upscalersDir());
const modelDir = (id: string): string => path.join(modelsRoot(), id);
const modelReceiptPath = (id: string): string => path.join(modelDir(id), 'writers-hoard-model.json');

// ── Module state ────────────────────────────────────────────────────────────

let state: SdRuntimeState = 'absent';
let lastError: string | null = null;
let installedBackend: SdBackend | null = null;
let runtimeBytes: number | null = null;
let serverChild: ChildProcess | null = null;
/** Pid of an sd-server left over from a previous session, reaped on will-quit. */
let orphanPid: number | null = null;
let orphanChecked = false;
let loadedModelId: string | null = null;
let serverReady = false;
let ensureChain: Promise<unknown> = Promise.resolve();
let installAbort: AbortController | null = null;
let modelAbort: { id: string; controller: AbortController } | null = null;
let cachedModels: SdInstalledModel[] = [];
let cachedLoras: SdLoraFile[] = [];
let cachedCompanions: SdCompanionFile[] = [];
/** File name of the ControlNet the live server was built with, or null. */
let serverControlNet: string | null = null;
/** Which ControlNet the next launch should use; null means none. */
let wantedControlNet: string | null = null;
let companionAbort: { id: string; controller: AbortController } | null = null;
/** Whether the live server was launched with `--lora-model-dir`. */
let serverHasLoraDir = false;
/**
 * Set only after this runtime build has been seen to refuse `--lora-model-dir`
 * and to start fine without it. Until that happens the flag is offered; after
 * it, the studio stops offering LoRAs instead of pretending they work.
 */
let loraLaunchRefused = false;
let idleTimer: NodeJS.Timeout | null = null;
/** The card is shared with the text models: give the VRAM back after a quiet spell. */
const IDLE_STOP_MS = 5 * 60_000;
const logRing: string[] = [];
let emit: (channel: string, payload: unknown) => void = () => {};

export function initSdRuntime(sink: (channel: string, payload: unknown) => void): void {
  emit = sink;
  // The folder is shown to the reader as the place to drop LoRAs, so it has to
  // be there to be opened — an instruction pointing at a path that does not
  // exist is not an instruction.
  void fs.mkdir(lorasDir(), { recursive: true }).catch(() => undefined);
  void fs.mkdir(controlNetsDir(), { recursive: true }).catch(() => undefined);
  void fs.mkdir(upscalersDir(), { recursive: true }).catch(() => undefined);
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
    loras: loraLaunchRefused ? [] : cachedLoras,
    lorasDir: lorasDir(),
    lorasSupported: !loraLaunchRefused,
    vram: cachedVramReport(),
    companions: cachedCompanions,
    controlNetsDir: controlNetsDir(),
    upscalersDir: upscalersDir(),
    loadedControlNet: serverReady ? serverControlNet : null,
    downloadingCompanion: companionAbort?.id ?? null,
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
    // A different build gets a fresh verdict on the LoRA flag.
    loraLaunchRefused = false;
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

/** Whether this launch should point the server at the LoRA folder. */
function wantsLoraDir(): boolean {
  return !loraLaunchRefused && cachedLoras.length > 0;
}

/**
 * What is in the LoRA folder right now. Cheap enough to run on every status
 * read: the reader drops a file in with the app open and expects to see it.
 * A name the server's `<lora:NAME:WEIGHT>` parser could not round-trip is
 * skipped rather than offered and silently ignored at generation time.
 */
async function refreshLoras(): Promise<void> {
  const dir = lorasDir();
  const out: SdLoraFile[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    cachedLoras = [];
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const extension = SD_LORA_EXTENSIONS.find((ext) => entry.name.toLowerCase().endsWith(ext));
    if (!extension) continue;
    const name = entry.name.slice(0, entry.name.length - extension.length);
    if (!isSdLoraName(name)) continue;
    const stat = await fs.stat(path.join(dir, entry.name)).catch(() => null);
    if (!stat) continue;
    out.push({ name, fileName: entry.name, sizeBytes: stat.size });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  cachedLoras = out;
}

/** Extensions the runtime's model loader reads for a ControlNet or an upscaler. */
const COMPANION_EXTENSIONS = ['.safetensors', '.gguf', '.pth', '.pt'] as const;

/**
 * ControlNets and upscalers on disk. Read on every status pass for the same
 * reason the LoRA folder is: a reader who drops a file in with the app open
 * expects to see it without restarting anything.
 */
async function refreshCompanions(): Promise<void> {
  const out: SdCompanionFile[] = [];
  for (const kind of ['controlnet', 'upscaler'] as const) {
    const dir = companionDir(kind);
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const extension = COMPANION_EXTENSIONS.find((ext) => entry.name.toLowerCase().endsWith(ext));
      if (!extension) continue;
      const stat = await fs.stat(path.join(dir, entry.name)).catch(() => null);
      if (!stat) continue;
      const catalogued = LOCAL_IMAGE_COMPANIONS.find((c) => c.kind === kind && c.fileName === entry.name);
      out.push({
        kind,
        catalogId: catalogued?.id ?? null,
        name: entry.name.slice(0, entry.name.length - extension.length),
        fileName: entry.name,
        sizeBytes: stat.size,
      });
    }
  }
  out.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  cachedCompanions = out;
}

/** Only pass `--hires-upscalers-dir` when a model is actually in it. */
function installedUpscalers(): SdCompanionFile[] {
  return cachedCompanions.filter((c) => c.kind === 'upscaler');
}

function controlNetFile(fileName: string | null): SdCompanionFile | null {
  if (!fileName) return null;
  return cachedCompanions.find((c) => c.kind === 'controlnet' && c.fileName === fileName) ?? null;
}

/**
 * Download a ControlNet or an upscaler into its folder, pinned exactly as a
 * model is: right size, right digest, or it does not land.
 */
export async function downloadSdCompanion(id: string): Promise<SdOpResult> {
  const asset = imageCompanionAsset(id);
  if (!asset) return { ok: false, error: 'unknown-companion' };
  if (companionAbort) return { ok: false, error: 'busy' };
  const controller = new AbortController();
  companionAbort = { id, controller };
  emit('sd:status', snapshot());
  const dir = companionDir(asset.kind);
  const target = path.join(dir, asset.fileName);
  try {
    try {
      await assertDiskSpace(app.getPath('userData'), asset.sizeBytes * 1.1);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'no-space:8' };
    }
    await fs.mkdir(dir, { recursive: true });
    if (!(await verifyFile(target, asset.sizeBytes, asset.sha256))) {
      progress({ kind: 'model', id, phase: 'downloading', receivedBytes: 0, totalBytes: asset.sizeBytes, fileIndex: 0, fileCount: 1 });
      await downloadVerified(
        { url: asset.url, target, sizeBytes: asset.sizeBytes, sha256: asset.sha256 },
        {
          signal: controller.signal,
          onProgress: (p) => progress({ kind: 'model', id, phase: 'downloading', receivedBytes: p.receivedBytes, totalBytes: asset.sizeBytes, fileIndex: 0, fileCount: 1 }),
        },
      );
    }
    await refreshCompanions();
    return { ok: true };
  } catch (err) {
    if (controller.signal.aborted || (err instanceof DownloadError && err.code === 'cancelled')) {
      return { ok: false, error: 'cancelled' };
    }
    return { ok: false, error: err instanceof Error ? err.message : 'download failed' };
  } finally {
    companionAbort = null;
    emit('sd:status', snapshot());
  }
}

export function cancelSdCompanionDownload(id: string): void {
  if (companionAbort?.id === id) companionAbort.controller.abort();
}

export async function deleteSdCompanion(id: string): Promise<SdOpResult> {
  const asset = imageCompanionAsset(id);
  if (!asset) return { ok: false, error: 'unknown-companion' };
  if (companionAbort?.id === id) return { ok: false, error: 'busy' };
  // The live server holds an open handle on the ControlNet it was built with;
  // stop it first or the delete fails on Windows and half-succeeds elsewhere.
  if (serverControlNet === asset.fileName) await stopSdServer();
  await fs.rm(path.join(companionDir(asset.kind), asset.fileName), { force: true }).catch(() => undefined);
  await refreshCompanions();
  emit('sd:status', snapshot());
  return { ok: true };
}

/** ControlNets and upscalers on disk, as the studio lists them. */
export function installedSdCompanions(): SdCompanionFile[] {
  return cachedCompanions;
}

/**
 * The LoRA file name behind a display name. The server resolves `lora[].path`
 * against its own listing of the folder, and that listing keeps the extension —
 * so a request built from the name alone would be refused outright.
 */
export function sdLoraFileName(name: string): string | null {
  return cachedLoras.find((lora) => lora.name === name)?.fileName ?? null;
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

/** Plenty for a capabilities document; a stranger's page never gets to stream. */
const PROBE_BODY_LIMIT = 64 * 1024;

/**
 * Does the holder of the port answer our own route the way an sd-server does?
 *
 * A 2xx on its own is not evidence of anything: a dev server with an SPA
 * fallback answers every path it has never heard of with its index.html and a
 * 200, and believing it means recording a stranger's pid as our orphan and
 * killing it later. `/sdcpp/v1/capabilities` answers with a JSON object; HTML,
 * a bare string and an array are all somebody else's server.
 */
function isCapabilitiesBody(body: string): boolean {
  try {
    const parsed: unknown = JSON.parse(body);
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length > 0
    );
  } catch {
    return false;
  }
}

async function probeServer(timeoutMs = 800): Promise<boolean> {
  try {
    const res = await net.fetch(`${SD_SERVER_URL}/sdcpp/v1/capabilities`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return false;
    return isCapabilitiesBody(await readBounded(res, PROBE_BODY_LIMIT));
  } catch {
    return false;
  }
}

/**
 * SIGKILL one process — never a process group.
 *
 * `killProcessTree` tries `process.kill(-pid)` first, which addresses the whole
 * GROUP led by that pid. That is right for the detached yt-dlp/ffmpeg pair it
 * was written for and wrong for every pid here: `spawnServer` starts sd-server
 * with `detached: false`, so our own child leads no group of its own, and an
 * orphan holding the port was never ours to spawn at all — any group carrying
 * that id belongs to somebody else, and killing it is not a reclaim.
 */
function killSdProcess(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone, or not ours to signal */
  }
}

/** The command that names a loopback port's listener on this platform. */
function listenerQuery(port: number): { command: string; args: string[] } {
  return process.platform === 'win32'
    ? { command: 'netstat', args: ['-a', '-n', '-o'] }
    : { command: 'lsof', args: ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'] };
}

/**
 * Pid of whatever listens on the port, out of that command's output, or null.
 * `netstat`'s state column is localised, the "no peer" foreign address is not,
 * so the row is recognised by that instead.
 */
function parseListenerPid(output: string, port: number): number | null {
  const isWin = process.platform === 'win32';
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

/** Pid of whatever listens on a loopback port, or null when it cannot be resolved. */
async function listenerPid(port: number): Promise<number | null> {
  const { command, args } = listenerQuery(port);
  const output = await new Promise<string>((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
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
  return parseListenerPid(output, port);
}

/**
 * The same question, answered without yielding. `will-quit` runs this module's
 * shutdown synchronously and nothing awaits it, so asking who holds the port at
 * that moment means blocking for the answer — briefly, and only when there is
 * an orphan to check.
 */
function listenerPidSync(port: number): number | null {
  const { command, args } = listenerQuery(port);
  const result = spawnSync(command, args, { windowsHide: true, encoding: 'utf8', timeout: 2000 });
  return parseListenerPid(result.stdout ?? '', port);
}

/**
 * Note an sd-server left behind by a crashed session, so will-quit reaps it.
 * The probe is what makes it OUR orphan rather than whoever happens to hold the
 * port. The pid is only as good as the moment it was read — this check runs
 * once a session — so it is re-checked against the live listener before
 * anything is killed (see `shutdownSdRuntime`).
 */
async function findOrphanServer(): Promise<void> {
  if (orphanChecked || serverChild) return;
  orphanChecked = true;
  if (!(await probeServer(600))) return;
  orphanPid = await listenerPid(SD_SERVER_PORT);
}

/**
 * An sd-server orphaned by a crashed session answers `probeServer` exactly like
 * the child we are about to spawn — with another model loaded, and holding the
 * port ours needs. Reap it and start our own; never adopt it. Returns null once
 * the port is clear, a failure when it cannot be freed.
 */
async function reclaimServerPort(): Promise<SdOpResult | null> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const answering = await probeServer(600);
    const pid = await listenerPid(SD_SERVER_PORT);
    if (!answering && pid === null) return null;
    if (answering) {
      // Only a server answering our own route is ours to reap; a stranger keeps
      // the port and we refuse, rather than spawn a child the next probe would
      // mistake for it. A pid-less orphan cannot be reaped at all.
      if (pid === null) break;
      killSdProcess(pid);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  setState('error', `port ${SD_SERVER_PORT} is held by another process`);
  return { ok: false, error: 'port-busy' };
}

async function spawnServer(entry: ImageCatalogModel, allowLoras = true): Promise<SdOpResult> {
  const backend = installedBackend;
  const artifact = backend ? artifactFor(backend) : undefined;
  if (!backend || !artifact) return { ok: false, error: 'runtime-missing' };
  const paths: Partial<Record<ImageFileRole, string>> = {};
  for (const file of entry.files) paths[file.role] = path.join(modelDir(entry.id), file.fileName);
  const hardware = await detectHardware(false);
  const fit = computeImageFit(hardware, entry);
  // Only when a LoRA is actually there: a build that did not know the flag
  // would refuse to start, and the reader who never touched LoRAs must never
  // meet that. Empty folder → byte-identical command line to before.
  const withLoras = allowLoras && wantsLoraDir();
  if (withLoras) await fs.mkdir(lorasDir(), { recursive: true }).catch(() => undefined);
  // ControlNet is a CONTEXT option: the model is baked into the process at
  // startup and no request can change it. Which one this server is holding is
  // therefore part of its identity — see ensureSdServer.
  const controlNet = controlNetFile(wantedControlNet);
  const withUpscalers = installedUpscalers().length > 0;
  const args = buildSdServerArgs(entry, {
    paths,
    port: SD_SERVER_PORT,
    offloadToCpu: fit.placement === 'split',
    flashAttention: backend === 'cuda12',
    loraDir: withLoras ? lorasDir() : undefined,
    controlNetPath: controlNet ? path.join(controlNetsDir(), controlNet.fileName) : undefined,
    hiresUpscalersDir: withUpscalers ? upscalersDir() : undefined,
  });
  setState('starting');
  progress({ kind: 'model', id: entry.id, phase: 'starting', receivedBytes: 0, totalBytes: 0, fileIndex: 0, fileCount: 0 });
  const busy = await reclaimServerPort();
  if (busy) return busy;
  const bin = path.join(runtimeDir(backend), artifact.serverBinary);
  const child = spawn(bin, args, { cwd: runtimeDir(backend), windowsHide: true, detached: false });
  serverChild = child;
  orphanPid = null;
  serverReady = false;
  loadedModelId = entry.id;
  serverHasLoraDir = withLoras;
  serverControlNet = controlNet?.fileName ?? null;
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
      serverControlNet = null;
    }
  });
  child.on('exit', (code) => {
    const wasLive = serverChild === child && (state === 'starting' || state === 'running');
    if (serverChild === child) {
      serverChild = null;
      serverReady = false;
      loadedModelId = null;
      serverControlNet = null;
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
  if (child.pid != null) killSdProcess(child.pid);
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
export interface EnsureSdServerOptions {
  /**
   * Catalogue id or file name of the ControlNet this job needs. Passing a
   * different one than the running server holds restarts it, because the model
   * is a context option; passing nothing leaves whichever one is loaded alone
   * so a plain job never pays for a restart.
   */
  controlNet?: string | null;
}

export function ensureSdServer(modelId: string, options: EnsureSdServerOptions = {}): Promise<SdOpResult> {
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
    // The LoRA folder is read here too: a file dropped in while the server was
    // already up needs the flag, and the flag is only settable at launch — so
    // the first generation after a folder goes from empty to non-empty (or back)
    // restarts the server instead of silently ignoring the LoRA.
    await refreshLoras();
    await refreshCompanions();
    if (options.controlNet !== undefined) {
      const asset = options.controlNet ? imageCompanionAsset(options.controlNet) : null;
      const fileName = asset?.fileName ?? options.controlNet ?? null;
      if (options.controlNet && !controlNetFile(fileName)) return { ok: false, error: 'controlnet-missing' };
      wantedControlNet = fileName;
    } else if (wantedControlNet && !controlNetFile(wantedControlNet)) {
      // The file was deleted under a running server; do not keep asking for it.
      wantedControlNet = null;
    }
    if (
      serverChild &&
      serverReady &&
      loadedModelId === modelId &&
      serverHasLoraDir === wantsLoraDir() &&
      serverControlNet === (controlNetFile(wantedControlNet)?.fileName ?? null) &&
      (await probeServer())
    ) {
      return { ok: true };
    }
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
    const usedLoraDir = wantsLoraDir();
    const started = await spawnServer(entry);
    if (started.ok || !usedLoraDir) return started;
    // The LoRA folder was the only thing that launch did differently. A build
    // that does not take `--lora-model-dir` prints its usage and exits, and the
    // reader would be left with no image generation at all because a file sits
    // in a folder. Try once more without it; if THAT works, the flag was the
    // problem and the studio stops offering LoRAs for this runtime.
    console.warn('[sd] sd-server refused to start; retrying without the LoRA folder');
    const retried = await spawnServer(entry, false);
    if (retried.ok) {
      loraLaunchRefused = true;
      emit('sd:status', snapshot());
    }
    return retried;
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
  serverHasLoraDir = false;
  serverControlNet = null;
  if (child?.pid != null) {
    killSdProcess(child.pid);
    await new Promise((r) => setTimeout(r, 300));
  }
  if (state === 'running' || state === 'starting') setState(installedBackend ? 'ready' : 'absent');
}

export function sdServerUrl(): string | null {
  return serverReady ? SD_SERVER_URL : null;
}

// ── Status / shutdown ───────────────────────────────────────────────────────

/**
 * Measure the card in the background and push the answer when it lands.
 *
 * Deliberately NOT awaited by the status read: nvidia-smi can take a moment and
 * `/api/ps` has its own timeout, and the settings page asks for this status far
 * more often than either figure changes. The report memoises itself for a
 * couple of seconds, so a burst of reads costs one measurement.
 */
function refreshVramReport(): void {
  void readVramReport()
    .then((report) => {
      if (report !== cachedVramReport()) return;
      emit('sd:status', snapshot());
    })
    .catch(() => undefined);
}

export async function getSdRuntimeStatus(): Promise<SdRuntimeStatus> {
  // With nothing measured yet — the first look, or right after an unload threw
  // the last figure away — wait for the measurement: a status that answers "no
  // idea" is exactly the one the studio needed in order to warn. Otherwise the
  // memoised figure goes back now and a fresh one is pushed when it lands.
  if (!cachedVramReport()) await readVramReport().catch(() => undefined);
  else refreshVramReport();
  if (state === 'downloading-runtime' || state === 'extracting' || state === 'starting') return snapshot();
  await refreshInstalled();
  await refreshModels();
  await refreshLoras();
  await refreshCompanions();
  await findOrphanServer();
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
  const child = serverChild;
  const orphan = orphanPid;
  serverChild = null;
  orphanPid = null;
  // Ours beyond doubt: we spawned it this session and have held the handle ever
  // since.
  if (child?.pid != null) killSdProcess(child.pid);
  // An orphan on the sd port is not a ChildProcess of ours; left alone it holds
  // its weights in VRAM and RAM through every quit from here on. Its pid, on
  // the other hand, was resolved once — possibly hours ago — and the OS may
  // hand that number to something else the moment the process exits. So it is
  // reaped only while it is STILL the listener on our port.
  if (orphan !== null && listenerPidSync(SD_SERVER_PORT) === orphan) killSdProcess(orphan);
  void fs.rm(stagingDir(), { recursive: true, force: true }).catch(() => undefined);
}
