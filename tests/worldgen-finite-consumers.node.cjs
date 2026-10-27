// Actual finite realm/road/travel consumers on controlled own terrain.
// No application, database, Worker, Browser or Native transport claim.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const Module = require('node:module'), esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sha = file => hash(fs.readFileSync(file));
const cases = [
  ['human', '2bd65e06315331b84fdaf592903861991397dce24e9bf50de649399f795290ae'],
  ['travel', 'cd844886c4d2edff8e2bf8928c7ad6d1ae3c9125af99a7764650646266ff6a66'],
  ['water', '3289842774a81fa34f0e6acadba6758c3fdec8d5b4095b04cedb76d67612b98c'],
];
const own = [__filename, ...cases.map(([name]) => path.join(__dirname, `worldgen-finite-consumers.${name}.ts`)), ...['package.json', 'package-lock.json', 'tsconfig.app.json'].map(file => path.join(root, file))];
const snapshot = files => files.map(file => ({ path: path.relative(root, file).replaceAll('\\', '/'), sha256: sha(file) }));
(async () => {
  const ownBefore = snapshot(own), results = [];
  for (const [name, historicalSHA] of cases) {
    let files, before, sourceStable = false, result, error;
    const entry = path.join(__dirname, `worldgen-finite-consumers.${name}.ts`);
    const body = fs.readFileSync(entry, 'utf8');
    const originalBodySHA = hash(body.replaceAll('../src', '../../src'));
    try {
      if (originalBodySHA !== historicalSHA) throw Error('Historical oracle differs beyond import rebase');
      const build = await esbuild.build({ absWorkingDir: root, entryPoints: [entry], bundle: true, write: false, metafile: true, platform: 'node', format: 'cjs', tsconfig: path.join(root, 'tsconfig.app.json'), logLevel: 'silent' });
      files = [...new Set([...Object.keys(build.metafile.inputs).map(file => path.join(root, file)), ...own])].sort();
      before = snapshot(files);
      const m = new Module(entry, module); m.filename = entry; m.paths = module.paths;
      m._compile(build.outputFiles[0].text, entry);
      result = await m.exports.run();
    } catch (e) { error = e.stack || String(e); }
    const after = files ? snapshot(files) : undefined;
    sourceStable = !!before && JSON.stringify(before) === JSON.stringify(after);
    results.push({ name, passed: !error && result?.passed === true && sourceStable, failures: result?.failures ?? [], error, bodySHA: sha(entry), originalBodySHA, historicalSHA, importRebaseOnly: originalBodySHA === historicalSHA, inputs: before?.length ?? 0, inputManifestSHA: before ? hash(JSON.stringify(before)) : null, sourceStable });
  }
  const ownAfter = snapshot(own), ownStable = JSON.stringify(ownBefore) === JSON.stringify(ownAfter);
  const passed = ownStable && results.every(result => result.passed);
  console.log(JSON.stringify({ suite: 'worldgen-finite-consumers', passed, ownStable, ownBefore, ownAfter, results }));
  process.exitCode = passed ? 0 : 1;
})().catch(error => { console.error(error.stack || String(error)); process.exitCode = 1; });
