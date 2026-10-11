// Regression tests for review r4 findings (task #136, round 5):
//  - P1: the v36->v37 upgrade must run when moving INTO v37 (a database
//    already at v36 migrates its rows; idempotent for v37-shaped rows).
//  - P2: undo A after apply B is rejected (revisionAfter check).
//  - P2: the four remaining parsers reserve explicit ids before deriving.
//  - P2: preview aligns derived ids with the valid entries and tolerates
//    null entries in the batch.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { migrateGenealogyLinkV36toV37, genealogyLinkKey, deriveLinkIds } from '../src/engines/genealogy/genealogyStore.ts';
import { importGenealogyNotion } from '../src/engines/genealogy/notionImport.ts';
import { importGenealogyObsidian } from '../src/engines/genealogy/obsidianImport.ts';
import { importGenealogyWorldAnvil } from '../src/engines/genealogy/worldAnvilImport.ts';
import { importGenealogyCampfire } from '../src/engines/genealogy/campfireImport.ts';
import { previewGenealogyImport } from '../src/engines/genealogy/importPreview.ts';
import { applyGenealogy, undoGenealogy } from '../src/engines/genealogy/genealogyOps.ts';

const CHARACTERS = [
  { id: 'A', name: 'Alice' },
  { id: 'B', name: 'Bruno' },
  { id: 'C', name: 'Carla' },
];

// --- P1: migration runs on a database already at v36 ------------------------

test('migrate rewrites a v36 row (bare id, no linkId) into the v37 shape', () => {
  const out = migrateGenealogyLinkV36toV37({ id: 'g1', projectId: 'p1', from: 'a', to: 'b', kind: 'partner' });
  assert.equal(out.id, genealogyLinkKey('p1', 'g1'));
  assert.equal(out.linkId, 'g1');
});

test('migrate is idempotent for a composite id WITHOUT linkId (v37 code ran, upgrade did not)', () => {
  // This is the exact shape codex-docker produced in the live IndexedDB probe:
  // the row kept its old id after the app opened the v37 schema.
  const composite = genealogyLinkKey('p1', 'g1');
  const out = migrateGenealogyLinkV36toV37({ id: composite, projectId: 'p1', from: 'a', to: 'b', kind: 'partner' });
  assert.equal(out.id, composite);
  assert.equal(out.linkId, 'g1');
});

test('migrate leaves an already-complete v37 row untouched', () => {
  const v37 = { id: genealogyLinkKey('p1', 'g1'), linkId: 'g1', projectId: 'p1', from: 'a', to: 'b', kind: 'partner' };
  const out = migrateGenealogyLinkV36toV37(v37);
  assert.equal(out.id, v37.id);
  assert.equal(out.linkId, 'g1');
});

// --- P2: undo A after apply B ----------------------------------------------

test('undo of an earlier application is rejected after a later apply changed the state', () => {
  const first = applyGenealogy(CHARACTERS, [], [
    { from: 'A', to: 'B', kind: 'biological_parent' },
  ], 'apply-1', {}, 'p1');
  const second = applyGenealogy(CHARACTERS, first.links, [
    { from: 'B', to: 'C', kind: 'partner' },
  ], 'apply-2', {}, 'p1');

  // The caller passes the CURRENT (post-B) revision: undo A must still be
  // rejected because A's revisionAfter no longer matches the state.
  assert.throws(
    () => undoGenealogy(second.links, { 'apply-1': first.application }, 'apply-1', second.application.revisionAfter, 'p1'),
    (err) => err.code === 'stale_revision',
  );
});

// --- P2: the four remaining parsers reserve explicit ids before deriving ----

test('notion parser: explicit id later in the batch is reserved before deriving', () => {
  const md = [
    '## Alice (A)',
    '- biological_parent: Bruno (B)',
    '## Bruno (B)',
    '- partner: Carla (C) : : g2',
  ].join('\n');
  const r = importGenealogyNotion(md);
  assert.deepEqual(r.issues, []);
  const ids = r.links.map((l) => l.id).sort();
  assert.deepEqual(ids, ['g1', 'g2']);
});

test('obsidian parser: derived ids skip explicit ids of the same batch', () => {
  const md = [
    '- [[Alice|A]] -> [[Bruno|B]] : biological_parent',
    '- [[Bruno|B]] -> [[Carla|C]] : partner : : g1',
  ].join('\n');
  const r = importGenealogyObsidian(md);
  assert.deepEqual(r.issues, []);
  assert.notEqual(r.links[0].id, 'g1'); // g1 is taken by the explicit id
  assert.equal(r.links[1].id, 'g1');
});

test('worldAnvil parser: derived ids skip explicit ids of the same batch', () => {
  const md = [
    '# Alice (A)',
    '- Parents: Bruno (B)',
    '- Spouses: Carla (C) : : g1',
  ].join('\n');
  const r = importGenealogyWorldAnvil(md);
  assert.deepEqual(r.issues, []);
  assert.notEqual(r.links[0].id, 'g1');
  assert.equal(r.links[1].id, 'g1');
});

test('campfire parser: derived ids skip explicit ids of the same batch', () => {
  const r = importGenealogyCampfire({
    characters: [
      { id: 'A', name: 'Alice' },
      { id: 'B', name: 'Bruno' },
      { id: 'C', name: 'Carla' },
    ],
    relationships: [
      { from: 'A', to: 'B', type: 'parent' },
      { from: 'B', to: 'C', type: 'spouse', id: 'g1' },
    ],
  });
  assert.deepEqual(r.issues, []);
  assert.notEqual(r.links[0].id, 'g1');
  assert.equal(r.links[1].id, 'g1');
});

// --- P2: preview with invalid entries and nulls -----------------------------

test('preview: an invalid entry before a valid id-less one no longer shifts ids', () => {
  const r = previewGenealogyImport({
    incoming: [
      { from: 'A', to: 'B', kind: 'nonsense_kind' }, // invalid: keeps its slot
      { from: 'A', to: 'B', kind: 'biological_parent' }, // valid, no id -> g2
    ],
    existing: [],
  });
  assert.equal(r.additions.length, 1);
  // Review r5 P2-2: ids are derived over the RAW list so preview and apply
  // agree; the invalid entry consumes g1's slot in BOTH paths.
  assert.equal(r.additions[0].id, 'g2');
});

test('preview: a null entry in the batch is reported as invalid, not a crash', () => {
  const r = previewGenealogyImport({
    incoming: [null, { from: 'A', to: 'B', kind: 'biological_parent' }],
    existing: [],
  });
  assert.deepEqual(r.issues, [{ index: 0, reason: 'invalid_link' }]);
  assert.equal(r.additions.length, 1);
  // Review r5 P2-2: the null consumes g1's slot in the raw derivation, so
  // the valid entry gets g2 — the same id apply will assign.
  assert.equal(r.additions[0].id, 'g2');
});

test('deriveLinkIds tolerates null/non-object entries', () => {
  const ids = deriveLinkIds([null, { id: 'x' }, 'nope', {}], new Set());
  assert.deepEqual(ids, ['g1', 'x', 'g2', 'g3']);
});
