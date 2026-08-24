import path from 'node:path';
import { promises as fs } from 'node:fs';

export type InternalRendererRole = 'main' | 'quick-note';

const IPC_CHANNEL_ROLES: Readonly<Record<string, readonly InternalRendererRole[]>> = Object.freeze({
  'media:saveTeleprompterMp4': ['main'],
  'media:downloadToLibrary': ['main'],
  'media:cancelDownload': ['main'],
  'media:deleteLibraryFile': ['main'],
  'media:listLibraryFiles': ['main'],
  'media:relocateLibrary': ['main'],
  'export:scriptToPdf': ['main'],
  'capture:page': ['main'],
  'capture:cancel': ['main'],
  'ig:login': ['main'],
  'ig:status': ['main'],
  'ig:logout': ['main'],
  'quick-note:set-context': ['main'],
  'quick-note:get-context': ['quick-note'],
  'quick-note:open': ['main'],
  'quick-note:submit': ['quick-note'],
  'quick-note:close': ['quick-note'],
  'updates:check': ['main'],
  'updates:quitAndInstall': ['main'],
  'ollama:getStatus': ['main'],
  'ollama:start': ['main'],
  'ollama:downloadRuntime': ['main'],
  'ollama:cancelRuntimeDownload': ['main'],
  'ollama:pullModel': ['main'],
  'ollama:cancelPull': ['main'],
  'ollama:deleteModel': ['main'],
  'ollama:chat': ['main'],
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
