// ============================================================================
// AI bridge — named keys (main process)
// ============================================================================
//
// Until now the bridge had one token. This module turns it into a list of
// named keys so each client (an MCP adapter, a script, another app) can have
// its own and be cut off alone, without touching the others.
//
//   token        the legacy file, unchanged: it IS the default key "Principal".
//                Clients already configured with it (WH_BRIDGE_TOKEN or the
//                token file the stdio adapter reads) keep working as they were.
//   keys.json    { version, keys: [...] }. Metadata for every key. A key made
//                here stores only the SHA-256 of its token: the token itself is
//                returned once, on creation, and never again. The default key
//                keeps its token in the `token` file (the pane has always been
//                able to show it, and the adapter reads it from there), so its
//                row carries no hash.
//
// The module is pure with respect to Electron: the directory and the clock are
// injected, so the unit test runs it against a temp folder.

import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const DEFAULT_KEY_ID = 'default';
export const DEFAULT_KEY_LABEL = 'Principal';
/** lastUsedAt is written at most this often per key. */
export const LAST_USED_THROTTLE_MS = 60_000;
export const MAX_ACTIVE_KEYS = 20;
export const MAX_LABEL_LENGTH = 60;

export interface BridgeKeyRecord {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
  /** SHA-256 hex of the token. Absent on the default key (token lives in the `token` file). */
  tokenHash?: string;
}

/** What leaves the main process: never a hash, never a token. */
export interface BridgeKeySummary {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
  isDefault: boolean;
  status: 'active' | 'revoked';
}

export type KeyAuthResult =
  | { ok: true; id: string; label: string }
  | { ok: false; code: 'missing-token' | 'bad-token' | 'revoked-token' };

export type KeyOpResult<T = object> = ({ ok: true } & T) | { ok: false; code: string; error: string };

export interface KeyStoreDeps {
  dir: () => string;
  now?: () => number;
}

interface KeysFile {
  version: 1;
  keys: BridgeKeyRecord[];
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function normaliseLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex -- control characters must not reach the audit log or the pane
  const label = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!label || label.length > MAX_LABEL_LENGTH) return null;
  return label;
}

function summarise(record: BridgeKeyRecord): BridgeKeySummary {
  return {
    id: record.id,
    label: record.label,
    createdAt: record.createdAt,
    ...(record.lastUsedAt !== undefined ? { lastUsedAt: record.lastUsedAt } : {}),
    ...(record.revokedAt !== undefined ? { revokedAt: record.revokedAt } : {}),
    isDefault: record.id === DEFAULT_KEY_ID,
    status: record.revokedAt !== undefined ? 'revoked' : 'active',
  };
}

function isRecord(value: unknown): value is BridgeKeyRecord {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.label === 'string' && typeof v.createdAt === 'number';
}

