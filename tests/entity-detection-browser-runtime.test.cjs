// Functional driver tests only. No app, server, model weights or inference.
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');
const Module = require('node:module');
async function main() {
  const root = path.resolve(__dirname, '..');
  const output = await build({
    stdin: { contents: "export {testEntityBrowserRuntimeSynthetic,testEntityBrowserAssetsSynthetic} from './tests/entity-detection-browser-runtime.test';", resolveDir: root },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'warning',
    plugins: [{ name: 'installed-runtime-assets-for-synthetic-tests', setup(builder) {
      builder.onResolve({ filter: /\?raw$/ }, args => ({ path: require.resolve(args.path.replace(/\?raw$/, ''), { paths: [root] }), namespace: 'installed-raw' }));
      builder.onLoad({ filter: /.*/, namespace: 'installed-raw' }, args => ({ contents: 'export default ' + JSON.stringify(fs.readFileSync(args.path, 'utf8')), loader: 'js' }));
      builder.onResolve({ filter: /\?url$/ }, args => ({ path: args.path, namespace: 'synthetic-url' }));
      builder.onLoad({ filter: /.*/, namespace: 'synthetic-url' }, () => ({ contents: 'export default "https://synthetic-entity.test/runtime.wasm"', loader: 'js' }));
    } }],
  });
  const testModule = new Module(path.join(root, 'tests/entity-browser-synthetic-memory.cjs'), module);
  testModule.filename = path.join(root, 'tests/entity-browser-synthetic-memory.cjs');
  testModule.paths = Module._nodeModulePaths(root);
  testModule._compile(output.outputFiles[0].text, testModule.filename);
  const results = [];
  for (const name of ['testEntityBrowserRuntimeSynthetic', 'testEntityBrowserAssetsSynthetic']) {
    results.push(...await testModule.exports[name]());
  }
  console.log(JSON.stringify({ ok: true, attribution: 'Synthetic driver and tiny-byte integrity only; no model preparation/import/inference, app or server.', results }, null, 2));
}
main().catch(cause => { console.error(cause.stack || String(cause)); process.exitCode = 1; });
