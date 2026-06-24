// ============================================================================
// Downloads the standalone yt-dlp binary into resources/bin for the current OS.
// ============================================================================
//
//   npm run fetch:bin
//
// The binary is gitignored (resources/bin) and packaged by electron-builder via
// `extraResources`. ffmpeg is provided separately by the ffmpeg-static npm dep.
//
// Re-run anytime to refresh yt-dlp to the latest release.

import { createWriteStream } from 'node:fs';
import { mkdir, chmod, stat } from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'resources', 'bin');

const ASSETS = {
  win32: 'yt-dlp.exe',
  darwin: 'yt-dlp_macos',
  linux: 'yt-dlp_linux',
};
const LOCAL_NAME = { win32: 'yt-dlp.exe', darwin: 'yt-dlp', linux: 'yt-dlp' };

const platform = process.platform;
const asset = ASSETS[platform];
if (!asset) {
  console.error(`Unsupported platform: ${platform}`);
  process.exit(1);
}

const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;
const outPath = path.join(OUT_DIR, LOCAL_NAME[platform]);

function download(fromUrl, toPath, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('too many redirects'));
    https
      .get(fromUrl, { headers: { 'User-Agent': 'writers-hoard-desktop' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          resolve(download(res.headers.location, toPath, redirects + 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${fromUrl}`));
          return;
        }
        const file = createWriteStream(toPath);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', reject);
      })
      .on('error', reject);
  });
}

await mkdir(OUT_DIR, { recursive: true });
console.log(`Downloading ${asset} → ${outPath} …`);
await download(url, outPath);
if (platform !== 'win32') await chmod(outPath, 0o755);
const { size } = await stat(outPath);
console.log(`Done. yt-dlp (${(size / 1e6).toFixed(1)} MB) ready at resources/bin/${LOCAL_NAME[platform]}`);
