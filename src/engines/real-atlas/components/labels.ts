// Small translated phrases the map and the list share. Kept out of the
// component modules so react-refresh keeps treating those as pure component
// files, and so the pluralisation rule lives in exactly one place.

type Translate = (key: string) => string;

/** "1 divergence" / "3 divergences": the app pluralises with a `…One` sibling key, as the measure panel's stages do. */
export function divergenceCountLabel(t: Translate, count: number): string {
  return count === 1
    ? t('realAtlas.divergences.countOne')
    : t('realAtlas.divergences.count').replace('{count}', () => String(count));
}

/**
 * A `{name}` placeholder filled with text the writer typed. `String.replace`
 * reads `$&`, `$'` and friends in a plain replacement string, so a bar called
 * "Sam $& Max" came out mangled; a function replacement is taken literally.
 */
export function fillName(template: string, name: string): string {
  return template.replace('{name}', () => name);
}
