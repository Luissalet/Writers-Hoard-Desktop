import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_DIR = path.join(ROOT, 'dist', 'assets');
const limits = {
  entry: Number(process.env.WH_BUNDLE_ENTRY_KB ?? 1_600) * 1_000,
  chunk: Number(process.env.WH_BUNDLE_CHUNK_KB ?? 700) * 1_000,
  total: Number(process.env.WH_BUNDLE_TOTAL_KB ?? 4_000) * 1_000,
};

const files = readdirSync(ASSET_DIR)
  .filter(name => name.endsWith('.js'))
  .map(name => ({ name, bytes: statSync(path.join(ASSET_DIR, name)).size }))
  .sort((left, right) => right.bytes - left.bytes);
const entry = files.find(file => file.name.startsWith('main-'));
const total = files.reduce((sum, file) => sum + file.bytes, 0);
const failures = [];

if (!entry) failures.push('No main-*.js renderer entry was found.');
else if (entry.bytes > limits.entry) {
  failures.push(`Renderer entry ${entry.name} is ${(entry.bytes / 1_000).toFixed(1)} kB (limit ${limits.entry / 1_000} kB).`);
}
for (const file of files.filter(file => file !== entry && file.bytes > limits.chunk)) {
  failures.push(`Lazy chunk ${file.name} is ${(file.bytes / 1_000).toFixed(1)} kB (limit ${limits.chunk / 1_000} kB).`);
}
if (total > limits.total) {
  failures.push(`Total renderer JavaScript is ${(total / 1_000).toFixed(1)} kB (limit ${limits.total / 1_000} kB).`);
}

if (failures.length) {
  failures.forEach(message => console.error(`ERROR ${message}`));
  process.exit(1);
}

console.log(
  `Bundle budget passed: entry ${(entry.bytes / 1_000).toFixed(1)} kB, ` +
  `largest lazy ${(files.find(file => file !== entry)?.bytes ?? 0) / 1_000} kB, ` +
  `total ${(total / 1_000).toFixed(1)} kB.`,
);
