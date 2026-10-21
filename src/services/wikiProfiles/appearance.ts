import type { WorldWikiOptions } from '@/types/worldWiki';
export const WIKI_FONTS = {
  georgia: { name: 'Georgia', family: 'Georgia,serif' }, times: { name: 'Times', family: '"Times New Roman",Times,serif' },
  palatino: { name: 'Palatino', family: '"Palatino Linotype",Palatino,serif' }, garamond: { name: 'Garamond', family: 'Garamond,serif' },
  cambria: { name: 'Cambria', family: 'Cambria,Georgia,serif' }, arial: { name: 'Arial', family: 'Arial,sans-serif' },
  verdana: { name: 'Verdana', family: 'Verdana,sans-serif' }, trebuchet: { name: 'Trebuchet', family: '"Trebuchet MS",sans-serif' },
  tahoma: { name: 'Tahoma', family: 'Tahoma,sans-serif' }, segoe: { name: 'Segoe UI', family: '"Segoe UI",system-ui,sans-serif' },
  calibri: { name: 'Calibri', family: 'Calibri,Arial,sans-serif' }, courier: { name: 'Courier', family: '"Courier New",monospace' },
  consolas: { name: 'Consolas', family: 'Consolas,"Liberation Mono",monospace' },
} as const;
export type WikiFont = keyof typeof WIKI_FONTS;
export interface WikiColors { background: string; accent: string; secondary: string; text: string; border: string }
export interface WikiBranding { name?: string; footer?: string; mark?: string }
export const WIKI_COLOR_KEYS = ['background','accent','secondary','text','border'] as const;
export function validateWikiAppearance(options: { colors?: unknown; headingFont?: unknown; bodyFont?: unknown; branding?: unknown }): void {
  for (const font of [options.headingFont, options.bodyFont]) if (font !== undefined && (typeof font !== 'string' || !Object.hasOwn(WIKI_FONTS, font))) throw Error('wiki_font_invalid');
  if (options.colors !== undefined) {
    if (!options.colors || typeof options.colors !== 'object' || Array.isArray(options.colors) || Object.entries(options.colors).some(([key, value]) => !WIKI_COLOR_KEYS.includes(key as typeof WIKI_COLOR_KEYS[number]) || typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value))) throw Error('wiki_colors_invalid');
  }
  if (options.branding !== undefined) {
    if (!options.branding || typeof options.branding !== 'object' || Array.isArray(options.branding)) throw Error('wiki_branding_invalid');
    for (const [key, value] of Object.entries(options.branding)) if (!['name','footer','mark'].includes(key) || value !== undefined && (typeof value !== 'string' || key === 'mark' && !/^data:image\/(png|jpe?g|webp|gif|avif|bmp);base64,[a-z\d+/=\s]+$/i.test(value))) throw Error('wiki_branding_invalid');
  }
}
export function wikiAppearanceStyle(options: WorldWikiOptions): string {
  validateWikiAppearance(options);
  const colors = options.colors, fonts = options.headingFont ? `h1,h2,h3,h4,h5,h6{font-family:${WIKI_FONTS[options.headingFont].family}}` : '';
  const body = options.bodyFont ? `body{font-family:${WIKI_FONTS[options.bodyFont].family}}` : '';
  const palette = colors ? `:root{${Object.entries(colors).map(([key,value]) => `--${({background:'paper',accent:'accent',secondary:'secondary',text:'ink',border:'line'} as const)[key as keyof WikiColors]}:${value}`).join(';')};--muted:color-mix(in srgb,var(--ink) 78%,var(--paper))}header,button,input,select,.prose pre{background:var(--secondary,var(--paper));color:var(--ink)}` : '';
  const terminal = options.layout === 'terminal' || options.layout === 'shell' ? `body{font-family:${options.bodyFont ? WIKI_FONTS[options.bodyFont].family : WIKI_FONTS.consolas.family}}.layout{max-width:1440px;gap:32px}article{border:1px solid var(--line);padding:24px;border-radius:0}header{border-bottom:3px double var(--line)}header h1{text-transform:uppercase;letter-spacing:.04em}.meta{font-family:inherit}nav{border-right:1px solid var(--line);padding-right:20px}@media(max-width:760px){nav{border-right:0;border-bottom:1px solid var(--line);padding-bottom:24px}}` : '';
  return `${palette}${terminal}${fonts}${body}.wiki-brand{display:flex;align-items:center;gap:12px;font:600 16px/1.4 system-ui;margin-bottom:20px}.wiki-mark{width:48px;height:48px;object-fit:contain}.wiki-footer{max-width:1280px;margin:0 auto;padding:24px;white-space:pre-wrap;overflow-wrap:anywhere;border-top:1px solid var(--line)}`;
}
/** Applying a saved look never changes source era, sections or content policy. */
export function wikiAppearanceCopy(options: WorldWikiOptions): Pick<WorldWikiOptions, 'theme'|'font'|'accent'|'colors'|'headingFont'|'bodyFont'> {
  return { theme: options.theme, font: options.font, accent: options.accent, colors: options.colors ? { ...options.colors } : undefined, headingFont: options.headingFont, bodyFont: options.bodyFont };
}
