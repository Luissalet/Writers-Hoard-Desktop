/** Portable formatting vocabulary shared by editor, publishing and MCP. */
export const FONT_FAMILIES = { inherit: 'inherit', serif: 'Georgia, serif', sans: 'Arial, sans-serif', mono: 'Consolas, monospace' } as const;
export const PARAGRAPH_STYLES = ['normal', 'lead', 'quote', 'caption'] as const;
export const SCENE_BREAK_STYLES = ['line', 'asterism', 'dots', 'diamond', 'space'] as const;
export type SceneBreakStyle = typeof SCENE_BREAK_STYLES[number];
export const SCENE_BREAK_TEXT:Record<SceneBreakStyle,string>={line:'—',asterism:'⁂',dots:'• • •',diamond:'◇',space:''};
export interface AdvancedFormatting {
  fontFamily?: string;
  fontSize?: number | null;
  color?: string | null;
  highlight?: string | null;
  alignment?: 'left' | 'center' | 'right' | 'justify';
  lineHeight?: number | null;
  indent?: number;
  firstLineIndent?: number;
  dropCap?: boolean;
  smallCaps?: boolean;
  ornament?: SceneBreakStyle;
  paragraphStyle?: (typeof PARAGRAPH_STYLES)[number];
  subscript?: boolean;
  superscript?: boolean;
}
export const FORMAT_ATTRIBUTES = {
  fontFamily: 'data-wh-font', fontSize: 'data-wh-size', color: 'data-wh-color',
  highlight: 'data-wh-highlight', alignment: 'data-wh-align', lineHeight: 'data-wh-line-height',
  indent: 'data-wh-indent', paragraphStyle: 'data-wh-paragraph-style',
  firstLineIndent:'data-wh-first-line-indent',dropCap:'data-wh-drop-cap',smallCaps:'data-wh-small-caps',ornament:'data-wh-ornament',
} as const;
export type FormatKey = keyof typeof FORMAT_ATTRIBUTES;
export function normalizeColumnWidths(value: unknown): number[] | null {
  const widths = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',').map(Number) : [];
  return widths.length && widths.every(width => typeof width === 'number' && Number.isFinite(width) && width >= 0) ? widths as number[] : null;
}
export const INLINE_KEYS: FormatKey[] = ['fontFamily', 'fontSize', 'color', 'highlight','smallCaps'];
export const BLOCK_KEYS: FormatKey[] = ['alignment', 'lineHeight', 'indent', 'paragraphStyle','firstLineIndent','dropCap'];
export const SCENE_BREAK_KEYS:FormatKey[]=['ornament'];

export function normalizeAdvancedFormatting(input: unknown): AdvancedFormatting {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const values = input as Record<string, unknown>;
  const result: AdvancedFormatting = {};
  if (typeof values.fontFamily === 'string' && (Object.hasOwn(FONT_FAMILIES, values.fontFamily) || /^\p{L}[\p{L}\p{N} -]*$/u.test(values.fontFamily))) result.fontFamily = values.fontFamily;
  for (const key of ['color', 'highlight'] as const) {
    const value = values[key];
    if (value === null) result[key] = null;
    else if (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)) result[key] = value.toLowerCase();
  }
  for (const key of ['fontSize', 'lineHeight', 'indent','firstLineIndent'] as const) {
    const value = values[key];
    if (value === null && key !== 'indent'&&key!=='firstLineIndent') result[key] = null;
    else if (typeof value === 'number' && Number.isFinite(value) && (key === 'indent'||key==='firstLineIndent' ? value >= 0 : value > 0)) result[key] = value;
  }
  if (['left', 'center', 'right', 'justify'].includes(String(values.alignment))) result.alignment = values.alignment as AdvancedFormatting['alignment'];
  if (PARAGRAPH_STYLES.includes(values.paragraphStyle as typeof PARAGRAPH_STYLES[number])) result.paragraphStyle = values.paragraphStyle as AdvancedFormatting['paragraphStyle'];
  for (const key of ['subscript', 'superscript','dropCap','smallCaps'] as const) if (typeof values[key] === 'boolean') result[key] = values[key];
  if(SCENE_BREAK_STYLES.includes(values.ornament as SceneBreakStyle))result.ornament=values.ornament as SceneBreakStyle;
  return result;
}

/** Read only our semantic attributes. Arbitrary incoming CSS is never retained. */
export function formattingFromElement(element: Element): AdvancedFormatting {
  const values: Record<string, unknown> = {};
  for (const [key, attr] of Object.entries(FORMAT_ATTRIBUTES)) {
    const value = element.getAttribute(attr);
    if (value !== null) values[key] = ['fontSize', 'lineHeight', 'indent','firstLineIndent'].includes(key) ? Number(value) : ['dropCap','smallCaps'].includes(key)?value==='true'?true:value==='false'?false:undefined:value;
  }
  return normalizeAdvancedFormatting(values);
}

export function formattingStyle(input: unknown): string {
  const format = normalizeAdvancedFormatting(input);
  const styles: string[] = [];
  if (format.fontFamily && format.fontFamily !== 'inherit') styles.push(`font-family:${Object.hasOwn(FONT_FAMILIES, format.fontFamily) ? FONT_FAMILIES[format.fontFamily as keyof typeof FONT_FAMILIES] : `"${format.fontFamily}"`}`);
  if (format.fontSize) styles.push(`font-size:${format.fontSize}pt`);
  if (format.color) styles.push(`color:${format.color}`);
  if (format.highlight) styles.push(`background-color:${format.highlight}`);
  if (format.alignment && format.alignment !== 'left') styles.push(`text-align:${format.alignment}`);
  if (format.lineHeight) styles.push(`line-height:${format.lineHeight}`);
  if (format.indent) styles.push(`margin-inline-start:${format.indent * 1.5}em`);
  if(format.firstLineIndent!==undefined)styles.push(`text-indent:${format.firstLineIndent}em`);
  if(format.smallCaps!==undefined)styles.push(`font-variant-caps:${format.smallCaps?'small-caps':'normal'}`);
  if (format.paragraphStyle === 'lead') styles.push('font-size:1.15em');
  if (format.paragraphStyle === 'quote') styles.push('font-style:italic');
  if (format.paragraphStyle === 'caption') styles.push('font-size:0.85em');
  return styles.join(';');
}

export function formattingHtmlAttributes(input: unknown, keys: readonly FormatKey[]): Record<string, string> {
  const format = normalizeAdvancedFormatting(input);
  const output: Record<string, string> = {};
  for (const key of keys) {
    const value = format[key];
    if (value !== undefined && value !== null) output[FORMAT_ATTRIBUTES[key]] = String(value);
  }
  const style = formattingStyle(Object.fromEntries(keys.map(key => [key, format[key]])));
  if (style) output.style = style;
  return output;
}
