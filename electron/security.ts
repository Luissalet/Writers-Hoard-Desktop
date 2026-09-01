import path from 'node:path';
import { promises as fs } from 'node:fs';

export type InternalRendererRole = 'main' | 'quick-note';

const IPC_CHANNEL_ROLES: Readonly<Record<string, readonly InternalRendererRole[]>> = Object.freeze({
  'media:saveTeleprompterMp4': ['main'],
  'media:downloadToLibrary': ['main'],
  'media:cancelDownload': ['main'],
  'media:deleteLibraryFile': ['main'],
  'media:listLibraryFiles': ['main'],
  'media:readLibraryFile': ['main'],
  'media:relocateLibrary': ['main'],
  'export:scriptToPdf': ['main'],
  // Automatic backup. The main window builds the archive from the database it
  // owns and hands main the finished bytes; main owns the directory, the file
  // name and the rotation, and is the only side that touches the disk. The
  // quick-note window holds no data and must never be able to write an
  // archive — or to learn where the archives live.
  'backup:writeArchive': ['main'],
  'backup:revealFolder': ['main'],
  'capture:page': ['main'],
  'capture:cancel': ['main'],
  'ig:login': ['main'],
  'ig:status': ['main'],
  'ig:logout': ['main'],
  'ig:listCollection': ['main'],
  'ig:cancelListCollection': ['main'],
  'quick-note:set-context': ['main'],
  'quick-note:get-context': ['quick-note'],
  'quick-note:open': ['main'],
  'quick-note:submit': ['quick-note'],
  // The main window is the only Dexie writer, so it is the only side that can
  // truthfully say a relayed capture was persisted. `quick-note:ack` closes a
  // request main opened with `webContents.send('quick-note:add')` and is what
  // resolves the floating window's pending `quick-note:submit`. The floating
  // window must never be able to acknowledge its own note — that is exactly
  // the "Saved" that lost them.
  'quick-note:ack': ['main'],
  'quick-note:close': ['quick-note'],
  'updates:check': ['main'],
  'updates:quitAndInstall': ['main'],
  // Closing the window. `beforeunload` cannot ask this question in Electron —
  // its preventDefault silently cancels the close and shows nothing — so main
  // owns the veto and asks the renderer that owns the unsaved text.
  // `shutdown:setWarning` is how main learns there is anything at risk at all
  // (and, since main has no `t()`, the already-translated words to say about
  // it); `shutdown:reply` answers the `shutdown:request` push. Only the main
  // window holds documents: the quick-note window must never be able to hold
  // the app's window open, nor to hand main the words it would show.
  'shutdown:setWarning': ['main'],
  'shutdown:reply': ['main'],
  'ollama:getStatus': ['main'],
  'ollama:start': ['main'],
  'ollama:downloadRuntime': ['main'],
  'ollama:cancelRuntimeDownload': ['main'],
  'ollama:pullModel': ['main'],
  'ollama:cancelPull': ['main'],
  'ollama:deleteModel': ['main'],
  'ollama:chat': ['main'],
  // AI bridge: the main window answers tool calls the local HTTP port relays
  // from external models. `aibridge:reply` closes a request main opened with
  // `webContents.send('aibridge:request')`; the quick-note window owns no data
  // and must never be able to serve or observe them.
  'aibridge:reply': ['main'],
  'aibridge:getInfo': ['main'],
  'aibridge:setEnabled': ['main'],
  'aibridge:setWritesEnabled': ['main'],
  'aibridge:regenerateToken': ['main'],
  'aibridge:readAudit': ['main'],
  'aibridge:undo': ['main'],
  // AI runtime: connections by IP/URL, model discovery, streaming inference
  // and the in-app copilot. Main owns every URL and key; the renderer only
  // ever names a connection id. Push channels (ai:stream, ai:image-done,
  // copilot:event) go main → renderer and need no entry here.
  'ai:listConnections': ['main'],
  'ai:saveConnection': ['main'],
  'ai:deleteConnection': ['main'],
  'ai:setSecret': ['main'],
  'ai:probe': ['main'],
  'ai:listModels': ['main'],
  'ai:discoverLocal': ['main'],
  'ai:hardware': ['main'],
  'ai:getDefaults': ['main'],
  'ai:setDefault': ['main'],
  'ai:setModelOverride': ['main'],
  'ai:legacyMigrated': ['main'],
  'ai:chat': ['main'],
  'ai:complete': ['main'],
  'ai:cancel': ['main'],
  'ai:generateImage': ['main'],
  'copilot:run': ['main'],
  'copilot:cancel': ['main'],
  'copilot:approve': ['main'],
  // Managed local image runtime (stable-diffusion.cpp). Push channels
  // sd:status and sd:progress go main → renderer and need no entry here.
  'sd:status': ['main'],
  'sd:installRuntime': ['main'],
  'sd:cancelInstall': ['main'],
  'sd:removeRuntime': ['main'],
  'sd:downloadModel': ['main'],
  'sd:cancelDownload': ['main'],
  'sd:deleteModel': ['main'],
  'sd:stop': ['main'],
  'forge:spawn': ['main'],
  // The shared preload requests this synchronously while both trusted windows
  // initialize. The quick-note renderer does not use the value afterwards.
  'forge:memory': ['main', 'quick-note'],
});

