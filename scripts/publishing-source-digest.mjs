// Digest of everything the packaged publishing worker is built from. The build writes it next to the
// executable (build-manifest.json); the contract test recomputes it from the repo, so a package that
// no longer matches the source or the catalogue fails instead of passing on an old executable.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const SKIP_DIRS = new Set(['runtime', '.build', '.venv', '__pycache__', 'node_modules', 'target', 'tests', '.pytest_cache']);
const BUILD_INPUTS = ['scripts/build-publishing-runtime.mjs'];

async function walk(directory, base, out) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) await walk(path.join(directory, entry.name), base, out); }
    else if (entry.isFile() && !entry.name.endsWith('.pyc')) out.push(path.relative(base, path.join(directory, entry.name)).split(path.sep).join('/'));
  }
}

export async function digestPublishingSource(root) {
  const files = [];
  await walk(path.join(root, 'publishing'), root, files);
  files.push(...BUILD_INPUTS);
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    hash.update(file + '\0');
    hash.update(createHash('sha256').update(await readFile(path.join(root, file))).digest());
  }
  return { sha256: hash.digest('hex'), files: files.length };
}

export const MANIFEST_NAME = 'build-manifest.json';
