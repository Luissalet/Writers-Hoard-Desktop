// ============================================
// Relationship catalogue — ready vocabularies for common kinds of tree
// ============================================
// A family is parents and partners; a company, an army or a royal court have
// their own words for who answers to whom. Each set is added to a tree's
// saved relationship types in one step, then used like any type made by hand.

import type { RelationTreeEdge, RelationVocabulary } from './relationTrees';

export const RELATION_CATALOGUE_SETS = ['family', 'corporate', 'military', 'court', 'order', 'underworld'] as const;
export type RelationCatalogueSet = typeof RELATION_CATALOGUE_SETS[number];

type Term = { es: string; en: string; kind: RelationTreeEdge['kind']; style?: RelationTreeEdge['style']; icon?: string };

export const RELATION_CATALOGUE_LABELS: Record<RelationCatalogueSet, { es: string; en: string }> = {
  family: { es: 'Familia', en: 'Family' }, corporate: { es: 'Empresa', en: 'Corporate' }, military: { es: 'Ejército', en: 'Military' },
  court: { es: 'Corte real', en: 'Royal court' }, order: { es: 'Orden o gremio', en: 'Order or guild' }, underworld: { es: 'Bajos fondos', en: 'Underworld' },
};

const CATALOGUE: Record<RelationCatalogueSet, Term[]> = {
  family: [
    { es: 'Madre / padre', en: 'Parent', kind: 'biological_parent' }, { es: 'Adopción', en: 'Adoptive parent', kind: 'adoptive_parent', style: 'dashed' },
    { es: 'Tutela', en: 'Guardian', kind: 'guardian', style: 'dotted' }, { es: 'Matrimonio', en: 'Marriage', kind: 'partner', icon: 'Heart' },
    { es: 'Pareja', en: 'Partner', kind: 'partner', style: 'dashed', icon: 'Heart' }, { es: 'Padrinazgo', en: 'Godparent', kind: 'custom', style: 'dotted' },
  ],
  corporate: [
    { es: 'Dirige a', en: 'Manager of', kind: 'custom', icon: 'Star' }, { es: 'Mentor de', en: 'Mentor of', kind: 'custom', style: 'dashed', icon: 'Eye' },
    { es: 'Socio de', en: 'Partner of', kind: 'custom', icon: 'Handshake' }, { es: 'Inversor en', en: 'Investor in', kind: 'custom', style: 'dotted', icon: 'Gem' },
    { es: 'Rival de', en: 'Rival of', kind: 'custom', style: 'dashed', icon: 'Flame' },
  ],
  military: [
    { es: 'Al mando de', en: 'Commands', kind: 'custom', icon: 'Sword' }, { es: 'Legado de', en: 'Legate of', kind: 'custom', style: 'dashed', icon: 'Shield' },
    { es: 'Escudero de', en: 'Squire of', kind: 'guardian', style: 'dotted', icon: 'Shield' }, { es: 'Compañero de armas', en: 'Brother in arms', kind: 'custom', icon: 'Handshake' },
    { es: 'Enemigo jurado', en: 'Sworn enemy', kind: 'custom', style: 'dashed', icon: 'Skull' },
  ],
  court: [
    { es: 'Vasallo de', en: 'Vassal of', kind: 'custom', icon: 'Crown' }, { es: 'Consejero de', en: 'Counsellor to', kind: 'custom', style: 'dashed', icon: 'Eye' },
    { es: 'Heredero de', en: 'Heir of', kind: 'custom', icon: 'Crown' }, { es: 'Pupilo de', en: 'Ward of', kind: 'guardian', style: 'dotted' },
    { es: 'Favorito de', en: 'Favourite of', kind: 'custom', style: 'dotted', icon: 'Star' }, { es: 'Alianza matrimonial', en: 'Marriage alliance', kind: 'partner', icon: 'Link' },
  ],
  order: [
    { es: 'Maestro de', en: 'Master of', kind: 'custom', icon: 'Star' }, { es: 'Aprendiz de', en: 'Apprentice of', kind: 'guardian', style: 'dashed' },
    { es: 'Hermano de orden', en: 'Fellow of the order', kind: 'custom', icon: 'Link' }, { es: 'Iniciado por', en: 'Initiated by', kind: 'custom', style: 'dotted', icon: 'Flame' },
  ],
  underworld: [
    { es: 'Jefe de', en: 'Boss of', kind: 'custom', icon: 'Crown' }, { es: 'Debe un favor a', en: 'Owes a favour to', kind: 'custom', style: 'dotted', icon: 'Link' },
    { es: 'Informante de', en: 'Informant for', kind: 'custom', style: 'dashed', icon: 'Eye' }, { es: 'Traicionó a', en: 'Betrayed', kind: 'custom', style: 'dashed', icon: 'Skull' },
    { es: 'Protegido de', en: 'Protégé of', kind: 'guardian', style: 'dotted', icon: 'Shield' },
  ],
};

/** The set's terms as relationship types (ids are new each time they are added). */
export function catalogueVocabulary(set: RelationCatalogueSet, locale: string, id: () => string): RelationVocabulary[] {
  const lang = locale.toLowerCase().startsWith('en') ? 'en' : 'es';
  return CATALOGUE[set].map(term => ({ id: id(), name: term[lang], kind: term.kind, label: term[lang], style: term.style ?? 'solid', ...(term.icon ? { icon: term.icon } : {}) }));
}

/** A tree with the set's terms added to its saved types; a name it already has is skipped. Returns how many were added. */
export function addCatalogueSet<T extends { relationVocabulary?: RelationVocabulary[] }>(tree: T, set: RelationCatalogueSet, locale: string, id: () => string): { tree: T; added: number } {
  const have = new Set((tree.relationVocabulary ?? []).map(item => item.name.trim().toLocaleLowerCase()));
  const fresh = catalogueVocabulary(set, locale, id).filter(item => !have.has(item.name.toLocaleLowerCase()));
  return { tree: fresh.length ? { ...tree, relationVocabulary: [...(tree.relationVocabulary ?? []), ...fresh] } : tree, added: fresh.length };
}
