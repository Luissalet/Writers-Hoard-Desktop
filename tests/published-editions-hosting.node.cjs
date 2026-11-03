const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');

const built = buildSync({
  entryPoints: [path.join(__dirname, 'published-editions-hosting.ts')], bundle: true, platform: 'node',
  format: 'cjs', write: false, logLevel: 'error',
});
const compiled = new Module(__filename, module);
compiled.filename = __filename;
compiled.paths = module.paths;
compiled._compile(built.outputFiles[0].text, __filename);
