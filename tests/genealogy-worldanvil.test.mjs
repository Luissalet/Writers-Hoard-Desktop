import test from 'node:test';
import assert from 'node:assert/strict';
import { importGenealogyWorldAnvil } from '../src/engines/genealogy/worldAnvilImport.ts';

// ============================================================================
// World Anvil importer tests (W6, fourth importer).
//
// Accepted shape (World Anvil-style Markdown export): one `# Name (id)`
// heading per person, family field bullets under it:
//
//   # Alice (a1)
//   - Parents: Bob (b1), Clara (c1)
//   - Children: Dora (d1)
//   - Spouses: Elin (e1) : married 1901
//
// Direction follows the field: Parents/Adoptive Parents/Guardians point FROM
// the named person TO the heading person (they are the parents); Children
// point FROM the heading person TO the named one; Spouses/Partners are
// partner links from the heading person. Field-to-kind mapping:
//   Parents -> biological_parent, Adoptive Parents -> adoptive_parent,
//   Guardians -> guardian, Children -> biological_parent,
//   Spouses/Partners -> partner.
// Unknown fields are per-line issues; valid lines still import.
// ============================================================================

test('worldanvil: Parents become biological_parent links pointing to the heading person', () => {
  const r = importGenealogyWorldAnvil('# Alice (a1)\n- Parents: Bob (b1)');
  assert.deepEqual(r.links, [{ id: 'g1', from: 'b1', to: 'a1', kind: 'biological_parent' }]);
  assert.equal(r.issues.length, 0);
});

test('worldanvil: Children become biological_parent links pointing away from the heading person', () => {
  const r = importGenealogyWorldAnvil('# Bob (b1)\n- Children: Dora (d1)');
  assert.deepEqual(r.links, [{ id: 'g1', from: 'b1', to: 'd1', kind: 'biological_parent' }]);
  assert.equal(r.issues.length, 0);
});

test('worldanvil: Adoptive Parents and Guardians map to their kinds with parent direction', () => {
  const r = importGenealogyWorldAnvil(
    '# Alice (a1)\n- Adoptive Parents: Carl (c1)\n- Guardians: Eve (e1)'
  );
  assert.deepEqual(r.links, [
    { id: 'g1', from: 'c1', to: 'a1', kind: 'adoptive_parent' },
    { id: 'g2', from: 'e1', to: 'a1', kind: 'guardian' },
  ]);
  assert.equal(r.issues.length, 0);
});

test('worldanvil: Spouses and Partners map to partner links from the heading person', () => {
  const r = importGenealogyWorldAnvil(
    '# Alice (a1)\n- Spouses: Elin (e1)\n- Partners: Fay (f1)'
  );
  assert.deepEqual(r.links, [
    { id: 'g1', from: 'a1', to: 'e1', kind: 'partner' },
    { id: 'g2', from: 'a1', to: 'f1', kind: 'partner' },
  ]);
  assert.equal(r.issues.length, 0);
});

test('worldanvil: comma-separated names expand to one link each, label after second colon', () => {
  const r = importGenealogyWorldAnvil(
    '# Alice (a1)\n- Parents: Bob (b1), Clara (c1) : wedlock'
  );
  assert.equal(r.links.length, 2);
  assert.deepEqual(r.links[0], { id: 'g1', from: 'b1', to: 'a1', kind: 'biological_parent', label: 'wedlock' });
  assert.deepEqual(r.links[1], { id: 'g2', from: 'c1', to: 'a1', kind: 'biological_parent', label: 'wedlock' });
  assert.equal(r.issues.length, 0);
});

test('worldanvil: name without id uses the name as node id', () => {
  const r = importGenealogyWorldAnvil('# Alice\n- Parents: Bob');
  assert.deepEqual(r.links, [{ id: 'g1', from: 'Bob', to: 'Alice', kind: 'biological_parent' }]);
  assert.equal(r.issues.length, 0);
});

test('worldanvil: unknown field is a per-line issue, valid lines still import', () => {
  const r = importGenealogyWorldAnvil('# Alice (a1)\n- Eye Colour: green\n- Parents: Bob (b1)');
  assert.equal(r.links.length, 1);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].code, 'unknown_kind');
  assert.equal(r.issues[0].line, 2);
});

test('worldanvil: field bullet before any heading is invalid_line with its number', () => {
  const r = importGenealogyWorldAnvil('- Parents: Bob');
  assert.equal(r.links.length, 0);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].code, 'invalid_line');
  assert.equal(r.issues[0].line, 1);
});

test('worldanvil: duplicate link ids are rejected, later occurrences skipped', () => {
  const r = importGenealogyWorldAnvil(
    '# Alice (a1)\n- Parents: Bob (b1) : : g1\n- Children: Dora (d1) : : g1'
  );
  assert.equal(r.links.length, 1);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].code, 'duplicate_id');
});

test('worldanvil: non-string input is a single invalid_line issue', () => {
  const r = importGenealogyWorldAnvil(42);
  assert.deepEqual(r.links, []);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].code, 'invalid_line');
});

test('worldanvil: empty input reports no_links', () => {
  const r = importGenealogyWorldAnvil('');
  assert.deepEqual(r.links, []);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].code, 'no_links');
});
