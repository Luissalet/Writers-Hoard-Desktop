// ============================================================================
// Genealogy contract tests — Node standard test runner (node --test).
//
// Run: node --experimental-strip-types --test tests/genealogy.test.mjs
//
// The validator under test is a pure TypeScript module with no external
// imports (no path aliases), so Node's type stripping can load it directly.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateGenealogy,
  GENEALOGY_CONTRACT_VERSION,
} from '../src/engines/genealogy/validate.ts';
import {
  encodeGenealogySidecar,
  decodeGenealogySidecar,
  GENEALOGY_SIDECAR_VERSION,
  GenealogySidecarError,
} from '../src/engines/genealogy/sidecar.ts';

// --- Shared fixtures ---------------------------------------------------------

const CHARACTERS = [
  { id: 'A', name: 'Alice' },
  { id: 'B', name: 'Bruno' },
  { id: 'C', name: 'Carla' },
  { id: 'D', name: 'Dario' },
  { id: 'E', name: 'Elena' },
];

// Generic relationships from the existing Relationship engine: preserved
// verbatim, never inferred into genealogy.
const GENERIC_RELATIONSHIPS = [
  { id: 'r1', from: 'A', to: 'B', kind: 'family', label: 'madre' },
  { id: 'r2', from: 'B', to: 'C', kind: 'family', label: 'familia' },
  { id: 'r3', from: 'A', to: 'E', kind: 'alliance', label: 'aliadas', directional: false },
];

// The genealogy proposal under test.
const PROPOSAL = [
  { id: 'f1', from: 'A', to: 'B', kind: 'biological_parent' },
  { id: 'f2', from: 'E', to: 'B', kind: 'adoptive_parent' },
  { id: 'f3', from: 'B', to: 'C', kind: 'biological_parent' },
  { id: 'f4', from: 'C', to: 'A', kind: 'biological_parent' }, // cycle A->B->C->A
  { id: 'f5', from: 'A', to: 'A', kind: 'adoptive_parent' },   // self link
  { id: 'f6', from: 'D', to: 'E', kind: 'partner' },
  { id: 'f7', from: 'E', to: 'C', kind: 'guardian' },
  { id: 'f8', from: 'MISSING', to: 'D', kind: 'biological_parent' }, // missing ref
  { id: 'f9', from: 'D', to: 'C', kind: 'invented_kind' },           // unknown kind
];

function issueCodesFor(result, linkId) {
  const rejected = result.rejected.find((r) => r.link.id === linkId);
  return rejected ? rejected.issues.map((i) => i.code) : [];
}

// --- Core acceptance / rejection ---------------------------------------------

test('contract version is exported and semver-like', () => {
  assert.match(GENEALOGY_CONTRACT_VERSION, /^\d+\.\d+\.\d+$/);
});

test('accepts the valid links and rejects exactly f4, f5, f8, f9', () => {
  const result = validateGenealogy(CHARACTERS, PROPOSAL, GENERIC_RELATIONSHIPS);

  const acceptedIds = result.accepted.map((l) => l.id).sort();
  assert.deepEqual(acceptedIds, ['f1', 'f2', 'f3', 'f6', 'f7']);

  const rejectedIds = result.rejected.map((r) => r.link.id).sort();
  assert.deepEqual(rejectedIds, ['f4', 'f5', 'f8', 'f9']);
});

test('f4 is rejected with ancestry_cycle and the full chain A->B->C->A', () => {
  const result = validateGenealogy(CHARACTERS, PROPOSAL, GENERIC_RELATIONSHIPS);
  const codes = issueCodesFor(result, 'f4');
  assert.ok(codes.includes('ancestry_cycle'));

  const rejected = result.rejected.find((r) => r.link.id === 'f4');
  const cycle = rejected.issues.find((i) => i.code === 'ancestry_cycle');
  // The chain must be the complete ancestry loop through the accepted edges.
  const chain = cycle.chain.join('->');
  assert.ok(
    chain === 'A->B->C->A' || chain === 'B->C->A->B' || chain === 'C->A->B->C',
    `unexpected chain: ${chain}`,
  );
});

