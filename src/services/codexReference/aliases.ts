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

/**
 * Words too common to stand for a card: an alias like "el" or "the" would link
 * every page. Spanish and English function words, folded (no accents).
 */
const COMMON_WORDS = new Set(`
a al algo alli ante antes aqui asi aun bajo bien cada como con contra cual cuando de del desde donde dos e el ella ellas ello ellos en entre era es esa ese eso esta este esto fue ha hay la las le les lo los mas me mi mientras muy nada ni no nos o os otra otro para pero poco por porque que quien se si sin sobre solo son su sus tal tan te ti todo tras tu un una uno unos unas y ya yo
an and are as at be but by for from had has have he her him his i if in into is it its me my no nor not of on or our she so than that the their them then there they this to too up us was we were what when where which who why will with you your
`.split(/\s+/).filter(Boolean));

export type AliasProblem = 'short' | 'common' | 'title';

/** Why an alias would not work as a name of the card, or null when it is fine. */
export function aliasProblem(alias: string, title = ''): AliasProblem | null {
  const folded = foldAlias(alias.trim()).replace(/\s+/g, ' ');
  if (folded.length < 2) return 'short';
  if (COMMON_WORDS.has(folded)) return 'common';
  if (title && folded === foldAlias(title.trim()).replace(/\s+/g, ' ')) return 'title';
  return null;
}

/** Aliases that stand for a card: common words are kept on the sheet but never link text. */
export function isLinkingAlias(alias: string): boolean {
  return aliasProblem(alias) === null;
}

const LEADING_ARTICLE = /^(el|la|los|las|lo|un|una|the|a|an)\s+/i;

/**
 * Names the card could also go by, read from its title: the title without its
 * article ("El Bosque Negro" → "Bosque Negro"), the part before a comma or an
 * epithet ("Aragorn, hijo de Arathorn" → "Aragorn"), and the first and last
 * word of a person's plain name ("Ana Ruiz" → "Ana", "Ruiz"). Never one already
 * given, nor a common word.
 */
export function suggestAliases(title: string, existing: readonly string[] = [], options: { person?: boolean; limit?: number } = {}): string[] {
  const limit = options.limit ?? 4;
  const name = title.trim().replace(/\s+/g, ' ');
  if (!name) return [];
  const taken = new Set([foldAlias(name), ...existing.map(item => foldAlias(item.trim()))]);
  const out: string[] = [];
  const add = (raw: string) => {
    const value = raw.trim().replace(/^[,;:\-–—\s]+|[,;:\-–—\s]+$/g, '');
    const folded = foldAlias(value);
    if (!value || taken.has(folded) || aliasProblem(value) || value.length < 3) return;
    taken.add(folded);
    out.push(value);
  };
  add(name.replace(LEADING_ARTICLE, ''));
  // An epithet after a comma, or for a person after "de"/"hijo de"/"of"…
  const head = name.split(options.person ? /,|\s+(?:de|del|of|the|el|la|hijo|hija|son|daughter)\s+/i : /,/)[0];
  if (head !== name) add(head.replace(LEADING_ARTICLE, ''));
  else if (options.person) {
    const words = name.split(' ');
    if (words.length >= 2 && words.length <= 4 && words.every(word => /^\p{Lu}/u.test(word))) { add(words[0]); add(words[words.length - 1]); }
  }
  return out.slice(0, limit);
}
