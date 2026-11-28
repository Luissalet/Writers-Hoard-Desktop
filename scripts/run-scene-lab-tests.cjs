const { app, BrowserWindow } = require('electron');
const esbuild = require('esbuild');
const fs = require('node:fs/promises');
const { runTemporaryElectronTest } = require('./test-temp-lifecycle.cjs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main(temporaryDirectory) {
  const bundlePath = path.join(temporaryDirectory, 'scene-lab.js');
  const htmlPath = path.join(temporaryDirectory, 'scene-lab.html');
  const entryPath = path.resolve(__dirname, '..', 'tests', 'scene-lab.browser.tsx');
  await esbuild.build({
    entryPoints: [entryPath],
    outfile: bundlePath,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    target: 'chrome130',
    alias: { '@': path.resolve(__dirname, '..', 'src') },
    define: {
      'process.env.NODE_ENV': '"test"',
      'globalThis.IS_REACT_ACT_ENVIRONMENT': 'true',
      'import.meta.env': '{"DEV":false,"BASE_URL":"/"}',
      'import.meta.url': '"file:///writers-hoard-scene-lab.js"',
    },
    logLevel: 'warning',
  });
  await fs.writeFile(
    htmlPath,
    '<!doctype html><html><body><div id="test-root"></div><script src="./scene-lab.js"></script></body></html>',
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
      const result = await testWindow.webContents.executeJavaScript('window.__sceneLabResult ?? null');
      if (result) {
        if (!result.ok) throw new Error(result.error || 'Scene Lab test failed');
        for (const test of result.tests) console.log(`PASS ${test}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Scene Lab test timed out');
  } finally {
    testWindow.destroy();
  }
}

void runTemporaryElectronTest(app, 'writers-hoard-scene-lab-', 'user-data', main);
