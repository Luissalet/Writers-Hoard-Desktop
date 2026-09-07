import { createHash } from 'node:crypto';
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
import { buildToolResult } from '../electron/aibridge/mcpContent';
import {
  isCurrentOllamaRuntimeReceipt,
  isOllamaRuntimeArtifactConfigured,
  matchesOllamaRuntimeDigest,
  OLLAMA_RUNTIME_ARTIFACT,
} from '../electron/ollamaRuntimeManifest';
import { isCurrentSdRuntimeReceipt, SD_RUNTIME_ARTIFACTS, sdBackendsFor, sdRuntimeArtifact } from '../electron/ai/sdRuntimeManifest';
import { contentRangeStart, DownloadError, downloadVerified, verifyFile } from '../electron/ai/download';
import { appendAudit, auditPath, getAuditRecord, readAudit, undoneIndices } from '../electron/aibridge/state';
import { runMediaSecurityTests } from './media-security';
import { runCausalGraphTests } from './causal-graph';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function runElectronSecurityTests(temporaryDirectory: string): Promise<string[]> {
  const passed: string[] = [];

  passed.push(...await runMediaSecurityTests(temporaryDirectory));
  passed.push(...runCausalGraphTests());

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
  for (const channel of [
    'media:downloaderHealth',
    'media:detectDownloadPlatform',
    'media:downloadToFile',
    'media:cancelFileDownload',
  ]) {
    assert(isIpcChannelAllowedForRole(channel, 'main'), `${channel} has no trusted renderer`);
    assert(!isIpcChannelAllowedForRole(channel, 'quick-note'), `${channel} leaked to quick-note`);
  }
  assert(isIpcChannelAllowedForRole('quick-note:submit', 'quick-note'), 'quick-note submit policy missing');
  assert(!isIpcChannelAllowedForRole('unknown:channel', 'main'), 'unknown IPC channel did not fail closed');
  // The AI bridge answers from the main window only: the quick-note renderer
  // owns no project data and must never be able to serve or observe a tool call.
  assert(isIpcChannelAllowedForRole('aibridge:reply', 'main'), 'AI bridge reply policy missing');
  assert(!isIpcChannelAllowedForRole('aibridge:reply', 'quick-note'), 'quick-note can answer AI bridge calls');
  assert(!isIpcChannelAllowedForRole('aibridge:setEnabled', 'quick-note'), 'quick-note can toggle the AI bridge');
  assert(isIpcChannelAllowedForRole('ig:listCollection', 'main'), 'ig:listCollection has no trusted renderer');
  // Closing the window. The renderer's half of the veto is two inbound
  // channels, and both belong to the window that actually holds documents.
  assert(isIpcChannelAllowedForRole('shutdown:setWarning', 'main'), 'shutdown warning policy missing');
  assert(isIpcChannelAllowedForRole('shutdown:reply', 'main'), 'shutdown reply policy missing');
  // The floating capture window owns no text and must never be able to hold
  // the app's window open — nor to hand main the words it shows the writer,
  // which is a dialog the quick-note renderer has no business authoring.
  assert(!isIpcChannelAllowedForRole('shutdown:setWarning', 'quick-note'), 'quick-note can warn about unsaved work it does not hold');
  assert(!isIpcChannelAllowedForRole('shutdown:reply', 'quick-note'), 'quick-note can answer for the main window closing');
  // `shutdown:request` goes main → renderer. Listing it would open an inbound
  // door for a renderer to impersonate main's own question to itself, so its
  // absence from the table is the assertion, not an oversight.
  assert(!isIpcChannelAllowedForRole('shutdown:request', 'main'), 'the main->renderer close push was opened as an inbound channel');
  assert(!isIpcChannelAllowedForRole('shutdown:request', 'quick-note'), 'the main->renderer close push was opened to quick-note');
  passed.push('exact renderer navigation + fail-closed IPC roles');

  // MCP content blocks: a picture must leave as an image block, and its base64
  // must never also land in the text block, where it would be pure noise.
  const withPicture = buildToolResult({
    id: 'snap_1',
    _media: [{ base64: 'AAAA', mimeType: 'image/jpeg' }],
  });
  const blocks = withPicture.content as { type: string; data?: string; text?: string }[];
  assert(blocks.length === 2, 'expected one image block and one text block');
  assert(blocks[0].type === 'image' && blocks[0].data === 'AAAA', 'image block missing or malformed');
  assert(blocks[1].type === 'text' && !blocks[1].text?.includes('AAAA'), 'base64 leaked into the text block');
  assert(blocks[1].text?.includes('snap_1'), 'text block lost the result body');
  const plain = buildToolResult({ ok: true }, true);
  assert((plain.content as unknown[]).length === 1, 'a result with no media gained a block');
  assert(plain.isError === true, 'isError was dropped');
  passed.push('MCP content blocks carry images without polluting the text');

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

  // The image runtime: every pinned asset, receipts, and the IPC roles of its channels.
  for (const artifact of SD_RUNTIME_ARTIFACTS) {
    assert(artifact.assets.length > 0, `${artifact.backend}/${artifact.platform}: no assets`);
    for (const asset of artifact.assets) {
      assert(asset.url.startsWith('https://github.com/leejet/stable-diffusion.cpp/releases/download/'), `${asset.fileName}: not a GitHub release asset`);
      assert(asset.sizeBytes > 1_000_000 && /^[0-9a-f]{64}$/.test(asset.sha256), `${asset.fileName}: unpinned`);
    }
  }
  const vulkan = sdRuntimeArtifact('vulkan', 'win32', 'x64');
  assert(vulkan && sdBackendsFor('win32', 'x64')[0] === 'vulkan', 'Vulkan must be the first Windows backend');
  assert(sdBackendsFor('win32', 'x64').includes('cuda12') && sdBackendsFor('win32', 'x64').includes('cpu'), 'Windows backends');
  assert(isCurrentSdRuntimeReceipt({ version: vulkan.version, backend: 'vulkan', sha256s: vulkan.assets.map((a) => a.sha256) }, vulkan), 'current sd receipt rejected');
  assert(!isCurrentSdRuntimeReceipt({ version: vulkan.version, backend: 'cuda12', sha256s: vulkan.assets.map((a) => a.sha256) }, vulkan), 'sd receipt for another backend accepted');
  assert(!isCurrentSdRuntimeReceipt({ version: 'old', backend: 'vulkan', sha256s: ['0'.repeat(64)] }, vulkan), 'stale sd receipt accepted');
  for (const channel of [
    'sd:status', 'sd:installRuntime', 'sd:downloadModel', 'sd:deleteModel', 'sd:stop',
    'sd:downloadCompanion', 'sd:cancelCompanionDownload', 'sd:deleteCompanion',
  ]) {
    assert(isIpcChannelAllowedForRole(channel, 'main'), `${channel} has no trusted renderer`);
    assert(!isIpcChannelAllowedForRole(channel, 'quick-note'), `quick-note can drive the image runtime through ${channel}`);
  }
  passed.push('pinned image runtime manifest + IPC roles');

  // The verified-download integrity check, against real files on disk. The
  // resume/Range path is exercised live (cancel + resume of a model in the UI);
  // here we pin the gate every downloaded byte passes through: size, then hash.
  const good = path.join(temporaryDirectory, 'download-good.bin');
  const payload = Buffer.alloc(2 * 1024 * 1024);
  for (let i = 0; i < payload.length; i += 1) payload[i] = (i * 31 + (i >> 8)) & 0xff;
  await fs.writeFile(good, payload);
  const goodSha = createHash('sha256').update(payload).digest('hex');
  assert(await verifyFile(good, payload.length, goodSha), 'a correct file was rejected');
  assert(await verifyFile(good, payload.length, goodSha.toUpperCase()), 'verifyFile must be case-insensitive on the digest');
  assert(!(await verifyFile(good, payload.length, '0'.repeat(64))), 'a wrong checksum passed');
  assert(!(await verifyFile(good, payload.length - 1, goodSha)), 'a wrong size passed');
  assert(!(await verifyFile(good, 0, goodSha)), 'a zero expected size passed');
  assert(!(await verifyFile(path.join(temporaryDirectory, 'absent.bin'), payload.length, goodSha)), 'a missing file passed');
  const empty = path.join(temporaryDirectory, 'download-empty.bin');
  await fs.writeFile(empty, Buffer.alloc(0));
  assert(!(await verifyFile(empty, 0, createHash('sha256').update(Buffer.alloc(0)).digest('hex'))), 'an empty file must never verify');
  // DownloadError carries a machine-readable code the UI branches on.
  assert(new DownloadError('integrity', 'x').code === 'integrity', 'DownloadError lost its code');
  passed.push('verified-download integrity gate: size then SHA-256');

  // Resume hardening. A `.part` that already holds every byte and checks out
  // is adopted without touching the network (the URL below cannot connect);
  // one that is complete but wrong is discarded, not adopted.
  const adopted = path.join(temporaryDirectory, 'download-adopt.bin');
  await fs.writeFile(`${adopted}.part`, payload);
  await downloadVerified({ url: 'http://127.0.0.1:9/never', target: adopted, sizeBytes: payload.length, sha256: goodSha });
  assert(await verifyFile(adopted, payload.length, goodSha), 'a complete, correct .part was not adopted');
  assert(!(await fs.stat(`${adopted}.part`).catch(() => null)), 'the adopted .part was left behind');
  const wrong = path.join(temporaryDirectory, 'download-wrong.bin');
  await fs.writeFile(`${wrong}.part`, payload);
  let wrongCode = '';
  try {
    await downloadVerified({ url: 'http://127.0.0.1:9/never', target: wrong, sizeBytes: payload.length, sha256: '0'.repeat(64) });
  } catch (err) {
    wrongCode = err instanceof DownloadError ? err.code : 'other';
  }
  assert(wrongCode === 'network', `a complete but wrong .part must be discarded and refetched (got ${wrongCode || 'success'})`);
  assert(!(await fs.stat(`${wrong}.part`).catch(() => null)), 'a wrong .part survived');
  // Content-Range: only an exact continuation counts as a resume.
  assert(contentRangeStart('bytes 1048576-2097151/2097152') === 1048576, 'Content-Range start not parsed');
  assert(contentRangeStart('bytes 0-99/*') === 0, 'Content-Range with unknown total not parsed');
  assert(contentRangeStart('bytes */2097152') === null, 'an unsatisfied range must not parse as a start');
  assert(contentRangeStart(null) === null && contentRangeStart('garbage') === null, 'malformed Content-Range must be null');
  passed.push('download resume: complete .part adopted, wrong one discarded, Content-Range checked');

  // Audit numbering survives rotation: a card that remembers "#1" must find
  // the same line after the log rolled over, and an undo recorded before the
  // roll-over still counts. userData is isolated by the runner, so this
  // writes nowhere real.
  const first = await appendAudit({ at: 1, tool: 't1', ok: true, summary: 'first' });
  const second = await appendAudit({ at: 2, tool: 't2', ok: true, summary: 'second' });
  await appendAudit({ at: 3, tool: '__undo', ok: true, kind: 'undo', undoOf: 0 });
  await appendAudit({ at: 4, tool: 'big', ok: true, summary: 'x'.repeat(6 * 1024 * 1024) });
  const afterRoll = await appendAudit({ at: 5, tool: 't5', ok: true, summary: 'after' });
  assert(first === 0 && second === 1 && afterRoll === 4, `audit indices drifted: ${first}, ${second}, ${afterRoll}`);
  assert(!(await fs.stat(auditPath()).then((st) => st.size > 1024 * 1024).catch(() => true)), 'the live audit log did not rotate');
  assert((await getAuditRecord(1))?.tool === 't2', 'a rotated-out entry is no longer found by its number');
  assert((await getAuditRecord(4))?.tool === 't5', 'the first entry after rotation has the wrong number');
  assert((await undoneIndices()).includes(0), 'an undo recorded before rotation was forgotten');
  const recent = await readAudit(10);
  assert(recent[0]?.index === 4 && recent.some((r) => r.index === 0), 'readAudit must span the rotated file too');
  passed.push('audit log numbering stable across rotation');

  return passed;
}
