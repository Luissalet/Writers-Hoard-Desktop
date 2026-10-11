// ============================================================================
// Beta reading — text helpers (pure: no DOM, no Dexie)
// ============================================================================
//
// Everything that decides what a chapter's "plain text" is lives here, because
// three places must agree on it byte for byte: the package builder (which
// writes the snapshot and the paragraph numbers), the reader page (which cuts a
// quote out of what the reader selected) and the importer (which looks for
// that quote in the chapter as it is today).
//
// A chapter is a list of BLOCKS: its top-level elements, each reduced to one
// normalised line of text. The paragraph index a comment carries is the index
// in that list; the snapshot is the block texts joined by "\n".

/** Collapse every run of whitespace (nbsp included) to one space and trim. */
export function normalizeText(value: string): string {
  return value.replace(/[\s\u00a0]+/g, ' ').trim();
}

/** 53-bit string hash (cyrb53), rendered as 14 hex digits. Not cryptographic: an identity, not a secret. */
export function hashText(value: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const high = (2097151 & h2).toString(16).padStart(6, '0');
  const low = (h1 >>> 0).toString(16).padStart(8, '0');
  return `${high}${low}`;
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Text of one fragment of HTML, as a browser's textContent would give it once `prepareBlockHtml` has run. */
export function htmlToText(html: string): string {
  const withoutScripts = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ');
  const spaced = withoutScripts.replace(/<br\s*\/?>/gi, ' ').replace(/<\/(li|p|div|h[1-6]|tr|td|th|blockquote)>/gi, ' ');
  return normalizeText(decodeEntities(spaced.replace(/<[^>]*>/g, '')));
}

/**
 * Put a space after the tags whose end is a line break in the reader's eyes, so
 * that the browser's textContent of a block equals `htmlToText` of it.
 */
export function prepareBlockHtml(html: string): string {
  return html.replace(/<br\s*\/?>/gi, '<br> ').replace(/<\/li>/gi, '</li> ');
}

export interface TextBlock {
  /** Sanitised HTML of the top-level element (or a <p> wrapped around loose text). */
  html: string;
  /** Normalised plain text; may be empty for a picture. */
  text: string;
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/**
 * The chapter's top-level elements. A block with neither text nor a picture is
 * dropped (an empty paragraph is not something a reader can comment on).
 * Total: unbalanced markup never throws, it just closes at the end.
 */
export function splitBlocks(html: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  const push = (fragment: string) => {
    const text = htmlToText(fragment);
    if (text || /<img\b/i.test(fragment)) blocks.push({ html: fragment, text });
  };
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  let depth = 0;
  let start = 0;
  let loose = 0;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(html)) !== null) {
    const closing = match[1] === '/';
    const name = match[2].toLowerCase();
    const selfClosed = match[3] === '/' || VOID_TAGS.has(name);
    if (depth === 0) {
      if (closing) continue; // a stray closer
      const before = html.slice(loose, match.index);
      if (htmlToText(before)) push(`<p>${before.trim()}</p>`);
      if (selfClosed) {
        if (name === 'img') push(match[0]);
        loose = tag.lastIndex;
        continue;
      }
      start = match.index;
      depth = 1;
      continue;
    }
    if (selfClosed) continue;
    depth += closing ? -1 : 1;
    if (depth === 0) {
      push(html.slice(start, tag.lastIndex));
      loose = tag.lastIndex;
    }
  }
  if (depth > 0) push(html.slice(start));
  else {
    const rest = html.slice(loose);
    if (htmlToText(rest)) push(`<p>${rest.trim()}</p>`);
  }
  return blocks;
}

/** The chapter's snapshot text: block texts, one per line. */
export function blocksToSnapshot(blocks: readonly TextBlock[]): string {
  return blocks.map(block => block.text).join('\n');
}

export function chapterHash(snapshot: string): string {
  return hashText(normalizeText(snapshot.replace(/\n/g, ' ')));
}

// ---------------------------------------------------------------------------
// Word-level diff
// ---------------------------------------------------------------------------

export interface TextDiff {
  /** Words only in the newer text. */
  added: number;
  /** Words only in the older text. */
  removed: number;
  /** Words both share, in order. */
  kept: number;
  /** Paragraphs of the newer text that did not exist verbatim in the older. */
  changedParagraphs: number;
  /** 0..1: share of words that changed, against the larger of the two texts. */
  ratio: number;
  changed: boolean;
  /** True when the pair was too large for an exact count and the numbers are an estimate. */
  estimated: boolean;
}

function words(value: string): string[] {
  const out = normalizeText(value).split(' ');
  return out.length === 1 && out[0] === '' ? [] : out;
}

/** Length of the longest common subsequence of two word lists (two-row DP). */
function lcsLength(a: readonly string[], b: readonly string[]): number {
  if (!a.length || !b.length) return 0;
  const [outer, inner] = a.length >= b.length ? [a, b] : [b, a];
  let previous = new Uint32Array(inner.length + 1);
  let current = new Uint32Array(inner.length + 1);
  for (let i = 1; i <= outer.length; i++) {
    for (let j = 1; j <= inner.length; j++) {
      current[j] = outer[i - 1] === inner[j - 1]
        ? previous[j - 1] + 1
        : Math.max(previous[j], current[j - 1]);
    }
    [previous, current] = [current, previous];
  }
  return previous[inner.length];
}

/** Word-level difference between a snapshot and the chapter as it is now. */
export function diffText(older: string, newer: string): TextDiff {
  const before = words(older);
  const after = words(newer);
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (
    tail < before.length - head && tail < after.length - head
    && before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) tail++;
  const a = before.slice(head, before.length - tail);
  const b = after.slice(head, after.length - tail);

  let common: number;
  let estimated = false;
  if (a.length * b.length <= 40_000_000) common = lcsLength(a, b);
  else {
    // Too big for the quadratic count: the multiset overlap is an upper bound on the LCS.
    estimated = true;
    const bag = new Map<string, number>();
    for (const word of a) bag.set(word, (bag.get(word) ?? 0) + 1);
    common = 0;
    for (const word of b) {
      const left = bag.get(word) ?? 0;
      if (left > 0) { common++; bag.set(word, left - 1); }
    }
  }
  const kept = head + tail + common;
  const added = after.length - kept;
  const removed = before.length - kept;
  const oldParagraphs = new Set(older.split('\n').map(normalizeText));
  const changedParagraphs = newer.split('\n').filter(line => normalizeText(line) && !oldParagraphs.has(normalizeText(line))).length;
  const larger = Math.max(before.length, after.length);
  return {
    added, removed, kept, changedParagraphs,
    ratio: larger ? (added + removed) / (2 * larger) : 0,
    changed: added > 0 || removed > 0 || changedParagraphs > 0,
    estimated,
  };
}
