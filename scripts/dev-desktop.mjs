import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const require = createRequire(import.meta.url);
const electronExecutable = require('electron');

let devServer;
let electronProcess;
let shutdownPromise;

function resolvedDevUrl(server) {
  const urls = server.resolvedUrls?.local ?? [];
  const url = urls.find(candidate => candidate.includes('127.0.0.1')) ?? urls[0];
  if (!url) throw new Error('Vite did not expose a local development URL.');
  return url.replace(/\/$/, '');
}

function terminateElectronTree() {
  if (!electronProcess?.pid || electronProcess.exitCode !== null) {
    return Promise.resolve();
  }

  if (process.platform !== 'win32') {
    electronProcess.kill('SIGTERM');
    return Promise.resolve();
  }

  return new Promise(resolve => {
    const killer = spawn(
      'taskkill',
      ['/pid', String(electronProcess.pid), '/T', '/F'],
      { stdio: 'ignore', windowsHide: true },
    );
    killer.once('error', () => resolve());
    killer.once('exit', () => resolve());
  });
}

function shutdown(exitCode, terminateElectron) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    if (terminateElectron) await terminateElectronTree();
    if (devServer) await devServer.close();
    process.exitCode = exitCode;
  })();
  return shutdownPromise;
}

async function main() {
  // Bundle main + preload before starting the renderer. Importing the build
  // module is equivalent to `npm run electron:build` but keeps one process tree.
  await import('../electron/build.mjs');

  devServer = await createServer({
    root: projectRoot,
    configFile: path.join(projectRoot, 'vite.config.ts'),
    server: {
      host: '127.0.0.1',
    },
  });
  await devServer.listen();

  // Vite increments its configured port when that port is occupied. Always
  // pass the URL it actually selected to Electron instead of assuming 5174.
  const rendererUrl = resolvedDevUrl(devServer);
  console.log(`[desktop] renderer ready at ${rendererUrl}`);

  electronProcess = spawn(electronExecutable, ['.'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      ELECTRON_RENDERER_URL: rendererUrl,
    },
    stdio: 'inherit',
    windowsHide: false,
  });

  electronProcess.once('error', error => {
    console.error('[desktop] failed to start Electron', error);
    void shutdown(1, false);
  });
  electronProcess.once('exit', (code, signal) => {
    const exitCode = typeof code === 'number' ? code : signal ? 1 : 0;
    void shutdown(exitCode, false);
  });
}

process.once('SIGINT', () => void shutdown(130, true));
process.once('SIGTERM', () => void shutdown(143, true));

main().catch(error => {
  console.error('[desktop] startup failed', error);
  void shutdown(1, true);
});
