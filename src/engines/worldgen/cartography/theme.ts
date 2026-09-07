// ============================================
// Cartography — Themes
// ============================================
// A theme is the complete visual identity of a rendered map: palette, symbol
// styling, typography and the strength of every effect. Swapping the theme
// swaps the entire look without touching the drawing code, the way Wonderdraft
// ships "themes" and Campaign Cartographer ships "styles".
//
// Colors are plain CSS strings so they can be handed straight to Canvas2D.

import { Biome, type BiomeId } from '../core/types';

export interface SymbolStyle {
  /** Base symbol height in map pixels at scale 1. */
  size: number;
  /** ± fraction of random size variation per instance. */
  sizeJitter: number;
  /** Ink outline color. */
  ink: string;
  /** Lit face fill. */
  light: string;
  /** Shadow face fill. */
  shadow: string;
  /** Outline width in px at scale 1. */
  lineWidth: number;
  /**
   * ± fracción de variación de TONO por instancia (0 = una plantilla repetida).
   *
   * Es la diferencia entre "un juego de símbolos dibujado" y "un glifo pegado
   * 2 800 veces": medido sobre el pliego de 1600 px, con 0 el ojo encuentra la
   * retícula en menos de un segundo; con 0.18 deja de encontrarla.
   */
  toneJitter: number;
}

export interface CartoTheme {
  id: string;
  name: string;

  // ---- Paper -------------------------------------------------------------
  paper: {
    /** Base tone of the sheet. */
    base: string;
    /** Darker tone the grain modulates toward. */
    grain: string;
    /** Warm stain color used for blotches. */
    stain: string;
    /** 0–1 strength of the fibre/grain noise. */
    grainAmount: number;
    /** 0–1 strength of the large aged blotches. */
    blotchAmount: number;
    /** 0–1 darkening at the sheet edges. */
    vignette: number;
  };

  // ---- Water -------------------------------------------------------------
  ocean: {
    shallow: string;
    deep: string;
    /** Depth in km at which `deep` is reached. */
    deepAt: number;
    /** Concentric coast rings (the Wonderdraft "coastal effect"). */
    rings: {
      count: number;
      /** Distance between ring centres, in map px at scale 1. */
      spacing: number;
      /** Ring line thickness in px. */
      width: number;
      color: string;
      /** Alpha of the innermost ring; later rings fade geometrically. */
      alpha: number;
      falloff: number;
    };
    /** Optional horizontal hatching over open water (antique look). */
    hatch: { enabled: boolean; color: string; alpha: number; spacing: number };
    /**
     * Quiebre de la plataforma continental: la isóbata que separa la sonda del
     * mar abierto. Sin ella el mar es una rampa de color y el lector no puede
     * decir dónde acaba lo somero — que es justo lo que un derrotero dibuja.
     */
    shelf: { enabled: boolean; /** profundidad en km */ depth: number; color: string; alpha: number; width: number };
    /**
     * Punteado de mar abierto. Un grabado no deja el agua lisa: la puntea, y el
     * punteado se ralea hacia la costa porque allí ya manda la anilla.
     */
    stipple: { enabled: boolean; color: string; alpha: number; /** px entre puntos */ spacing: number };
  };

  coastline: { color: string; width: number; /** hand-drawn wobble px */ wobble: number };

  // ---- Land --------------------------------------------------------------
  land: {
    /** Flat base tone applied over the whole landmass. */
    base: string;
    /** Per-biome translucent washes painted over `base`. */
    tints: Partial<Record<BiomeId, string>>;
    /** 0–1 opacity of the biome washes. */
    tintAlpha: number;
    /** 0–1 strength of the baked relief shading multiplied over land. */
    shading: number;
    /** Color multiplied into slopes facing away from the sun. */
    shadeColor: string;
    /** Snow/ice overlay tone. */
    snow: string;
    /**
     * Hachura de ladera: trazos cortos en la línea de máxima pendiente sobre el
     * terreno abrupto. Es como un mapa dibujado cuenta la altura sin rampa de
     * color, y lo que evita el fallo de "montañas flotando sobre un llano liso".
     * `slope` es el cuantil de relieve local a partir del cual se hachura.
     */
    hachure: { enabled: boolean; color: string; alpha: number; /** px entre trazos a escala 1 */ spacing: number; slope: number };
  };

