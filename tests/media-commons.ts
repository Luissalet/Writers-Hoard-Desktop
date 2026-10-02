import { BrowserWindow, session } from 'electron';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildYtdlpArgs, checkPublicUrl, runProcess } from '../electron/media/commons';
import { desktopToolOptions } from '../electron/media/desktopTools';
import { downloadMedia, detectPlatform } from '../electron/media/ytdlp';
import { capturePage } from '../electron/media/pageCapture';
import { guardCaptureSession } from '../electron/media/publicNetwork';
import { runMediaSecurityTests } from './media-security';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(run: () => Promise<unknown>, pattern: RegExp) {
  try { await run(); } catch (error) {
    assert(pattern.test(String(error)), `unexpected error: ${String(error)}`);
    return;
  }
  throw new Error('operation unexpectedly succeeded');
}

export async function runMediaCommonsTests(tmp: string): Promise<string[]> {
  const passed = await runMediaSecurityTests(tmp);
  const hosts = { lookup: async (host: string) => host === 'public.test' ? ['1.1.1.1'] : ['1.1.1.1', '127.0.0.1'] };
  for (const url of [
    'http://127.0.0.1/', 'http://2130706433/', 'http://0x7f.1/', 'http://[::1]/',
    'http://[::ffff:127.0.0.1]/', 'http://169.254.169.254/', 'http://100.64.0.1/',
    'http://metadata.google.internal/', 'http://printer.local/', 'file:///C:/Windows/win.ini',
    'https://user:pass@public.test/', 'https://mixed.test/',
  ]) assert(await checkPublicUrl(url, hosts), `unsafe destination accepted: ${url}`);
  assert(await checkPublicUrl('https://public.test/', hosts) === null, 'public destination refused');
  await rejects(() => capturePage('http://127.0.0.1/'), /Page capture refused/);
  passed.push('shared public policy denies literal, obfuscated, mixed-DNS, metadata and credential destinations');

  const options = desktopToolOptions({
    isPackaged: true, appPath: tmp, resourcesPath: path.join(tmp, 'packaged'),
    ffmpegPath: path.join(tmp, 'app.asar', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'), env: {},
  });
  assert(options.extraDirs?.[0] === path.join(tmp, 'packaged', 'bin'), 'packaged tool fallback lost');
  assert(options.env?.HOARD_FFMPEG?.includes('app.asar.unpacked'), 'ffmpeg-static was left inside asar');
  assert(options.env?.ELECTRON_RUN_AS_NODE === '1', 'packaged Electron cannot act as the shared Node runtime');
  const overridden = desktopToolOptions({ isPackaged: false, appPath: tmp, resourcesPath: tmp, ffmpegPath: 'bundled', env: { HOARD_FFMPEG: 'explicit' } });
  assert(overridden.env?.HOARD_FFMPEG === 'explicit', 'explicit ffmpeg override was overwritten');
  assert(overridden.extraDirs?.[0] === path.join(tmp, 'resources', 'bin'), 'development tool fallback lost');
  assert(detectPlatform('https://x.com/post') === 'X (Twitter)', 'platform label changed');
  assert(detectPlatform('https://youtube.com.evil.test/post') === 'Desconocida', 'platform detection trusted an embedded domain');
  const oldArgs = buildYtdlpArgs({ url: 'https://1.1.1.1/video', format: 'video', dir: tmp, hasFfmpeg: false, ytdlpVersion: '2025.01.01' });
  assert(!oldArgs.includes('--js-runtimes') && !oldArgs.includes('--merge-output-format'), 'old/no-ffmpeg tool gets unsupported options');
  passed.push('desktop keeps packaged/dev binaries, unpacked ffmpeg and explicit shared overrides');

  const fixture = path.join(tmp, 'fake-ytdlp.cjs');
  const record = path.join(tmp, 'download-record.json');
  await fs.writeFile(fixture, `
const fs = require('node:fs'); const path = require('node:path');
const args = process.argv.slice(2);
if (args.includes('--version') || args.includes('-version')) { console.log('2026.09.01'); process.exit(0); }
const dir = args[args.indexOf('-P') + 1];
fs.writeFileSync(process.env.WH_TOOL_RECORD, JSON.stringify({args, dir}));
if (args.at(-1).includes('/failure')) { console.error('deterministic failure'); process.exit(7); }
if (args.at(-1).includes('/empty')) process.exit(0);
if (args.at(-1).includes('/cancel')) { setInterval(() => {}, 1000); return; }
fs.writeFileSync(path.join(dir, 'fixture.info.json'), JSON.stringify({description:'Caption', uploader_id:'Author', upload_date:'20261003'}));
fs.writeFileSync(path.join(dir, 'oversized.part'), Buffer.alloc(4096));
fs.writeFileSync(path.join(dir, 'oversized.f137.mp4'), Buffer.alloc(2048));
fs.writeFileSync(path.join(dir, args.includes('-x') ? 'fixture.mp3' : 'fixture.mp4'), 'media');
`);
  const envKeys = ['HOARD_YTDLP', 'HOARD_FFMPEG', 'WH_TOOL_RECORD'] as const;
  const original = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  process.env.HOARD_YTDLP = `node:${fixture}`;
  process.env.HOARD_FFMPEG = `node:${fixture}`;
  process.env.WH_TOOL_RECORD = record;
  try {
    for (const format of ['video', 'audio'] as const) {
      const result = await downloadMedia('https://1.1.1.1/video', format, undefined, path.join(tmp, 'cookies.txt'));
      const saved = JSON.parse(await fs.readFile(record, 'utf8')) as { args: string[]; dir: string };
      assert(result.filename === (format === 'audio' ? 'fixture.mp3' : 'fixture.mp4'), 'partial output selected');
      assert(result.metadata?.description === 'Caption' && result.metadata.uploader === 'Author', 'sidecar metadata lost');
      assert(saved.args.includes('--ignore-config') && saved.args.includes('--write-info-json'), 'shared config/metadata arguments missing');
      assert(saved.args.at(-2) === '--' && saved.args.at(-1) === 'https://1.1.1.1/video', 'URL argument boundary missing');
      assert(saved.args[saved.args.indexOf('--cookies') + 1] === path.join(tmp, 'cookies.txt'), 'saved cookie file lost');
      if (format === 'audio') assert(saved.args.includes('mp3'), 'audio format lost');
      await result.cleanup();
      assert(!await fs.stat(saved.dir).catch(() => null), 'successful download directory leaked');
    }
    for (const suffix of ['failure', 'empty']) {
      await rejects(() => downloadMedia(`https://1.1.1.1/${suffix}`, 'video'), /deterministic failure|no output file produced/);
      const saved = JSON.parse(await fs.readFile(record, 'utf8')) as { dir: string };
      assert(!await fs.stat(saved.dir).catch(() => null), 'failed download directory leaked');
    }
    await rejects(() => downloadMedia('http://127.0.0.1/video', 'video'), /Media download refused/);
    const aborted = new AbortController(); aborted.abort();
    await rejects(() => downloadMedia('https://1.1.1.1/video', 'video', aborted.signal), /cancelled/);
    const cancel = new AbortController();
    const cancelledDownload = downloadMedia('https://1.1.1.1/cancel', 'video', cancel.signal);
    let cancelledDirectory = '';
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const saved = JSON.parse(await fs.readFile(record, 'utf8')) as { args: string[]; dir: string };
      if (saved.args.at(-1)?.endsWith('/cancel')) { cancelledDirectory = saved.dir; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    cancel.abort();
    await rejects(() => cancelledDownload, /cancelled/);
    assert(cancelledDirectory, 'cancelled download never started');
    assert(!await fs.stat(cancelledDirectory).catch(() => null), 'cancelled download directory leaked');
  } finally {
    for (const key of envKeys) {
      if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
    }
  }
  passed.push('shared downloader preserves audio/video, cookies and metadata, ignores partial files, cleans success/failure/cancellation');

  const controller = new AbortController();
  let childPid = 0;
  const grandchildRecord = path.join(tmp, 'grandchild-pid.txt');
  const processFixture = `const {spawn} = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {env:process.env, windowsHide:true});
    require('node:fs').writeFileSync(${JSON.stringify(grandchildRecord)}, String(child.pid));
    setInterval(() => {}, 1000);`;
  const running = runProcess({ cmd: process.execPath, args: [] }, ['-e', processFixture], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, signal: controller.signal,
    onSpawn: child => { childPid = child.pid ?? 0; },
  });
  let grandchildPid = 0;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    grandchildPid = Number(await fs.readFile(grandchildRecord, 'utf8').catch(() => '0'));
    if (grandchildPid) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  controller.abort();
  await rejects(() => running, /cancel/i);
  assert(childPid > 0 && grandchildPid > 0, 'cancellation did not launch the process tree fixture');
  for (const pid of [childPid, grandchildPid]) {
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch { /* expected */ }
    assert(!alive, 'cancelled process tree remained alive after settlement');
  }
  const noisy = await runProcess({ cmd: process.execPath, args: [] }, ['-e', "process.stdout.write('x'.repeat(100000));process.stderr.write('y'.repeat(100000))"], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  assert(noisy.stdout.length === 65536 && noisy.stderr.length === 65536, 'process output tails are not bounded');
  passed.push('shared runner cancels a real process tree before settlement and bounds both output tails');

  await testChromiumGuard(passed);
  return passed;
}

async function testChromiumGuard(passed: string[]) {
  const reached: string[] = [];
  const proxy = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://public.test');
    reached.push(url.href);
    if (url.pathname === '/redirect') {
      response.writeHead(302, { Location: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}/private-redirect` });
      response.end(); return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<html><body>Public document
      <img src="http://public.test/public-image">
      <img src="http://private.test/private-image">
      <iframe src="http://private.test/private-frame"></iframe>
      <script>window.probe = fetch('http://private.test/private-fetch').then(() => 'allowed', () => 'blocked')</script>
      <script>window.socketProbe = new Promise(resolve => {
        const socket = new WebSocket('ws://private.test/private-socket');
        socket.onopen = () => resolve('allowed'); socket.onerror = () => resolve('blocked');
      })</script>
    </body></html>`);
  });
  proxy.on('upgrade', (request, socket) => { reached.push(request.url ?? 'private-upgrade'); socket.destroy(); });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const partition = `media-security-${randomUUID()}`;
  const isolated = session.fromPartition(partition);
  await isolated.setProxy({ proxyRules: `127.0.0.1:${(proxy.address() as AddressInfo).port}`, proxyBypassRules: '<-loopback>' });
  let lookups = 0;
  const release = guardCaptureSession(isolated, undefined, {
    lookup: async host => { lookups += 1; return host === 'public.test' ? ['1.1.1.1'] : ['127.0.0.1']; },
  });
  const win = new BrowserWindow({ show: false, webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await win.loadURL('http://public.test/page');
    assert(await win.webContents.executeJavaScript('window.probe') === 'blocked', 'private fetch escaped the request guard');
    assert(await win.webContents.executeJavaScript('window.socketProbe') === 'blocked', 'private WebSocket escaped the request guard');
    await rejects(() => win.loadURL('http://public.test/redirect'), /ERR_BLOCKED_BY_CLIENT/);
    assert(!reached.some(url => url.includes('private-')), `private Chromium destination reached fixture: ${reached.join(', ')}`);
    assert(reached.some(url => url.includes('/public-image')), 'public image traffic was blocked');
    assert(lookups >= 7, 'redirect/assets/WebSocket requests were not independently revalidated');
    passed.push('real Chromium permits public assets and blocks private redirects, frames, images, fetch and WebSockets');
  } finally {
    win.destroy(); release();
    await isolated.clearStorageData();
    await new Promise<void>(resolve => proxy.close(() => resolve()));
  }
}
