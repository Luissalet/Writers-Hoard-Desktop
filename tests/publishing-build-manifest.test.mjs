// The digest the packaged worker's build manifest records must change with anything the worker is built from
// and ignore build output, so a stale package fails the contract test instead of passing on an old executable.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { digestPublishingSource } from '../scripts/publishing-source-digest.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'writer-digest-'));
  for (const [file, text] of Object.entries({
    'publishing/worker.py': 'print(1)', 'publishing/borges/a.py': 'A = 1', 'publishing/fusion/catalog.json': '[]',
    'publishing/requirements.txt': 'httpx==1', 'scripts/build-publishing-runtime.mjs': 'build',
  })) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), text); }
  return root;
}

test('source, catalogue, requirements and build script change the digest', async () => {
  const root = await fixture();
  try {
    const base = (await digestPublishingSource(root)).sha256;
    for (const file of ['publishing/borges/a.py', 'publishing/fusion/catalog.json', 'publishing/requirements.txt', 'scripts/build-publishing-runtime.mjs']) {
      await writeFile(path.join(root, file), 'changed');
      assert.notEqual((await digestPublishingSource(root)).sha256, base, file);
      await writeFile(path.join(root, file), file.endsWith('a.py') ? 'A = 1' : file.endsWith('.json') ? '[]' : file.endsWith('.txt') ? 'httpx==1' : 'build');
      assert.equal((await digestPublishingSource(root)).sha256, base, `${file} restored`);
    }
    await writeFile(path.join(root, 'publishing/borges/new.py'), 'x');
    assert.notEqual((await digestPublishingSource(root)).sha256, base, 'a new source file');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('build output and caches do not change the digest', async () => {
  const root = await fixture();
  try {
    const base = (await digestPublishingSource(root)).sha256;
    for (const file of ['publishing/runtime/x/y.exe', 'publishing/.build/spec', 'publishing/.venv/lib.py', 'publishing/borges/__pycache__/a.pyc', 'publishing/tests/t.py']) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), 'noise');
    }
    assert.equal((await digestPublishingSource(root)).sha256, base);
  } finally { await rm(root, { recursive: true, force: true }); }
});
