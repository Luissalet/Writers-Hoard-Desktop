const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-vvd-startup-'));
app.setPath('userData', path.join(directory, 'profile'));
async function main() {
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', details => { if (details.level === 'error') { errors.push(details.message); console.error(details.message); } });
  win.webContents.on('did-fail-load', (_e, code, description) => console.error(code, description));
  const url = process.argv[2];
  const built = url === '--built';
  if (!built && !/^http:\/\/127\.0\.0\.1:\d+\/$/.test(url ?? '')) throw new Error('Pass the actual resolved Vite local URL or --built.');
  if (built) await win.webContents.session.enableNetworkEmulation({ offline: true });
  await Promise.race([built ? win.loadFile(path.resolve(__dirname, '../dist/index.html')) : win.loadURL(url), new Promise((_, reject) => setTimeout(() => reject(new Error('Initial page load timed out')), 30000))]);
  const end = Date.now() + 45000;
  let state;
  do {
    state = await win.webContents.executeJavaScript('({text:document.body.innerText, main:document.getElementById("main-content")?.innerText, loading:!!document.querySelector("[aria-busy=true]")})');
    if (state.main?.trim() && !state.loading) break;
    await new Promise(resolve => setTimeout(resolve, 150));
  } while (Date.now() < end);
  fs.writeFileSync(path.join(directory, 'startup.png'), (await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify({ ...state, errors, screenshot: path.join(directory, 'startup.png') }));
  if (!state.main?.trim() || state.loading || errors.length) throw new Error('Full renderer startup failed');
  console.log(`PASS ${built ? 'Offline production' : 'Full App'} renderer mounts its dashboard and shell without startup errors`);
  app.exit(0);
}
main().catch(error => { console.error(error.stack || error); app.exit(1); });
