import test from 'node:test';
import assert from 'node:assert/strict';
import { importGenealogyCampfire } from '../src/engines/genealogy/campfireImport.ts';

// ============================================================================
// Campfire importer tests (W6, fifth importer).
//
// Accepted shape (Campfire-style JSON export):
//
//   {
//     "characters": [{ "name": "Alice", "id": "a1" }],
//     "relationships": [
//       { "from": "a1", "to": "b1", "type": "parent", "label": "..." }
//     ]
//   }
//
// `from`/`to` are character ids; `type` maps to the contract kinds:
//   parent -> biological_parent, adoptive -> adoptive_parent,
//   guardian -> guardian, partner/spouse -> partner.
// Unknown types, missing ids and non-object entries are per-item issues.
// Derived link ids (`g1`, `g2`, …) unless explicit; duplicate ids rejected;
// pure function with no I/O.
// ============================================================================

test('campfire: parent relationship maps to biological_parent', () => {
  const r = importGenealogyCampfire({
    characters: [{ name: 'Bob', id: 'b1' }],
    relationships: [{ from: 'a1', to: 'b1', type: 'parent' }],
  });
  assert.equal(r.links.length, 1);
  assert.deepEqual(r.links[0], { id: 'g1', from: 'a1', to: 'b1', kind: 'biological_parent' });
  assert.equal(r.issues.length, 0);
});

test('campfire: adoptive, guardian, partner and spouse types map to their kinds', () => {
  const r = importGenealogyCampfire({
    relationships: [
      { from: 'a1', to: 'b1', type: 'adoptive' },
      { from: 'a1', to: 'c1', type: 'guardian' },
      { from: 'a1', to: 'd1', type: 'partner' },
      { from: 'a1', to: 'e1', type: 'spouse' },
    ],
  });
  assert.deepEqual(r.links.map((l) => l.kind), [
    'adoptive_parent',
    'guardian',
    'partner',
    'partner',
  ]);
  assert.equal(r.issues.length, 0);
});

test('campfire: label is kept', () => {
  const r = importGenealogyCampfire({
    relationships: [{ from: 'a1', to: 'b1', type: 'spouse', label: 'married 1901' }],
  });
  assert.equal(r.links[0].label, 'married 1901');
  assert.equal(r.issues.length, 0);
});

test('campfire: unknown type is a per-item issue, other items still import', () => {
  const r = importGenealogyCampfire({
    relationships: [
      { from: 'a1', to: 'b1', type: 'parent' },
      { from: 'a1', to: 'c1', type: 'nemesis' },
    ],
  });
  assert.equal(r.links.length, 1);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].code, 'unknown_kind');
  assert.match(r.issues[0].detail, /nemesis/);
});

test('campfire: missing from or to id is a per-item issue', () => {
  const r = importGenealogyCampfire({
    relationships: [
      { to: 'b1', type: 'parent' },
      { from: 'a1', type: 'parent' },
      { from: 'a1', to: 'b1', type: 'parent' },
    ],
  });
  assert.equal(r.links.length, 1);
  assert.equal(r.issues.length, 2);
  assert.ok(r.issues.every((i) => i.code === 'invalid_line'));
});

test('campfire: non-object relationship entries are per-item issues', () => {
  const r = importGenealogyCampfire({
    relationships: ['parent', null, { from: 'a1', to: 'b1', type: 'parent' }],
  });
  assert.equal(r.links.length, 1);
  assert.equal(r.issues.length, 2);
  assert.ok(r.issues.every((i) => i.code === 'invalid_line'));
});

test('campfire: explicit link ids are honoured; duplicates are rejected', () => {
  const r = importGenealogyCampfire({
    relationships: [
      { from: 'a1', to: 'b1', type: 'parent', id: 'x9' },
      { from: 'a1', to: 'c1', type: 'parent', id: 'x9' },
      { from: 'a1', to: 'd1', type: 'parent' },
    ],
  });
  assert.deepEqual(r.links.map((l) => l.id), ['x9', 'g2']);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].code, 'duplicate_id');
});

test('campfire: empty relationships yield a no_links issue', () => {
  const r = importGenealogyCampfire({ characters: [], relationships: [] });
  assert.equal(r.links.length, 0);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].code, 'no_links');
});

test('campfire: non-object input is rejected with one issue', () => {
  const r = importGenealogyCampfire('not json');
  assert.equal(r.links.length, 0);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].code, 'invalid_line');
});

test('campfire: relationships missing entirely is treated as empty (no_links)', () => {
  const r = importGenealogyCampfire({ characters: [{ name: 'Alice', id: 'a1' }] });
  assert.equal(r.links.length, 0);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].code, 'no_links');
});

test('campfire: characters are not required to import links (ids are free)', () => {
  const r = importGenealogyCampfire({
    relationships: [{ from: 'x', to: 'y', type: 'parent' }],
  });
  assert.deepEqual(r.links[0], { id: 'g1', from: 'x', to: 'y', kind: 'biological_parent' });
  assert.equal(r.issues.length, 0);
});

test('campfire: input is not mutated', () => {
  const input = {
    relationships: [{ from: 'a1', to: 'b1', type: 'parent', label: 'l' }],
  };
  const snapshot = JSON.stringify(input);
  importGenealogyCampfire(input);
  assert.equal(JSON.stringify(input), snapshot);
});