/** Fail-closed channel policy: an unlisted channel has no trusted renderer. */
export function isIpcChannelAllowedForRole(
  channel: string,
  role: InternalRendererRole,
): boolean {
  return IPC_CHANNEL_ROLES[channel]?.includes(role) ?? false;
}

/** Native path atoms are deliberately ASCII and never navigation markers. */
export function isSafeNativeSegment(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value !== '.' &&
    value !== '..' &&
    /^[A-Za-z0-9._-]+$/.test(value)
  );
}

/**
 * True when `candidate` is lexically contained by `root`. `path.relative`
 * handles drive letters and separator boundaries without unsafe prefix tests.
 */
export function isPathContainedBy(root: string, candidate: string, allowRoot = false): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative === '') return allowRoot;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Resolve a managed relative path only when every atom and the result are safe. */
export function resolveContainedNativePath(root: string, relativePath: unknown): string | null {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) {
    return null;
  }
  const segments = relativePath.split(/[\\/]/);
  if (segments.length === 0 || segments.some((segment) => !isSafeNativeSegment(segment))) {
    return null;
  }
  const candidate = path.resolve(root, ...segments);
  return isPathContainedBy(root, candidate) ? candidate : null;
}

/** Resolve an existing managed item through realpath so symlinks cannot escape. */
export async function resolveExistingContainedNativePath(
  root: string,
  relativePath: unknown,
): Promise<string | null> {
  const lexical = resolveContainedNativePath(root, relativePath);
  if (!lexical) return null;
  try {
    const [realRoot, realTarget] = await Promise.all([
      fs.realpath(root),
      fs.realpath(lexical),
    ]);
    return isPathContainedBy(realRoot, realTarget) ? realTarget : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a future managed write and prove its nearest existing ancestor is
 * still inside the real root. Existing and broken symlinks fail closed.
 */
export async function resolveWritableContainedNativePath(
  rootPath: string,
  relativePath: unknown,
): Promise<string | null> {
  const lexical = resolveContainedNativePath(rootPath, relativePath);
  if (!lexical) return null;
  const root = path.resolve(rootPath);
  await fs.mkdir(root, { recursive: true });
  const realRoot = await fs.realpath(root);
  let cursor = lexical;
  while (isPathContainedBy(root, cursor, true)) {
    try {
      await fs.lstat(cursor);
      let realCursor: string;
      try {
        realCursor = await fs.realpath(cursor);
      } catch {
        return null;
      }
      return isPathContainedBy(realRoot, realCursor, cursor === root) ? lexical : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
    }
    if (cursor === root) break;
    cursor = path.dirname(cursor);
  }
  return null;
}

/**
 * Match one exact renderer document while allowing its client-side hash route.
 * Search parameters, sibling files, prefix lookalikes and other origins fail.
 */
export function isExactRendererDocumentUrl(actual: string, expected: string): boolean {
  try {
    const actualUrl = new URL(actual);
    const expectedUrl = new URL(expected);
    actualUrl.hash = '';
    expectedUrl.hash = '';
    return actualUrl.href === expectedUrl.href;
  } catch {
    return false;
  }
}
