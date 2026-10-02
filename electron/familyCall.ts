// ============================================================================
// Writers Hoard — handing work to the user's other local apps (main process)
// ============================================================================
//
// `family:call` is how the renderer sends a character or a storyboard to
// Prospero's Hoard and moves a story world to or from Scheherazade's Hoard.
// Like `family:search` it goes through the local Hoard hub with this app's own
// bridge token, and the renderer never builds a request: it names an app and a
// tool, and main checks both against a four-entry allowlist, bounds the size of
// the arguments, and only then calls the hub (`callApp` in aibridge/family.ts).
//
// Pictures: Prospero takes image PATHS, and a path from the renderer is
// exactly what must never be trusted. So the renderer sends the pictures as
// base64 `files`, each named by an id that appears in the arguments as
// `@file:<id>`; main checks every file really is a PNG, writes it into a
// private temporary folder (mode 0700/0600), puts the real path where the
// placeholder was, and deletes the folder as soon as the call is over — a
// failed call included. A folder left by a crash is swept the next time.
//
// Also allowed: `refsLink`, the hub's "this record is that record elsewhere"
// store, with refs that must look like `hoard://app/kind/id`.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { callApp, refsLink, type CallAppOptions } from './aibridge/family';
import {
  FILE_PLACEHOLDER, HOARD_REF, MAX_ARGS_BYTES, MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_FILE_BYTES,
  REF_RELATIONS, isAllowedCall,
  type FamilyCallRequest, type FamilyCallResponse, type FamilyRefsRequest,
} from '../src/services/familyBridge/protocol';

const TEMP_PREFIX = 'writers-hoard-family-';
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FILE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface FamilyCallDeps extends CallAppOptions {
  /** Where the temporary folder goes. Replaced by the tests. */
  tmpDir?: () => string;
  call?: typeof callApp;
}

function bad(error: string): FamilyCallResponse {
  return { ok: false, code: 'bad-request', error };
}

/** Replace every `@file:<id>` string in `value` with the path it stands for. Returns the ids that were used. */
function substitute(value: unknown, paths: Map<string, string>, used: Set<string>): unknown {
  if (typeof value === 'string') {
    if (!value.startsWith(FILE_PLACEHOLDER)) return value;
    const id = value.slice(FILE_PLACEHOLDER.length);
    const target = paths.get(id);
    if (!target) throw new Error(`the arguments mention file "${id}", which was not sent`);
    used.add(id);
    return target;
  }
  if (Array.isArray(value)) return value.map(item => substitute(item, paths, used));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, substitute(item, paths, used)]));
  }
  return value;
}

/** The request, checked. Exported for the security tests. */
export function checkFamilyCall(raw: unknown): { request: FamilyCallRequest } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'The request must be an object.' };
  const request = raw as Record<string, unknown>;
  if (!isAllowedCall(request.app, request.tool)) {
    return { error: 'That app and tool may not be called from Writers Hoard (allowed: Prospero cast_import_character and production_from_storyboard; Scheherazade world_export and world_import).' };
  }
  const args = request.args;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return { error: 'The arguments must be an object.' };
  let size = 0;
  try {
    size = Buffer.byteLength(JSON.stringify(args));
  } catch {
    return { error: 'The arguments must be plain JSON.' };
  }
  if (size > MAX_ARGS_BYTES) return { error: `The arguments are ${Math.round(size / 1024 / 1024)} MB; at most ${MAX_ARGS_BYTES / 1024 / 1024} MB go in one call.` };
  const files = request.files === undefined ? [] : request.files;
  if (!Array.isArray(files) || files.length > MAX_FILES) return { error: `At most ${MAX_FILES} files go in one call.` };
  const seen = new Set<string>();
  for (const file of files) {
    if (!file || typeof file !== 'object') return { error: 'Every file must be an object.' };
    const { id, base64 } = file as Record<string, unknown>;
    if (typeof id !== 'string' || !FILE_ID.test(id) || seen.has(id)) return { error: 'A file needs a unique id of letters, digits, "-" and "_".' };
    if (typeof base64 !== 'string' || !base64) return { error: `File "${id}" has no data.` };
    seen.add(id);
  }
  const timeoutS = request.timeoutS;
  if (timeoutS !== undefined && (typeof timeoutS !== 'number' || !Number.isFinite(timeoutS) || timeoutS < 1 || timeoutS > 300)) {
    return { error: 'timeoutS must be a number of seconds from 1 to 300.' };
  }
  return {
    request: {
      app: request.app as FamilyCallRequest['app'],
      tool: request.tool as string,
      args: args as Record<string, unknown>,
      files: files as FamilyCallRequest['files'],
      timeoutS: timeoutS as number | undefined,
    },
  };
}

