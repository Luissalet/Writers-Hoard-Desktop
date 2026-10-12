// Fetch an unchanged, pinned local grammar runtime and preserve all its notices.
import { createHash } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'resources', 'proofing');
const version = 'LanguageTool-6.6';
const expected = '53600506b399bb5ffe1e4c8dec794fd378212f14aaf38ccef9b6f89314d11631';
try { await access(path.join(target, version, 'languagetool-server.jar')); }
catch {
  const response = await fetch('https://languagetool.org/download/LanguageTool-6.6.zip');
  if (!response.ok) throw new Error(`Grammar runtime download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Grammar runtime does not match the pinned archive.');
  const zip = await JSZip.loadAsync(bytes);
  await mkdir(target, { recursive: true });
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const destination = path.resolve(target, name);
    if (!name.startsWith(`${version}/`) || !destination.startsWith(`${target}${path.sep}`)) throw new Error('Grammar archive entry leaves its runtime directory.');
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, await entry.async('nodebuffer'));
  }
}
console.log('Local grammar runtime ready; Java 17 or newer is required.');