  rivers: { color: string; /** px width at flow 1 */ maxWidth: number; minWidth: number };
  lakes: { fill: string; stroke: string; width: number };

  // ---- Symbols -----------------------------------------------------------
  mountains: SymbolStyle & {
    snow: string;
    hatch: string;
    hatchAlpha: number;
    /** Falda de derrubios al pie, en fracción de la altura. 0 = ninguna. */
    scree: number;
    /**
     * 0–1 de perspectiva aérea: cuánto se lava hacia el papel un símbolo que
     * queda DETRÁS de otro. Es lo que convierte una fila de tiendas de campaña
     * en una sierra con fondo — línea pesada delante, ligera detrás.
     */
    aerial: number;
  };
  hills: SymbolStyle;
  forest: SymbolStyle & { conifer: string; broadleaf: string; /** sombra al pie del árbol */ aerial: number };
  dunes: { color: string; alpha: number; width: number };
  marsh: { color: string; alpha: number };
  /** Hielo: grietas y bordes de glaciar, para casquetes y banquisa. */
  ice: { color: string; alpha: number; width: number };

  // ---- Culture layer -----------------------------------------------------
  roads: { major: string; minor: string; majorWidth: number; minorWidth: number; dash: number[] };
  settlement: { ink: string; fill: string; capitalFill: string };
  borders: { width: number; alpha: number; dash: number[]; fillAlpha: number };

  // ---- Type --------------------------------------------------------------
  type: {
    /** CSS font stack. Cinzel / IM Fell are the classic fantasy choices; the
     *  tail must stay installed-everywhere so the map never falls back to
     *  something sans-serif. */
    display: string;
    body: string;
    color: string;
    /** Halo painted behind glyphs for legibility over busy terrain. */
    halo: string;
    haloWidth: number;
    oceanColor: string;
  };

  furniture: {
    ink: string;
    accent: string;
    frame: string;
    frameFill: string;
    /**
     * Cenefa de damero entre las dos reglas del marco: el borde graduado de los
     * atlas grabados. `teeth` es el número aproximado de dientes en el lado
     * largo; 0 lo apaga y deja el doble filete de siempre.
     */
    teeth: number;
    /** Esquinas del marco con voluta en vez de bloque romboidal. */
    flourish: boolean;
  };
}

const WONDER_TINTS: Partial<Record<BiomeId, string>> = {
  [Biome.IceCap]: '#eef3f6',
  [Biome.Glacier]: '#e6eef3',
  [Biome.Tundra]: '#b9b9a0',
  [Biome.BorealForest]: '#7f9a76',
  [Biome.TemperateForest]: '#87a771',
  [Biome.TemperateRainforest]: '#6f9a72',
  [Biome.Grassland]: '#c3c489',
  [Biome.Shrubland]: '#c6bd8a',
  [Biome.Savanna]: '#d4c288',
  [Biome.TropicalForest]: '#7ea86e',
  [Biome.TropicalRainforest]: '#6a9c63',
  [Biome.Desert]: '#e3cf9c',
  [Biome.ColdDesert]: '#cfc49e',
  [Biome.Alpine]: '#b3aa9a',
  [Biome.Beach]: '#e8d9ae',
  [Biome.SaltFlat]: '#eae3cf',
  [Biome.Mangrove]: '#6d9273',
  [Biome.SaltMarsh]: '#a8b189',
  [Biome.Marsh]: '#93a880',
  [Biome.PeatBog]: '#9aa085',
  [Biome.Steppe]: '#d0c68d',
  [Biome.Chaparral]: '#c5bb85',
  [Biome.MonsoonForest]: '#8aab6c',
  [Biome.CloudForest]: '#7ba17f',
  [Biome.MontaneForest]: '#6d9070',
  [Biome.AlpineMeadow]: '#adb98c',
  [Biome.Erg]: '#eBD79E'.toLowerCase(),
  [Biome.Reg]: '#d6c49b',
  [Biome.Badlands]: '#c8a37c',
  [Biome.RiparianForest]: '#86a86b',
  32: '#b9c39a',
  33: '#aac97f',
  34: '#d2ccb8',
  35: '#c4b57f',
  36: '#a3977e',
  37: '#c8bda3',
  38: '#655c58',
  39: '#a8a09a',
  40: '#b6a48d',
  41: '#9a86b3',
  42: '#dae5ec',
  43: '#7fada1',
};

