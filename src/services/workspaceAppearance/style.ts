import type { CSSProperties } from 'react';
import { appearanceFonts, type WorkspaceAppearanceValues } from './types';
const rgb = (color: string) => [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
const hex = (color: number[]) => `#${color.map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: string, b: string, amount: number) => hex(rgb(a).map((value, index) => value * (1 - amount) + rgb(b)[index] * amount));
export function appearanceContrast(a: string, b: string): number {
  const luminance = (color: string) => rgb(color).map(value => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const [x, y] = [luminance(a), luminance(b)]; return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
type WorkspaceStyle = CSSProperties & Record<`--${string}`, string | number | undefined>;
export function workspaceAppearanceStyle(values: WorkspaceAppearanceValues): WorkspaceStyle {
  const customized = values.mode || values.background || values.accent;
  const background = values.background ?? (values.mode === 'light' ? '#f3efe6' : '#17191a');
  const light = appearanceContrast('#000000', background) > appearanceContrast('#ffffff', background), ink = light ? '#000000' : '#ffffff';
  const surface = mix(background, light ? '#ffffff' : '#000000', .045), elevated = mix(background, light ? '#ffffff' : '#000000', .09);
  const readable = (color: string) => { let result = color; for (let i = 0; i < 60 && [background, surface, elevated].some(target => appearanceContrast(result, target) < 4.5); i++) result = mix(result, ink, .12); return result; };
  const palette = customized ? { '--color-deep': background, '--color-surface': surface, '--color-elevated': elevated, '--color-border': mix(background, ink, .32), '--color-border-hover': mix(background, ink, .5), '--color-text-primary': readable(light ? '#191b1b' : '#eeeae2'), '--color-text-muted': readable(mix(background, ink, .8)), '--color-text-dim': readable(mix(background, ink, .7)), '--color-text-secondary': readable(mix(background, ink, .8)), '--color-background': background, '--color-bg-base': background, '--color-bg-elevated': elevated, '--color-accent-amber': readable('#e4a853'), '--color-accent-plum': readable('#7c5cbf'), '--color-accent-plum-light': readable('#9b7ed8'), '--color-success': readable('#4a9e6d'), '--color-warning': readable('#d4a843'), '--color-danger': readable('#c4463a'), '--color-accent-gold': readable(values.accent ?? (light ? '#725221' : '#d5b575')), backgroundColor: background, color: readable(light ? '#191b1b' : '#eeeae2'), colorScheme: (light ? 'light' : 'dark') as CSSProperties['colorScheme'] } : {};
  return { ...palette, ...(values.uiFont ? { '--font-sans': appearanceFonts[values.uiFont], fontFamily: appearanceFonts[values.uiFont] } : {}), ...(values.proseFont && values.proseFont !== 'reading' ? { '--workspace-prose-font': appearanceFonts[values.proseFont] } : {}), ...(values.backgroundImage ? { '--workspace-image': `url("${values.backgroundImage}")` } : {}), '--workspace-grain-opacity': (values.grain ?? 0) / 100 * .12 } as WorkspaceStyle;
}
/** A small deterministic local raster; no network, shipped image or SVG filter. */
export function localGrain(): string {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d'); if (!context) return '';
  const pixels = context.createImageData(64, 64); let seed = 73;
  for (let i = 0; i < pixels.data.length; i += 4) { seed = (seed * 1664525 + 1013904223) >>> 0; pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = seed >>> 24; pixels.data[i + 3] = 255; }
  context.putImageData(pixels, 0, 0); return canvas.toDataURL('image/png');
}
