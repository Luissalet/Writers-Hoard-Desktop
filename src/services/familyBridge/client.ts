// ============================================================================
// Family bridge — the renderer's side of `family:call`
// ============================================================================
//
// One function per thing the renderer can ask of main (`callFamily`, `linkRefs`),
// with an injectable transport so the tests can stand in for the hub without
// Electron. Without the desktop app there is no hub token and no IPC, and the
// answer says so instead of throwing.

import type {
  FamilyCallApp, FamilyCallFile, FamilyCallRequest, FamilyCallResponse, FamilyRefsRequest,
} from './protocol';

export type FamilyTransport = (request: FamilyCallRequest) => Promise<FamilyCallResponse>;
export type RefsTransport = (request: FamilyRefsRequest) => Promise<{ ok: true } | { ok: false; code: string; error: string }>;

let callOverride: FamilyTransport | null = null;
let linkOverride: RefsTransport | null = null;

/** Tests only: replace what answers a call. Pass null to restore the IPC transport. */
export function setFamilyTransport(call: FamilyTransport | null, link: RefsTransport | null = null): void {
  callOverride = call;
  linkOverride = link;
}

const NOT_DESKTOP: FamilyCallResponse = {
  ok: false,
  code: 'desktop-only',
  error: 'Talking to other Hoard apps needs the desktop app: it holds the hub token, and the web build has none.',
};

export async function callFamily(
  app: FamilyCallApp,
  tool: string,
  args: Record<string, unknown>,
  options: { files?: FamilyCallFile[]; timeoutS?: number } = {},
): Promise<FamilyCallResponse> {
  const request: FamilyCallRequest = { app, tool, args, ...(options.files?.length ? { files: options.files } : {}), ...(options.timeoutS ? { timeoutS: options.timeoutS } : {}) };
  const send = callOverride ?? (typeof window === 'undefined' ? undefined : window.electronAPI?.family?.call);
  if (!send) return NOT_DESKTOP;
  try {
    return await send(request);
  } catch (error) {
    return { ok: false, code: 'bad_response', error: error instanceof Error ? error.message : String(error), app, tool };
  }
}

/** Record a link on the hub. A hint that did not land is never an error for the caller. */
export async function linkRefs(request: FamilyRefsRequest): Promise<boolean> {
  const send = linkOverride ?? (typeof window === 'undefined' ? undefined : window.electronAPI?.family?.link);
  if (!send) return false;
  try {
    const answer = await send(request);
    return answer.ok;
  } catch {
    return false;
  }
}
