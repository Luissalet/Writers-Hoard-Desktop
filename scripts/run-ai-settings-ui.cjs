const { app, BrowserWindow } = require('electron');
const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-subscription-ui-'));
app.setPath('userData', path.join(directory, 'profile'));

async function main() {
  const { compile } = require('@tailwindcss/node');
  const { Scanner } = require('@tailwindcss/oxide');
  const compiler = await compile(fs.readFileSync(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} });
  const scanner = new Scanner({ sources: [{ base: path.join(root, 'src'), pattern: '**/*.{ts,tsx}', negated: false }] });
  fs.writeFileSync(path.join(directory, 'styles.css'), compiler.build(scanner.scan()));
  await esbuild.build({
    stdin: { contents: `import {testSubscriptionUi} from './tests/subscription-ui.browser.tsx';globalThis.IS_REACT_ACT_ENVIRONMENT=true;testSubscriptionUi().then(tests=>window.__result={ok:true,tests}).catch(error=>window.__result={ok:false,error:error.stack});`, resolveDir: root },
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome130', outfile: path.join(directory, 'test.js'),
    alias: { '@': path.join(root, 'src') }, loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{"DEV":false,"BASE_URL":"/"}', 'import.meta.url': '"file:///test.js"' }, logLevel: 'warning',
  });
  fs.writeFileSync(path.join(directory, 'index.html'), '<!doctype html><html lang="es"><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css"></head><body><div id="root"></div><script src="test.js"></script></body></html>');
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1280, height: 1000, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  await win.loadFile(path.join(directory, 'index.html'));
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const result = await win.webContents.executeJavaScript('window.__result ?? null');
    if (result) {
      if (!result.ok) throw new Error(result.error);
      for (const label of result.tests) console.log(`PASS ${label}`);
      for (const width of [1280, 760]) {
        win.setContentSize(width, 1000);
        await win.webContents.executeJavaScript('window.scrollTo(0, 0)');
        await new Promise(resolve => setTimeout(resolve, 100));
        const overflow = await win.webContents.executeJavaScript('document.documentElement.scrollWidth > window.innerWidth');
        if (overflow) throw new Error(`Horizontal overflow at ${width}px`);
        const screenshot = path.join(directory, `subscriptions-${width}.png`);
        fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
        console.log(`SCREENSHOT ${screenshot}`);
        await win.webContents.executeJavaScript('document.getElementById("external-bridge").scrollIntoView({block:"start"})');
        await new Promise(resolve => setTimeout(resolve, 100));
        const bridgeScreenshot = path.join(directory, `external-bridge-${width}.png`);
        fs.writeFileSync(bridgeScreenshot, (await win.webContents.capturePage()).toPNG());
        console.log(`SCREENSHOT ${bridgeScreenshot}`);
      }
      app.exit(0);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('UI tests timed out');
}
main().catch(error => { console.error(error); app.exit(1); });