test('f5 is rejected with self_link', () => {
  const result = validateGenealogy(CHARACTERS, PROPOSAL, GENERIC_RELATIONSHIPS);
  assert.ok(issueCodesFor(result, 'f5').includes('self_link'));
});

test('f8 is rejected with missing_ref', () => {
  const result = validateGenealogy(CHARACTERS, PROPOSAL, GENERIC_RELATIONSHIPS);
  assert.ok(issueCodesFor(result, 'f8').includes('missing_ref'));
});

test('f9 is rejected with unknown_kind', () => {
  const result = validateGenealogy(CHARACTERS, PROPOSAL, GENERIC_RELATIONSHIPS);
  assert.ok(issueCodesFor(result, 'f9').includes('unknown_kind'));
});

// --- Generic relationships are preserved, never inferred ----------------------

test('generic relationships pass through untouched and never enter the graph', () => {
  const result = validateGenealogy(CHARACTERS, PROPOSAL, GENERIC_RELATIONSHIPS);

  assert.deepEqual(result.relationships, GENERIC_RELATIONSHIPS);
  // 'madre' (r1) is a generic family label: it must NOT create ancestry edges.
  const ancestryIds = result.ancestry.map((e) => e.linkId);
  assert.ok(!ancestryIds.includes('r1'));
  assert.ok(!ancestryIds.includes('r2'));
  assert.ok(!ancestryIds.includes('r3'));
  // Only genealogy links of parent kinds form the ancestry graph.
  assert.deepEqual(ancestryIds.sort(), ['f1', 'f2', 'f3']);
});

// --- Ancestry semantics --------------------------------------------------------

test('biological and adoptive parents allow multiple parents per child', () => {
  // B already has A (biological) and E (adoptive) as parents in PROPOSAL.
  const result = validateGenealogy(CHARACTERS, PROPOSAL, GENERIC_RELATIONSHIPS);
  const parentsOfB = result.ancestry
    .filter((e) => e.child === 'B')
    .map((e) => e.parent)
    .sort();
  assert.deepEqual(parentsOfB, ['A', 'E']);
});

test('mixed adoptive/biological cycle is detected', () => {
  const links = [
    { id: 'm1', from: 'A', to: 'B', kind: 'adoptive_parent' },
    { id: 'm2', from: 'B', to: 'C', kind: 'biological_parent' },
    { id: 'm3', from: 'C', to: 'A', kind: 'adoptive_parent' },
  ];
  const result = validateGenealogy(CHARACTERS, links, []);
  const codes = result.rejected.flatMap((r) => r.issues.map((i) => i.code));
  assert.ok(codes.includes('ancestry_cycle'));
});

test('guardian and partner edges do not create ancestry', () => {
  const links = [
    { id: 'g1', from: 'E', to: 'C', kind: 'guardian' },
    { id: 'g2', from: 'D', to: 'E', kind: 'partner' },
  ];
  const result = validateGenealogy(CHARACTERS, links, []);
  assert.equal(result.ancestry.length, 0);
  assert.equal(result.accepted.length, 2);
});

// --- Purity --------------------------------------------------------------------

test('validation does not mutate its inputs (deep copy)', () => {
  const characters = structuredClone(CHARACTERS);
  const proposal = structuredClone(PROPOSAL);
  const relationships = structuredClone(GENERIC_RELATIONSHIPS);
  const before = JSON.stringify({ characters, proposal, relationships });

  validateGenealogy(characters, proposal, relationships);

  assert.equal(JSON.stringify({ characters, proposal, relationships }), before);
});

test('invalid proposals do not contaminate the rest of the batch', () => {
  const links = [
    { id: 'ok1', from: 'A', to: 'B', kind: 'biological_parent' },
    { id: 'bad1', from: 'A', to: 'A', kind: 'biological_parent' },
    { id: 'ok2', from: 'B', to: 'C', kind: 'biological_parent' },
    { id: 'bad2', from: 'D', to: 'ZZZ', kind: 'partner' },
  ];
  const result = validateGenealogy(CHARACTERS, links, []);
  assert.deepEqual(result.accepted.map((l) => l.id).sort(), ['ok1', 'ok2']);
  assert.deepEqual(result.rejected.map((r) => r.link.id).sort(), ['bad1', 'bad2']);
});

