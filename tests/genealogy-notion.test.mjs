import test from 'node:test';
import assert from 'node:assert/strict';
import { importGenealogyNotion } from '../src/engines/genealogy/notionImport.ts';

// ============================================================================
// Notion importer tests (W6, third importer).
//
// Accepted shape (Notion-style Markdown export):
//
//   ## Alice (a1)
//   - biological_parent: Bob (b1)
//   - partner: Clara : married 1901
//
// The heading is the source person; the optional `(id)` after the name is the
// node id. Each list item is `kind: target[, target2…]` with kind accepted
// verbatim; a target may carry its own `(id)`. A second `:` is the label.
// ============================================================================

test('notion: heading person + kind bullet becomes a link', () => {
  const r = importGenealogyNotion('## Alice (a1)\n- biological_parent: Bob (b1)');
  assert.equal(r.links.length, 1);
  assert.deepEqual(r.links[0], { id: 'g1', from: 'a1', to: 'b1', kind: 'biological_parent' });
  assert.equal(r.issues.length, 0);
});

test('notion: name without id uses the name as node id', () => {
  const r = importGenealogyNotion('## Alice\n- guardian: Bob');
  assert.deepEqual(r.links[0], { id: 'g1', from: 'Alice', to: 'Bob', kind: 'guardian' });
  assert.equal(r.issues.length, 0);
});

test('notion: comma-separated targets expand to one link each', () => {
  const r = importGenealogyNotion('## Alice (a1)\n- partner: Bob (b1), Clara (c1)');
  assert.equal(r.links.length, 2);
  assert.deepEqual(r.links[0], { id: 'g1', from: 'a1', to: 'b1', kind: 'partner' });
  assert.deepEqual(r.links[1], { id: 'g2', from: 'a1', to: 'c1', kind: 'partner' });
  assert.equal(r.issues.length, 0);
});

test('notion: label after the second colon is kept', () => {
  const r = importGenealogyNotion('## Alice (a1)\n- partner: Bob (b1) : married 1901');
  assert.deepEqual(r.links[0], { id: 'g1', from: 'a1', to: 'b1', kind: 'partner', label: 'married 1901' });
  assert.equal(r.issues.length, 0);
});

test('notion: unknown kind is a per-line issue, valid lines still import', () => {
  const r = importGenealogyNotion('## Alice (a1)\n- sibling: Bob\n- guardian: Clara');
  assert.equal(r.links.length, 1);
  assert.equal(r.links[0].kind, 'guardian');
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].code, 'unknown_kind');
  assert.equal(r.issues[0].line, 2);
});

test('notion: bullet before any heading is invalid_line with its number', () => {
  const r = importGenealogyNotion('- partner: Bob');
  assert.equal(r.links.length, 0);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].code, 'invalid_line');
  assert.equal(r.issues[0].line, 1);
});

test('notion: explicit link ids deduplicate', () => {
  const r = importGenealogyNotion(
    '## Alice (a1)\n- partner: Bob (b1) : married : x1\n- guardian: Clara (c1) : : x1'
  );
  assert.equal(r.links.length, 1);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].code, 'duplicate_id');
});

test('notion: non-string input is a single issue, no throw', () => {
  const r = importGenealogyNotion(42);
  assert.deepEqual(r.links, []);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].code, 'invalid_line');
});

test('notion: empty input reports no_links', () => {
  const r = importGenealogyNotion('');
  assert.deepEqual(r.links, []);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].code, 'no_links');
});
