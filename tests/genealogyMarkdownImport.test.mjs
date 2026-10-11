// ============================================================================
// Genealogy Markdown importer tests — Node standard test runner (node --test).
//
// Run: node --experimental-strip-types --test tests/genealogyMarkdownImport.test.mjs
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { importGenealogyMarkdown } from '../src/engines/genealogy/markdownImport.ts';

const VALID = `# Árbol ForgeTales

## Personajes
- Alice (A)
- Bruno (B)
- Carla (C)

## Relaciones
- A -> B : biological_parent
- B -> C : biological_parent : madre
- A -> C : guardian
`;

test('parses a valid document into a proposal with labels', () => {
  const { links, issues } = importGenealogyMarkdown(VALID);
  assert.deepEqual(issues, []);
  assert.equal(links.length, 3);
  assert.deepEqual(links[0], { id: 'g1', from: 'A', to: 'B', kind: 'biological_parent' });
  assert.equal(links[1].label, 'madre');
  assert.equal(links[2].kind, 'guardian');
});

test('accepts the unicode arrow and explicit link ids', () => {
  const md = '- A → B : partner : pareja : f9';
  const { links, issues } = importGenealogyMarkdown(md);
  assert.deepEqual(issues, []);
  assert.equal(links[0].id, 'f9');
  assert.equal(links[0].label, 'pareja');
});

test('malformed lines are reported with their line number; valid lines survive', () => {
  const md = [
    '- A -> B : biological_parent',
    'not a list item',
    '- B -> C : step_parent',
    '- C -> A : partner',
  ].join('\n');
  const { links, issues } = importGenealogyMarkdown(md);
  assert.equal(links.length, 2);
  assert.equal(issues.length, 2);
  assert.equal(issues[0].code, 'invalid_line');
  assert.equal(issues[0].line, 2);
  assert.equal(issues[1].code, 'unknown_kind');
  assert.equal(issues[1].line, 3);
});

test('duplicate explicit ids are rejected as duplicate_id', () => {
  const md = '- A -> B : partner : : f1\n- B -> A : partner : : f1';
  const { links, issues } = importGenealogyMarkdown(md);
  assert.equal(links.length, 1);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'duplicate_id');
  assert.equal(issues[0].line, 2);
});

test('non-string input is rejected as invalid_line', () => {
  const { links, issues } = importGenealogyMarkdown(null);
  assert.deepEqual(links, []);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'invalid_line');
});

test('empty document reports no_links', () => {
  const { links, issues } = importGenealogyMarkdown('# solo un título\n');
  assert.deepEqual(links, []);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'no_links');
});

test('output feeds validateGenealogy directly (integration shape)', async () => {
  const { importGenealogyMarkdown: imp } = await import('../src/engines/genealogy/markdownImport.ts');
  const { validateGenealogy } = await import('../src/engines/genealogy/validate.ts');
  const { links, issues } = imp(VALID);
  assert.deepEqual(issues, []);
  const result = validateGenealogy(
    [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
    links,
    [],
  );
  assert.equal(result.rejected.length, 0);
  assert.equal(result.accepted.length, 3);
  assert.equal(result.ancestry.length, 2); // guardian does not create ancestry
});
