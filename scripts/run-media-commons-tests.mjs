import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const temporary = await mkdtemp(path.join(os.tmpdir(), 'wh-media-commons-tests-'));
try {
  const env = { ...process.env, WH_MEDIA_TEST_ROOT: temporary };
  delete env.ELECTRON_RUN_AS_NODE;
  const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), 'run-media-commons-tests.cjs');
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(electron, [entry], {
      windowsHide: true, stdio: 'inherit',
      env,
    });
    child.on('error', reject);
    child.on('close', code => resolve(code ?? 1));
  });
} finally {
  // Chromium's network files stay locked until its process has exited.
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
