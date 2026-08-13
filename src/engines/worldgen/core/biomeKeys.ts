// ============================================
// Biome → clave de catálogo
// ============================================
// El motor guarda CLAVES y quien pinta traduce con t() — la regla de todas las
// tablas de etiquetas. Esta tabla existe porque la que vivía en `Map2D` se
// quedó en 17 entradas cuando la revisión ecológica llevó `Biome` hasta 43:
// manglar, estepa, erg, karst y compañía caían al `biomeName` del gazetteer,
// que es prosa en castellano — así que el sobrevuelo y el panel del pincel
// hablaban español en una UI en inglés exactamente en los biomas nuevos.
//
// Indexada por id de `Biome` (0..43, apéndice-only por contrato: los mundos
// guardados serializan estos números). Un id fuera de tabla devuelve
// `undefined` y el llamante decide su reserva.

export const BIOME_KEY: readonly string[] = [
  'ocean', 'lake', 'iceCap', 'tundra', 'boreal', 'tempForest', 'tempRain',
  'grassland', 'shrubland', 'savanna', 'tropForest', 'tropRain', 'desert',
  'coldDesert', 'alpine', 'glacier', 'beach', 'saltFlat',
  // --- la revisión ecológica ---
  'mangrove', 'saltMarsh', 'marsh', 'peatBog', 'steppe', 'chaparral',
  'monsoonForest', 'cloudForest', 'montaneForest', 'alpineMeadow', 'erg',
  'reg', 'badlands', 'riparianForest',
  // --- segunda oleada ---
  'karst', 'bamboo', 'fogDesert', 'thornScrub', 'moor', 'puna', 'volcanic',
  'ashPlain',
  // --- los raros ---
  'petrifiedForest', 'fungalForest', 'crystalFlats', 'glowMarsh',
] as const;

/** Clave de catálogo completa para un id de bioma, o null fuera de tabla. */
export function biomeLocaleKey(id: number): string | null {
  const k = BIOME_KEY[id];
  return k ? `worldgen.biome.${k}` : null;
}
