const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || path.join(root, '_stage/gap-B2/contract'));
fs.mkdirSync(output, { recursive: true });
buildSync({ entryPoints: [path.join(root, 'src/services/aiBridge/manifestFiction.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(output, 'manifest.cjs') });
const { FICTION_TOOLS, FICTION_ANNOTATIONS } = require(path.join(output, 'manifest.cjs'));
const original = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/fiction-original-tools.json'), 'utf8'));
assert.equal(original.tools.length, 19);
for (const tool of original.tools) {
  assert.deepEqual(FICTION_TOOLS.find(item => item.name === tool.name), tool, `Original fiction contract changed: ${tool.name}`);
  assert.deepEqual(FICTION_ANNOTATIONS[tool.name], original.annotations[tool.name], `Original fiction annotations changed: ${tool.name}`);
}
assert.equal(FICTION_TOOLS.length, 24);
assert.equal(FICTION_TOOLS.find(tool => tool.name === 'wh_story_session_list').writes, false);
assert.equal(FICTION_TOOLS.find(tool => tool.name === 'wh_story_session_update').writes, true);
assert.equal(new Set(FICTION_TOOLS.map(tool => tool.name)).size, FICTION_TOOLS.length);
(async () => {
  const { publicFields } = await import('../src/engines/fiction/native/lib/copilot-context.js');
  assert.deepEqual(publicFields({ dm_notes: 'PRIVATE', secrets: 'PRIVATE', hook: 'Opening' }), { hook: 'Opening' });
  console.log('PASS All 19 original fiction schemas, descriptions and annotations remain exact');
  console.log('PASS 3 additive session tools plus 2 controls; unique names and write flags');
  console.log('PASS Session DM notes and secrets excluded from copilot form snapshots');
})().catch(error => { console.error(error); process.exitCode = 1; });
