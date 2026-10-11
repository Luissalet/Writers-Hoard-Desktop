// Regression tests for review r5 findings (codex-ayuda, 11-10).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { importGenealogyObsidian } from '../src/engines/genealogy/obsidianImport.ts';
import { importGenealogyNotion } from '../src/engines/genealogy/notionImport.ts';
import { importGenealogyWorldAnvil } from '../src/engines/genealogy/worldAnvilImport.ts';
import { importGenealogyCampfire } from '../src/engines/genealogy/campfireImport.ts';
import { previewGenealogyImport } from '../src/engines/genealogy/importPreview.ts';
import { applyGenealogy } from '../src/engines/genealogy/genealogyOps.ts';
import { buildGenealogyTree } from '../src/engines/genealogy/tree.ts';
import { layoutGenealogyTree } from '../src/engines/genealogy/layout.ts';

const EXISTING = [{ id: 'g1', from: 'a', to: 'b', kind: 'biological_parent' }];

test('r5 P2-1: incremental import without ids reserves existing ids (all 4 parsers)', () => {
  const existingIds = new Set(['g1']);
  const cases = [
    importGenealogyObsidian('- [[C]] -> [[D]] : biological_parent', existingIds),
    importGenealogyNotion('## C' + String.fromCharCode(10) + '- biological_parent: D', existingIds),
    importGenealogyWorldAnvil('# C' + String.fromCharCode(10) + '- Parents: D', existingIds),
    importGenealogyCampfire({ relationships: [{ from: 'c', to: 'd', type: 'parent' }] }, existingIds),
  ];
  for (const parsed of cases) {
    assert.equal(parsed.links.length, 1);
    assert.equal(parsed.links[0].id, 'g2', `derived id must skip g1 (${parsed.links[0].id})`);
  }
});

test('r5 P2-2: preview and apply assign the same ids in a mixed batch', () => {
  const incoming = [null, { from: 'c', to: 'd', kind: 'biological_parent' }];
  const preview = previewGenealogyImport({ incoming, existing: EXISTING });
  const chars = [
    { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' },
  ];
  const result = applyGenealogy(chars, EXISTING, incoming, 'apply-r6-p2');
  assert.equal(preview.issues.length, 1);
  assert.equal(preview.issues[0].index, 0);
  assert.equal(result.appliedLinkIds[0], 'g3');
  // The applied id must be the one preview promised for the same entry.
  assert.equal(preview.additions[0].id, 'g3');
});

test('r5 P2-3: two parents of one child do not overlap in the layout', () => {
  const chars = [{ id: 'hijo' }, { id: 'madre' }, { id: 'padre' }];
  const links = [
    { id: 'g1', from: 'madre', to: 'hijo', kind: 'biological_parent' },
    { id: 'g2', from: 'padre', to: 'hijo', kind: 'adoptive_parent' },
  ];
  const layout = layoutGenealogyTree(buildGenealogyTree(chars, links));
  const slots = new Set([...layout.positions.values()].map((p) => `${p.row}:${p.col}`));
  assert.equal(slots.size, layout.positions.size, 'every character needs its own slot');
});

test('r5 P2-4: apply that rejects every link reports applied: [] (handler throws nothing_applied)', () => {
  const chars = [{ id: 'a' }, { id: 'b' }];
  // c and d are unknown characters: every link is rejected. The pure op
  // returns applied: []; the bridge handler (genealogy.ts) turns that into
  // a nothing_applied error so dispatch never announces ok:true.
  const proposal = [{ from: 'c', to: 'd', kind: 'biological_parent' }];
  const result = applyGenealogy(chars, [], proposal, 'apply-r6-p4');
  assert.deepEqual(result.appliedLinkIds, []);
  assert.equal(result.rejected.length, 1);
});
