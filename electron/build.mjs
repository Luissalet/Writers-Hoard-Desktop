// Bundles the Electron main + preload TypeScript to CommonJS (.cjs).
//
// We emit .cjs explicitly so the output is treated as CommonJS regardless of
// the project's `"type": "module"` in package.json — sidestepping the whole
// ESM/CJS friction with Electron's main process and sandboxed preload.
//
// `electron`, `electron-updater` and `ffmpeg-static` stay external: they are
// resolved at runtime from node_modules (electron-updater/ffmpeg-static are
// production deps; ffmpeg-static is also asar-unpacked for execution).

import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
  external: ['electron', 'electron-updater', 'ffmpeg-static'],
};

await Promise.all([
  build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs' }),
  build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs' }),
]);

console.log('[electron] bundled main.cjs + preload.cjs → dist-electron/');
