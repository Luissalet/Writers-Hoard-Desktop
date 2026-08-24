import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const executable = path.join(root, 'release', 'win-unpacked', 'Writers Hoard.exe');
await access(executable);

const profile = await mkdtemp(path.join(os.tmpdir(), 'writers-hoard-packaged-smoke-'));
try {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(executable, [`--user-data-dir=${profile}`], {
      cwd: root,
      env: { ...process.env, WH_DESKTOP_SMOKE_TEST: '1' },
      stdio: 'ignore',
      windowsHide: true,
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Packaged desktop startup timed out.'));
    }, 30_000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
  if (exitCode !== 0) throw new Error(`Packaged desktop startup exited with code ${exitCode}.`);
  console.log('PASS packaged Electron renderer startup');
} finally {
  await rm(profile, { recursive: true, force: true });
}
