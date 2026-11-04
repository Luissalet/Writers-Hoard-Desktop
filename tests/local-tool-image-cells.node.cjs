'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const { build } = require('esbuild');

async function main() {
  const bundle = await build({
    stdin: {
      contents: `export { createLocalToolGenesis, createLocalToolReplica, exportLocalToolConvergenceCheckpoint, collectLocalToolCheckpointImages } from '../src/engines/local/convergence/replica';
export { collectRoomImageAssets } from '../src/engines/local/convergence/imageRefs';
export { tableCellAddress } from '../src/engines/local/convergence/tableAxesFormat';`,
      resolveDir: __dirname,
    },
    alias: { '@': path.resolve(__dirname, '../src') }, bundle: true, write: false, platform: 'node', format: 'cjs',
  });
  const test = new Module(__filename, module);
  test._compile(bundle.outputFiles[0].text, __filename);
  const { createLocalToolGenesis, createLocalToolReplica, exportLocalToolConvergenceCheckpoint, collectLocalToolCheckpointImages, collectRoomImageAssets, tableCellAddress } = test.exports;
  const field = 'body', t = 'T', r = 'R', c = 'C', f = 'F', i = 'I';
  const asset = { sha256: 'a'.repeat(64), mime: 'image/jpeg', size: 1285 };
  const replacement = { sha256: 'b'.repeat(64), mime: 'image/webp', size: 98 };
  const contract = {
    namespace: 'tests.table-images', schemaEpoch: 'one', validationId: 'cells',
    codec: { version: 2, fields: { [field]: { kind: 'rich', profile: 'blocks-tree/9', schema: 'writers-blocks/8' } } },
    validateState: data => !!data && typeof data === 'object' && !Array.isArray(data),
  };
  const genesis = createLocalToolGenesis({ [field]: { type: 'block-doc', schema: 'writers-blocks/8', blocks: [], axisOrder: [] } }, contract);
  assert.equal(genesis.engine.version, '12');
  const replicas = [];
  const open = (authorId, checkpoint = genesis) => {
    const replica = createLocalToolReplica(checkpoint, { authorId, contract });
    replicas.push(replica);
    return replica;
  };
  const create = replica => replica.apply([{
    type: 'rich-table-create', field, capture: replica.richBlockEditCapture(field, [], { parentId: null, slot: 'body', afterId: null }),
    table: { id: t, rows: [{ id: r, header: false }, { id: 'unused-row', header: true }], columns: [{ id: c }, { id: 'unused-column' }] },
  }]);
  const capture = replica => replica.richTableCellCapture(field, t, r, c);
  const insert = (replica, at = capture(replica)) => replica.apply([{ type: 'rich-table-cell-image-insert', field, capture: at, fragmentId: f, id: i, asset }]);
  const remove = replica => replica.apply([{ type: 'rich-block-hide', field, capture: replica.richBlockEditCapture(field, [i]) }]);
  const image = replica => replica.read()[field].blocks.find(block => block.id === i);
  const assertImage = (replica, expectedAsset, displaySize) => {
    assert.equal(image(replica)?.parentId, f);
    assert.deepEqual(image(replica).attrs, { asset: expectedAsset, displaySize, alignment: 'left' });
    assert.deepEqual(tableCellAddress(replica.read()[field], i), [t, r, c]);
  };
  try {
    const seed = open('seed');
    create(seed);
    const checkpoint = seed.checkpoint();
    for (const receiveFirst of [false, true]) {
      const a = open('A', checkpoint), b = open('B', checkpoint);
      const born = insert(a);
      assertImage(a, asset, 'medium');
      assert.equal(a.read()[field].blocks.filter(block => block.type === 'paragraph').length, 0);
      b.receive(born.update);
      const edited = b.apply([{ type: 'rich-image-resize', field, capture: b.richImageCapture(field, i, 'size'), displaySize: 'small' }]);
      if (receiveFirst) a.receive(edited.update);
      const reversed = a.undo(born.receiptId);
      if (!receiveFirst) {
        assert.equal(image(a), undefined);
        a.receive(edited.update);
      }
      b.receive(reversed.update);
      assertImage(a, asset, 'small');
      assertImage(b, asset, 'small');
      const lastUndo = b.undo(edited.receiptId);
      a.receive(lastUndo.update);
      assert.equal(image(a), undefined);
      assert.equal(a.read()[field].blocks.some(block => block.id === f), false);
      a.receive(b.redo(lastUndo.receiptId).update);
      assertImage(a, asset, 'small');
      console.log(`PASS foreign edit retains the same image and cell with receiveFirst=${receiveFirst}`);
    }

    const a = open('table-author'), birth = create(a), b = open('image-author', a.checkpoint());
    a.receive(insert(b).update);
    b.receive(a.undo(birth.receiptId).update);
    assertImage(a, asset, 'medium');
    assertImage(b, asset, 'medium');
    assert.deepEqual(a.read()[field].axisOrder, [{ tableId: t, rows: [r], columns: [c] }]);
    console.log('PASS independent table Undo retains only the image dependencies, including its column');

    const hideA = open('hide', checkpoint), textB = open('text', checkpoint);
    textB.receive(insert(hideA).update);
    const hidden = remove(hideA);
    assert.equal(image(hideA), undefined);
    assert.equal(hideA.read()[field].blocks.some(block => block.id === f), true);
    const hiddenPortable = exportLocalToolConvergenceCheckpoint(hideA.checkpoint());
    assert.equal(hiddenPortable.pending, false);
    assert.deepEqual(collectRoomImageAssets(hiddenPortable.update), [asset]);
    const typed = textB.apply([{ type: 'rich-table-cell-insert', field, capture: textB.richTableCellCapture(field, t, r, c, f), fragment: { id: 'FT', paragraph: { id: 'PT', text: 'other author' } } }]);
    hideA.receive(typed.update);
    textB.receive(hidden.update);
    assert.equal(textB.read()[field].blocks.find(block => block.id === 'PT').content[0].text, 'other author');
    assert.deepEqual(tableCellAddress(textB.read()[field], 'PT'), [t, r, c]);
    textB.receive(hideA.undo(hidden.receiptId).update);
    assertImage(textB, asset, 'medium');
    const replaced = textB.apply([{ type: 'rich-image-replace', field, capture: textB.richImageCapture(field, i, 'source'), asset: replacement }]);
    hideA.receive(replaced.update);
    assertImage(hideA, replacement, 'medium');
    const portable = exportLocalToolConvergenceCheckpoint(hideA.checkpoint());
    assert.equal(portable.pending, false);
    const archived = collectLocalToolCheckpointImages(hideA.checkpoint(), contract.codec);
    assert.deepEqual(archived.sort((a, b) => a.sha256.localeCompare(b.sha256)), [asset, replacement]);
    assert.deepEqual(collectRoomImageAssets(portable.update), [asset, replacement]);
    console.log('PASS remove preserves concurrent text, Undo restores the same image, and both assets survive export');

    const stale = open('stale', checkpoint), old = capture(stale);
    stale.apply([{ type: 'rich-table-axis-hide', field, capture: stale.richTableAxisCapture(field, t, 'columns', c) }]);
    const before = stale.checkpoint();
    assert.throws(() => insert(stale, old), /local_tool_table_axes_action_invalid/);
    assert.deepEqual(stale.checkpoint(), before);
    console.log('PASS capture for a withdrawn column rejects without writing');

    const columnA = open('column-hide', checkpoint), imageB = open('column-image', checkpoint);
    imageB.receive(insert(columnA).update);
    const update = imageB.apply([{ type: 'rich-image-resize', field, capture: imageB.richImageCapture(field, i, 'size'), displaySize: 'full' }]);
    const hideColumn = columnA.apply([{ type: 'rich-table-axis-hide', field, capture: columnA.richTableAxisCapture(field, t, 'columns', c) }]);
    imageB.receive(hideColumn.update);
    columnA.receive(update.update);
    assert.equal(image(columnA), undefined);
    assert.equal(image(imageB), undefined);
    imageB.receive(columnA.undo(hideColumn.receiptId).update);
    assertImage(imageB, asset, 'full');
    console.log('PASS explicit column hide wins over a concurrent image edit and Undo restores it');
  } finally {
    replicas.forEach(replica => replica.destroy());
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
