// The relationship catalogue: ready sets of relationship types (family,
// corporate, military, royal court, order, underworld) added to a tree's
// saved types from the panel or the bridge; names the tree has are skipped.
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { db } from '@/db';
import { TreeVocabularyPanel } from '@/engines/genealogy/components/TreeAffordancePanels';
import { addCatalogueSet, catalogueVocabulary, RELATION_CATALOGUE_SETS } from '@/engines/genealogy/relationCatalogue';
import { createTreePreset } from '@/engines/genealogy/treePresets';
import { saveRelationTree } from '@/engines/genealogy/relationTreeStore';
import { validateRelationTree, type RelationTreeDocument } from '@/engines/genealogy/relationTrees';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import type { Project } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

export async function testRelationCatalogue(): Promise<string[]> {
  const passed: string[] = [];
  let n = 0; const id = () => `v${++n}`;
  for (const set of RELATION_CATALOGUE_SETS) assert(catalogueVocabulary(set, 'es', id).length >= 4, `${set} has terms`);
  const tree = createTreePreset('rc-tree', 'Casa Velarde', 'family' as never, 'es', 1);
  const once = addCatalogueSet(tree, 'corporate', 'es', id);
  assert(once.added === 5 && once.tree.relationVocabulary!.some(item => item.name === 'Dirige a' && item.icon === 'Star') && once.tree.relationVocabulary!.some(item => item.name === 'Mentor de' && item.style === 'dashed'), `Corporate: ${JSON.stringify(once.tree.relationVocabulary)}`);
  assert(addCatalogueSet(once.tree, 'corporate', 'es', id).added === 0, 'Added again: nothing new');
  validateRelationTree(once.tree as RelationTreeDocument);
  assert(catalogueVocabulary('military', 'en', id).some(item => item.name === 'Legate of'), 'English names');
  passed.push(`Catalogue: ${RELATION_CATALOGUE_SETS.length} sets; "Empresa" adds Dirige a (★), Mentor de (dashed), Socio de, Inversor en, Rival de; adding it again adds nothing; the tree stays valid; English names for an English book (Legate of…)`);

  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  let latest: RelationTreeDocument = tree;
  function Harness() { const [value, setValue] = useState<RelationTreeDocument>(tree); latest = value; return <TreeVocabularyPanel tree={value} trees={[value]} locale="es" onChange={setValue} />; }
  try {
    await act(async () => { root = createRoot(host); root.render(<Harness />); await pause(150); });
    const set = document.querySelector('[data-testid="tree-catalogue-set"]') as HTMLSelectElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(set, 'court'); set.dispatchEvent(new Event('change', { bubbles: true })); await pause(60); });
    await act(async () => { (document.querySelector('[data-testid="tree-catalogue-add"]') as HTMLButtonElement).click(); await pause(80); });
    assert(latest.relationVocabulary?.some(item => item.name === 'Vasallo de') && /6 tipos añadidos/.test(document.querySelector('[data-testid="tree-catalogue-status"]')?.textContent ?? ''), 'Court added from the panel');
    await act(async () => { (document.querySelector('[data-testid="tree-catalogue-add"]') as HTMLButtonElement).click(); await pause(80); });
    assert(/ya tiene todos/.test(document.querySelector('[data-testid="tree-catalogue-status"]')?.textContent ?? ''), 'Second time: already there');
    const saved = [...(document.querySelector('select[aria-label="Tipo guardado"]') as HTMLSelectElement).options].map(option => option.textContent);
    assert(saved.some(text => text?.includes('Heredero de')), `Saved types list: ${saved.join(' | ')}`);
    passed.push('Panel: "Tipos de relación guardados → Catálogo: Corte real → Añadir al árbol" adds 6 types (Vasallo de, Consejero de, Heredero de…) that appear among the saved types; a second time says the tree already has them');
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
  }

  const P = 'relation-catalogue';
  try {
    await db.projects.put({ id: P, title: 'Velarde', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['genealogy', 'codex'], createdAt: 1, updatedAt: 1 } as Project);
    const stored = await saveRelationTree(P, createTreePreset('rc-bridge', 'Legión', 'family' as never, 'es', 1), null);
    const result = await runBridgeTool('wh_relation_tree_action', { projectId: P, treeId: 'rc-bridge', expectedRevision: stored.revision, action: 'vocabulary-catalogue', catalogue: 'military', locale: 'es' });
    const after = (result.result as { tree: RelationTreeDocument }).tree;
    assert(result.ok && after.relationVocabulary?.some(item => item.name === 'Legado de' && item.icon === 'Shield'), `Bridge: ${JSON.stringify(result).slice(0, 300)}`);
    const bad = await runBridgeTool('wh_relation_tree_action', { projectId: P, treeId: 'rc-bridge', expectedRevision: after.revision, action: 'vocabulary-catalogue', catalogue: 'pirates' });
    assert(!bad.ok, 'Unknown set refused');
    passed.push('Bridge: wh_relation_tree_action vocabulary-catalogue "military" adds Al mando de, Legado de (shield)…; an unknown set is refused');
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
