// ============================================================================
// AI bridge — helpers shared by every tool handler
// ============================================================================
//
// Argument coercion, project scoping, Markdown conversion and the audit
// envelope. Handlers stay short enough to read at a glance.

import { db } from '@/db';
import { useAppStore } from '@/stores/appStore';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { htmlToMarkdown } from '@/engines/writings/manuscriptExport';
import { markdownToTiptapHtml } from '../markdown';

export type ToolArgs = Record<string, unknown>;

/** A failure the model should read and act on, not a crash. */
export class BridgeError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
  }
}

/**
 * Bookkeeping the main process peels off a write result to build the audit
 * line. Never reaches the model.
 */
export interface AuditEnvelope {
  projectId?: string;
  entityId?: string;
  summary?: string;
  before?: unknown;
  /**
   * Dexie table the row lives in. Only deletions record it, because only they
   * need it: undoing a delete means putting the row back, and by then there is
   * no row left to look the table up from.
   */
  table?: string;
}

export function withAudit<T extends object>(result: T, audit: AuditEnvelope): T {
  return { ...result, __audit: audit } as T;
}

// ---------------------------------------------------------------------------
// Argument coercion
// ---------------------------------------------------------------------------

export function requireString(args: ToolArgs, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new BridgeError('bad-args', `"${key}" is required and must be a non-empty string.`);
  }
  return value;
}

export function optString(args: ToolArgs, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}

export function optNumber(args: ToolArgs, key: string): number | undefined {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function optBoolean(args: ToolArgs, key: string): boolean | undefined {
  const value = args[key];
  return typeof value === 'boolean' ? value : undefined;
}

export function optStringArray(args: ToolArgs, key: string): string[] | undefined {
  const value = args[key];
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string');
}

export function optStringMap(args: ToolArgs, key: string): Record<string, string> | undefined {
  const value = args[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
  }
  return out;
}

/** One of `allowed`, or undefined. Never throws on an unknown value. */
export function optEnum<T extends string>(
  args: ToolArgs,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = args[key];
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

export function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

// ---------------------------------------------------------------------------
// Project scoping
// ---------------------------------------------------------------------------

/**
 * `projectId` is optional on every tool: omitting it means "the project the
 * user is looking at". That is what makes "add this to my codex" work without
 * the model having to resolve an id first.
 */
export function resolveProjectId(args: ToolArgs): string {
  const explicit = optString(args, 'projectId');
  if (explicit) return explicit;
  const current = useAppStore.getState().currentProjectId;
  if (current) return current;
  throw new BridgeError(
    'no-project',
    'No project is open in Writers Hoard, so there is nothing to scope this to. Call wh_list_projects and pass projectId explicitly.',
  );
}

/**
 * Resolve the project AND refuse if the engine is switched off in it.
 *
 * A project only renders the engines in its `enabledEngines`, and its own
 * global search only looks at those. So a row written into a disabled engine
 * is not "hidden until they turn it on" — it is unreachable by every route the
 * writer has, and they were never told it exists. Refusing is the honest
 * answer, and the `essentials` preset makes it the common case: a new project
 * starts with three engines of twenty-one.
 *
 * Reads are deliberately NOT gated. If data is there, saying so is more useful
 * than pretending the engine does not exist.
 */
export async function resolveProjectForEngine(
  args: ToolArgs,
  engineId: string,
): Promise<string> {
  const projectId = resolveProjectId(args);
  await assertEngineEnabled(projectId, engineId);
  return projectId;
}

/**
 * The same gate for a write that reaches its project through a parent row
 * rather than through `projectId` — adding a beat to an outline, tagging an
 * image, editing a chapter.
 *
 * Guarding only the top-level creates was not enough: an engine can be
 * switched off AFTER its rows exist, and gallery and maps have no create tool
 * here at all, so their whole write surface reaches the project this way.
 * Call it straight after loading the parent, before touching anything.
 */
export async function assertEngineEnabled(
  projectId: string,
  engineId: string,
): Promise<void> {
  const project = await db.projects.get(projectId);
  if (!project) {
    throw new BridgeError('not-found', `No project with id "${projectId}".`);
  }
  if (!project.enabledEngines.includes(engineId)) {
    throw new BridgeError(
      'engine-disabled',
      `The "${engineId}" engine is switched off in "${project.title}", so anything written there would be invisible to the writer — no tab, and the app's own search skips it. Call wh_enable_engine with engineId "${engineId}" to turn it on, or ask them first if you are not sure they want it.`,
    );
  }
}

/** The engine tab currently on screen, read from the hash route. */
export function currentEngineId(): string | null {
  const match = /#\/project\/[^/]+\/([^/?#]+)/.exec(window.location.hash || '');
  return match ? decodeURIComponent(match[1]) : null;
}

// ---------------------------------------------------------------------------
// Rich text
// ---------------------------------------------------------------------------

/** Markdown in, storable TipTap HTML out. Sanitised: this is foreign input. */
export function htmlFromMarkdown(markdown: string): string {
  return sanitizeRichHtml(markdownToTiptapHtml(markdown));
}

/** Stored HTML out as Markdown, which is what models read reliably. */
export function markdownFromHtml(html: string | undefined): string {
  return html ? htmlToMarkdown(html) : '';
}

// ---------------------------------------------------------------------------
// Images — the vision path
// ---------------------------------------------------------------------------

/**
 * Pictures a tool wants the model to actually SEE. The MCP adapter turns each
 * one into an image content block; the HTTP API returns them as-is.
 */
export interface BridgeMedia {
  base64: string;
  mimeType: string;
  label?: string;
}

export function withMedia<T extends object>(result: T, media: BridgeMedia[]): T {
  return { ...result, _media: media } as T;
}

/** Longest edge a picture is shrunk to before it is sent to a model. */
const VISION_MAX_EDGE = 1024;
const VISION_QUALITY = 0.8;

/**
 * Re-encode an image so a model can look at it without swallowing megabytes
 * of context. Vision models gain nothing from a 4000px original, and base64
 * inflates every byte by a third on the way out.
 */
export async function toVisionJpeg(blob: Blob): Promise<BridgeMedia> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, VISION_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new BridgeError('tool-error', 'Could not open a canvas to resize the image.');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', VISION_QUALITY);
    return { base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType: 'image/jpeg' };
  } finally {
    bitmap.close();
  }
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

/** Turn a stored base64 data URL into a Blob without a round trip. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new BridgeError('tool-error', 'That thumbnail is not a base64 data URL.');
  return base64ToBlob(match[2], match[1]);
}

/**
 * Read a managed media file by its library-relative path.
 *
 * NOT `fetch('wh-media://…')`: the renderer is served from http://localhost in
 * development and file:// when packaged, so a custom scheme is always
 * cross-origin and the fetch is refused — the same reason every Ollama call in
 * this app goes through IPC. Main owns the media root and its containment
 * checks, so it does the read.
 */
export async function readLibraryBlob(relPath: string): Promise<Blob> {
  const media = window.electronAPI?.media;
  if (!media?.readLibraryFile) {
    throw new BridgeError('tool-error', 'Reading media files needs the desktop app.');
  }
  const result = await media.readLibraryFile(relPath);
  if (!result.ok || !result.base64) {
    throw new BridgeError('not-found', `Could not read "${relPath}": ${result.error ?? 'unknown error'}.`);
  }
  return base64ToBlob(result.base64, result.mimeType ?? 'application/octet-stream');
}
