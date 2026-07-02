// ============================================================================
// Downloads the standalone yt-dlp + gallery-dl binaries into resources/bin.
// ============================================================================
//
//   npm run fetch:bin
//
// Binaries are gitignored (resources/bin) and packaged by electron-builder via
// `extraResources`. ffmpeg is provided separately by the ffmpeg-static npm dep.
//   • yt-dlp     → downloads videos (YouTube, Instagram reels, X, …)
//   • gallery-dl → downloads photos / carousels (needs the user's browser cookies)
//
// Re-run anytime to refresh both tools to their latest release.

import { createWriteStream } from 'node:fs';
import { mkdir, chmod, stat } from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'resources', 'bin');

const BINARIES = [
  {
    repo: 'yt-dlp/yt-dlp',
    asset: { win32: 'yt-dlp.exe', darwin: 'yt-dlp_macos', linux: 'yt-dlp_linux' },
    local: { win32: 'yt-dlp.exe', darwin: 'yt-dlp', linux: 'yt-dlp' },
  },
  {
    // gallery-dl dev moved to Codeberg; standalone executables are published
    // by CI in the gdl-org/builds repo (mikf/gallery-dl releases have no assets).
    repo: 'gdl-org/builds',
    asset: { win32: 'gallery-dl_windows.exe', darwin: 'gallery-dl_macos', linux: 'gallery-dl_linux' },
    local: { win32: 'gallery-dl.exe', darwin: 'gallery-dl', linux: 'gallery-dl' },
  },
];

const platform = process.platform;

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

for (const bin of BINARIES) {
  const asset = bin.asset[platform];
  const localName = bin.local[platform];
  if (!asset) {
    console.error(`Unsupported platform for ${bin.repo}: ${platform}`);
    process.exit(1);
  }
  const url = `https://github.com/${bin.repo}/releases/latest/download/${asset}`;
  const outPath = path.join(OUT_DIR, localName);
  console.log(`Downloading ${asset} → ${outPath} …`);
  await download(url, outPath);
  if (platform !== 'win32') await chmod(outPath, 0o755);
  const { size } = await stat(outPath);
  console.log(`Done. ${localName} (${(size / 1e6).toFixed(1)} MB)`);
}

console.log('All binaries ready in resources/bin.');
