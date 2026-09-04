// ============================================================================
// Wildcards, resolved HERE — because a recipe holding `{a|b|c}` is not a recipe
// ============================================================================
//
// `{red|blue|green}` and `__hair__` are resolved client-side, before anything
// is sent, and the RESOLVED text is what goes in the request and what is stored
// on the row. The alternative — letting a server expand them — produces a
// stored prompt that reproduces a different picture every time it is run, which
// quietly destroys the one promise a seed makes.
//
// The picks are seeded from the generation's own seed, so the same seed with
// the same prompt makes the same choices. A batch of four with incrementing
// seeds therefore explores the wildcards as well as the noise, which is what a
// writer means by "give me four".

/** One `{…}` or `__file__` that was replaced, and what it became. */
export interface WildcardPick {
  token: string;
  choice: string;
}

export interface WildcardResolution {
  text: string;
  picks: WildcardPick[];
  /** `__names__` with no list behind them. Left in the text, and said out loud. */
  unresolved: string[];
}

/** Deterministic, so the same seed reproduces the same prompt. */
function makeRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Split on `|` at brace depth zero, so `{a|{b|c}}` has two options, not three. */
function splitOptions(body: string): string[] {
  const options: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of body) {
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (char === '|' && depth === 0) {
      options.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  options.push(current);
  return options;
}

/** The innermost `{…}`: no braces inside, so its options are already literal. */
function findInnermostGroup(text: string): { start: number; end: number } | null {
  const start = text.lastIndexOf('{');
  if (start < 0) return null;
  const end = text.indexOf('}', start);
  if (end < 0) return null;
  return { start, end };
}

/** Deep enough for a nested list of lists; short enough that a cycle terminates. */
const MAX_ROUNDS = 64;

const FILE_TOKEN = /__([A-Za-z0-9_-]+)__/g;

export function hasWildcards(text: string): boolean {
  return /\{[^{}]*\|/.test(text) || /__[A-Za-z0-9_-]+__/.test(text);
}

/**
 * Resolve every wildcard in `text`.
 *
 * `files` maps a wildcard name to its lines. A name with no list is LEFT IN
 * PLACE, exactly as written, and reported: deleting it would send a prompt the
 * writer never wrote, and expanding it to nothing would silently drop whatever
 * it was carrying. The composer shows the unresolved names in the warning tone
 * so the prompt is fixed before it is spent on a generation.
 */
export function resolveWildcards(
  text: string,
  seed: number,
  files: Readonly<Record<string, readonly string[]>> = {},
): WildcardResolution {
  const random = makeRandom(seed);
  const picks: WildcardPick[] = [];
  const unresolved = new Set<string>();
  let out = text;

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const group = findInnermostGroup(out);
    if (group) {
      const token = out.slice(group.start, group.end + 1);
      const options = splitOptions(out.slice(group.start + 1, group.end)).map((option) => option.trim());
      const choice = options.length ? options[Math.floor(random() * options.length)] : '';
      picks.push({ token, choice });
      out = out.slice(0, group.start) + choice + out.slice(group.end + 1);
      continue;
    }
    const replacement = replaceFirstKnownFile(out, files, random, picks, unresolved);
    if (!replacement) break;
    out = replacement;
  }

  return { text: tidy(out), picks, unresolved: [...unresolved] };
}

/**
 * Replace the first `__name__` that has a list, recording every name that does
 * not. Scanning past the unknown ones rather than rewriting them is what keeps
 * an unresolved wildcard identical to what the writer typed.
 */
function replaceFirstKnownFile(
  text: string,
  files: Readonly<Record<string, readonly string[]>>,
  random: () => number,
  picks: WildcardPick[],
  unresolved: Set<string>,
): string | null {
  FILE_TOKEN.lastIndex = 0;
  let match = FILE_TOKEN.exec(text);
  while (match) {
    const [token, name] = match;
    const lines = files[name.toLowerCase()] ?? files[name];
    if (lines && lines.length > 0) {
      const choice = lines[Math.floor(random() * lines.length)];
      picks.push({ token, choice });
      return text.slice(0, match.index) + choice + text.slice(match.index + token.length);
    }
    unresolved.add(name);
    match = FILE_TOKEN.exec(text);
  }
  return null;
}

/** An option that expanded to nothing leaves ", ," behind; nobody typed that. */
function tidy(text: string): string {
  return text
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,(\s*,)+/g, ',')
    .replace(/^[\s,]+|[\s,]+$/g, '');
}

/**
 * Wildcard lists built from the project's own style references.
 *
 * There is no wildcard-file table to read — this engine owns exactly one table
 * and it is not this — so the lists a writer can name are the reusable prompt
 * blocks they have already built as references. `__lighting__` picks one line
 * of the reference called "lighting".
 */
export function wildcardFilesFromRefs(
  refs: readonly { name: string; promptFragment?: string }[],
): Record<string, string[]> {
  const files: Record<string, string[]> = {};
  for (const ref of refs) {
    const fragment = ref.promptFragment?.trim();
    if (!fragment) continue;
    const key = ref.name.trim().toLowerCase().replace(/\s+/g, '_');
    if (!key) continue;
    // One line per option: a fragment written as a paragraph is one option, and
    // splitting it on commas would turn a description into a lottery.
    files[key] = fragment.split('\n').map((line) => line.trim()).filter(Boolean);
  }
  return files;
}
