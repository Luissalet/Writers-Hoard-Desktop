const { app, BrowserWindow } = require('electron');
const esbuild = require('esbuild');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Keep rendering deterministic in CI while still exercising the real WebGL
// shader pipeline used by Worldgen's 3D regional-detail overlay.
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const temporaryDirectory = fsSync.mkdtempSync(path.join(os.tmpdir(), 'writers-hoard-critical-'));
const isolatedUserData = path.join(temporaryDirectory, 'user-data');
fsSync.mkdirSync(isolatedUserData, { recursive: true });
// Must happen before app ready: no test may ever open the user's real profile.
app.setPath('userData', isolatedUserData);

async function main() {
  const nativeBundlePath = path.join(temporaryDirectory, 'electron-security.cjs');
  await esbuild.build({
    entryPoints: [path.resolve(__dirname, '..', 'tests', 'electron-security.ts')],
    outfile: nativeBundlePath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    // The bundle runs inside Electron's main process: `electron` must resolve
    // to the real module there, not to the npm package (whose export is the
    // path of the binary).
    external: ['electron'],
    logLevel: 'warning',
  });
  const { runElectronSecurityTests } = require(nativeBundlePath);
  const nativeTests = await runElectronSecurityTests(temporaryDirectory);
  for (const test of nativeTests) console.log(`PASS ${test}`);

  const buildHarness = async (name, entry) => {
    const bundlePath = path.join(temporaryDirectory, `${name}.js`);
    const htmlPath = path.join(temporaryDirectory, `${name}.html`);
    await esbuild.build({
      entryPoints: [path.resolve(__dirname, '..', 'tests', entry)],
      outfile: bundlePath,
      bundle: true,
      platform: 'browser',
      format: 'iife',
      target: 'chrome130',
      jsx: 'automatic',
      sourcemap: 'inline',
      alias: {
        '@': path.resolve(__dirname, '..', 'src'),
      },
      define: {
        'process.env.NODE_ENV': '"test"',
        'import.meta.env': '{"DEV":false,"BASE_URL":"/"}',
        'import.meta.url': '"file:///writers-hoard-startup.js"',
      },
      plugins: name === 'startup'
        ? [{
            name: 'ignore-renderer-css',
            setup(build) {
              build.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'css' }));
            },
          }]
        : [],
      logLevel: 'warning',
    });
    await fs.writeFile(
      htmlPath,
      `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title></head>` +
        `<body><div id="root"></div><script src="./${name}.js"></script></body></html>`,
      'utf8',
    );
    return htmlPath;
  };
  const [criticalHtmlPath, startupHtmlPath, worldgenHtmlPath] = await Promise.all([
    buildHarness('critical', 'critical.browser.ts'),
    buildHarness('startup', 'startup.browser.ts'),
    buildHarness('worldgen', 'worldgen-study.entry.ts'),
  ]);

  const testWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Hidden test windows must execute editor timers like a foreground app.
      backgroundThrottling: false,
    },
  });
  const runHarness = async (htmlPath, resultExpression, label, timeoutMs) => {
    const url = pathToFileURL(htmlPath).toString() +
      (label === 'Full renderer startup' ? '#/' : '');
    await testWindow.loadURL(url);
    // An inactivity budget, not a total one: a slow machine that keeps
    // reporting progress must not fail for being slow (lesson #40).
    let deadline = Date.now() + timeoutMs;
    const startedAt = Date.now();
    let lastProgress = '';
    while (Date.now() < deadline) {
      const result = await testWindow.webContents.executeJavaScript(
        `${resultExpression} ?? null`,
      );
      if (result) {
        if (!result.ok) throw new Error(result.error || `${label} failed`);
        for (const test of result.tests) console.log(`PASS ${test}`);
        return result.tests.length;
      }
      const progress = await testWindow.webContents.executeJavaScript(
        '`${window.__criticalProgress?.length ?? 0} checks, ${window.__criticalStage ?? "initial checks"}`',
      );
      if (progress !== lastProgress) {
        console.log(`${label}: ${progress} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
        lastProgress = progress;
        deadline = Date.now() + timeoutMs;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const progress = await testWindow.webContents.executeJavaScript(
      'window.__criticalProgress ?? null',
    ).catch(() => null);
    if (Array.isArray(progress)) {
      for (const test of progress) console.log(`PASS ${test}`);
      const at = await testWindow.webContents.executeJavaScript(
        'window.__criticalStage ?? null',
      ).catch(() => null);
      console.log(`(${label} stopped answering after ${progress.length} test(s)${at ? `, at stage ${at}` : ''})`);
    }
    throw new Error(`${label} timed out`);
  };

  try {
    const criticalCount = await runHarness(
      criticalHtmlPath,
      'window.__criticalResult',
      'Critical data tests',
      90_000,
    );
    const startupCount = await runHarness(
      startupHtmlPath,
      'window.__startupResult',
      'Full renderer startup',
      30_000,
    );
    const worldgenCount = await runHarness(
      worldgenHtmlPath,
      'window.__worldgenResult',
      'Worldgen quality and workflow tests',
      60_000,
    );
    const { createServer } = await import('vite');
    const projectRoot = path.resolve(__dirname, '..');
    const devServer = await createServer({
      root: projectRoot,
      configFile: path.join(projectRoot, 'vite.config.ts'),
      logLevel: 'error',
      server: {
        host: '127.0.0.1',
        port: 0,
        strictPort: true,
      },
    });
    let devStartupCount = 0;
    try {
      await devServer.listen();
      const devUrl = devServer.resolvedUrls?.local[0];
      if (!devUrl) throw new Error('Vite did not expose a local development URL.');
      const rendererErrors = [];
      const onConsoleMessage = details => {
        if (details.level === 'error') {
          rendererErrors.push(`${details.sourceId}:${details.lineNumber} ${details.message}`);
        }
      };
      const onRendererGone = (_event, details) => {
        rendererErrors.push(`Renderer process exited: ${details.reason} (${details.exitCode})`);
      };
      testWindow.webContents.on('console-message', onConsoleMessage);
      testWindow.webContents.on('render-process-gone', onRendererGone);
      try {
        await testWindow.loadURL(`${devUrl}#/`);
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
          if (rendererErrors.length) throw new Error(rendererErrors.join('\n'));
          const mounted = await testWindow.webContents.executeJavaScript(`
            (() => {
              const root = document.getElementById('root');
              return Boolean(
                root &&
                root.childElementCount > 0 &&
                (root.textContent?.trim().length ?? 0) > 10
              );
            })()
          `);
          if (mounted) {
            await new Promise(resolve => setTimeout(resolve, 250));
            if (rendererErrors.length) throw new Error(rendererErrors.join('\n'));
            console.log('PASS Vite development renderer startup');
            devStartupCount = 1;
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (!devStartupCount) {
          throw new Error('Vite development renderer did not mount visible application UI.');
        }
        const regionalWorker = await testWindow.webContents.executeJavaScript(`
          (() => new Promise((resolve) => {
            const worker = new Worker(
              new URL('/src/engines/worldgen/region.worker.ts', location.origin),
              { type: 'module' },
            );
            const timer = setTimeout(() => {
              worker.terminate();
              resolve({ ok: false, error: 'Regional worker startup timed out.' });
            }, 8000);
            worker.onmessage = (event) => {
              if (event.data?.type !== 'configured') return;
              clearTimeout(timer);
              worker.terminate();
              resolve({ ok: true });
            };
            worker.onerror = (event) => {
              clearTimeout(timer);
              worker.terminate();
              resolve({ ok: false, error: event.message || 'Regional worker failed.' });
            };
            worker.postMessage({
              type: 'configure',
              contextId: 'critical-regional-worker',
              world: { params: { seed: 'critical-regional-worker' } },
              geography: {
                settlements: [],
                roads: [],
                realms: [],
                realmOf: new Int32Array(0),
                features: [],
                ruins: [],
                landforms: [],
                languageOf: {},
                languageCount: 2,
              },
            });
          }))()
        `);
        if (!regionalWorker.ok) {
          throw new Error(regionalWorker.error || 'Regional worker startup failed.');
        }
        console.log('PASS Vite regional worker startup');
        devStartupCount += 1;
        const journeyTests = await testWindow.webContents.executeJavaScript(`
          import('/tests/worldgen-journey-live.ts').then(module => module.testWorldgenLiveJourney())
        `);
        for (const test of journeyTests) console.log('PASS ' + test);
        devStartupCount += journeyTests.length;
      } finally {
        testWindow.webContents.removeListener('console-message', onConsoleMessage);
        testWindow.webContents.removeListener('render-process-gone', onRendererGone);
      }
    } finally {
      await devServer.close();
    }
    console.log(
      `Critical tests passed: ${nativeTests.length + criticalCount + worldgenCount + startupCount + devStartupCount}`,
    );
  } finally {
    if (!testWindow.isDestroyed()) testWindow.destroy();
  }
}

app.whenReady()
  .then(main)
  .then(() => app.exit(0))
  .catch(error => {
    console.error(error);
    app.exit(1);
  })
  .finally(async () => {
    if (temporaryDirectory) {
      await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  });
