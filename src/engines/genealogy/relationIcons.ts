import { RELATION_ICON_DATA } from './relationIconData';
export const RELATION_ICON_NAMES = Object.keys(RELATION_ICON_DATA);
export const isRelationIcon = (value: unknown): value is string => typeof value === 'string' && Object.hasOwn(RELATION_ICON_DATA, value);
/** Only bundled paths are emitted. Author strings never become SVG elements or attributes. */
export function relationIconSvg(name: string | undefined, x: number, y: number): string {
  if (!isRelationIcon(name)) return '';
  const escape = (value: string | number) => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
  const paths = RELATION_ICON_DATA[name].map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([key, value]) => `${key}="${escape(value)}"`).join(' ')}/>`).join('');
  return `<svg x="${x}" y="${y}" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#716650" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><title>${name}</title>${paths}</svg>`;
}
