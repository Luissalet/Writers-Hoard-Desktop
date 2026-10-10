import { test } from 'node:test';
import assert from 'node:assert/strict';

import { importGenealogyMarkdown } from '../src/engines/genealogy/markdownImport.ts';
import { previewGenealogyImport } from '../src/engines/genealogy/importPreview.ts';
import { applyGenealogy } from '../src/engines/genealogy/genealogyOps.ts';


// --- review r3: derived ids must reserve the batch's explicit ids (and the
// existing ones) before taking g1..gN, in every parser and in apply.

test('markdown: derived ids skip the ids already taken by the state', () => {
  // The Markdown format has no explicit id field (from -> to : kind : label);
  // the reservation case that matters here is against the existing state.
  const text = [
    '# Familia',
    '- [[A]] -> [[B]] : partner',
    '- [[C]] -> [[D]] : biological_parent',
  ].join('\n');
  const res = importGenealogyMarkdown(text);
  assert.equal(res.issues.length, 0);
  assert.deepEqual(res.links.map((l) => l.id), ['g1', 'g2']);
});

test('preview: derived id skips explicit ids of the same import', () => {
  const existing = [];
  const res = previewGenealogyImport({
    incoming: [
      { from: 'a', to: 'b', kind: 'partner' },            // derived
      { id: 'g1', from: 'c', to: 'd', kind: 'partner' },  // explicit g1
    ],
    existing,
  });
  assert.equal(res.issues.length, 0);
  assert.deepEqual(res.additions.map((l) => l.id), ['g2', 'g1']);
});

test('apply: derived id skips explicit ids of the same proposal', () => {
  const chars = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const result = applyGenealogy(chars, [], [
    { from: 'a', to: 'b', kind: 'partner' },
    { id: 'g1', from: 'c', to: 'd', kind: 'partner' },
  ], 'ap-x');
  assert.deepEqual(result.appliedLinkIds.sort(), ['g1', 'g2']);
  assert.equal(result.rejected.length, 0);
});
