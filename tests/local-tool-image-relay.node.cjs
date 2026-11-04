'use strict';

const path = require('node:path');
const Module = require('node:module');
const { build } = require('esbuild');

async function main() {
  const root = path.resolve(__dirname, '..');
  const bundled = await build({
    stdin: {
      contents: `export { testBinaryImageRelay } from './local-tool-image-relay.server.node';
export { testSharedImageProfile, testSharedImageBirthUndo } from './local-tool-convergence.image-profile';
export { testSharedImageAlignment, testConcurrentImageAlignment, testImageAlignmentBirthUndo } from './local-tool-convergence.image-alignment';`,
      resolveDir: __dirname,
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    alias: { '@': path.join(root, 'src') },
  });
  const test = new Module(__filename, module);
  test._compile(bundled.outputFiles[0].text, __filename);
  test.exports.testSharedImageProfile();
  test.exports.testSharedImageBirthUndo();
  test.exports.testSharedImageAlignment();
  test.exports.testConcurrentImageAlignment();
  test.exports.testImageAlignmentBirthUndo();
  const { checks, calls } = await test.exports.testBinaryImageRelay();
  const aligned = await test.exports.testBinaryImageRelay('aligned');
  const raster = await test.exports.testBinaryImageRelay('raster');
  const cells = await test.exports.testBinaryImageRelay('cells');
  console.log(JSON.stringify({ legacy: { checks: checks.length, calls }, aligned: { checks: aligned.checks.length, calls: aligned.calls }, raster: { checks: raster.checks.length, calls: raster.calls }, cells: { checks: cells.checks.length, calls: cells.calls } }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
