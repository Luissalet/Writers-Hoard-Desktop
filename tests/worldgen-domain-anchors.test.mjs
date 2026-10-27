import test from 'node:test';
import assert from 'node:assert/strict';
import { realmAnchors } from '../src/engines/worldgen/cartography/realmAnchors.ts';

function geography() {
  const realmOf = new Int32Array(8 * 4).fill(-1);
  for (const x of [0, 1, 5, 6, 7]) realmOf[8 + x] = 0;
  return { realmOf, realms: [{}, {}] };
}

test('finite realm labels use the linear centroid; legacy labels keep the wrapped centroid', () => {
  const geo = geography();
  assert.deepEqual(realmAnchors(8, 4, geo), [{ x: 7, y: 1, cells: 5 }, null]);
  assert.deepEqual(realmAnchors(8, 4, geo, false), [{ x: 5, y: 1, cells: 5 }, null]);
});

test('the same geography can switch topology without reusing the other label anchor', () => {
  const geo = geography();
  const finite = realmAnchors(8, 4, geo, false);
  const legacy = realmAnchors(8, 4, geo);
  assert.deepEqual(realmAnchors(8, 4, geo, false), finite);
  assert.deepEqual(realmAnchors(8, 4, geo), legacy);
  assert.notDeepEqual(finite, legacy);
});

test('realm label cache checks the actual rectangular dimensions', () => {
  const geo = geography();
  realmAnchors(8, 4, geo, false);
  assert.deepEqual(realmAnchors(4, 8, geo, false), [{ x: 1, y: 3, cells: 5 }, null]);
});
