// The shapes behind the name generator: the kinds of thing it names, the
// styles it names them in, and the word tables each style draws from.

export const NAME_KINDS = ['inn', 'shop', 'person', 'village', 'house'] as const;
export type NameKind = typeof NAME_KINDS[number];

export const NAME_STYLES = ['classic', 'grim', 'homely', 'grand', 'northern', 'slavic', 'desert', 'eastasian', 'seafaring', 'fey', 'dwarven', 'frontier', 'farfuture'] as const;
export type NameStyle = typeof NAME_STYLES[number];

/** The parts of a generated idea, in the order they are offered. */
export const NAME_STEPS = ['name', 'owner', 'role', 'charm', 'knownFor', 'secret', 'trouble', 'motto'] as const;
export type NameStep = typeof NAME_STEPS[number];

/** Which steps each kind offers (name always first). */
export const KIND_STEPS: Record<NameKind, NameStep[]> = {
  inn: ['name', 'owner', 'charm', 'knownFor', 'secret', 'trouble'],
  shop: ['name', 'owner', 'charm', 'knownFor', 'secret', 'trouble'],
  person: ['name', 'role', 'charm', 'knownFor', 'secret', 'trouble'],
  village: ['name', 'owner', 'knownFor', 'secret', 'trouble', 'motto'],
  house: ['name', 'owner', 'knownFor', 'secret', 'trouble', 'motto'],
};

/** Syllables, joined to make names that sound of one style. Lowercase, romanised. */
export interface Syllables { start: string[]; middle?: string[]; end: string[] }

export interface StyleTable {
  label: { es: string; en: string };
  /** Given names; `feminine` endings, when present, replace `end` for a woman. */
  given: Syllables & { feminine?: string[] };
  /** Family or clan names. */
  family: Syllables;
  /** Villages and towns. */
  place: Syllables;
  /** Words for inn signs, shop signs and noble houses, in the style's mood. */
  words: {
    /** Spanish nouns with their gender, e.g. ['jarra', 'f']. */
    es: { nouns: [string, 'm' | 'f'][]; adjectives: [string, string][] };
    en: { nouns: string[]; adjectives: string[] };
  };
}

/** The non-name steps, per language and kind. `{name}` is replaced by a generated given name. */
export interface KindTables {
  charm: Record<NameKind, string[]>;
  knownFor: Record<NameKind, string[]>;
  secret: Record<NameKind, string[]>;
  trouble: Record<NameKind, string[]>;
  /** A person's occupation. */
  role: string[];
  /** The owner's (or head's, or mayor's) title: inn keeper, shopkeeper, village reeve, head of the house. */
  ownerTitle: Record<'inn' | 'shop' | 'village' | 'house', string[]>;
  /** Shop trades for "{trade} de {name}" / "{name}'s {trade}". */
  trades: string[];
  mottos: string[];
}
