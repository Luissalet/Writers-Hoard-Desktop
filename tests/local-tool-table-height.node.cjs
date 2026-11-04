'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { build } = require('esbuild');

async function main() {
  const bundled = await build({
    stdin: {
      contents: "export { createLocalToolGenesis, createLocalToolReplica, exportLocalToolConvergenceCheckpoint } from '../src/engines/local/convergence/replica';",
      resolveDir: __dirname,
    },
    alias: { '@': path.resolve(__dirname, '../src') }, bundle: true, write: false, platform: 'node', format: 'cjs',
  });
  const moduleUnderTest = new Module(__filename, module);
  moduleUnderTest._compile(bundled.outputFiles[0].text, __filename);
  const { createLocalToolGenesis, createLocalToolReplica, exportLocalToolConvergenceCheckpoint } = moduleUnderTest.exports;
  const field = 'body';
  const document = schema => ({ body: { type: 'block-doc', schema, blocks: [], axisOrder: [] } });
  const contractFor = (profile, schema) => ({
    namespace: 'tests.table-height', schemaEpoch: 'one', validationId: 'table-height',
    codec: { version: 2, fields: { body: { kind: 'rich', profile, schema } } },
    validateState: value => !!value && typeof value === 'object' && !Array.isArray(value),
  });
  const contract = contractFor('blocks-tree/10', 'writers-blocks/9');
  const genesis = createLocalToolGenesis(document('writers-blocks/9'), contract);
  const a = createLocalToolReplica(genesis, { authorId: 'A', contract });
  let b, cold, legacy, seeded;
  const block = (replica, id) => replica.read().body.blocks.find(item => item.id === id);
  const height = (replica, id, heightPx, capture = replica.richBlockEditCapture(field, [id])) =>
    replica.apply([{ type: 'rich-table-row-height', field, capture, heightPx }]);
  const create = replica => replica.apply([{
    type: 'rich-table-create', field, capture: replica.richBlockEditCapture(field, [], { parentId: null, slot: 'body', afterId: null }),
    table: { id: 'T', rows: [{ id: 'R1', header: true }, { id: 'R2', header: false }], columns: [{ id: 'C' }] },
  }]);
  try {
    create(a);
    b = createLocalToolReplica(a.checkpoint(), { authorId: 'B', contract });
    const previousCell = b.richTableCellCapture(field, 'T', 'R1', 'C');
    const original = a.richBlockEditCapture(field, ['R1']);
    const before = a.read().body;
    const changed = height(a, 'R1', 79, original);
    assert.ok(changed.receiptId);
    assert.equal(a.checkpoint().engine.version, '13');
    assert.deepEqual(a.read().body, { ...before, blocks: before.blocks.map(item => item.id === 'R1' ? { ...item, attrs: { header: true, heightPx: 79 } } : item) });
    console.log('PASS row height changes only the witnessed row in the opt-in profile');

    const current = a.checkpoint();
    assert.throws(() => height(a, 'R1', 80, original), /local_tool_block_edit_invalid/);
    assert.throws(() => height(a, 'T', 80), /local_tool_block_edit_invalid/);
    for (const invalid of [23, 24.5, '79', undefined]) {
      assert.throws(() => height(a, 'R1', invalid), /local_tool_block_edit_invalid/);
    }
    assert.equal(height(a, 'R1', 79).receiptId, null);
    assert.deepEqual(a.checkpoint(), current);
    console.log('PASS invalid, stale, wrong-kind and no-op requests preserve the checkpoint');

    const headerCapture = b.richBlockEditCapture(field, ['R1']);
    b.receive(changed.update);
    const toggled = b.apply([{ type: 'rich-table-row-header', field, capture: headerCapture, header: false }]);
    const typed = b.apply([{ type: 'rich-table-cell-insert', field, capture: previousCell, fragment: { id: 'F', paragraph: { id: 'P', text: 'Otra autora' } } }]);
    a.receive(toggled.update);
    a.receive(typed.update);
    const undo = a.undo(changed.receiptId);
    b.receive(undo.update);
    assert.deepEqual(a.read(), b.read());
    assert.deepEqual(block(b, 'R1').attrs, { header: false });
    assert.equal(block(b, 'P').content[0].text, 'Otra autora');
    const redo = a.redo(undo.receiptId);
    b.receive(redo.update);
    assert.deepEqual(a.read(), b.read());
    assert.deepEqual(block(b, 'R1').attrs, { header: false, heightPx: 79 });
    assert.deepEqual(block(b, 'R2').attrs, { header: false });
    console.log('PASS header and cell captures survive height, and Undo preserves another author');

    const saved = a.checkpoint();
    assert.equal(exportLocalToolConvergenceCheckpoint(saved).pending, false);
    cold = createLocalToolReplica(saved, { authorId: 'Cold', contract });
    assert.deepEqual(cold.read(), a.read());
    seeded = createLocalToolReplica(createLocalToolGenesis(a.read(), contract), { authorId: 'Seed', contract });
    assert.deepEqual(seeded.read(), a.read());
    const reset = height(cold, 'R1', null);
    assert.ok(reset.receiptId);
    assert.deepEqual(block(cold, 'R1').attrs, { header: false });
    cold.undo(reset.receiptId);
    assert.equal(block(cold, 'R1').attrs.heightPx, 79);
    console.log('PASS cold, semantic copy, automatic height and Undo preserve state');

    const old = contractFor('blocks-tree/9', 'writers-blocks/8');
    legacy = createLocalToolReplica(createLocalToolGenesis(document('writers-blocks/8'), old), { authorId: 'Old', contract: old });
    create(legacy);
    const oldCheckpoint = legacy.checkpoint();
    assert.equal(oldCheckpoint.engine.version, '12');
    assert.throws(() => height(legacy, 'R1', 79), /local_tool_block_edit_invalid/);
    assert.deepEqual(legacy.checkpoint(), oldCheckpoint);
    console.log('PASS the previous profile rejects height without changing its engine or checkpoint');
  } finally {
    a.destroy();
    b?.destroy();
    cold?.destroy();
    legacy?.destroy();
    seeded?.destroy();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
