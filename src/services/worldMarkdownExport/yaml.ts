// ============================================
// World Markdown export — YAML frontmatter writer
// ============================================
// Small, dependency-free and strict: every scalar that a YAML reader could
// take for something else (a number, a boolean, a date, text with a colon) is
// written as a double-quoted JSON string, which is valid YAML.

export type YamlValue = string | number | boolean | null | undefined | YamlValue[] | { [key: string]: YamlValue };

const PLAIN = /^[\p{L}][\p{L}\p{N} _./()'-]*$/u;
const RESERVED = /^(?:true|false|yes|no|on|off|null|y|n|~)$/i;

export function yamlScalar(value: string | number | boolean | null): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (PLAIN.test(value) && !RESERVED.test(value) && !/\s$/.test(value) && !value.includes(': ') && !value.includes(' #')) return value;
  return JSON.stringify(value);
}

function isEmpty(value: YamlValue): boolean {
  return value === undefined || (Array.isArray(value) && value.length === 0) || (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0);
}

function lines(key: string, value: YamlValue, indent: string): string[] {
  const name = yamlScalar(key);
  if (value === undefined) return [];
  if (Array.isArray(value)) {
    if (!value.length) return [`${indent}${name}: []`];
    return [`${indent}${name}:`, ...value.flatMap(item => (item !== null && typeof item === 'object')
      ? [`${indent}  - ${JSON.stringify(item)}`]
      : [`${indent}  - ${yamlScalar(item as string | number | boolean | null)}`])];
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, inner]) => inner !== undefined);
    if (!entries.length) return [`${indent}${name}: {}`];
    return [`${indent}${name}:`, ...entries.flatMap(([inner, innerValue]) => lines(inner, innerValue, `${indent}  `))];
  }
  return [`${indent}${name}: ${yamlScalar(value)}`];
}

/** A `---` block. Empty arrays and objects are left out so cards stay short. */
export function frontmatter(data: Record<string, YamlValue>): string {
  const body = Object.entries(data).filter(([, value]) => !isEmpty(value)).flatMap(([key, value]) => lines(key, value, ''));
  return `---\n${body.join('\n')}\n---\n\n`;
}

export function isoDate(time: number | undefined): string | undefined {
  return typeof time === 'number' && Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}
