// ============================================================================
// AI runtime — connection registry with encrypted secrets (main process)
// ============================================================================
//
// <userData>/ai/connections.json holds every server the user has added by
// IP/URL, plus the default routes. API keys never sit in that file in clear:
// they are wrapped with Electron's safeStorage (DPAPI on Windows, Keychain on
// macOS) and only the ciphertext is stored. The renderer is told THAT a key
// exists and its last four characters — never the key. Writes are atomic
// (temp file + rename) so a crash mid-save cannot leave half a registry.
//
// The embedded/system Ollama the app already manages is exposed as a builtin
// connection with a stable id; it is synthesised on read, never stored, so it
// cannot be deleted or pointed elsewhere.

import { app, safeStorage } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type {
  AiConnectionInput,
  AiConnectionSummary,
  AiDefaults,
  AiLocality,
  AiModelType,
  AiRouteSelection,
} from '@/services/aiRuntime/types';
import { normaliseBaseUrl } from '@/services/aiRuntime/urlPolicy';
import { BUILTIN_OLLAMA_ID, BUILTIN_SD_ID } from '@/services/aiRuntime/constants';
import { SD_SERVER_URL } from '@/services/aiRuntime/sdServer';

export { BUILTIN_OLLAMA_ID, BUILTIN_SD_ID };

export function isBuiltinConnectionId(id: string): boolean {
  return id === BUILTIN_OLLAMA_ID || id === BUILTIN_SD_ID;
}

interface StoredConnection {
  id: string;
  name: string;
  // The kinds a person can create and that therefore get written to disk.
  // `sdcpp` is deliberately not here: that connection is synthesised for the
  // managed runtime and never persisted, so a stored row can never point at a
  // server the app is supposed to be supervising itself.
  kind: 'openai-compatible' | 'ollama' | 'comfyui' | 'claude-subscription' | 'codex-subscription';
  baseUrl: string;
  enabled: boolean;
  modelTypes: AiModelType[];
  pinnedModels: string[];
  allowInsecureRemote?: boolean;
  /** base64 of safeStorage ciphertext. */
  secretEnc?: string;
  secretHint?: string;
  createdAt: number;
  updatedAt: number;
}

interface StoreFile {
  version: 1;
  connections: StoredConnection[];
  defaults: AiDefaults;
  /** Set once the legacy Dexie settings have been folded in. */
  legacyMigrated?: boolean;
  /** Per-connection model capability overrides the user pinned by hand. */
  modelOverrides?: Record<string, { tools?: boolean; vision?: boolean; image?: boolean }>;
}

const EMPTY: StoreFile = { version: 1, connections: [], defaults: {} };

let cache: StoreFile | null = null;
let writeChain: Promise<unknown> = Promise.resolve();

/** Live base URL of the managed Ollama, wired from electron/ollama.ts. */
let builtinBaseUrl: () => string | null = () => null;
export function setBuiltinOllamaResolver(resolver: () => string | null): void {
  builtinBaseUrl = resolver;
}

/** Whether the managed image runtime is installed, wired from electron/ai/sdRuntime.ts. */
let sdInstalled: () => boolean = () => false;
export function setBuiltinSdResolver(resolver: () => boolean): void {
  sdInstalled = resolver;
}

function dir(): string {
  return path.join(app.getPath('userData'), 'ai');
}
function file(): string {
  return path.join(dir(), 'connections.json');
}

async function load(): Promise<StoreFile> {
  if (cache) return cache;
  let raw: string;
  try {
    raw = (await fs.readFile(file(), 'utf8')).replace(/^\uFEFF/, '');
  } catch (err) {
    // Only a missing file means "no connections yet". Any other failure (a
    // scanner holding the file, EPERM) is thrown uncached, so the next call
    // retries: an empty registry cached here would be written over the real
    // one — every connection and every encrypted key — by the next save.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    cache = { ...EMPTY, connections: [], defaults: {}, modelOverrides: {} };
    return cache;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoreFile>;
    cache = {
      version: 1,
      connections: Array.isArray(parsed.connections) ? parsed.connections : [],
      defaults: parsed.defaults && typeof parsed.defaults === 'object' ? parsed.defaults : {},
      legacyMigrated: parsed.legacyMigrated === true,
      modelOverrides: parsed.modelOverrides ?? {},
    };
  } catch {
    // Unparseable (a hand edit gone wrong): start empty, but move the file
    // aside first so the next save cannot erase what is still in it.
    await fs.rename(file(), `${file()}.unreadable-${Date.now()}`).catch(() => undefined);
    cache = { ...EMPTY, connections: [], defaults: {}, modelOverrides: {} };
  }
  return cache;
}

