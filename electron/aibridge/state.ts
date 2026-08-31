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
  /** Which door the call came through: the local port or the in-app copilot. */
  origin?: 'bridge' | 'copilot' | 'feature';
  /** Copilot thread the change belongs to, so its card can find this line. */
  conversationId?: string;
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

/** The rotated-out predecessor of the live log (at most one is kept). */
function rotatedAuditPath(): string {
  return path.join(bridgeDir(), 'audit.jsonl.1');
}

/**
 * Index of the first line of the live log. Lines are numbered across
 * rotations — a copilot card or an MCP client that remembers "#412" must
 * still find line 412 after the log rolled over, and never a different one
 * — so the live file starts where the rotated one ended. Kept in a sidecar
 * because JSONL has no header.
 */
function auditOffsetPath(): string {
  return path.join(bridgeDir(), 'audit.offset');
}

let auditOffset: number | null = null;

async function readAuditOffset(): Promise<number> {
  if (auditOffset !== null) return auditOffset;
  try {
    const raw = (await fs.readFile(auditOffsetPath(), 'utf8')).trim();
    const value = Number(raw);
    auditOffset = Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch {
    auditOffset = 0;
  }
  return auditOffset;
}

async function writeAuditOffset(value: number): Promise<void> {
  auditOffset = value;
  await fs.writeFile(auditOffsetPath(), `${value}\n`, 'utf8');
}

/** Non-empty lines of a file — the unit indices count in, parseable or not. */
async function countLines(file: string): Promise<number> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return raw.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

/**
 * Line count of the live log, so a write can be told its own line number
 * without re-reading the file. Filled lazily from disk, reset on rotation.
 */
let auditLineCount: number | null = null;
let auditChain: Promise<unknown> = Promise.resolve();

/**
 * Append one line and resolve with its index — the handle undo and the
 * copilot's tool cards address it by. Serialised so two concurrent writes
 * cannot claim the same line. Resolves null (never throws) when the disk says
 * no: bookkeeping must not break a tool call.
 */
export function appendAudit(entry: AuditEntry): Promise<number | null> {
  const run = auditChain.then(async (): Promise<number | null> => {
    try {
      const dir = await ensureDir();
      const file = path.join(dir, 'audit.jsonl');
      const offset = await readAuditOffset();
      if (auditLineCount === null) auditLineCount = await countLines(file);
      try {
        const stat = await fs.stat(file);
        if (stat.size > AUDIT_MAX_BYTES) {
          // Roll over: the live file becomes the predecessor and numbering
          // carries on from where it stopped.
          await fs.rename(file, path.join(dir, 'audit.jsonl.1'));
          await writeAuditOffset(offset + auditLineCount);
          auditLineCount = 0;
        }
      } catch {
        // no log yet
      }
      await fs.appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8');
      const index = (auditOffset ?? offset) + auditLineCount;
      auditLineCount += 1;
      return index;
    } catch (err) {
      console.error('[aibridge] audit append failed', err);
      return null;
    }
  });
  auditChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** One logged call, plus the line number undo addresses it by. */
export interface AuditRecord extends AuditEntry {
  /** Line number, counted across rotations. Stable: the log is append-only. */
  index: number;
}

/** Parse one file, numbering its non-empty lines from `offset`. */
async function readAuditFile(file: string, offset: number): Promise<AuditRecord[]> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return raw
      .split('\n')
      .filter(Boolean)
      .flatMap((line, position) => {
        try {
          return [{ ...(JSON.parse(line) as AuditEntry), index: offset + position }];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

/**
 * Everything still on disk, oldest first: the rotated predecessor (numbered
 * so it ends exactly where the live file starts) and then the live file.
 */
async function readAllAudit(): Promise<AuditRecord[]> {
  const offset = await readAuditOffset();
  const previous = rotatedAuditPath();
  const previousLines = await countLines(previous);
  // A predecessor rotated out before numbering carried across (no sidecar,
  // offset 0) would collide with the live file's numbers: leave it out, as it
  // was unreachable then too.
  const older = previousLines && offset >= previousLines
    ? await readAuditFile(previous, offset - previousLines)
    : [];
  const live = await readAuditFile(auditPath(), offset);
  return older.concat(live);
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
