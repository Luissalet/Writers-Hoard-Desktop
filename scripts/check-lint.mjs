import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(ROOT, 'scripts', 'lint-baseline.json');
const PRUNE = process.argv.includes('--prune');
const TARGETS = ['src', 'electron', 'scripts', 'vite.config.ts', 'eslint.config.js'];

function normalizePath(filePath) {
  return path.relative(ROOT, filePath).replaceAll('\\', '/');
}

function hashMessage(message) {
  return createHash('sha256').update(message).digest('hex').slice(0, 12);
}

function entryKey(entry) {
  return [
    entry.file,
    entry.line,
    entry.column,
    entry.ruleId,
    entry.severity,
    entry.messageHash,
  ].join(':');
}

function sortEntries(left, right) {
  return (
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    left.column - right.column ||
    left.ruleId.localeCompare(right.ruleId) ||
    left.messageHash.localeCompare(right.messageHash)
  );
}

const baselineDocument = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
if (baselineDocument.version !== 1 || !Array.isArray(baselineDocument.entries)) {
  throw new Error('scripts/lint-baseline.json must have version 1 and an entries array.');
}

const eslint = new ESLint({ cwd: ROOT });
const results = await eslint.lintFiles(TARGETS);
const currentEntries = [];
const currentMessages = new Map();

for (const result of results) {
  for (const message of result.messages) {
    const entry = {
      file: normalizePath(result.filePath),
      line: message.line ?? 0,
      column: message.column ?? 0,
      ruleId: message.ruleId ?? 'eslint',
      severity: message.severity === 2 ? 'error' : 'warning',
      messageHash: hashMessage(message.message),
    };
    const key = entryKey(entry);
    currentEntries.push(entry);
    currentMessages.set(key, message.message.split('\n')[0]);
  }
}
currentEntries.sort(sortEntries);

const baselineEntries = [...baselineDocument.entries].sort(sortEntries);
const baselineKeys = new Set(baselineEntries.map(entryKey));
if (baselineKeys.size !== baselineEntries.length) {
  throw new Error('scripts/lint-baseline.json contains duplicate fingerprints.');
}
const currentKeys = new Set(currentEntries.map(entryKey));
const newEntries = currentEntries.filter((entry) => !baselineKeys.has(entryKey(entry)));
const resolvedEntries = baselineEntries.filter((entry) => !currentKeys.has(entryKey(entry)));
const remainingDebt = currentEntries.filter((entry) => baselineKeys.has(entryKey(entry)));

if (PRUNE) {
  if (newEntries.length > 0) {
    console.error('Refusing to prune while new lint violations exist.');
    process.exit(1);
  }
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify({ version: 1, entries: remainingDebt }, null, 2)}\n`,
  );
  console.log(`Pruned ${resolvedEntries.length} resolved fingerprint(s); ${remainingDebt.length} remain.`);
  process.exit(0);
}

for (const entry of newEntries) {
  console.error(`NEW ${entryKey(entry)} ${currentMessages.get(entryKey(entry))}`);
}
for (const entry of resolvedEntries) {
  console.error(`RESOLVED ${entryKey(entry)}`);
}
for (const entry of remainingDebt) {
  console.warn(`BASELINE ${entryKey(entry)} ${currentMessages.get(entryKey(entry))}`);
}

if (newEntries.length > 0 || resolvedEntries.length > 0) {
  console.error(
    `\nShipping lint failed: ${newEntries.length} new, ${resolvedEntries.length} resolved-but-unpruned. ` +
      'Fix new violations; after fixes run "npm run lint:baseline:prune".',
  );
  process.exit(1);
}

console.log(`Shipping lint passed with ${remainingDebt.length} exact baseline fingerprint(s).`);
