import type { CSSProperties } from 'react';
import type { WorldEra } from './types';
export function eraThemeStyle(era?: WorldEra): CSSProperties {
  const background = era?.theme?.background ?? (era?.theme?.accent ? '#17191a' : undefined); if (!background || !/^#[\da-f]{6}$/i.test(background)) return {};
  const rgb = [1, 3, 5].map(index => parseInt(background.slice(index, index + 2), 16)), light = rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 > 150;
  const ink = light ? [25, 27, 27] : [238, 234, 226];
  const mix = (fraction: number) => `#${rgb.map((value, index) => Math.round(value * (1 - fraction) + ink[index] * fraction).toString(16).padStart(2, '0')).join('')}`;
  const luminance = (values: number[]) => values.map(value => { const normalized = value / 255; return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const original = era?.theme?.accent ?? (light ? '#6c4531' : '#d5b575');
  let accent = [1, 3, 5].map(index => parseInt(original.slice(index, index + 2), 16));
  const surface = [1, 3, 5].map(index => parseInt(mix(.09).slice(index, index + 2), 16));
  const contrast = () => { const a = luminance(accent), b = luminance(surface); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
  for (let step = 0; step < 50 && contrast() < 4.5; step++) accent = accent.map(value => Math.round(value * .9 + (light ? 0 : 255) * .1));
  const accentColor = `#${accent.map(value => value.toString(16).padStart(2, '0')).join('')}`;
  return { '--color-deep': background, '--color-surface': mix(.045), '--color-elevated': mix(.09), '--color-border': mix(.27), '--color-text-primary': light ? '#191b1b' : '#eeeae2', '--color-text-muted': mix(.78), '--color-text-dim': mix(.68), '--color-accent-gold': accentColor, backgroundColor: background, color: light ? '#191b1b' : '#eeeae2' } as CSSProperties;
}
