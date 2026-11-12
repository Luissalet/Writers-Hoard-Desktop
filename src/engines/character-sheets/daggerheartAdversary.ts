export const daggerheartTiers = [1, 2, 3, 4] as const;
const levelsByTier = { 1: '1', 2: '2–4', 3: '5–7', 4: '8–10' } as const;

export function daggerheartTierLevels(tier: number | undefined): string | undefined {
  const knownTier = daggerheartTiers.find(value => value === tier);
  return knownTier === undefined ? undefined : levelsByTier[knownTier];
}

export const daggerheartAdversaryTypes = {
  Bruiser: 'Bruto',
  Horde: 'Horda',
  Leader: 'Líder',
  Minion: 'Esbirro',
  Ranged: 'A distancia',
  Skulk: 'Acechador',
  Social: 'Social',
  Solo: 'Solitario',
  Standard: 'Estándar',
  Support: 'Apoyo',
} as const;

export const daggerheartFeatureKinds = ['passive', 'action', 'reaction'] as const;
export type DaggerheartFeatureKind = typeof daggerheartFeatureKinds[number];
export type DaggerheartAdversaryRow =
  | { kind: 'experience'; modifier: number }
  | { kind: 'feature'; category: DaggerheartFeatureKind };

const featureNames = {
  passive: { en: 'Passive', es: 'Pasivo' },
  action: { en: 'Action', es: 'Acción' },
  reaction: { en: 'Reaction', es: 'Reacción' },
};

export function daggerheartFeatureLabel(kind: DaggerheartFeatureKind, locale: 'en' | 'es'): string {
  return featureNames[kind][locale];
}

export function validDaggerheartAdversaryRow(value: unknown): value is DaggerheartAdversaryRow {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2) return false;
  const row = value as Partial<DaggerheartAdversaryRow>;
  return row.kind === 'experience' ? Number.isSafeInteger(row.modifier)
    : row.kind === 'feature' && daggerheartFeatureKinds.some(kind => kind === row.category);
}
