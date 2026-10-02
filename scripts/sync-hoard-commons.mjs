// Byte-for-byte upstream copies. Never edit electron/vendor/hoard-commons by hand.
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const sourceFlag = args.indexOf('--source');
const source = path.resolve(sourceFlag >= 0 ? args[sourceFlag + 1] : path.join(root, '..', 'HoardLink'));
const destination = path.join(root, 'electron', 'vendor', 'hoard-commons');
const files = ['media.js', 'text.js', 'web.js'];
const contents = await Promise.all(files.map(file => readFile(path.join(source, 'js', 'hoard-commons', file))));
const license = await readFile(path.join(source, 'LICENSE'));
const pyproject = await readFile(path.join(source, 'pyproject.toml'), 'utf8');
const version = /^version\s*=\s*"([^"]+)"/m.exec(pyproject)?.[1];
if (!version) throw new Error('Cannot read upstream HoardLink version');
const manifest = Buffer.from(JSON.stringify({
  upstream: 'https://github.com/Luissalet/HoardLink', version,
  files: Object.fromEntries(files.map((file, i) => [file, createHash('sha256').update(contents[i]).digest('hex')])),
  license: createHash('sha256').update(license).digest('hex'),
}, null, 2) + '\n');
const entries = [...files.map((file, i) => [file, contents[i]]), ['LICENSE', license], ['manifest.json', manifest]];
if (!check) await mkdir(destination, { recursive: true });
let drift = false;
for (const [file, bytes] of entries) {
  const target = path.join(destination, file);
  if (check) {
    const existing = await readFile(target).catch(() => Buffer.alloc(0));
    if (!existing.equals(bytes)) { console.error(`Upstream drift: ${file}`); drift = true; }
  } else {
    await writeFile(target, bytes);
  }
}
if (drift) process.exitCode = 1;
else console.log(`HoardLink ${version}: ${files.length} commons modules ${check ? 'verified' : 'synced'}`);
