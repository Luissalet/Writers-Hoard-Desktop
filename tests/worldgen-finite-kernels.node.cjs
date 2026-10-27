const {build} = require('esbuild');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), Module = require('node:module'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
(async () => {
  const built = await build({ absWorkingDir: root, entryPoints: ['tests/worldgen-finite-kernels.ts'], bundle: true, write: false, metafile: true, platform: 'node', format: 'cjs', tsconfig: 'tsconfig.app.json', logLevel: 'error' });
  const inputs = Object.keys(built.metafile.inputs).map(file => ({ file, sha256: sha(path.join(root, file)) }));
  assert(!inputs.some(({file}) => /src\/(?:db\/|services\/aiBridge\/)/.test(file)), 'Numerical regression must not import the database or bridge');
  const compiled = new Module(__filename, module); compiled.filename = __filename; compiled.paths = module.paths;
  compiled._compile(built.outputFiles[0].text, __filename);
  try { for (const check of compiled.exports.runFiniteKernelChecks()) console.log('PASS ' + check); }
  finally { assert(inputs.every(row => row.sha256 === sha(path.join(root, row.file))), 'Kernel inputs changed during execution'); }
  console.log('PASS ' + inputs.length + ' numerical regression inputs remained exact');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
