import { validateRelationTree, type RelationTreeDocument } from './relationTrees';

export const TREE_PRESETS = ['family', 'corporate', 'military', 'royal', 'blank'] as const;
export type TreePreset = typeof TREE_PRESETS[number];
const names = {
  es: { family: 'Familia', corporate: 'Empresa', military: 'Ejército', royal: 'Corte real', blank: 'En blanco' },
  en: { family: 'Family', corporate: 'Corporate', military: 'Military', royal: 'Royal court', blank: 'Blank' },
};
export const treePresetNames = (locale: string) => names[locale === 'en' ? 'en' : 'es'];
const roles = {
  es: { family: ['Progenitor', 'Pareja', 'Hija o hijo', 'Hija o hijo'], corporate: ['Dirección', 'Operaciones', 'Producto', 'Equipo'], military: ['Mando', 'Compañía A', 'Compañía B', 'Sección'], royal: ['Soberano', 'Consorte', 'Consejo', 'Heredero'] },
  en: { family: ['Parent', 'Partner', 'Child', 'Child'], corporate: ['Director', 'Operations', 'Product', 'Team'], military: ['Commander', 'Company A', 'Company B', 'Platoon'], royal: ['Sovereign', 'Consort', 'Council', 'Heir'] },
};

/** Editable diagram starts, with independent IDs and no changes to canonical genealogy. */
export function createTreePreset(id: string, title: string, preset: TreePreset, locale: string, now: number): RelationTreeDocument {
  if (!TREE_PRESETS.includes(preset)) throw Error('invalid_tree_preset');
  const language = locale === 'en' ? 'en' : 'es';
  const labels = preset === 'blank' ? [] : roles[language][preset];
  const points = preset === 'family' || preset === 'royal'
    ? [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 0, y: 200 }, { x: 300, y: 200 }]
    : [{ x: 150, y: 0 }, { x: 0, y: 200 }, { x: 300, y: 200 }, { x: 0, y: 400 }];
  const nodes = labels.map((label, index) => ({ id: `${id}:node:${index}`, label, position: { ...points[index] } }));
  const family = preset === 'family';
  const pairs = family ? [[0, 1], [0, 2], [1, 2], [0, 3], [1, 3]] : preset === 'royal' ? [[0, 1], [0, 2], [0, 3]] : [[0, 1], [0, 2], [1, 3]];
  const relation = preset === 'corporate' ? language === 'es' ? 'Supervisa' : 'Supervises' : preset === 'military' ? language === 'es' ? 'Dirige' : 'Commands' : language === 'es' ? 'Consejo' : 'Council';
  const edges: RelationTreeDocument['edges'] = !nodes.length ? [] : pairs.map(([source, target], index) => ({ id: `${id}:edge:${index}`, source: nodes[source].id, target: nodes[target].id, kind: family ? index === 0 ? 'partner' : 'biological_parent' : 'custom', style: 'solid', ...(family ? {} : { label: preset === 'royal' ? [language === 'es' ? 'Consorte' : 'Consort', relation, language === 'es' ? 'Sucesión' : 'Succession'][index] : relation }), ...(index === 0 && (family || preset === 'royal') ? { sourceHandle: 'right', targetHandle: 'left' } : {}) }));
  const result = { id, title, preset, snapToNodes: true, nodes, edges, revision: 0, createdAt: now, updatedAt: now };
  validateRelationTree(result); return result;
}

/** Align matching card edges or centres in world coordinates. Tolerance comes from screen pixels / zoom. */
export function snapTreePoint(tree: RelationTreeDocument, id: string, point: { x: number; y: number }, tolerance = 8) {
  if (!tree.snapToNodes || !tree.nodes.some(node => node.id === id)) return point;
  const others = tree.nodes.filter(node => node.id !== id), result = { ...point };
  for (const [axis, offsets] of [['x', [0, 100, 200]], ['y', [0, 37.5, 75]]] as const) {
    let closest = tolerance;
    for (const node of others) for (const targetOffset of offsets) for (const sourceOffset of offsets) {
      const difference = node.position[axis] + targetOffset - point[axis] - sourceOffset;
      if (Math.abs(difference) < closest) { closest = Math.abs(difference); result[axis] = point[axis] + difference; }
    }
  }
  return result;
}