function save(next: StoreFile): Promise<void> {
  cache = next;
  const run = writeChain.then(async () => {
    await fs.mkdir(dir(), { recursive: true });
    const target = file();
    const temporary = `${target}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, target);
  });
  writeChain = run.then(
    () => undefined,
    (err) => console.error('[ai] connections save failed', err),
  );
  return run;
}

function localityOf(baseUrl: string): AiLocality {
  const n = normaliseBaseUrl(baseUrl);
  return n.ok ? n.locality : 'remote';
}

function toSummary(row: StoredConnection): AiConnectionSummary {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    baseUrl: row.baseUrl,
    enabled: row.enabled,
    hasSecret: Boolean(row.secretEnc),
    secretHint: row.secretHint,
    locality: localityOf(row.baseUrl),
    modelTypes: row.modelTypes,
    pinnedModels: row.pinnedModels,
    allowInsecureRemote: row.allowInsecureRemote,
    status: 'unknown',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The managed Ollama, as a connection the rest of the gateway can route to. */
export function builtinConnection(): AiConnectionSummary {
  const url = builtinBaseUrl();
  return {
    id: BUILTIN_OLLAMA_ID,
    name: 'IA local (Ollama)',
    kind: 'ollama',
    baseUrl: url ?? 'http://127.0.0.1:11434',
    enabled: true,
    hasSecret: false,
    locality: 'embedded',
    modelTypes: ['chat'],
    pinnedModels: [],
    builtin: true,
    status: url ? 'unknown' : 'offline',
    createdAt: 0,
    updatedAt: 0,
  };
}

/** The managed image server, as a connection: image models only, never a key. */
export function builtinSdConnection(): AiConnectionSummary {
  return {
    id: BUILTIN_SD_ID,
    name: 'Imágenes locales (stable-diffusion.cpp)',
    kind: 'sdcpp',
    baseUrl: SD_SERVER_URL,
    enabled: true,
    hasSecret: false,
    locality: 'embedded',
    modelTypes: ['image'],
    pinnedModels: [],
    builtin: true,
    status: sdInstalled() ? 'unknown' : 'offline',
    createdAt: 0,
    updatedAt: 0,
  };
}

export async function listConnections(): Promise<AiConnectionSummary[]> {
  const store = await load();
  return [builtinConnection(), builtinSdConnection(), ...store.connections.map(toSummary)];
}

export async function getConnection(id: string): Promise<AiConnectionSummary | null> {
  if (id === BUILTIN_OLLAMA_ID) return builtinConnection();
  if (id === BUILTIN_SD_ID) return builtinSdConnection();
  const store = await load();
  const row = store.connections.find((c) => c.id === id);
  return row ? toSummary(row) : null;
}

/** Main-only: the decrypted key for a request header. Never crosses IPC. */
export async function getSecret(id: string): Promise<string | null> {
  const store = await load();
  const row = store.connections.find((c) => c.id === id);
  if (!row?.secretEnc) return null;
  try {
    return safeStorage.decryptString(Buffer.from(row.secretEnc, 'base64'));
  } catch (err) {
    console.error('[ai] secret decrypt failed', err);
    return null;
  }
}

export type SaveConnectionResult =
  | { ok: true; connection: AiConnectionSummary }
  | { ok: false; code: 'bad-url' | 'duplicate' | 'builtin' | 'not-found'; error: string };

export async function saveConnection(input: AiConnectionInput): Promise<SaveConnectionResult> {
  if (input.id && isBuiltinConnectionId(input.id)) {
    return { ok: false, code: 'builtin', error: 'A built-in connection cannot be edited.' };
  }
  if (input.kind === 'sdcpp') {
    return { ok: false, code: 'builtin', error: 'The local image server is managed by the app; add an OpenAI-compatible image server instead.' };
  }
  const normalised = normaliseBaseUrl(input.kind === 'claude-subscription' ? 'https://claude.ai' : input.kind === 'codex-subscription' ? 'https://chatgpt.com' : input.baseUrl);
  if (!normalised.ok) {
    return { ok: false, code: 'bad-url', error: `Invalid address (${normalised.code}).` };
  }
  const store = await load();
  const now = Date.now();
  const duplicate = store.connections.find(
    (c) => c.id !== input.id && c.baseUrl.toLowerCase() === normalised.baseUrl.toLowerCase() && c.kind === input.kind,
  );
  if (duplicate) {
    return { ok: false, code: 'duplicate', error: `"${duplicate.name}" already points at that server.` };
  }
  const modelTypes: AiModelType[] = input.kind.endsWith('-subscription') ? ['chat'] : input.modelTypes?.length ? input.modelTypes : ['chat'];
  const pinnedModels = (input.pinnedModels ?? []).map((m) => m.trim()).filter(Boolean);
  const name = input.name.trim() || normalised.host;

  if (input.id) {
    const existing = store.connections.find((c) => c.id === input.id);
    if (!existing) return { ok: false, code: 'not-found', error: 'No such connection.' };
    const updated: StoredConnection = {
      ...existing,
      name,
      kind: input.kind,
      baseUrl: normalised.baseUrl,
      enabled: input.enabled ?? existing.enabled,
      modelTypes,
      pinnedModels,
      allowInsecureRemote: input.allowInsecureRemote ?? existing.allowInsecureRemote,
      updatedAt: now,
    };
    const next = {
      ...store,
      connections: store.connections.map((c) => (c.id === existing.id ? updated : c)),
    };
    await save(next);
    return { ok: true, connection: toSummary(updated) };
  }

  const created: StoredConnection = {
    id: `conn-${randomUUID()}`,
    name,
    kind: input.kind,
    baseUrl: normalised.baseUrl,
    enabled: input.enabled ?? true,
    modelTypes,
    pinnedModels,
    allowInsecureRemote: input.allowInsecureRemote,
    createdAt: now,
    updatedAt: now,
  };
  await save({ ...store, connections: [...store.connections, created] });
  return { ok: true, connection: toSummary(created) };
}

export async function deleteConnection(id: string): Promise<boolean> {
  if (isBuiltinConnectionId(id)) return false;
  const store = await load();
  if (!store.connections.some((c) => c.id === id)) return false;
  const defaults: AiDefaults = { ...store.defaults };
  if (defaults.chat?.connectionId === id) delete defaults.chat;
  if (defaults.image?.connectionId === id) delete defaults.image;
  await save({ ...store, connections: store.connections.filter((c) => c.id !== id), defaults });
  return true;
}

export type SetSecretResult =
  | { ok: true; connection: AiConnectionSummary }
  | { ok: false; code: 'not-found' | 'no-encryption' | 'builtin'; error: string };

/** Store (or clear, with an empty string) the API key for a connection. */
export async function setSecret(id: string, secret: string): Promise<SetSecretResult> {
  if (isBuiltinConnectionId(id)) {
    return { ok: false, code: 'builtin', error: 'The built-in connection takes no key.' };
  }
  const store = await load();
  const row = store.connections.find((c) => c.id === id);
  if (!row) return { ok: false, code: 'not-found', error: 'No such connection.' };
  const trimmed = secret.trim();
  let updated: StoredConnection;
  if (!trimmed) {
    updated = { ...row, secretEnc: undefined, secretHint: undefined, updatedAt: Date.now() };
  } else {
    if (!safeStorage.isEncryptionAvailable()) {
      return {
        ok: false,
        code: 'no-encryption',
        error: 'This system cannot encrypt secrets at rest, so the key was not saved.',
      };
    }
    const enc = safeStorage.encryptString(trimmed).toString('base64');
    const hint = trimmed.length > 8 ? `${trimmed.slice(0, 3)}…${trimmed.slice(-4)}` : '•••';
    updated = { ...row, secretEnc: enc, secretHint: hint, updatedAt: Date.now() };
  }
  await save({ ...store, connections: store.connections.map((c) => (c.id === id ? updated : c)) });
  return { ok: true, connection: toSummary(updated) };
}

export async function getDefaults(): Promise<AiDefaults> {
  return { ...(await load()).defaults };
}

export async function setDefault(kind: keyof AiDefaults, route: AiRouteSelection | null): Promise<AiDefaults> {
  const store = await load();
  const defaults: AiDefaults = { ...store.defaults };
  if (route && route.connectionId && route.modelId) defaults[kind] = { ...route };
  else delete defaults[kind];
  await save({ ...store, defaults });
  return { ...defaults };
}

export async function isLegacyMigrated(): Promise<boolean> {
  return (await load()).legacyMigrated === true;
}

export async function markLegacyMigrated(): Promise<void> {
  const store = await load();
  if (store.legacyMigrated) return;
  await save({ ...store, legacyMigrated: true });
}

export async function getModelOverrides(): Promise<Record<string, { tools?: boolean; vision?: boolean; image?: boolean }>> {
  return { ...((await load()).modelOverrides ?? {}) };
}

export async function setModelOverride(
  key: string,
  override: { tools?: boolean; vision?: boolean; image?: boolean } | null,
): Promise<void> {
  const store = await load();
  const modelOverrides = { ...(store.modelOverrides ?? {}) };
  if (override) modelOverrides[key] = override;
  else delete modelOverrides[key];
  await save({ ...store, modelOverrides });
}

/** Free-text sanity for logs and error messages: never echo a secret. */
export function redactSecrets(text: string, secret: string | null): string {
  if (!secret || secret.length < 6) return text;
  return text.split(secret).join('[redacted]');
}
