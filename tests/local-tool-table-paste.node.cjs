'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { build } = require('esbuild');

async function main() {
  const bundle = await build({
    stdin: {
      contents: "export * from '../src/engines/local/convergence/replica'; export { tableAxesRows } from '../src/engines/local/collaborativeRich/tableAxesLayout'; export { richBlockChildren } from '../src/engines/local/convergence/blockEditing';",
      resolveDir: __dirname,
    },
    alias: { '@': path.resolve(__dirname, '../src') }, bundle: true, write: false, platform: 'node', format: 'cjs',
  });
  const moduleUnderTest = new Module(__filename, module);
  moduleUnderTest._compile(bundle.outputFiles[0].text, __filename);
  const { createLocalToolGenesis, createLocalToolReplica, exportLocalToolConvergenceCheckpoint, tableAxesRows, richBlockChildren } = moduleUnderTest.exports;
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
  let b, cold, legacy, sameCellA, sameCellB, spans, spanPeer, spanCold;
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

    const beforeImage = a.read(),asset = { sha256: 'e'.repeat(64), mime: 'image/webp', size: 244 };
    const mixedImage = { header: false, paragraphs: [[text('Antes')], [text('Después')]], images: [{ asset, afterParagraph: 0, displaySize: 'small', alignment: 'right' }] };
    const pastedImage = a.apply([action(a, ['R2', 'C1'], [[mixedImage]])]);
    const children = tableAxesRows(a.read().body, table)[1].cells[0].children;
    assert.deepEqual(children.map(child => child.type), ['paragraph', 'image', 'paragraph']);
    assert.deepEqual(children[1].attrs, { asset, displaySize: 'small', alignment: 'right' });
    const afterImage = a.read(),removeImage = a.undo(pastedImage.receiptId);
    assert.deepEqual(a.read(), beforeImage);
    a.redo(removeImage.receiptId);
    assert.deepEqual(a.read(), afterImage);
    const malformedImage = { ...mixedImage, images: [{ ...mixedImage.images[0], afterParagraph: 2 }] };
    const beforeMalformed = a.checkpoint();
    assert.throws(() => a.apply([action(a, ['R2', 'C1'], [[malformedImage]])]), /local_tool_table_paste_invalid/);
    assert.deepEqual(a.checkpoint(), beforeMalformed);
    console.log('PASS pasted images preserve ordered paragraphs and exact Undo and Redo');

    const previous = contractFor('blocks-tree/10', 'writers-blocks/9');
    legacy = createLocalToolReplica(createLocalToolGenesis(empty('writers-blocks/9'), previous), { authorId: 'Old', contract: previous });
    create(legacy);
    const oldCheckpoint = legacy.checkpoint();
    assert.equal(oldCheckpoint.engine.version, '13');
    assert.throws(() => legacy.apply([action(legacy, ['R2', 'C1'], mixed)]), /local_tool_table_paste_invalid/);
    assert.deepEqual(legacy.checkpoint(), oldCheckpoint);
    console.log('PASS previous profile remains strict and opens unchanged');

    const spanContract = contractFor('blocks-tree/12', 'writers-blocks/11');
    spans = createLocalToolReplica(createLocalToolGenesis(empty('writers-blocks/11'), spanContract), { authorId: 'Spans', contract: spanContract });
    create(spans);
    const merge = { ...cell(false, text('Combinada')), span: { rows: 2, columns: 2 } };
    const combined = [[merge, null, cell(false, text('Derecha 1'))], [null, null, cell(false, text('Derecha 2'))]];
    const pasteCombined = replica => action(replica, ['R2', 'C1'], combined, ['R3', 'C3']);
    const before = spans.checkpoint(), initialAxes = spans.read().body.axisOrder, before14 = a.checkpoint();
    assert.throws(() => a.apply([pasteCombined(a)]), /local_tool_table_paste_invalid/);
    assert.deepEqual(a.checkpoint(), before14);
    for (const malformed of [
      action(spans, ['R2', 'C1'], combined),
      action(spans, ['R2', 'C1'], [[merge, null, null], [null, cell(false), cell(false)]], ['R3', 'C3']),
    ]) assert.throws(() => spans.apply([malformed]), /local_tool_table_paste_invalid/);
    assert.deepEqual(spans.checkpoint(), before);
    assert.equal(before.engine.version, '15');
    spanPeer = createLocalToolReplica(before, { authorId: 'Span peer', contract: spanContract });
    const merged = spans.apply([pasteCombined(spans)]);
    const separate = spanPeer.apply([action(spanPeer, ['R1', 'C1'], [[cell(true, text('Cambio ajeno'))]])]);
    spanPeer.receive(merged.update);
    spans.receive(separate.update);
    const physical = replica => tableAxesRows(replica.read().body, table).map(({ cells }) => cells.filter(cell => !cell.covered).map(cell => [
      cell.rowSpan, cell.colSpan, cell.children.flatMap(child => child.content ?? []).map(run => run.text).join(''),
    ]));
    assert.deepEqual(physical(spans), [
      [[1, 1, 'Cambio ajeno'], [1, 1, ''], [1, 1, '']],
      [[2, 2, 'Combinada'], [1, 1, 'Derecha 1']],
      [[1, 1, 'Derecha 2']],
    ]);
    assert.deepEqual(spanPeer.read(), spans.read());
    assert.deepEqual(spans.read().body.axisOrder, initialAxes);
    const revert = spans.undo(merged.receiptId);
    spanPeer.receive(revert.update);
    assert.deepEqual(physical(spanPeer).map(row => row.length), [3, 3, 3]);
    assert.equal(physical(spanPeer)[0][0][2], 'Cambio ajeno');
    spanPeer.receive(spans.redo(revert.receiptId).update);
    assert.deepEqual(spanPeer.read(), spans.read());
    const coldCut = spans.checkpoint();
    assert.equal(exportLocalToolConvergenceCheckpoint(coldCut).pending, false);
    spanCold = createLocalToolReplica(coldCut, { authorId: 'Span cold', contract: spanContract });
    assert.deepEqual(physical(spanCold), physical(spans));
    console.log('PASS merged geometry, overlap guards, independent Undo and cold relay');

    const remove = spans.apply([action(spans, ['R2', 'C1'], [[cell(false, text('Separada'))]], ['R2', 'C1'])]);
    assert.deepEqual(physical(spans)[1], [[1, 1, 'Separada'], [1, 1, 'Separada'], [1, 1, 'Derecha 1']]);
    spans.undo(remove.receiptId);
    assert.deepEqual(physical(spans), physical(spanCold));
    const hideAxis = spans.apply([{ type: 'rich-table-axis-hide', field, capture: spans.richTableAxisCapture(field, table, 'columns', 'C2') }]);
    assert.deepEqual(physical(spans)[1], [[2, 1, 'Combinada'], [1, 1, 'Derecha 1']]);
    spans.undo(hideAxis.receiptId);
    assert.deepEqual(physical(spans), physical(spanCold));
    console.log('PASS spans can be replaced and shrink with hidden axes, both reversible');

    const stable = physical(spans);
    for (const [anchor,head,dimensions,expectedRows] of [
      [['R2', 'C3'], ['R3', 'C3'], [2, 1], [3, 2, 0]],
      [['R1', 'C2'], ['R1', 'C3'], [1, 2], [2, 2, 1]],
      [['R1', 'C3'], ['R1', 'C3'], [1, 1], [3, 2, 1]],
    ]) {
      const clipped = spans.apply([action(spans, anchor, combined, head)]);
      const shape = physical(spans);
      const item = shape[Number(anchor[0][1])-1].find(cell => cell[2]==='Combinada' && cell[0]===dimensions[0] && cell[1]===dimensions[1]);
      assert.ok(item);
      assert.deepEqual(shape.map(row=>row.length),expectedRows);
      assert.equal(shape[0][0][2],'Cambio ajeno');
      spans.undo(clipped.receiptId);
      assert.deepEqual(physical(spans),stable);
    }
    const tiledMerge = [[merge,null],[null,null]];
    const clippedTiles = spans.apply([action(spans, ['R1','C1'], tiledMerge, ['R3','C3'])]);
    assert.deepEqual(physical(spans),[
      [[2,2,'Combinada'],[2,1,'Combinada']],
      [],
      [[1,2,'Combinada'],[1,1,'Combinada']],
    ]);
    spans.undo(clippedTiles.receiptId);
    assert.deepEqual(physical(spans),stable);
    console.log('PASS merged paste clips either axis and repeats clipped edge tiles without changing outside cells');

    const root = afterId => ({ parentId: null, slot: 'body', afterId });
    spans.apply([{
      type: 'rich-block-insert', field, capture: spans.richBlockEditCapture(field, [], root(null)),
      block: { id: 'P-Caret', type: 'paragraph', attrs: {} }, text: 'Antes Ω🙂', marks: ['bold'],
    }]);
    const newTable = (replica, afterId) => ({
      type: 'rich-table-create', field, capture: replica.richBlockEditCapture(field, [], root(afterId)),
      table: { id: 'T-Caret', rows: ['R4','R5'].map(id => ({id,header:false})), columns: ['C4','C5','C6'].map(id => ({id})) },
      matrix: combined,
    });
    const beforeCaret = spans.read(), caretCheckpoint = spans.checkpoint(), strict14 = a.checkpoint();
    const split = { type: 'rich-block-split', field, capture: spans.richBlockSplitCapture(field, 'P-Caret', 3), newNodeId: 'P-Right' };
    assert.throws(() => a.apply([newTable(a, null)]), /local_tool_table_axes_action_invalid/);
    assert.deepEqual(a.checkpoint(), strict14);
    assert.throws(() => spans.apply([split, {...newTable(spans, 'P-Caret'), matrix: [[merge]]}]), /local_tool_table_axes_action_invalid/);
    assert.deepEqual(spans.checkpoint(), caretCheckpoint);
    const standalone = spans.apply([split,newTable(spans, 'P-Caret')]);
    assert.ok(standalone.receiptId);
    const visible = richBlockChildren(spans.read().body, null);
    assert.deepEqual(visible.map(block => block.id), ['P-Caret','T-Caret','P-Right','T']);
    assert.deepEqual(visible[0].content, [text('Ant',[{type:'bold'}])]);
    assert.deepEqual(visible[2].content, [text('es Ω🙂',[{type:'bold'}])]);
    const pasted = tableAxesRows(spans.read().body, 'T-Caret');
    assert.deepEqual(pasted.map(({cells})=>cells.filter(cell=>!cell.covered).map(cell=>[cell.rowSpan,cell.colSpan])), [[[2,2],[1,1]],[[1,1]]]);
    assert.deepEqual(physical(spans), stable);
    const standaloneState = spans.read(), revertStandalone = spans.undo(standalone.receiptId);
    assert.deepEqual(spans.read(),beforeCaret);
    const redoStandalone = spans.redo(revertStandalone.receiptId);
    assert.deepEqual(spans.read(),standaloneState);
    assert.equal(exportLocalToolConvergenceCheckpoint(spans.checkpoint()).pending,false);
    assert.ok(redoStandalone.receiptId);
    console.log('PASS a populated table and paragraph split share one atomic, reversible receipt');
  } finally {
    a.destroy();b?.destroy();cold?.destroy();legacy?.destroy();sameCellA?.destroy();sameCellB?.destroy();spans?.destroy();spanPeer?.destroy();spanCold?.destroy();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
