// ============================================================================
// Downloads the standalone yt-dlp + gallery-dl binaries into resources/bin.
// ============================================================================
//
//   npm run fetch:bin
//
// Defaults live in binary-manifest.json. A release can override each mutable
// version/checksum with WH_YTDLP_VERSION / WH_YTDLP_SHA256 and
// WH_GALLERYDL_VERSION / WH_GALLERYDL_SHA256.

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'resources', 'bin');
const manifest = JSON.parse(
  await readFile(path.join(__dirname, 'binary-manifest.json'), 'utf8'),
);
const BINARIES = Object.entries(manifest.binaries);
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

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const file = createReadStream(filePath);
    file.on('error', reject);
    file.on('data', (chunk) => hash.update(chunk));
    file.on('end', () => resolve(hash.digest('hex')));
  });
}

await mkdir(OUT_DIR, { recursive: true });

for (const [id, bin] of BINARIES) {
  const asset = bin.assets[platform];
  const localName = bin.localNames[platform];
  if (!asset || !localName) {
    throw new Error(`Unsupported platform for ${bin.repository}: ${platform}`);
  }

  const version = process.env[`${bin.envPrefix}_VERSION`] || bin.version;
  const expectedSha = (
    process.env[`${bin.envPrefix}_SHA256`] ||
    bin.sha256?.[platform] ||
    ''
  ).toLowerCase();
  if (expectedSha && !/^[a-f0-9]{64}$/.test(expectedSha)) {
    throw new Error(`${bin.envPrefix}_SHA256 must be a 64-character hexadecimal SHA-256.`);
  }

  const releasePath =
    version === 'latest'
      ? 'releases/latest/download'
      : `releases/download/${encodeURIComponent(version)}`;
  const url = `https://github.com/${bin.repository}/${releasePath}/${asset}`;
  const outPath = path.join(OUT_DIR, localName);
  const tempPath = `${outPath}.download`;

  console.log(`Downloading ${asset} -> ${outPath} ...`);
  await rm(tempPath, { force: true });
  try {
    await download(url, tempPath);
    const actualSha = await sha256(tempPath);
    if (expectedSha && actualSha !== expectedSha) {
      throw new Error(
        `${id} SHA-256 mismatch: expected ${expectedSha}, downloaded ${actualSha}.`,
      );
    }
    if (!expectedSha) {
      console.warn(
        `WARNING: ${id} is not checksum-pinned (downloaded SHA-256 ${actualSha}). ` +
          `Set ${bin.envPrefix}_SHA256 or update scripts/binary-manifest.json ` +
          'before a reproducible release.',
      );
    }
    await rm(outPath, { force: true });
    await rename(tempPath, outPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }

  if (platform !== 'win32') await chmod(outPath, 0o755);
  const { size } = await stat(outPath);
  console.log(`Done. ${localName} (${(size / 1e6).toFixed(1)} MB, ${version})`);
}

console.log('All binaries ready in resources/bin.');
