// Built-in looks and the accent hue helper. Values are plain appearance values: contrast of text
// and accent is derived (and corrected) by `workspaceAppearanceStyle`, so any pair is safe.
import type { WorkspaceAppearanceValues } from './types';

export interface ThemePreset { id: string; es: string; en: string; values: WorkspaceAppearanceValues }
export const THEME_PRESETS: readonly ThemePreset[] = [
  { id: 'parchment', es: 'Pergamino', en: 'Parchment', values: { mode: 'light', background: '#f1e8d2', accent: '#8a5a1f', proseFont: 'classic' } },
  { id: 'midnight', es: 'Medianoche', en: 'Midnight', values: { mode: 'dark', background: '#0f1424', accent: '#8aa4e6' } },
  { id: 'forest', es: 'Bosque', en: 'Forest', values: { mode: 'dark', background: '#14201a', accent: '#8cc48f', proseFont: 'serif' } },
  { id: 'ember', es: 'Brasa', en: 'Ember', values: { mode: 'dark', background: '#221412', accent: '#ee8a4f', grain: 20 } },
  { id: 'ocean', es: 'Océano', en: 'Ocean', values: { mode: 'light', background: '#e5eff1', accent: '#1d6f7e' } },
  { id: 'slate', es: 'Pizarra', en: 'Slate', values: { mode: 'dark', background: '#262b31', accent: '#9fb3c8', uiFont: 'system' } },
  { id: 'dusty-rose', es: 'Rosa antigua', en: 'Dusty rose', values: { mode: 'light', background: '#f1e3e1', accent: '#a04a5d', proseFont: 'serif' } },
  { id: 'high-contrast', es: 'Alto contraste', en: 'High contrast', values: { mode: 'dark', background: '#000000', accent: '#ffd400', performance: true } },
];

/** A preset sets the whole look except the background picture, so one preset never inherits another's fonts or grain. */
export const presetPatch = (preset: ThemePreset): WorkspaceAppearanceValues => ({ uiFont: 'incumbent', proseFont: 'reading', grain: 0, performance: false, ...preset.values });

const clamp = (value: number) => Math.min(1, Math.max(0, value));
export function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1)), h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round((h * 60 + 360) % 360), s, l];
}
export function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * clamp(l) - 1)) * clamp(s), x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = clamp(l) - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}
/** The accent turned to a new hue, keeping its saturation and lightness (grey accents gain a soft one). */
export function accentWithHue(accent: string, hue: number): string {
  const [, s, l] = hexToHsl(accent);
  return hslToHex(((Math.round(hue) % 360) + 360) % 360, s < .15 ? .45 : s, l);
}
