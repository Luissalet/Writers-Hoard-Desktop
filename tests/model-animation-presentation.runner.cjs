const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const esbuild = require('esbuild');
const { viteCssTextPlugin } = require('../scripts/esbuild-vite-css.cjs');

app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-model-presentation-'));
app.setPath('userData', path.join(directory, 'profile'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const root = path.resolve(__dirname, '..');
  const { build } = await import('vite');
  const { default: tailwind } = await import('@tailwindcss/vite');
  const result = await build({ configFile: false, root, plugins: [tailwind()], logLevel: 'error', build: { write: false, minify: false, rollupOptions: { input: path.join(root, 'src/index.css') } } });
  const css = result.output.find(item => item.type === 'asset' && item.fileName.endsWith('.css'));
  if (!css) throw Error('No current compiled application CSS');
  fs.writeFileSync(path.join(directory, 'test.css'), css.source);
  await esbuild.build({
    stdin: { contents: `import {testModelAnimationPresentation} from './tests/model-animation-presentation.browser.tsx';
      globalThis.IS_REACT_ACT_ENVIRONMENT=true;
      window.__modelAnimationCapture=async(name,metrics)=>{
        if(window.__modelAnimationCheckpoint)throw Error('Overlapping capture requests');
        window.__modelAnimationCheckpoint={name,metrics};
        const until=Date.now()+20000;
        while(Date.now()<until){
          if(window.__modelAnimationAcknowledged?.name===name){const value=window.__modelAnimationAcknowledged;delete window.__modelAnimationAcknowledged;return value.receipt;}
          await new Promise(done=>setTimeout(done,20));
        }throw Error('Capture acknowledgement timed out: '+name);
      };
      testModelAnimationPresentation().then(tests=>window.__result={ok:true,tests}).catch(error=>window.__result={ok:false,error:error.stack||String(error)});`, resolveDir: root },
    bundle: true, platform: 'browser', format: 'iife', target: 'chrome130', jsx: 'automatic',
    outfile: path.join(directory, 'test.js'), alias: { '@': path.join(root, 'src') }, loader: { '.css': 'empty', '.txt': 'text' }, plugins: [viteCssTextPlugin()],
    define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{"DEV":false,"BASE_URL":"/"}', 'import.meta.url': '"file:///model-presentation-test.js"' },
    logLevel: 'warning',
  });
  fs.writeFileSync(path.join(directory, 'test.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="test.css"></head><body><div id="root"></div><script src="test.js"></script></body></html>');
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1280, height: 1000, useContentSize: true, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.webContents.session.enableNetworkEmulation({ offline: true });
  win.webContents.on('console-message', details => { if (details.level === 'error') console.error(details.message); else if (details.message.startsWith('PASS ') || details.message.startsWith('BASELINE ')) console.log(details.message); });
  win.webContents.on('render-process-gone', (_event, details) => { console.error(`Renderer exited: ${details.reason}/${details.exitCode}`); app.exit(1); });
  console.log(`Artifacts: ${directory}`);
  console.log(`Current compiled CSS sha256=${hash(css.source)}`);
  win.setContentSize(1280, 1000);
  await win.loadFile(path.join(directory, 'test.html'));
  let outcome;
  const captures = [];
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const state = await win.webContents.executeJavaScript('({checkpoint:window.__modelAnimationCheckpoint??null,result:window.__result??null})');
    if (state.checkpoint) {
      const { name, metrics } = state.checkpoint;
      if (!/^[a-z0-9-]+$/.test(name)) throw Error('Invalid capture name');
      if (!metrics?.canvas || metrics.canvas.width <= 0 || metrics.canvas.height <= 0) throw Error('Missing genuine canvas dimensions');
      const image = await win.webContents.capturePage(name === 'baseline' ? undefined : metrics.canvas);
      const png = image.toPNG(), size = image.getSize(), bitmap = image.toBitmap();
      let count = 0, sumX = 0, sumY = 0;
      for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
        const i = (y * size.width + x) * 4, b = bitmap[i], g = bitmap[i + 1], r = bitmap[i + 2];
        if (r > 130 && r > g * 1.35 && g > b * 1.1) { count++; sumX += x; sumY += y; }
      }
      const receipt = { sha256: hash(png), width: size.width, height: size.height, marker: { count, x: count ? sumX / count : null, y: count ? sumY / count : null } };
      fs.writeFileSync(path.join(directory, `${name}.png`), png);
      fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify({ name, metrics, receipt }, null, 2) + '\n');
      captures.push({ name, ...receipt });
      console.log(`CAPTURE ${name} ${JSON.stringify({ metrics, receipt })}`);
      await win.webContents.executeJavaScript(`delete window.__modelAnimationCheckpoint;window.__modelAnimationAcknowledged=${JSON.stringify({ name, receipt })}`);
    }
    if (state.result) { outcome = state.result; break; }
    await delay(30);
  }
  fs.writeFileSync(path.join(directory, 'outcome.json'), JSON.stringify({ outcome: outcome ?? null, captures }, null, 2) + '\n');
  if (!outcome?.ok) throw Error(outcome?.error ?? 'Model presentation suite timed out');
  console.log(`Completed ${outcome.tests.length} model presentation groups`);
  app.exit(0);
}
main().catch(error => { console.error(error.stack || error); app.exit(1); });
