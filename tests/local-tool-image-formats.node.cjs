'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { build } = require('esbuild');

async function main() {
  const bundle = await build({
    stdin: {
      contents: `export { rasterFixtures } from './local-tool-image-formats.fixture';
export { detectSourceRasterMime } from '../src/services/sourceRasterFormat';
export { assetFileMime, prepareAssetFile, encodeAssetFile, decodeAssetFiles } from '../src/engines/local/assetFileFormat';
export { createLocalToolGenesis, createLocalToolReplica, collectLocalToolCheckpointImages, exportLocalToolConvergenceCheckpoint } from '../src/engines/local/convergence/replica';
export { collectRoomImageAssets } from '../src/engines/local/convergence/imageRefs';
export * as Y from 'yjs';`,
      resolveDir: __dirname,
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    alias: { '@': path.join(__dirname, '..', 'src') },
  });
  const test = new Module(__filename, module);
  test._compile(bundle.outputFiles[0].text, __filename);
  const { rasterFixtures, detectSourceRasterMime, assetFileMime, prepareAssetFile, encodeAssetFile, decodeAssetFiles } = test.exports;
  const project = 'raster-qa';
  for (const { name, mime, sha256, base64 } of rasterFixtures) {
    const bytes = Buffer.from(base64, 'base64');
    assert.equal(detectSourceRasterMime(bytes), mime);
    for (let length = 0; length < bytes.length; length++) {
      assert.equal(detectSourceRasterMime(bytes.subarray(0, length)), undefined, `${name} truncated at ${length}`);
    }
    assert.equal(detectSourceRasterMime(Buffer.concat([bytes, Buffer.from([0])])), undefined);
    const brokenSignature = Buffer.from(bytes);
    brokenSignature[0] = 0;
    assert.equal(detectSourceRasterMime(brokenSignature), undefined);
    assert.equal(assetFileMime('image', name, '', bytes), mime);
    assert.throws(() => assetFileMime('image', name, 'image/png', bytes), /local_asset_image_invalid/);
    const row = await prepareAssetFile(new File([bytes], name, { type: mime }), 'image', project);
    assert.equal(row.mime, mime);
    assert.equal(row.sha256, sha256);
    assert.deepEqual(Buffer.from(await row.blob.arrayBuffer()), bytes);
    const encoded = await encodeAssetFile(row);
    const [decoded] = await decodeAssetFiles([encoded], project);
    assert.equal(decoded.blob.type, mime);
    assert.equal(decoded.sha256, sha256);
    assert.deepEqual(Buffer.from(await decoded.blob.arrayBuffer()), bytes);
    await assert.rejects(decodeAssetFiles([encoded], 'another-project'), /local_asset_file_invalid/);
    await assert.rejects(decodeAssetFiles([{ ...encoded, size: row.size - 1 }], project), /local_asset_file_corrupt/);
    await assert.rejects(decodeAssetFiles([{ ...encoded, sha256: '0'.repeat(64) }], project), /local_asset_file_corrupt/);
  }
  console.log(`Validated ${rasterFixtures.length} raster containers and exact local asset round trips.`);
  testFieldAuthority(test.exports);
}

function testFieldAuthority({ createLocalToolGenesis, createLocalToolReplica, collectLocalToolCheckpointImages, collectRoomImageAssets, exportLocalToolConvergenceCheckpoint, Y }) {
  const contract = {
    namespace: 'tests.raster-authorization', schemaEpoch: 'one', validationId: 'raster',
    codec: { version: 2, fields: {
      body: { kind: 'rich', profile: 'blocks-tree/8', schema: 'writers-blocks/7' },
      png: { kind: 'rich', profile: 'blocks-tree/7', schema: 'writers-blocks/6' },
    } },
    validateState: value => value && typeof value === 'object' && !Array.isArray(value),
  };
  const blockDoc = field => ({ type: 'block-doc', schema: contract.codec.fields[field].schema, blocks: [], axisOrder: [] });
  const genesis = createLocalToolGenesis({ body: blockDoc('body'), png: blockDoc('png') }, contract);
  const replica = createLocalToolReplica(genesis, { authorId: 'raster-qa', contract });
  const asset = { sha256: 'd'.repeat(64), size: 1285, mime: 'image/jpeg' };
  const insert = field => replica.apply([{
    type: 'rich-image-insert', field, asset, id: 'own-raster',
    capture: replica.richBlockEditCapture(field, [], { parentId: null, slot: 'body', afterId: null }),
  }]);
  const forged = new Y.Doc({ gc: false });
  try {
    assert.equal(genesis.engine.version, '11');
    assert.throws(() => insert('png'), /local_tool_image_asset_invalid/);
    assert.deepEqual(replica.checkpoint(), genesis);
    insert('body');
    const checkpoint = replica.checkpoint();
    assert.deepEqual(collectLocalToolCheckpointImages(checkpoint, contract.codec), [asset]);
    assert.deepEqual(collectRoomImageAssets(replica.export()), [asset]);
    Y.applyUpdate(forged, Buffer.from(checkpoint.checkpointBase64, 'base64'));
    forged.getMap('image-raster-fields').set('value', JSON.stringify(['body', 'png']));
    const changed = {
      ...checkpoint,
      checkpointBase64: Buffer.from(Y.encodeStateAsUpdate(forged)).toString('base64'),
      stateVectorBase64: Buffer.from(Y.encodeStateVector(forged)).toString('base64'),
    };
    assert.throws(() => exportLocalToolConvergenceCheckpoint(changed), /local_tool_image_fields_invalid/);
    assert.throws(() => createLocalToolReplica(changed, { authorId: 'raster-forgery', contract }), /local_tool_image_raster_fields_invalid|local_tool_image_fields_invalid/);
    const { checkpointBase64, stateVectorBase64: _vector, ...identity } = changed;
    assert.throws(() => collectRoomImageAssets({ ...identity, format: 'writers-hoard-local-convergence-update/1', updateBase64: checkpointBase64 }), /local_tool_image_fields_invalid/);
    console.log('Validated mixed field authority and rejected a forged raster declaration in all readers.');
  } finally {
    forged.destroy();
    replica.destroy();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