test('duplicate link ids are rejected as duplicate_id', () => {
  const links = [
    { id: 'dup', from: 'A', to: 'B', kind: 'biological_parent' },
    { id: 'dup', from: 'B', to: 'C', kind: 'biological_parent' },
  ];
  const result = validateGenealogy(CHARACTERS, links, []);
  const dupRejections = result.rejected.filter((r) => r.link.id === 'dup');
  assert.equal(dupRejections.length, 2);
  for (const r of dupRejections) {
    assert.ok(r.issues.some((i) => i.code === 'duplicate_id'));
  }
  assert.equal(result.accepted.length, 0);
});

// --- Exchange: sidecar over an intact world/1 document --------------------------

const WORLD_DOC = {
  schema: 'hoard.world/1',
  project: { ref: 'hoard://writer/project/p1', title: 'Demo' },
  characters: [
    { ref: 'hoard://writer/codex/c1', name: 'Alice', summary: 'Protagonist' },
  ],
  relations: [
    { ref: 'hoard://writer/relation/r1', from: 'hoard://writer/codex/c1', to: 'hoard://writer/codex/c2', type: 'family', note: 'madre' },
  ],
  events: [],
};

test('sidecar roundtrip preserves the world/1 document (deep equal, same JSON serialization)', () => {
  const links = [{ id: 'f1', from: 'A', to: 'B', kind: 'biological_parent' }];
  const { worldDoc, sidecar } = encodeGenealogySidecar(WORLD_DOC, links);

  // The world document is returned untouched: same content, same key order.
  assert.deepEqual(worldDoc, WORLD_DOC);
  assert.equal(JSON.stringify(worldDoc), JSON.stringify(WORLD_DOC));
  assert.equal(sidecar.schema, 'hoard.genealogy/1');
  assert.equal(GENEALOGY_SIDECAR_VERSION, 'hoard.genealogy/1');

  const decoded = decodeGenealogySidecar(worldDoc, sidecar);
  assert.deepEqual(decoded.links, links);
});

test('decoding without sidecar support is an explicit rejection, not a silent loss', () => {
  assert.throws(
    () => decodeGenealogySidecar(WORLD_DOC, null),
    (err) => err instanceof GenealogySidecarError && err.code === 'genealogy_unsupported',
  );
});

test('decoding a sidecar with an unsupported schema version is rejected', () => {
  const links = [{ id: 'f1', from: 'A', to: 'B', kind: 'biological_parent' }];
  const { sidecar } = encodeGenealogySidecar(WORLD_DOC, links);
  const future = { ...sidecar, schema: 'hoard.genealogy/2' };

  assert.throws(
    () => decodeGenealogySidecar(WORLD_DOC, future),
    (err) => err instanceof GenealogySidecarError && err.code === 'genealogy_version_unsupported',
  );
});

// --- Sidecar strictness (contract version + link shape) -------------------------

test('sidecar with a foreign contractVersion is rejected as version unsupported', () => {
  const links = [{ id: 'f1', from: 'A', to: 'B', kind: 'biological_parent' }];
  const { sidecar } = encodeGenealogySidecar(WORLD_DOC, links);
  const foreign = { ...sidecar, contractVersion: '99.0.0' };

  assert.throws(
    () => decodeGenealogySidecar(WORLD_DOC, foreign),
    (err) => err instanceof GenealogySidecarError && err.code === 'genealogy_version_unsupported',
  );
});

test('sidecar without contractVersion is rejected as invalid', () => {
  const links = [{ id: 'f1', from: 'A', to: 'B', kind: 'biological_parent' }];
  const { sidecar } = encodeGenealogySidecar(WORLD_DOC, links);
  const missing = { schema: sidecar.schema, links: sidecar.links };

  assert.throws(
    () => decodeGenealogySidecar(WORLD_DOC, missing),
    (err) => err instanceof GenealogySidecarError && err.code === 'genealogy_sidecar_invalid',
  );
});

