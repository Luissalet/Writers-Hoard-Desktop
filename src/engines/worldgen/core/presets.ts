// ============================================
// World Generator — Parameter Presets
// ============================================
// Writer-friendly starting points. Each preset overrides a subset of
// DEFAULT_PARAMS; seed & resolution are always preserved from current state.

import type { WorldParams } from './types';

export interface WorldPreset {
  id: string;
  /** i18n key suffix: worldgen.preset.<id> */
  overrides: Partial<WorldParams>;
}

export const WORLD_PRESETS: WorldPreset[] = [
  {
    id: 'continents',
    overrides: { plates: 9, landRatio: 0.32, mountainousness: 0.6, ruggedness: 0.5, erosion: 0.6, moisture: 1, temperature: 0 },
  },
  {
    id: 'pangaea',
    overrides: { plates: 5, landRatio: 0.38, mountainousness: 0.55, ruggedness: 0.45, erosion: 0.65, moisture: 0.9 },
  },
  {
    id: 'archipelago',
    overrides: { plates: 18, landRatio: 0.16, mountainousness: 0.75, ruggedness: 0.65, erosion: 0.45, moisture: 1.15 },
  },
  {
    id: 'shattered',
    overrides: { plates: 14, landRatio: 0.26, mountainousness: 0.85, ruggedness: 0.7, erosion: 0.5 },
  },
  {
    id: 'iceAge',
    overrides: { plates: 8, landRatio: 0.34, temperature: -7, moisture: 0.8, mountainousness: 0.6 },
  },
  {
    id: 'desertWorld',
    overrides: { plates: 7, landRatio: 0.42, temperature: 4, moisture: 0.55, erosion: 0.35, riverDensity: 0.3 },
  },
  {
    id: 'lushWorld',
    overrides: { plates: 10, landRatio: 0.3, temperature: 1.5, moisture: 1.4, erosion: 0.7, riverDensity: 0.7 },
  },
];