export function createKeyStore(deps: KeyStoreDeps) {
  const now = deps.now ?? Date.now;
  let cache: KeysFile | null = null;
  let loading: Promise<KeysFile> | null = null;
  let defaultToken: string | null = null;
  // Writes of keys.json are serialised; lastUsed bumps never wait on the disk.
  let chain: Promise<unknown> = Promise.resolve();

  const keysFile = () => path.join(deps.dir(), 'keys.json');
  const tokenFile = () => path.join(deps.dir(), 'token');

  async function persist(): Promise<void> {
    const snapshot = cache;
    if (!snapshot) return;
    const run = chain.then(async () => {
      await fs.mkdir(deps.dir(), { recursive: true });
      const target = keysFile();
      const tmp = `${target}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2), { encoding: 'utf8', mode: 0o600 });
      // Windows refuses to replace a file another handle (a reader, an antivirus scan) has open:
      // retry briefly, then copy over it, so a busy moment never loses the keys or the last use.
      for (let attempt = 0; ; attempt++) {
        try { await fs.rename(tmp, target); break; }
        catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if ((code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') || attempt >= 5) {
            if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') { await fs.copyFile(tmp, target); await fs.rm(tmp, { force: true }); break; }
            throw error;
          }
          await new Promise(resolve => setTimeout(resolve, 15 * 2 ** attempt));
        }
      }
    });
    chain = run.then(() => undefined, () => undefined);
    await run;
  }

  /** The legacy token: read it, or mint it when the app never had one. */
  async function readDefaultToken(): Promise<string> {
    if (defaultToken) return defaultToken;
    await fs.mkdir(deps.dir(), { recursive: true });
    try {
      const existing = (await fs.readFile(tokenFile(), 'utf8')).trim();
      if (/^[a-f0-9]{64}$/.test(existing)) {
        defaultToken = existing;
        return existing;
      }
    } catch {
      // falls through to generation
    }
    return regenerateDefaultToken();
  }

  async function regenerateDefaultToken(): Promise<string> {
    await fs.mkdir(deps.dir(), { recursive: true });
    const token = randomBytes(32).toString('hex');
    await fs.writeFile(tokenFile(), `${token}\n`, { encoding: 'utf8', mode: 0o600 });
    defaultToken = token;
    return token;
  }

  async function loadFile(): Promise<KeysFile> {
    let loaded: KeysFile | null = null;
    try {
      const text = (await fs.readFile(keysFile(), 'utf8')).replace(/^\uFEFF/, '');
      const raw = JSON.parse(text) as { keys?: unknown };
      if (Array.isArray(raw.keys)) {
        loaded = { version: 1, keys: raw.keys.filter(isRecord) };
      }
    } catch {
      // first run, or an unreadable file: the migration below rebuilds it
    }
    let dirty = false;
    if (!loaded) {
      loaded = { version: 1, keys: [] };
      dirty = true;
    }
    if (!loaded.keys.some((key) => key.id === DEFAULT_KEY_ID)) {
      // Migration: the single token becomes the default key. Its age is the
      // token file's, when there is one.
      let createdAt = now();
      try {
        createdAt = Math.round((await fs.stat(tokenFile())).mtimeMs);
      } catch {
        // no token file yet
      }
      loaded.keys.unshift({ id: DEFAULT_KEY_ID, label: DEFAULT_KEY_LABEL, createdAt });
      dirty = true;
    }
    // The default key never carries a hash and is never revoked.
    for (const key of loaded.keys) {
      if (key.id === DEFAULT_KEY_ID) {
        delete key.tokenHash;
        delete key.revokedAt;
      }
    }
    cache = loaded;
    if (dirty) await persist();
    return loaded;
  }

  async function load(): Promise<KeysFile> {
    if (loading) return loading;
    if (cache) return cache;
    // Every cold-start operation must mutate the same snapshot, including
    // requests arriving while the initial migration is being persisted.
    loading = loadFile();
    try { return await loading; }
    finally { loading = null; }
  }

  return {
    /** The default key's token (the legacy file). */
    async getDefaultToken(): Promise<string> {
      await load();
      return readDefaultToken();
    },

    /** Rotate the default key's token. Other keys are untouched. */
    async regenerateDefaultToken(): Promise<string> {
      await load();
      return regenerateDefaultToken();
    },

    async list(): Promise<BridgeKeySummary[]> {
      const file = await load();
      return file.keys.map(summarise);
    },

    /** Which key does this token belong to? Records usage, throttled. */
    async authenticate(presented: string): Promise<KeyAuthResult> {
      if (!presented) return { ok: false, code: 'missing-token' };
      const file = await load();
      const expectedDefault = await readDefaultToken();
      const hash = sha256Hex(presented);
      let matched: BridgeKeyRecord | null = null;
      // No early exit: every key is compared, so timing does not say which one matched.
      for (const key of file.keys) {
        const hit =
          key.id === DEFAULT_KEY_ID
            ? sameString(presented, expectedDefault)
            : typeof key.tokenHash === 'string' && sameString(hash, key.tokenHash);
        if (hit && !matched) matched = key;
      }
      if (!matched) return { ok: false, code: 'bad-token' };
      if (matched.revokedAt !== undefined) return { ok: false, code: 'revoked-token' };
      const at = now();
      if (matched.lastUsedAt === undefined || at - matched.lastUsedAt >= LAST_USED_THROTTLE_MS) {
        matched.lastUsedAt = at;
        void persist().catch((err) => console.error('[aibridge] could not record key use', err));
      }
      return { ok: true, id: matched.id, label: matched.label };
    },

    /** Make a key. The token is in the answer once and nowhere else. */
    async create(labelInput: unknown): Promise<KeyOpResult<{ key: BridgeKeySummary; token: string }>> {
      const label = normaliseLabel(labelInput);
      if (!label) {
        return { ok: false, code: 'bad-label', error: `The key needs a name of 1 to ${MAX_LABEL_LENGTH} characters.` };
      }
      const file = await load();
      const active = file.keys.filter((key) => key.revokedAt === undefined);
      if (active.length >= MAX_ACTIVE_KEYS) {
        return { ok: false, code: 'too-many-keys', error: `At most ${MAX_ACTIVE_KEYS} active keys. Revoke one first.` };
      }
      if (active.some((key) => key.label.toLowerCase() === label.toLowerCase())) {
        return { ok: false, code: 'duplicate-label', error: 'Another active key already has that name.' };
      }
      const token = randomBytes(32).toString('hex');
      const record: BridgeKeyRecord = {
        id: `key_${randomBytes(6).toString('hex')}`,
        label,
        createdAt: now(),
        tokenHash: sha256Hex(token),
      };
      file.keys.push(record);
      await persist();
      return { ok: true, key: summarise(record), token };
    },

    async rename(id: unknown, labelInput: unknown): Promise<KeyOpResult<{ key: BridgeKeySummary }>> {
      const label = normaliseLabel(labelInput);
      if (!label) {
        return { ok: false, code: 'bad-label', error: `The key needs a name of 1 to ${MAX_LABEL_LENGTH} characters.` };
      }
      const file = await load();
      const record = typeof id === 'string' ? file.keys.find((key) => key.id === id) : undefined;
      if (!record) return { ok: false, code: 'not-found', error: 'No such key.' };
      if (file.keys.some((key) => key.id !== record.id && key.revokedAt === undefined && key.label.toLowerCase() === label.toLowerCase())) {
        return { ok: false, code: 'duplicate-label', error: 'Another active key already has that name.' };
      }
      record.label = label;
      await persist();
      return { ok: true, key: summarise(record) };
    },

    /** Cut a key off. Immediate: the next request with it is refused. */
    async revoke(id: unknown): Promise<KeyOpResult<{ key: BridgeKeySummary }>> {
      const file = await load();
      const record = typeof id === 'string' ? file.keys.find((key) => key.id === id) : undefined;
      if (!record) return { ok: false, code: 'not-found', error: 'No such key.' };
      if (record.id === DEFAULT_KEY_ID) {
        return { ok: false, code: 'default-key', error: 'The main key cannot be revoked; regenerate it instead.' };
      }
      if (record.revokedAt === undefined) {
        record.revokedAt = now();
        await persist();
      }
      return { ok: true, key: summarise(record) };
    },

    /** Test hook: forget the in-memory copy so the next call re-reads the disk. */
    resetCache(): void {
      cache = null;
      defaultToken = null;
    },
  };
}

export type BridgeKeyStore = ReturnType<typeof createKeyStore>;
