'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { build } = require('esbuild');

async function main() {
  const bundle = await build({
    stdin: {
      contents: "export * from '../src/engines/local/convergence/replica'; export { tableAxesRows } from '../src/engines/local/collaborativeRich/tableAxesLayout';",
      resolveDir: __dirname,
    },
    alias: { '@': path.resolve(__dirname, '../src') }, bundle: true, write: false, platform: 'node', format: 'cjs',
  });
  const moduleUnderTest = new Module(__filename, module);
  moduleUnderTest._compile(bundle.outputFiles[0].text, __filename);
  const { createLocalToolGenesis, createLocalToolReplica, exportLocalToolConvergenceCheckpoint, tableAxesRows } = moduleUnderTest.exports;
  const field = 'body', table = 'T';
  const text = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
  const cell = (header, ...runs) => ({ header, paragraphs: runs.length ? [runs] : [] });
  const contractFor = (profile, schema) => ({
    namespace: 'tests.table-paste', schemaEpoch: 'one', validationId: 'table-paste',
    codec: { version: 2, fields: { body: { kind: 'rich', profile, schema } } },
    validateState: value => !!value && typeof value === 'object' && !Array.isArray(value),
  });
  const empty = schema => ({ body: { type: 'block-doc', schema, blocks: [], axisOrder: [] } });
  const contract = contractFor('blocks-tree/11', 'writers-blocks/10');
  const a = createLocalToolReplica(createLocalToolGenesis(empty('writers-blocks/10'), contract), { authorId: 'A', contract });
  let b, cold, legacy, sameCellA, sameCellB;
  const grid = replica => tableAxesRows(replica.read().body, table).map(({ cells }) => cells.map(item => ({
    header: item.header, paragraphs: item.children.map(child => child.content),
  })));
  const create = replica => replica.apply([{
    type: 'rich-table-create', field, capture: replica.richBlockEditCapture(field, [], { parentId: null, slot: 'body', afterId: null }),
    table: { id: table, rows: ['R1', 'R2', 'R3'].map((id, i) => ({ id, header: i === 0 })), columns: ['C1', 'C2', 'C3'].map(id => ({ id })) },
  }]);
  const action = (replica, anchor, matrix, head) => {
    const { rows, columns } = replica.read().body.axisOrder[0];
    return { type: 'rich-table-paste', field, capture: replica.richBlockEditCapture(field, [table]), target: { rows, columns, anchor, ...(head ? { head } : {}) }, matrix };
  };
  try {
    create(a);
    const baseline = a.read();
    const mixed = [[cell(true, text('Mapa Ω', [{ type: 'bold' }]), text(' β🙂')), cell(false), cell(true)]];
    const first = a.apply([action(a, ['R2', 'C1'], mixed)]);
    assert.ok(first.receiptId);
    assert.equal(a.checkpoint().engine.version, '14');
    assert.deepEqual(grid(a)[1], mixed[0]);
    assert.deepEqual(a.read().body.axisOrder, baseline.body.axisOrder);
    console.log('PASS paste keeps mixed cell types, empty headers, Unicode and mixed marks');

    const saved = a.checkpoint();
    assert.equal(exportLocalToolConvergenceCheckpoint(saved).pending, false);
    cold = createLocalToolReplica(saved, { authorId: 'Cold', contract });
    assert.deepEqual(cold.read(), a.read());
    console.log('PASS mixed headers survive a complete cold checkpoint');

    const stale = action(a, ['R2', 'C1'], [[cell(false, text('Obsoleto'))]]);
    const leaf = a.read().body.blocks.find(block => block.content?.some(run => run.text === 'Mapa Ω'));
    const edit = a.apply([{ type: 'rich-text-splice', field, nodeId: leaf.id, range: a.richRange(field, leaf.id, 0, 0), text: 'Nuevo ' }]);
    assert.ok(edit.receiptId);
    const afterEdit = a.checkpoint();
    assert.throws(() => a.apply([stale]), /local_tool_table_paste_stale/);
    assert.throws(() => a.apply([action(a, ['R2', 'C1'], [[cell(true)], []])]), /local_tool_table_paste_invalid/);
    assert.deepEqual(a.checkpoint(), afterEdit);
    console.log('PASS stale target and malformed matrix reject before mutating');

    const tile = [[cell(true, text('Alfa')), cell(false, text('Beta'))]];
    const tiled = a.apply([action(a, ['R3', 'C3'], tile, ['R2', 'C1'])]);
    assert.ok(tiled.receiptId);
    assert.deepEqual(grid(a).slice(1), [[...tile[0], tile[0][0]], [...tile[0], tile[0][0]]]);
    const beforeGrowth = a.read();
    const square = [[cell(true, text('a')), cell(false, text('b'))], [cell(false, text('c')), cell(true, text('d'))]];
    const growth = a.apply([action(a, ['R3', 'C3'], square)]);
    assert.ok(growth.receiptId);
    assert.deepEqual(grid(a).map(row => row.length), [4, 4, 4, 4]);
    assert.deepEqual(grid(a).slice(2).map(row => row.slice(2)), square);
    const undo = a.undo(growth.receiptId);
    assert.deepEqual(a.read(), beforeGrowth);
    a.redo(undo.receiptId);
    assert.deepEqual(grid(a).slice(2).map(row => row.slice(2)), square);
    console.log('PASS rectangular selection tiles and caret growth is one Undo step');

    b = createLocalToolReplica(a.checkpoint(), { authorId: 'B', contract });
    const aEdit = a.apply([action(a, ['R1', 'C1'], [[cell(false, text('Autor A'))]])]);
    const bEdit = b.apply([action(b, ['R1', 'C2'], [[cell(false, text('Autor B'))]])]);
    a.receive(bEdit.update); b.receive(aEdit.update);
    const undoA = a.undo(aEdit.receiptId); b.receive(undoA.update);
    assert.deepEqual(a.read(), b.read());
    assert.deepEqual(grid(b)[0].slice(0, 2), [cell(true), cell(false, text('Autor B'))]);
    console.log('PASS Undo preserves another author\'s independent content and header');

    const mixedBeforeHeader = b.read();
    const header = b.apply([{ type: 'rich-table-row-header', field, capture: b.richBlockEditCapture(field, ['R1']), header: true }]);
    assert.ok(header.receiptId);
    assert.equal(grid(b)[0].every(cell => cell.header), true);
    b.undo(header.receiptId);
    assert.deepEqual(b.read(), mixedBeforeHeader);
    const hide = b.apply([{ type: 'rich-table-axis-hide', field, capture: b.richTableAxisCapture(field, table, 'columns', 'C2') }]);
    assert.equal(grid(b)[0].length, 3);
    b.undo(hide.receiptId);
    assert.deepEqual(b.read(), mixedBeforeHeader);
    console.log('PASS row header and axis controls compose with per-cell presentation');

    const overlap = b.checkpoint();
    sameCellA = createLocalToolReplica(overlap, { authorId: 'Same cell A', contract });
    sameCellB = createLocalToolReplica(overlap, { authorId: 'Same cell B', contract });
    const firstOverlap = sameCellA.apply([action(sameCellA, ['R1', 'C3'], [[cell(false, text('Uno'))]])]);
    const secondOverlap = sameCellB.apply([action(sameCellB, ['R1', 'C3'], [[cell(false, text('Dos'))]])]);
    sameCellA.receive(secondOverlap.update); sameCellB.receive(firstOverlap.update);
    assert.deepEqual(sameCellA.read(), sameCellB.read());
    assert.equal(grid(sameCellA)[0][2].header, false);
    assert.deepEqual(grid(sameCellA)[0][2].paragraphs.flat().map(run => run.text).sort(), ['Dos', 'Uno']);
    sameCellB.receive(sameCellA.undo(firstOverlap.receiptId).update);
    assert.deepEqual(sameCellA.read(), sameCellB.read());
    assert.deepEqual(grid(sameCellB)[0][2], cell(false, text('Dos')));
    console.log('PASS concurrent pastes into one cell converge and can be undone independently');

    const previous = contractFor('blocks-tree/10', 'writers-blocks/9');
    legacy = createLocalToolReplica(createLocalToolGenesis(empty('writers-blocks/9'), previous), { authorId: 'Old', contract: previous });
    create(legacy);
    const oldCheckpoint = legacy.checkpoint();
    assert.equal(oldCheckpoint.engine.version, '13');
    assert.throws(() => legacy.apply([action(legacy, ['R2', 'C1'], mixed)]), /local_tool_table_paste_invalid/);
    assert.deepEqual(legacy.checkpoint(), oldCheckpoint);
    console.log('PASS previous profile remains strict and opens unchanged');
  } finally {
    a.destroy();b?.destroy();cold?.destroy();legacy?.destroy();sameCellA?.destroy();sameCellB?.destroy();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