/** Warm parchment, blue sea, muted biome washes — the Wonderdraft default. */
export const THEME_WONDER: CartoTheme = {
  id: 'wonder',
  name: 'Pergamino clásico',
  paper: {
    base: '#efe0bd',
    grain: '#d8c39a',
    stain: '#c9a978',
    grainAmount: 0.34,
    blotchAmount: 0.3,
    vignette: 0.34,
  },
  ocean: {
    shallow: '#7fa8bd',
    deep: '#3d6c8c',
    deepAt: 3.2,
    rings: { count: 4, spacing: 6.5, width: 2.0, color: '#e3d3ae', alpha: 0.46, falloff: 0.6 },
    hatch: { enabled: false, color: '#2f5f78', alpha: 0.05, spacing: 7 },
    shelf: { enabled: true, depth: 0.55, color: '#2c5772', alpha: 0.3, width: 1.1 },
    stipple: { enabled: true, color: '#2f5f78', alpha: 0.24, spacing: 12 },
  },
  coastline: { color: '#3f3323', width: 1.5, wobble: 0.55 },
  land: {
    base: '#e6d4ab',
    tints: WONDER_TINTS,
    tintAlpha: 0.62,
    shading: 0.3,
    shadeColor: '#6d5a3c',
    snow: '#f2f5f7',
    hachure: { enabled: true, color: '#6d5a3c', alpha: 0.26, spacing: 5.2, slope: 0.72 },
  },
  rivers: { color: '#5d8fae', maxWidth: 3.1, minWidth: 0.65 },
  lakes: { fill: '#84acc2', stroke: '#40566a', width: 1.1 },
  mountains: {
    size: 9.5,
    sizeJitter: 0.36,
    ink: '#463724',
    light: '#cdbb96',
    shadow: '#8c785a',
    lineWidth: 1.05,
    toneJitter: 0.17,
    snow: '#f4f6f7',
    hatch: '#5b4a32',
    hatchAlpha: 0.5,
    scree: 0.16,
    aerial: 0.4,
  },
  hills: { size: 7.5, sizeJitter: 0.32, ink: '#544329', light: '#d8c69f', shadow: '#a08a66', lineWidth: 0.95, toneJitter: 0.15 },
  forest: {
    size: 6.2,
    sizeJitter: 0.3,
    ink: '#3d4f31',
    light: '#7d9c63',
    shadow: '#4f6a44',
    lineWidth: 0.8,
    toneJitter: 0.2,
    conifer: '#4e6d4c',
    broadleaf: '#6d8f57',
    aerial: 0.3,
  },
  dunes: { color: '#b39a68', alpha: 0.6, width: 1.05 },
  marsh: { color: '#6f7f62', alpha: 0.6 },
  ice: { color: '#8fb3c6', alpha: 0.55, width: 0.9 },
  roads: { major: '#7b5f3c', minor: '#8b7350', majorWidth: 1.7, minorWidth: 1.0, dash: [5, 3.4] },
  settlement: { ink: '#3a2c1b', fill: '#f2e7cd', capitalFill: '#c9a45a' },
  borders: { width: 1.5, alpha: 0.7, dash: [7, 4], fillAlpha: 0.085 },
  type: {
    // La cola de la pila DEBE ser una serifa concreta, no la palabra `serif`:
    // ni Skia (la carta en el navegador) ni @napi-rs/canvas (el banco) resuelven
    // el genérico a una serifa — caían en la sans por defecto, y todo el pliego
    // se leía como una captura de pantalla. Medido: con `serif` al final,
    // "Monstruo" a 20 px mide 83.4 px (DejaVu Sans); con Lora, 92.1 px.
    display: '"Cinzel", "IM Fell English", "EB Garamond", "Cormorant Garamond", Georgia, "Palatino Linotype", "Book Antiqua", Palatino, Lora, "Liberation Serif", "DejaVu Serif", "Times New Roman", serif',
    body: '"EB Garamond", "Cormorant Garamond", Georgia, "Palatino Linotype", "Book Antiqua", Palatino, Lora, "Liberation Serif", "DejaVu Serif", "Times New Roman", serif',
    color: '#3b2d1c',
    halo: 'rgba(239,224,189,0.85)',
    haloWidth: 3,
    oceanColor: '#244451',
  },
  furniture: { ink: '#4a3a23', accent: '#9c7434', frame: '#5a4529', frameFill: '#e2cfa4', teeth: 46, flourish: true },
};

