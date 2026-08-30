// ============================================================================
// AI bridge — token, switches and audit trail (main process)
// ============================================================================
//
// Everything durable the bridge owns lives in <userData>/aibridge/:
//
//   token         32 random bytes, hex. Required on every HTTP request.
//   config.json   { enabled, writesEnabled }
//   audit.jsonl   one line per mutating call, with the previous state
//
// The audit trail is deliberately a file and not a Dexie table: the
// conformance gate requires every table to have an owning engine and a backup
// strategy, and a log is neither. Keeping it in main also means it survives a
// renderer crash and is readable while the app is closed.

import { app } from 'electron';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';

export interface BridgeConfig {
  /** Master switch. Off by default: turning the port on is a deliberate act. */
  enabled: boolean;
  /** When false, only read-only tools are served. */
  writesEnabled: boolean;
}

const DEFAULT_CONFIG: BridgeConfig = { enabled: false, writesEnabled: true };

/** Rotate once the log passes this, so a runaway agent cannot fill the disk. */
const AUDIT_MAX_BYTES = 5 * 1024 * 1024;

let cachedToken: string | null = null;
let cachedConfig: BridgeConfig | null = null;

function bridgeDir(): string {
  return path.join(app.getPath('userData'), 'aibridge');
}

async function ensureDir(): Promise<string> {
  const dir = bridgeDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

export async function getBridgeToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const dir = await ensureDir();
  const file = path.join(dir, 'token');
  try {
    const existing = (await fs.readFile(file, 'utf8')).trim();
    if (/^[a-f0-9]{64}$/.test(existing)) {
      cachedToken = existing;
      return existing;
    }
  } catch {
    // falls through to generation
  }
  return regenerateBridgeToken();
}

export async function regenerateBridgeToken(): Promise<string> {
  const dir = await ensureDir();
  const token = randomBytes(32).toString('hex');
  await fs.writeFile(path.join(dir, 'token'), `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  cachedToken = token;
  return token;
}

/**
 * Constant-time-ish comparison. Node's timingSafeEqual throws on length
 * mismatch, so the length check happens first and leaks only the length.
 */
export function tokenMatches(presented: string, expected: string): boolean {
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < presented.length; i += 1) {
    diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export async function getBridgeConfig(): Promise<BridgeConfig> {
  if (cachedConfig) return cachedConfig;
  const dir = await ensureDir();
  try {
    // A hand-edited file (or one written by PowerShell) can carry a UTF-8 BOM,
    // which JSON.parse rejects — that would silently reset the switches.
    const text = (await fs.readFile(path.join(dir, 'config.json'), 'utf8')).replace(/^\uFEFF/, '');
    const raw = JSON.parse(text) as Partial<BridgeConfig>;
    cachedConfig = {
      enabled: raw.enabled === true,
      writesEnabled: raw.writesEnabled !== false,
    };
  } catch {
    cachedConfig = { ...DEFAULT_CONFIG };
  }
  return cachedConfig;
}

export async function setBridgeConfig(changes: Partial<BridgeConfig>): Promise<BridgeConfig> {
  const current = await getBridgeConfig();
  const next: BridgeConfig = { ...current, ...changes };
  const dir = await ensureDir();
  await fs.writeFile(path.join(dir, 'config.json'), JSON.stringify(next, null, 2), 'utf8');
  cachedConfig = next;
  return next;
}

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

export interface AuditEntry {
  at: number;
  tool: string;
  client?: string;
  projectId?: string;
  entityId?: string;
  summary?: string;
  /** Previous state, base64 fields stripped, so a bad edit can be undone. */
  before?: unknown;
  /**
   * What the call did to the row. Inferred from the result, not declared by
   * each handler — 'created: true' and 'deleted: true' are already in every
   * result that means one, so forty call sites did not have to learn a new
   * field. Undo needs it: reverting a create is a delete, and vice versa.
   */
  kind?: 'create' | 'update' | 'delete' | 'undo';
  /** Dexie table, recorded only where the handler knows it (deletions). */
  table?: string;
  /** On an 'undo' entry: the line number it reverted. */
  undoOf?: number;
  ok: boolean;
  error?: string;
}

export function auditPath(): string {
  return path.join(bridgeDir(), 'audit.jsonl');
}

export async function appendAudit(entry: AuditEntry): Promise<void> {
  try {
    const dir = await ensureDir();
    const file = path.join(dir, 'audit.jsonl');
    try {
      const stat = await fs.stat(file);
      if (stat.size > AUDIT_MAX_BYTES) {
        await fs.rename(file, path.join(dir, 'audit.jsonl.1'));
      }
    } catch {
      // no log yet
    }
    await fs.appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (err) {
    // Never let bookkeeping break a tool call.
    console.error('[aibridge] audit append failed', err);
  }
}

/** One logged call, plus the line number undo addresses it by. */
export interface AuditRecord extends AuditEntry {
  /** 0-based line in audit.jsonl. Stable: the log is append-only. */
  index: number;
}

async function readAllAudit(): Promise<AuditRecord[]> {
  try {
    const raw = await fs.readFile(auditPath(), 'utf8');
    return raw
      .split('\n')
      .filter(Boolean)
      .flatMap((line, index) => {
        try {
          return [{ ...(JSON.parse(line) as AuditEntry), index }];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

/** Most recent entries first, for the settings panel and the CLI. */
export async function readAudit(limit = 50): Promise<AuditRecord[]> {
  const all = await readAllAudit();
  return all.slice(-limit).reverse();
}

/** One entry by its line number, for undo. */
export async function getAuditRecord(index: number): Promise<AuditRecord | null> {
  const all = await readAllAudit();
  return all.find((record) => record.index === index) ?? null;
}

/** Line numbers already reverted, so the same change is not undone twice. */
export async function undoneIndices(): Promise<number[]> {
  const all = await readAllAudit();
  return all
    .filter((record) => record.kind === 'undo' && record.ok && typeof record.undoOf === 'number')
    .map((record) => record.undoOf as number);
}
