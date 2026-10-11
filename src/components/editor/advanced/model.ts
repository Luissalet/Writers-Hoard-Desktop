/** Portable formatting vocabulary shared by editor, publishing and MCP. */
export const FONT_FAMILIES = { inherit: 'inherit', serif: 'Georgia, serif', sans: 'Arial, sans-serif', mono: 'Consolas, monospace' } as const;
export const PARAGRAPH_STYLES = ['normal', 'lead', 'quote', 'caption'] as const;
export interface AdvancedFormatting {
  fontFamily?: string;
  fontSize?: number | null;
  color?: string | null;
  highlight?: string | null;
  alignment?: 'left' | 'center' | 'right' | 'justify';
  lineHeight?: number | null;
  indent?: number;
  paragraphStyle?: (typeof PARAGRAPH_STYLES)[number];
  subscript?: boolean;
  superscript?: boolean;
}
export const FORMAT_ATTRIBUTES = {
  fontFamily: 'data-wh-font', fontSize: 'data-wh-size', color: 'data-wh-color',
  highlight: 'data-wh-highlight', alignment: 'data-wh-align', lineHeight: 'data-wh-line-height',
  indent: 'data-wh-indent', paragraphStyle: 'data-wh-paragraph-style',
} as const;
export type FormatKey = keyof typeof FORMAT_ATTRIBUTES;
export function normalizeColumnWidths(value: unknown): number[] | null {
  const widths = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',').map(Number) : [];
  return widths.length && widths.length <= 64 && widths.every(width => typeof width === 'number' && Number.isInteger(width) && width >= 0 && width <= 4096) ? widths as number[] : null;
}
export const INLINE_KEYS: FormatKey[] = ['fontFamily', 'fontSize', 'color', 'highlight'];
export const BLOCK_KEYS: FormatKey[] = ['alignment', 'lineHeight', 'indent', 'paragraphStyle'];

export function normalizeAdvancedFormatting(input: unknown): AdvancedFormatting {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const values = input as Record<string, unknown>;
  const result: AdvancedFormatting = {};
  if (typeof values.fontFamily === 'string' && (Object.hasOwn(FONT_FAMILIES, values.fontFamily) || /^[A-Za-z][A-Za-z0-9 -]{0,63}$/.test(values.fontFamily))) result.fontFamily = values.fontFamily;
  for (const key of ['color', 'highlight'] as const) {
    const value = values[key];
    if (value === null) result[key] = null;
    else if (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)) result[key] = value.toLowerCase();
  }
  for (const [key, min, max] of [['fontSize', 8, 72], ['lineHeight', 1, 3], ['indent', 0, 8]] as const) {
    const value = values[key];
    if (value === null && key !== 'indent') result[key] = null;
    else if (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (key !== 'indent' || Number.isInteger(value))) result[key] = value;
  }
  if (['left', 'center', 'right', 'justify'].includes(String(values.alignment))) result.alignment = values.alignment as AdvancedFormatting['alignment'];
  if (PARAGRAPH_STYLES.includes(values.paragraphStyle as typeof PARAGRAPH_STYLES[number])) result.paragraphStyle = values.paragraphStyle as AdvancedFormatting['paragraphStyle'];
  for (const key of ['subscript', 'superscript'] as const) if (typeof values[key] === 'boolean') result[key] = values[key];
  return result;
}

/** Read only our semantic attributes. Arbitrary incoming CSS is never retained. */
export function formattingFromElement(element: Element): AdvancedFormatting {
  const values: Record<string, unknown> = {};
  for (const [key, attr] of Object.entries(FORMAT_ATTRIBUTES)) {
    const value = element.getAttribute(attr);
    if (value !== null) values[key] = ['fontSize', 'lineHeight', 'indent'].includes(key) ? Number(value) : value;
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
