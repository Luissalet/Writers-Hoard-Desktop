/** Alias fields used by manual entries and worldbuilding imports. */
export function isAliasField(key: string): boolean {
  return /^(alias|aliases|aka|apodo|apodos|sobrenombre|sobrenombres|nickname|nicknames|otros nombres|also known as|other names)$/i.test(key.trim());
}

export function foldAlias(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** JSON arrays preserve aliases containing punctuation; manual values accept separators. */
export function parseAliasValue(value: unknown): string[] {
  let values: unknown[];
  if (Array.isArray(value)) values = value;
  else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        values = Array.isArray(parsed) ? parsed : trimmed.split(/[,;|\n]/);
      } catch {
        values = trimmed.split(/[,;|\n]/);
      }
    } else values = trimmed.split(/[,;|\n]/);
  } else return [];
  const seen = new Set<string>();
  return values.flatMap(value => {
    if (typeof value !== 'string') return [];
    const alias = value.trim();
    const folded = foldAlias(alias);
    if (!alias || seen.has(folded)) return [];
    seen.add(folded);
    return [alias];
  });
}

export function readAliases(fields: Record<string, string> = {}): string[] {
  const seen = new Set<string>();
  return Object.entries(fields).filter(([key]) => isAliasField(key)).flatMap(([, value]) =>
    parseAliasValue(value).filter(alias => {
      const folded = foldAlias(alias);
      if (seen.has(folded)) return false;
      seen.add(folded);
      return true;
    }),
  );
}

/** Only alias fields change: all other author/import metadata survives editing. */
export function replaceAliases(fields: Record<string, string>, aliases: readonly string[]): Record<string, string> {
  const next = Object.fromEntries(Object.entries(fields).filter(([key]) => !isAliasField(key)));
  const unique = parseAliasValue([...aliases]);
  if (unique.length) next.aliases = JSON.stringify(unique);
  return next;
}
