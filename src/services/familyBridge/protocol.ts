// ============================================================================
// Family bridge — what the renderer and the main process agree on (pure)
// ============================================================================
//
// Writers Hoard can hand a character or a storyboard to Prospero's Hoard and
// move a story world to and from Scheherazade's Hoard. The renderer owns the
// data (Dexie), the main process owns the hub token, so a call crosses IPC as
// `family:call` and main builds the one request that is allowed:
//
//   - the app and the tool must be on ALLOWED_CALLS (four tools, two apps),
//   - the arguments are bounded (size, depth of nothing but JSON),
//   - pictures never travel as paths from the renderer: they travel as base64
//     `files`, main writes them to a private temporary folder, substitutes the
//     `@file:<id>` placeholders in the arguments with those paths, and removes
//     the folder when the call is over.
//
// This module is imported by both sides, so it touches neither `window` nor
// Electron nor Dexie.

/** Who may be called, and with what. Anything else is refused before the network. */
export const ALLOWED_CALLS: Readonly<Record<string, readonly string[]>> = {
  prospero: ['cast_import_character', 'production_from_storyboard'],
  scheherazade: ['world_export', 'world_import'],
};

export type FamilyCallApp = 'prospero' | 'scheherazade';

/** The hub's own link store: "this record here came from / went to that record there". */
export const REF_RELATIONS = ['sent_to', 'imported_from', 'derived_from'] as const;
export type RefRelation = typeof REF_RELATIONS[number];

export const MAX_ARGS_BYTES = 8 * 1024 * 1024;
export const MAX_FILES = 40;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_FILE_BYTES = 48 * 1024 * 1024;
export const FILE_PLACEHOLDER = '@file:';

/** `hoard://app/kind/id` — the shape every cross-app reference has. */
export const HOARD_REF = /^hoard:\/\/[a-z0-9_-]{1,40}\/[a-z0-9_-]{1,40}\/[^\s]{1,200}$/i;

export interface FamilyCallFile {
  /** Matches an `@file:<id>` string somewhere in the arguments. */
  id: string;
  /** A PNG, base64 encoded (no data-URL prefix). */
  base64: string;
}

export interface FamilyCallRequest {
  app: FamilyCallApp;
  tool: string;
  args: Record<string, unknown>;
  files?: FamilyCallFile[];
  /** Seconds the hub may wait for the app. Default 60, at most 300. */
  timeoutS?: number;
}

export interface FamilyRefsRequest {
  from: string;
  to: string;
  rel: RefRelation;
  fromLabel?: string;
  toLabel?: string;
}

export type FamilyCallFailure =
  | 'bad-request' | 'desktop-only' | 'hub_unreachable' | 'unauthorized' | 'app_unavailable' | 'tool_failed' | 'timeout' | 'too-large' | 'bad_response';

export type FamilyCallResponse =
  | { ok: true; app: string; tool: string; result: unknown }
  | { ok: false; code: FamilyCallFailure; error: string; app?: string; tool?: string };

/** Human labels for toasts and tool results. */
export const APP_LABEL: Readonly<Record<FamilyCallApp, string>> = { prospero: 'Prospero', scheherazade: 'Scheherazade' };

export function isFamilyCallApp(value: unknown): value is FamilyCallApp {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ALLOWED_CALLS, value);
}

export function isAllowedCall(app: unknown, tool: unknown): boolean {
  return isFamilyCallApp(app) && typeof tool === 'string' && ALLOWED_CALLS[app].includes(tool);
}
