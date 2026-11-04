'use strict';

const path = require('node:path');
const Module = require('node:module');
const { build } = require('esbuild');

async function main() {
  const root = path.resolve(__dirname, '..');
  const bundled = await build({
    stdin: {
      contents: `export { testBinaryImageRelay } from './local-tool-image-relay.server.node';
export { testSharedImageProfile, testSharedImageBirthUndo } from './local-tool-convergence.image-profile';`,
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
  const { checks, calls } = await test.exports.testBinaryImageRelay();
  console.log(JSON.stringify({ checks: checks.length, calls }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
