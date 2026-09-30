// ============================================
// Citation check (pure)
// ============================================
//
// A report line that states something checkable must point at a source that
// still stands. Markers are numeric (`[1]`, `[1, 2]`, `[1][2]`) and resolve to
// the report's source list. The check FLAGS; it never rewrites or hides text.
//
// "Factual" is a deliberately blunt heuristic: a statement of four or more words
// that contains a number or a capitalised word in mid-sentence (a name, a place,
// a date). Questions, headings, tables, code and the sections the caller says
// to skip are not checked (nor are blockquotes: the report uses them for notes
// and for the flags this check itself raised). It will miss subtle claims and flag the odd
// harmless line; it is a safety net, not a judge.

export interface CheckSource {
  number: number;
  /** Not retracted and its excerpt exists. */
  active: boolean;
}

export type CitationIssueKind = 'uncited' | 'retracted-marker' | 'unknown-marker';

export interface CitationIssue {
  kind: CitationIssueKind;
  /** 1-based line of the text. */
  line: number;
  sentence: string;
  marker?: number;
}

export interface CitationCheckResult {
  issues: CitationIssue[];
  factualSentences: number;
  /** Factual sentences carrying at least one marker to an active source. */
  citedSentences: number;
  ok: boolean;
}

export interface CitationCheckOptions {
  /** Headings (case-insensitive, prefix match) whose section is not checked. */
  skipSections?: readonly string[];
}

const MARKER_GROUP = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

export function markersIn(text: string): number[] {
  const numbers: number[] = [];
  for (const match of text.matchAll(MARKER_GROUP)) {
    for (const part of match[1].split(',')) numbers.push(Number(part.trim()));
  }
  return numbers;
}

/** Drops markers, emphasis and the `_(metadata)_` tail the report builder appends. */
function plain(sentence: string): string {
  return sentence
    .replace(/_\([^)]*\)_/g, ' ')
    .replace(MARKER_GROUP, ' ')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isFactualSentence(sentence: string): boolean {
  const text = plain(sentence).replace(/^(?:[-+>]|\d+[.)])\s+/, '');
  if (!text || text.endsWith('?')) return false;
  const words = text.split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word));
  if (words.length < 4) return false;
  if (/\d/.test(text)) return true;
  // A capitalised word after the first one: a name or place stated as fact.
  return words.slice(1).some(word => /^\p{Lu}[\p{L}'’-]*$/u.test(word.replace(/^[("“]+/, '')));
}

/** Put markers that trail the full stop before it, so a sentence owns its marker. */
function attachTrailingMarkers(line: string): string {
  return line.replace(/([.!?])\s*((?:\[\d+(?:\s*,\s*\d+)*\]\s*)+)/g, (_all, stop: string, markers: string) => ` ${markers.trim()}${stop} `);
}

function splitSentences(line: string): string[] {
  return attachTrailingMarkers(line).split(/(?<=[.!?])\s+/).map(part => part.trim()).filter(Boolean);
}

export function checkCitations(text: string, sources: readonly CheckSource[], options: CitationCheckOptions = {}): CitationCheckResult {
  const byNumber = new Map(sources.map(source => [source.number, source]));
  const skip = (options.skipSections ?? []).map(title => title.trim().toLowerCase()).filter(Boolean);
  const issues: CitationIssue[] = [];
  let factual = 0;
  let cited = 0;
  let skipping = false;
  let inCode = false;

  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (line.startsWith('```')) { inCode = !inCode; return; }
    if (inCode || !line) return;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      const title = heading[1].trim().toLowerCase();
      skipping = skip.some(prefix => title.startsWith(prefix));
      return;
    }
    if (skipping || line.startsWith('|') || line.startsWith('>') || /^[-*_]{3,}$/.test(line)) return;

    for (const sentence of splitSentences(line)) {
      const markers = markersIn(sentence);
      let hasActive = false;
      for (const marker of markers) {
        const source = byNumber.get(marker);
        if (!source) issues.push({ kind: 'unknown-marker', line: index + 1, sentence, marker });
        else if (!source.active) issues.push({ kind: 'retracted-marker', line: index + 1, sentence, marker });
        else hasActive = true;
      }
      if (!isFactualSentence(sentence)) continue;
      factual += 1;
      if (hasActive) cited += 1;
      else issues.push({ kind: 'uncited', line: index + 1, sentence });
    }
  });

  return { issues, factualSentences: factual, citedSentences: cited, ok: issues.length === 0 };
}
