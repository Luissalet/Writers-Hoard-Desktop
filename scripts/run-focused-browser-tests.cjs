const { app, BrowserWindow } = require('electron');
const { once } = require('node:events');
const { runTemporaryElectronTest } = require('./test-temp-lifecycle.cjs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { preparationTimeoutMs, startDeadline } = require('./focused-browser-deadline.cjs');

// Same as run-critical-tests: SwiftShader keeps WebGL available headless, so
// focused tests can mount the real 3D view instead of its 2D fallback.
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const root = path.resolve(__dirname, '..');
const host = '127.0.0.1';
const harnessPath = '/__focused_browser_test__';

async function main(_temporaryDirectory, profile) {
  const [file, exported, timeoutArgument] = process.argv.slice(2);
  const timeoutMs = timeoutArgument === undefined ? 60000 : Number(timeoutArgument);
  if (!file || !/^[A-Za-z_$][\w$]*$/.test(exported ?? '') || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) throw new Error('Usage: electron scripts/run-focused-browser-tests.cjs tests/file.browser.tsx exportedFunction [timeoutMs:1000..600000]');
  const entry = path.resolve(root, file);
  if (!entry.startsWith(path.join(root, 'tests') + path.sep)) throw new Error('Test file must be inside tests/');
  const entryUrl = '/' + path.relative(root, entry).split(path.sep).map(encodeURIComponent).join('/');
  const prepMs = preparationTimeoutMs();

  process.env.WH_USER_DATA_DIR = profile;

  let expire;
  const expired = new Promise((_, reject) => {
    expire = () => reject(new Error('Focused browser deadline exceeded'));
  });
  const preparation = startDeadline('preparation', 'starting Vite', prepMs, expire, true);
  let execution;
  let vite;
  let stopped;
  let win;
  let closing = false;
  let tests;
  let viteExitCode;
  let executionDuration;
  try {
    // Vite plugins can block synchronously during startup. Keep them off the
    // event loop that supervises the preparation deadline.
    vite = new Worker(path.join(__dirname, 'focused-browser-vite.cjs'), {
      workerData: { root, host, harnessPath, entry, entryUrl },
    });
    stopped = new Promise(resolve => vite.once('exit', resolve));
    const viteFailure = new Promise((_, reject) => {
      vite.once('error', reject);
      stopped.then(code => {
        if (!closing) reject(new Error(`Focused browser Vite worker exited (${code})`));
      });
    });
    const [port] = await Promise.race([once(vite, 'message'), viteFailure, expired]);

    preparation.phase('starting Electron');
    await Promise.race([app.whenReady(), viteFailure, expired]);
    win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    win.webContents.on('console-message', details => {
      if (details.level === 'error') console.error(`${details.sourceId}:${details.lineNumber} ${details.message}`);
    });
    const rendererFailure = new Promise((_, reject) => {
      win.webContents.once('render-process-gone', (_event, details) => {
        reject(new Error(`Test renderer exited: ${details.reason} (${details.exitCode})`));
      });
    });
    const supervise = operation => Promise.race([operation, viteFailure, rendererFailure, expired]);

    preparation.phase('loading the test page');
    await supervise(win.loadURL(`http://${host}:${port}${harnessPath}`));
    // Await the renderer's import so Vite can scan, prebundle and serve the
    // initial module graph before the fixture's own execution budget starts.
    preparation.phase('loading the test module');
    const loaded = await supervise(win.webContents.executeJavaScript(
      `globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        import(${JSON.stringify(entryUrl)})
          .then(module => {
            if (typeof module[${JSON.stringify(exported)}] !== 'function') {
              throw new Error('Test module does not export the requested function');
            }
            globalThis.__focusedTest = () => module[${JSON.stringify(exported)}]();
            return { ok: true };
          })
          .catch(error => ({ ok: false, error: error.stack || String(error) }));`,
    ));
    if (!loaded.ok) throw new Error(loaded.error);
    console.log(`Focused browser preparation finished in ${preparation.stop()} ms`);
    execution = startDeadline('tests', 'running the test', timeoutMs, expire);
    const result = await supervise(win.webContents.executeJavaScript(
      `Promise.resolve().then(() => globalThis.__focusedTest())
        .then(tests => ({ ok: true, tests }))
        .catch(error => ({ ok: false, error: error.stack || String(error) }));`,
    ));
    if (!result.ok) throw new Error(result.error);
    tests = result.tests;
  } finally {
    closing = true;
    const deadline = execution ?? preparation;
    deadline.phase('closing the test window and Vite');
    try {
      try {
        if (win && !win.isDestroyed()) win.destroy();
      } finally {
        if (vite && vite.threadId !== -1) vite.postMessage('close');
        viteExitCode = await Promise.race([stopped, expired]);
      }
    } catch (error) {
      if (vite && vite.threadId !== -1) await vite.terminate();
      throw error;
    } finally {
      executionDuration = deadline.stop();
    }
  }
  if (viteExitCode !== 0) throw new Error(`Focused browser Vite worker failed to close (${viteExitCode})`);
  console.log(`Focused browser tests finished in ${executionDuration} ms`);
  for (const test of Array.isArray(tests) ? tests : [tests]) console.log(`PASS ${test}`);
}

void runTemporaryElectronTest(app, 'wh-focused-', 'profile', main);
