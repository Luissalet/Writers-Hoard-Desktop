const { app, BrowserWindow } = require('electron');
const esbuild = require('esbuild');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { runTemporaryElectronTest } = require('./test-temp-lifecycle.cjs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main(temporaryDirectory) {
  const bundlePath = path.join(temporaryDirectory, 'health.js');
  const htmlPath = path.join(temporaryDirectory, 'health.html');
  const entryPath = path.resolve(__dirname, '..', 'tests', 'projectHealthRecovery.browser.ts');
  if (!fsSync.existsSync(entryPath)) throw new Error(`Missing test entry: ${entryPath}`);
  await esbuild.build({
    tsconfig: path.resolve(__dirname, '..', 'tsconfig.app.json'),
    stdin: {
      contents: fsSync.readFileSync(entryPath, 'utf8'),
      resolveDir: path.dirname(entryPath),
      sourcefile: 'projectHealthRecovery.browser.ts',
      loader: 'ts',
    },
    outfile: bundlePath,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'chrome130',
    alias: { '@': path.resolve(__dirname, '..', 'src') },
    define: {
      'process.env.NODE_ENV': '"test"',
      'import.meta.env': '{"DEV":false,"BASE_URL":"/"}',
      'import.meta.url': '"file:///writers-hoard-health.js"',
    },
    logLevel: 'warning',
  });
  await fs.writeFile(
    htmlPath,
    '<!doctype html><html><body><script src="./health.js"></script></body></html>',
    'utf8',
  );

  await app.whenReady();
  const testWindow = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  try {
    await testWindow.loadURL(pathToFileURL(htmlPath).toString());
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const result = await testWindow.webContents.executeJavaScript(
        'window.__projectHealthRecoveryResult ?? null',
      );
      if (result) {
        if (!result.ok) throw new Error(result.error || 'Project Health test failed');
        for (const test of result.tests) console.log(`PASS ${test}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Project Health test timed out');
  } finally {
    testWindow.destroy();
  }
}

void runTemporaryElectronTest(app, 'writers-hoard-health-', 'user-data', main);