/** Sepia engraving on old paper — Campaign Cartographer / 16th-century atlas. */
export const THEME_ANTIQUE: CartoTheme = {
  id: 'antique',
  name: 'Grabado antiguo',
  paper: {
    base: '#e8dcc0',
    grain: '#cdb994',
    stain: '#b28d5e',
    grainAmount: 0.42,
    blotchAmount: 0.45,
    vignette: 0.46,
  },
  ocean: {
    // El grabado deja la sonda casi en blanco y entinta el mar abierto: si las
    // dos van igual de claras (las viejas #dccfae / #c6b48d distan 22 niveles),
    // a tamaño de mundo no se distingue tierra de agua sin seguir la costa.
    shallow: '#e0d5b6',
    deep: '#b6a380',
    deepAt: 3.2,
    rings: { count: 7, spacing: 4.2, width: 1.15, color: '#7d6134', alpha: 0.33, falloff: 0.72 },
    hatch: { enabled: true, color: '#8a6c3d', alpha: 0.12, spacing: 6 },
    shelf: { enabled: true, depth: 0.5, color: '#6b5228', alpha: 0.34, width: 0.95 },
    stipple: { enabled: true, color: '#7d6134', alpha: 0.3, spacing: 9 },
  },
  coastline: { color: '#4a3618', width: 1.35, wobble: 0.7 },
  land: {
    base: '#e6dabb',
    tints: {
      [Biome.IceCap]: '#f0ece0',
      [Biome.Glacier]: '#eee9dc',
      [Biome.Tundra]: '#dbd0b2',
      [Biome.BorealForest]: '#c3bb96',
      [Biome.TemperateForest]: '#cbc39c',
      [Biome.TemperateRainforest]: '#c2bb95',
      [Biome.Grassland]: '#ded2ac',
      [Biome.Desert]: '#ece0bb',
      [Biome.TropicalRainforest]: '#bdb693',
      [Biome.TropicalForest]: '#c6bf99',
      [Biome.Mangrove]: '#bab290',
      [Biome.SaltMarsh]: '#d2c8a6',
      [Biome.Marsh]: '#c9c0a0',
      [Biome.PeatBog]: '#cdc5a8',
      [Biome.Steppe]: '#e0d4ae',
      [Biome.Chaparral]: '#dbcfa8',
      [Biome.MonsoonForest]: '#c8c09a',
      [Biome.CloudForest]: '#c0b995',
      [Biome.MontaneForest]: '#bfb894',
      [Biome.AlpineMeadow]: '#d8d0b0',
      [Biome.Erg]: '#efe2bd',
      [Biome.Reg]: '#e3d5b0',
      [Biome.Badlands]: '#d8c49c',
      [Biome.RiparianForest]: '#c4bd97',
      32: '#a9b98d',
      33: '#9dbf74',
      34: '#cdc7b4',
      35: '#bcae79',
      36: '#9d9078',
      37: '#c2b79d',
      38: '#5c5350',
      39: '#a09992',
      40: '#ae9c86',
      41: '#8e7ba8',
      42: '#d3e0e7',
      43: '#74a397',
    },
    tintAlpha: 0.5,
    shading: 0.2,
    shadeColor: '#6b5228',
    snow: '#f6f2e6',
    // El grabado dice la altura con línea, no con color: hachura más apretada,
    // más oscura y desde una pendiente más baja que el pergamino pintado.
    hachure: { enabled: true, color: '#5b451f', alpha: 0.4, spacing: 4.0, slope: 0.6 },
  },
  rivers: { color: '#6c5730', maxWidth: 2.5, minWidth: 0.55 },
  lakes: { fill: '#d3c49f', stroke: '#6c5730', width: 1 },
  mountains: {
    size: 14,
    sizeJitter: 0.34,
    ink: '#4c3a1c',
    light: '#e4d8b6',
    shadow: '#b09a6f',
    lineWidth: 0.95,
    toneJitter: 0.1,
    snow: '#f7f3e6',
    hatch: '#5b451f',
    hatchAlpha: 0.62,
    scree: 0.22,
    aerial: 0.5,
  },
  hills: { size: 7, sizeJitter: 0.3, ink: '#54411f', light: '#e2d6b3', shadow: '#bdaa7e', lineWidth: 0.85, toneJitter: 0.09 },
  forest: {
    size: 6.8,
    sizeJitter: 0.28,
    ink: '#4a3c1d',
    light: '#cfc49c',
    shadow: '#9c8d63',
    lineWidth: 0.75,
    toneJitter: 0.12,
    conifer: '#8d8058',
    broadleaf: '#b3a679',
    aerial: 0.4,
  },
  dunes: { color: '#a98d5a', alpha: 0.55, width: 0.95 },
  marsh: { color: '#7c6c44', alpha: 0.55 },
  ice: { color: '#8a7550', alpha: 0.5, width: 0.8 },
  roads: { major: '#6b5228', minor: '#7d6537', majorWidth: 1.5, minorWidth: 0.9, dash: [4.5, 3] },
  settlement: { ink: '#402f14', fill: '#f0e6cb', capitalFill: '#b4913f' },
  borders: { width: 1.3, alpha: 0.7, dash: [6, 3.5], fillAlpha: 0.1 },
  type: {
    // El grabado prefiere una romana de tipografía (Times / Liberation Serif)
    // ANTES que Lora: dos temas que caen en la misma cara son un cambio de
    // paleta, no un estilo, y aquí la letra es la mitad del estilo.
    display: '"IM Fell English", "IM Fell DW Pica", "EB Garamond", "Times New Roman", "Liberation Serif", Georgia, "DejaVu Serif", Lora, serif',
    body: '"IM Fell English", "EB Garamond", "Times New Roman", "Liberation Serif", Georgia, "DejaVu Serif", Lora, serif',
    color: '#4a3618',
    halo: 'rgba(232,220,192,0.85)',
    haloWidth: 3,
    oceanColor: '#6d5730',
  },
  furniture: { ink: '#4a3618', accent: '#8a6c3d', frame: '#5b451f', frameFill: '#ded0ac', teeth: 64, flourish: false },
};

export const THEMES: CartoTheme[] = [THEME_WONDER, THEME_ANTIQUE];

export function themeById(id: string): CartoTheme {
  return THEMES.find((t) => t.id === id) ?? THEME_WONDER;
}
