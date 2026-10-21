import { spawn } from 'node:child_process';
import { access, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const executable = path.join(root, 'release', 'win-unpacked', 'Writers Hoard.exe');
await access(executable);

const temporaryRoot = await realpath(os.tmpdir());
const profile = await mkdtemp(path.join(temporaryRoot, 'writers-hoard-packaged-smoke-'));
async function cleanupProfile() {
  const resolvedProfile = await realpath(profile);
  const relative = path.relative(temporaryRoot, resolvedProfile);
  if (resolvedProfile !== path.resolve(profile) || !relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(relative).startsWith('writers-hoard-packaged-smoke-')) {
    throw new Error('Packaged smoke profile cleanup is outside its temporary directory.');
  }
  await rm(resolvedProfile, { recursive: true, force: true });
}
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
  await cleanupProfile();
}
