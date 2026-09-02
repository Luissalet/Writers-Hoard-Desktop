#!/usr/bin/env node
// Inserts `key|||English|||Castellano` lines (from a file or stdin) into
// src/locales/en.ts and es.ts, right before the closing `} as const;`.
// Refuses duplicates so two agents cannot silently disagree on a key.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const source = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : fs.readFileSync(0, 'utf8');
const lines = source.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

const entries = [];
for (const line of lines) {
  const parts = line.split('|||');
  if (parts.length !== 3) throw new Error(`Bad line (need key|||en|||es): ${line}`);
  entries.push({ key: parts[0].trim(), en: parts[1], es: parts[2] });
}

const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;

for (const [file, field] of [['en.ts', 'en'], ['es.ts', 'es']]) {
  const filePath = path.join(root, 'src', 'locales', file);
  let text = fs.readFileSync(filePath, 'utf8');
  const marker = '} as const;';
  const at = text.lastIndexOf(marker);
  if (at < 0) throw new Error(`No closing marker in ${file}`);
  const additions = [];
  for (const entry of entries) {
    const existing = new RegExp(`^  '${entry.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}':`, 'm');
    if (existing.test(text)) {
      console.error(`skip (exists in ${file}): ${entry.key}`);
      continue;
    }
    additions.push(`  ${quote(entry.key)}: ${quote(entry[field])},`);
  }
  if (additions.length === 0) continue;
  text = text.slice(0, at) + additions.join('\n') + '\n' + text.slice(at);
  fs.writeFileSync(filePath, text);
  console.log(`${file}: +${additions.length}`);
}
