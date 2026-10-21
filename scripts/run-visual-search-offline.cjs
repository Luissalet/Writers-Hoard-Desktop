// Real CPU inference, restarted under a worker whose network APIs reject.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..'), cache = process.env.WH_VISUAL_SEARCH_TEST_CACHE, page = process.env.WH_VISUAL_SEARCH_TEST_PAGE;
if (!cache || !page) throw Error('Set the isolated model cache and local page fixture environment variables.');
esbuild.buildSync({ entryPoints: [path.join(root, 'electron/visualSearch/worker.ts'), path.join(root, 'electron/visualSearch/runtime.ts')], outdir: path.join(root, 'dist-electron/visualSearch'), outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', external: ['@huggingface/transformers'] });
const { VisualSearchRuntime } = require('../dist-electron/visualSearch/runtime.cjs');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-visual-offline-')), wrapper = path.join(temporary, 'offline.cjs');
fs.writeFileSync(wrapper, `global.fetch=async()=>{throw Error('offline_network_attempt')};for(const module of ['node:http','node:https']){const api=require(module);api.request=api.get=()=>{throw Error('offline_network_attempt')}};require(${JSON.stringify(path.join(root, 'dist-electron/visualSearch/worker.cjs'))});`);
const map = 'data:image/png;base64,' + fs.readFileSync(path.join(root, '.impeccable/review/maps-depth/continents-wonder-country-cpu.png')).toString('base64');
const book = 'data:image/png;base64,' + fs.readFileSync(page).toString('base64');
async function main() {
  for (const restart of [1, 2]) {
    const runtime = new VisualSearchRuntime(cache, wrapper);
    try {
      assert.equal((await runtime.status()).state, 'ready');
      // Preparation with complete, validated assets also works without network.
      await runtime.prepare();
      const images = [await runtime.image(map), await runtime.image(book)];
      for (const [query, expected] of [['un mapa de montañas y costas', 0], ['una página de un libro con texto', 1], ['a map with mountains and coastlines', 0], ['a page of a book with text', 1]]) {
        const text = await runtime.text(query), scores = images.map(image => image.vector.reduce((sum, value, index) => sum + value * text[index], 0));
        assert(scores[expected] > scores[1 - expected], JSON.stringify({ query, scores }));
        console.log(JSON.stringify({ restart, query, scores }));
      }
      assert.equal((await runtime.status()).state, 'ready', 'Cold inference left readiness in preparing state');
      const file = path.join(cache, 'vectors', images[0].hash + '.json');
      fs.writeFileSync(file, JSON.stringify({ model: images[0].model, vector: [1] }));
      const rebuilt = await runtime.image(map); assert.equal(rebuilt.cached, false); assert.equal(rebuilt.hash, images[0].hash); assert.deepEqual(rebuilt.vector, images[0].vector);
      await assert.rejects(runtime.image('https://example.invalid/private.png'), /data_invalid/);
    } finally { await runtime.close(); }
  }
  console.log('PASS two genuine CPU restarts with fetch/http/https blocked; Spanish/English pixel rankings, ready state, damaged derived cache rebuild, and remote image input refusal');
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
