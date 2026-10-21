import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = await realpath(os.tmpdir());
const temporary = await mkdtemp(path.join(temporaryRoot, 'writers-document-service-'));
try {
  const output = path.join(temporary, 'nativeDocumentService.mjs');
  await build({
    entryPoints: [path.join(root, 'electron/documents/nativeDocumentService.ts')],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    alias: { '@': path.join(root, 'src') },
  });
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', path.join(root, 'tests/documents-native-service.test.mjs')], {
      windowsHide: true,
      stdio: 'inherit',
      env: { ...process.env, WRITER_DOCUMENT_SERVICE_TEST_MODULE: output },
    });
    child.on('error', reject);
    child.on('close', code => resolve(code ?? 1));
  });
} finally {
  const resolvedTemporary = await realpath(temporary);
  const relative = path.relative(temporaryRoot, resolvedTemporary);
  if (resolvedTemporary === path.resolve(temporary) && relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(relative).startsWith('writers-document-service-')) {
    await rm(resolvedTemporary, { recursive: true, force: true });
  }
}
