'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { build } = require('esbuild');

async function main() {
  const bundled = await build({
    stdin: {
      contents: `export { createLocalToolGenesis, createLocalToolReplica, exportLocalToolConvergenceCheckpoint } from '../src/engines/local/convergence/replica';`,
      resolveDir: __dirname,
    },
    alias: { '@': path.resolve(__dirname, '../src') }, bundle: true, write: false, platform: 'node', format: 'cjs',
  });
  const test = new Module(__filename, module);
  test._compile(bundled.outputFiles[0].text, __filename);
  const { createLocalToolGenesis, createLocalToolReplica, exportLocalToolConvergenceCheckpoint } = test.exports;
  const field = 'body';
  const contract = {
    namespace: 'tests.table-header', schemaEpoch: 'one', validationId: 'table-header',
    codec: { version: 2, fields: { body: { kind: 'rich', profile: 'blocks-tree/9', schema: 'writers-blocks/8' } } },
    validateState: value => !!value && typeof value === 'object' && !Array.isArray(value),
  };
  const genesis = createLocalToolGenesis({ body: { type: 'block-doc', schema: 'writers-blocks/8', blocks: [], axisOrder: [] } }, contract);
  const a = createLocalToolReplica(genesis, { authorId: 'A', contract });
  let b;
  const row = (replica, id) => replica.read().body.blocks.find(block => block.id === id);
  const header = (replica, id, value, capture = replica.richBlockEditCapture(field, [id])) =>
    replica.apply([{ type: 'rich-table-row-header', field, capture, header: value }]);
  try {
    a.apply([{ type: 'rich-table-create', field, capture: a.richBlockEditCapture(field, [], { parentId: null, slot: 'body', afterId: null }), table: { id: 'T', rows: [{ id: 'R1', header: true }, { id: 'R2', header: false }], columns: [{ id: 'C' }] } }]);
    b = createLocalToolReplica(a.checkpoint(), { authorId: 'B', contract });
    const cell = b.richTableCellCapture(field, 'T', 'R1', 'C');
    const first = a.richBlockEditCapture(field, ['R1']);
    const before = a.read().body;
    const toggle = header(a, 'R1', false, first);
    assert.ok(toggle.receiptId);
    assert.deepEqual(a.read().body, { ...before, blocks: before.blocks.map(block => block.id === 'R1' ? { ...block, attrs: { header: false } } : block) });
    assert.equal(a.checkpoint().engine.version, genesis.engine.version);
    assert.equal(a.checkpoint().genesisId, genesis.genesisId);
    console.log('PASS header changes only its row attributes in the existing engine');

    const current = a.checkpoint();
    assert.throws(() => header(a, 'R1', true, first), /local_tool_block_edit_invalid/);
    assert.equal(header(a, 'R1', false).receiptId, null);
    assert.deepEqual(a.checkpoint(), current);
    assert.throws(() => header(a, 'T', true), /local_tool_block_edit_invalid/);
    assert.deepEqual(a.checkpoint(), current);
    console.log('PASS stale, wrong-kind and no-op actions preserve the checkpoint');

    b.receive(toggle.update);
    const typed = b.apply([{ type: 'rich-table-cell-insert', field, capture: cell, fragment: { id: 'F', paragraph: { id: 'P', text: 'Otro autor' } } }]);
    a.receive(typed.update);
    const undo = a.undo(toggle.receiptId);
    b.receive(undo.update);
    assert.deepEqual(a.read(), b.read());
    assert.deepEqual(row(b, 'R1').attrs, { header: true });
    assert.equal(row(b, 'P').content[0].text, 'Otro autor');
    const redo = a.redo(undo.receiptId);
    b.receive(redo.update);
    assert.deepEqual(row(b, 'R1').attrs, { header: false });
    assert.equal(row(b, 'P').content[0].text, 'Otro autor');
    console.log('PASS prior cell capture stays valid and Undo preserves another author\'s text');

    a.receive(header(b, 'R2', true).update);
    assert.deepEqual(row(a, 'R1').attrs, { header: false });
    assert.deepEqual(row(a, 'R2').attrs, { header: true });
    assert.equal(exportLocalToolConvergenceCheckpoint(a.checkpoint()).pending, false);
    console.log('PASS SDK selects a row by ID and exports a complete cold view');
  } finally {
    a.destroy();
    b?.destroy();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