test('sidecar links with null / number entries are rejected, never coerced', () => {
  const { sidecar } = encodeGenealogySidecar(WORLD_DOC, []);
  const bad = { ...sidecar, links: [null, 123] };

  assert.throws(
    () => decodeGenealogySidecar(WORLD_DOC, bad),
    (err) => err instanceof GenealogySidecarError && err.code === 'genealogy_sidecar_invalid',
  );
});

test('sidecar links with missing or empty fields are rejected', () => {
  const { sidecar } = encodeGenealogySidecar(WORLD_DOC, []);
  const bad = { ...sidecar, links: [{ id: 'f1', from: 'A', to: 'B' }] }; // no kind

  assert.throws(
    () => decodeGenealogySidecar(WORLD_DOC, bad),
    (err) => err instanceof GenealogySidecarError && err.code === 'genealogy_sidecar_invalid',
  );
});

test('encode rejects malformed links too: nothing malformed is ever emitted', () => {
  assert.throws(
    () => encodeGenealogySidecar(WORLD_DOC, [null]),
    (err) => err instanceof GenealogySidecarError && err.code === 'genealogy_sidecar_invalid',
  );
});

test('encoded sidecar carries the implemented contract version', () => {
  const links = [{ id: 'f1', from: 'A', to: 'B', kind: 'biological_parent' }];
  const { sidecar } = encodeGenealogySidecar(WORLD_DOC, links);
  assert.equal(sidecar.contractVersion, GENEALOGY_CONTRACT_VERSION);
});

test('decoding without a world document is rejected as invalid', () => {
  const links = [{ id: 'f1', from: 'A', to: 'B', kind: 'biological_parent' }];
  const { sidecar } = encodeGenealogySidecar(WORLD_DOC, links);
  assert.throws(
    () => decodeGenealogySidecar(null, sidecar),
    (err) => err instanceof GenealogySidecarError && err.code === 'genealogy_sidecar_invalid',
  );
});

// --- Id-space coherence: sidecar ids vs world/1 refs -----------------------------

test('sidecar keeps LOCAL ids; world/1 uses hoard refs — no mapping is claimed', () => {
  const links = [{ id: 'f1', from: 'A', to: 'B', kind: 'biological_parent' }];
  const { worldDoc, sidecar } = encodeGenealogySidecar(WORLD_DOC, links);

  // The sidecar link keeps the local character id.
  assert.equal(sidecar.links[0].from, 'A');
  // The world/1 document references characters as hoard://writer/codex/<id>
  // (see src/services/familyBridge/worldSchema.ts, refCodex): a DIFFERENT id
  // space. Nothing maps one onto the other yet, so end-to-end exchange is
  // NOT proven by this suite; the mapping is declared pending in the contract.
  const relationFrom = worldDoc.relations[0].from;
  assert.equal(relationFrom, 'hoard://writer/codex/c1');
  assert.notEqual(relationFrom, sidecar.links[0].from);
});

// --- invalid_shape: the raw payload is preserved, not coerced ---------------------

test('non-object proposals are rejected as invalid_shape with the raw payload kept', () => {
  const links = [
    null,
    123,
    { id: 'ok1', from: 'A', to: 'B', kind: 'biological_parent' },
  ];
  const result = validateGenealogy(CHARACTERS, links, []);

  assert.deepEqual(result.accepted.map((l) => l.id), ['ok1']);
  assert.equal(result.rejected.length, 2);
  for (const r of result.rejected) {
    assert.ok(r.issues.some((i) => i.code === 'invalid_shape'));
  }
  // The raw payloads survive untouched (deep-copied), so the caller can see
  // exactly what was rejected; they are NOT coerced into GenealogyLink.
  assert.equal(result.rejected[0].link, null);
  assert.equal(result.rejected[1].link, 123);
});
