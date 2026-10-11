import test from 'node:test';
import assert from 'node:assert/strict';
import { importGenealogyObsidian } from '../src/engines/genealogy/obsidianImport.ts';

// ============================================================================
// Obsidian wiki-link importer tests (W6, second importer).
// ============================================================================

test('obsidian: parses [[A]] -> [[B]] : kind into a link', () => {
  const r = importGenealogyObsidian('- [[Alice]] -> [[Bob]] : biological_parent');
  assert.equal(r.links.length, 1);
  assert.deepEqual(r.links[0], { id: 'g1', from: 'Alice', to: 'Bob', kind: 'biological_parent' });
  assert.equal(r.issues.length, 0);
});

test('obsidian: alias form [[display|id]] uses the id and keeps the label', () => {
  const r = importGenealogyObsidian('- [[Alice|a1]] -> [[Bob|b1]] : partner : married 1901');
  assert.deepEqual(r.links[0], { id: 'g1', from: 'a1', to: 'b1', kind: 'partner', label: 'married 1901' });
  assert.equal(r.issues.length, 0);
});

test('obsidian: accepts the unicode arrow and multiple links with derived ids', () => {
  const r = importGenealogyObsidian(
    '- [[Alice]] → [[Bob]] : biological_parent\n- [[Bob]] -> [[Clara]] : partner'
  );
  assert.equal(r.links.length, 2);
  assert.equal(r.links[0].id, 'g1');
  assert.equal(r.links[1].id, 'g2');
  assert.equal(r.issues.length, 0);
});

test('obsidian: unknown kind is a per-line issue, valid lines still import', () => {
  const r = importGenealogyObsidian(
    '- [[Alice]] -> [[Bob]] : sibling\n- [[Bob]] -> [[Clara]] : guardian'
  );
  assert.equal(r.links.length, 1);
  assert.equal(r.links[0].kind, 'guardian');
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].code, 'unknown_kind');
  assert.equal(r.issues[0].line, 1);
});

test('obsidian: line without wiki links is invalid_line with its number', () => {
  const r = importGenealogyObsidian('- Alice -> Bob : partner');
  assert.equal(r.links.length, 0);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].code, 'invalid_line');
  assert.equal(r.issues[0].line, 1);
});

test('obsidian: explicit ids deduplicate', () => {
  const r = importGenealogyObsidian(
    '- [[A]] -> [[B]] : partner : married : x1\n- [[C]] -> [[D]] : partner : married : x1'
  );
  assert.equal(r.links.length, 1);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].code, 'duplicate_id');
});

test('obsidian: non-string input is a single issue, no throw', () => {
  const r = importGenealogyObsidian(null);
  assert.deepEqual(r.links, []);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].code, 'invalid_line');
});

test('obsidian: empty input reports no_links', () => {
  const r = importGenealogyObsidian('');
  assert.deepEqual(r.links, []);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].code, 'no_links');
});