async function sweepStale(root: string): Promise<void> {
  try {
    const now = Date.now();
    for (const name of await fs.readdir(root)) {
      if (!name.startsWith(TEMP_PREFIX)) continue;
      const full = path.join(root, name);
      const stat = await fs.stat(full).catch(() => null);
      if (stat?.isDirectory() && now - stat.mtimeMs > STALE_AFTER_MS) await fs.rm(full, { recursive: true, force: true });
    }
  } catch {
    // Housekeeping only.
  }
}

/** Write the PNGs and return id → path, or an error. */
async function materialize(files: NonNullable<FamilyCallRequest['files']>, root: string): Promise<{ dir: string; paths: Map<string, string> } | { error: string }> {
  const paths = new Map<string, string>();
  if (!files.length) return { dir: '', paths };
  let total = 0;
  const decoded: Array<{ id: string; bytes: Buffer }> = [];
  for (const file of files) {
    const bytes = Buffer.from(file.base64, 'base64');
    if (bytes.length > MAX_FILE_BYTES) return { error: `File "${file.id}" is ${Math.round(bytes.length / 1024 / 1024)} MB; at most ${MAX_FILE_BYTES / 1024 / 1024} MB each.` };
    if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return { error: `File "${file.id}" is not a PNG image.` };
    total += bytes.length;
    if (total > MAX_TOTAL_FILE_BYTES) return { error: `The pictures add up to more than ${MAX_TOTAL_FILE_BYTES / 1024 / 1024} MB.` };
    decoded.push({ id: file.id, bytes });
  }
  await sweepStale(root);
  const dir = await fs.mkdtemp(path.join(root, TEMP_PREFIX));
  await fs.chmod(dir, 0o700).catch(() => undefined);
  for (const { id, bytes } of decoded) {
    // The name is ours (a random prefix plus the validated id), never the renderer's path.
    const target = path.join(dir, `${crypto.randomBytes(4).toString('hex')}-${id}.png`);
    await fs.writeFile(target, bytes, { mode: 0o600 });
    paths.set(id, target);
  }
  return { dir, paths };
}

/** One allowed call to one family app, through the hub. Never throws. */
export async function familyCall(raw: unknown, deps: FamilyCallDeps = {}): Promise<FamilyCallResponse> {
  const checked = checkFamilyCall(raw);
  if ('error' in checked) return bad(checked.error);
  const { request } = checked;
  const root = deps.tmpDir ? deps.tmpDir() : os.tmpdir();
  let dir = '';
  try {
    const made = await materialize(request.files ?? [], root);
    if ('error' in made) return bad(made.error);
    dir = made.dir;
    let args: Record<string, unknown>;
    try {
      args = substitute(request.args, made.paths, new Set()) as Record<string, unknown>;
    } catch (error) {
      return bad(error instanceof Error ? error.message : String(error));
    }
    return await (deps.call ?? callApp)(request.app, request.tool, args, { timeoutS: request.timeoutS, deps: deps.deps });
  } catch (error) {
    return { ok: false, code: 'bad_response', error: error instanceof Error ? error.message : String(error), app: request.app, tool: request.tool };
  } finally {
    if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The link request, checked. Exported for the security tests. */
export function checkFamilyRefs(raw: unknown): { request: FamilyRefsRequest } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'The request must be an object.' };
  const r = raw as Record<string, unknown>;
  if (typeof r.from !== 'string' || !HOARD_REF.test(r.from) || typeof r.to !== 'string' || !HOARD_REF.test(r.to)) {
    return { error: 'Both ends of a link must be hoard://app/kind/id references.' };
  }
  if (!(REF_RELATIONS as readonly unknown[]).includes(r.rel)) return { error: `The relation must be one of: ${REF_RELATIONS.join(', ')}.` };
  const label = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 120) : '');
  return { request: { from: r.from, to: r.to, rel: r.rel as FamilyRefsRequest['rel'], fromLabel: label(r.fromLabel), toLabel: label(r.toLabel) } };
}

export async function familyRefs(raw: unknown, deps: Pick<FamilyCallDeps, 'deps'> = {}): Promise<{ ok: true } | { ok: false; code: string; error: string }> {
  const checked = checkFamilyRefs(raw);
  if ('error' in checked) return { ok: false, code: 'bad-request', error: checked.error };
  return refsLink(checked.request, { deps: deps.deps });
}
