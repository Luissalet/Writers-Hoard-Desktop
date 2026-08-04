// Bundles the Electron main + preload TypeScript to CommonJS (.cjs).
//
// We emit .cjs explicitly so the output is treated as CommonJS regardless of
// the project's `"type": "module"` in package.json — sidestepping the whole
// ESM/CJS friction with Electron's main process and sandboxed preload.
//
// `electron`, `electron-updater` and `ffmpeg-static` stay external: they are
// resolved at runtime from node_modules (electron-updater/ffmpeg-static are
// production deps; ffmpeg-static is also asar-unpacked for execution).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
  external: ['electron', 'electron-updater', 'ffmpeg-static'],
  // The forge bundles renderer-side worldgen modules, which import shared code
  // through the same `@/` alias Vite and the test harness use.
  alias: { '@': path.join(ROOT, 'src') },
};

await Promise.all([
  build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs' }),
  build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs' }),
  // La Forja: the worldgen engine bundled for dedicated OS processes.
  // @napi-rs/canvas stays external (a native .node resolved from
  // node_modules and asar-unpacked in packaged builds).
  build({
    ...common,
    external: [...common.external, '@napi-rs/canvas'],
    entryPoints: ['src/engines/worldgen/forge/regionForge.ts'],
    outfile: 'dist-electron/forge/regionForge.cjs',
  }),
  build({
    ...common,
    external: [...common.external, '@napi-rs/canvas'],
    entryPoints: ['src/engines/worldgen/forge/worldgenForge.ts'],
    outfile: 'dist-electron/forge/worldgenForge.cjs',
  }),
]);

console.log('[electron] bundled main.cjs + preload.cjs + forge/*.cjs → dist-electron/');
