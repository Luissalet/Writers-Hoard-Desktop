import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  isExactRendererDocumentUrl,
  isIpcChannelAllowedForRole,
  isPathContainedBy,
  isSafeNativeSegment,
  resolveContainedNativePath,
  resolveExistingContainedNativePath,
  resolveWritableContainedNativePath,
} from '../electron/security';
import {
  isCurrentOllamaRuntimeReceipt,
  isOllamaRuntimeArtifactConfigured,
  matchesOllamaRuntimeDigest,
  OLLAMA_RUNTIME_ARTIFACT,
} from '../electron/ollamaRuntimeManifest';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function runElectronSecurityTests(temporaryDirectory: string): Promise<string[]> {
  const passed: string[] = [];

  assert(isSafeNativeSegment('project_1-safe.zip'), 'safe native segment rejected');
  for (const unsafe of ['.', '..', '', '../escape', 'folder/file', 'folder\\file']) {
    assert(!isSafeNativeSegment(unsafe), `unsafe native segment accepted: ${unsafe}`);
  }
  const root = path.join(temporaryDirectory, 'managed-root');
  const sibling = path.join(temporaryDirectory, 'managed-root-lookalike');
  await fs.mkdir(path.join(root, 'project-1'), { recursive: true });
  await fs.mkdir(sibling, { recursive: true });
  assert(isPathContainedBy(root, path.join(root, 'project-1')), 'contained path rejected');
  assert(!isPathContainedBy(root, sibling), 'prefix-lookalike path accepted');
  assert(resolveContainedNativePath(root, 'project-1/file.mp4') !== null, 'safe relative path rejected');
  for (const unsafe of ['.', '..', '../escape', 'project-1/../escape', sibling]) {
    assert(resolveContainedNativePath(root, unsafe) === null, `path traversal accepted: ${unsafe}`);
  }
  passed.push('native path atoms + lexical containment');

  const safeFile = path.join(root, 'project-1', 'safe.txt');
  await fs.writeFile(safeFile, 'safe', 'utf8');
  assert(
    await resolveExistingContainedNativePath(root, 'project-1/safe.txt') === await fs.realpath(safeFile),
    'safe existing managed file rejected',
  );
  assert(
    await resolveWritableContainedNativePath(root, 'project-1/future.txt') !== null,
    'safe future managed file rejected',
  );

  const outside = path.join(temporaryDirectory, 'outside-root');
  const escapeLink = path.join(root, 'escape-link');
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(outside, 'secret.txt'), 'secret', 'utf8');
  await fs.symlink(outside, escapeLink, process.platform === 'win32' ? 'junction' : 'dir');
  assert(
    await resolveExistingContainedNativePath(root, 'escape-link/secret.txt') === null,
    'existing symlink escape was accepted',
  );
  assert(
    await resolveWritableContainedNativePath(root, 'escape-link/new.txt') === null,
    'writable symlink escape was accepted',
  );
  passed.push('realpath containment blocks symlink escapes');

  const renderer = 'file:///C:/Writers%20Hoard/dist/index.html';
  assert(isExactRendererDocumentUrl(`${renderer}#/project/p1`, renderer), 'hash route rejected');
  assert(!isExactRendererDocumentUrl(`${renderer}?debug=1`, renderer), 'search variant accepted');
  assert(!isExactRendererDocumentUrl('file:///C:/Writers%20Hoard/dist/other.html', renderer), 'sibling renderer accepted');
  assert(!isExactRendererDocumentUrl('https://example.com/', renderer), 'external renderer accepted');
  assert(isIpcChannelAllowedForRole('media:listLibraryFiles', 'main'), 'main IPC policy missing');
  assert(!isIpcChannelAllowedForRole('media:listLibraryFiles', 'quick-note'), 'quick-note gained main IPC');
  assert(isIpcChannelAllowedForRole('quick-note:submit', 'quick-note'), 'quick-note submit policy missing');
  assert(!isIpcChannelAllowedForRole('unknown:channel', 'main'), 'unknown IPC channel did not fail closed');
  passed.push('exact renderer navigation + fail-closed IPC roles');

  assert(isOllamaRuntimeArtifactConfigured(), 'Ollama runtime manifest is inconsistent');
  assert(matchesOllamaRuntimeDigest(OLLAMA_RUNTIME_ARTIFACT.sha256), 'official Ollama digest rejected');
  assert(!matchesOllamaRuntimeDigest('0'.repeat(64)), 'incorrect Ollama digest accepted');
  assert(isCurrentOllamaRuntimeReceipt({
    version: OLLAMA_RUNTIME_ARTIFACT.version,
    fileName: OLLAMA_RUNTIME_ARTIFACT.fileName,
    sha256: OLLAMA_RUNTIME_ARTIFACT.sha256,
  }), 'current Ollama receipt rejected');
  assert(!isCurrentOllamaRuntimeReceipt({
    version: 'v0.0.0',
    fileName: OLLAMA_RUNTIME_ARTIFACT.fileName,
    sha256: OLLAMA_RUNTIME_ARTIFACT.sha256,
  }), 'stale Ollama receipt accepted');
  passed.push('immutable Ollama artifact digest + receipt');

  return passed;
}
