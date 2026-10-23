// Prep blocks in Markdown, both ways. Written as an alert ("> [!CHECK] ...")
// whose first line reads like the block and whose last line is a comment with
// the block's data, so a note read through the bridge and written back keeps
// every field. A hand-written alert with no comment is read from its words.
import { checkText, encounterRowText, handoutText, normalizeCheck, normalizeEncounter, normalizeHandout, parsePrepData, prepBlockHtml, type CheckData, type EncounterData, type EncounterRow, type HandoutData, type PrepKind, type PrepLang } from './model';

const COMMENT = /^<!--\s*wh-prep\s+(\{[\s\S]*\})\s*-->$/;
const ALERT_WORDS: Record<string, { kind: PrepKind; lang: PrepLang }> = {
  CHECK: { kind: 'check', lang: 'en' }, PRUEBA: { kind: 'check', lang: 'es' },
  ENCOUNTER: { kind: 'encounter', lang: 'en' }, ENCUENTRO: { kind: 'encounter', lang: 'es' },
  HANDOUT: { kind: 'handout', lang: 'en' }, MATERIAL: { kind: 'handout', lang: 'es' },
};
export const PREP_ALERT_PATTERN = 'CHECK|PRUEBA|ENCOUNTER|ENCUENTRO|HANDOUT|MATERIAL';

const dataComment = (data: unknown) => `<!-- wh-prep ${JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')} -->`;

/** The Markdown of a block, as the lines of one quote. */
export function prepMarkdown(kind: PrepKind, raw: unknown): string {
  const data = parsePrepData(kind, JSON.stringify(raw));
  const alert = kind === 'check' ? '[!CHECK]' : kind === 'encounter' ? '[!ENCOUNTER]' : '[!HANDOUT]';
  const lines: string[] = [];
  if (kind === 'check') lines.push(`${alert} ${checkText(data as CheckData)}`);
  else if (kind === 'encounter') { const encounter = data as EncounterData; lines.push(`${alert} ${encounter.title}`.trimEnd(), ...encounter.rows.map(row => `- ${encounterRowText(row)}`)); }
  else lines.push(`${alert} ${handoutText(data as HandoutData)}`);
  lines.push(dataComment(data));
  return lines.map(line => `> ${line}`).join('\n');
}

const attributeOf = (tag: string, name: string) => (new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(tag)?.[1] ?? '');
const plain = (value: string) => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** The Markdown of a stored block (its wrapper element as a string). */
export function prepMarkdownFromHtml(html: string): string | null {
  const open = /^<(?:div|figure)\b[^>]*>/i.exec(html.trim())?.[0]; if (!open) return null;
  const kind = attributeOf(open, 'data-wh-prep');
  if (kind !== 'check' && kind !== 'encounter' && kind !== 'handout') return null;
  return prepMarkdown(kind, parsePrepData(kind, plain(attributeOf(open, 'data-wh-prep-data'))));
}

/** "2x Goblin", "Goblin x3", "- 1× Goblin jefe {monster:goblin-boss}". */
export function parseEncounterLine(text: string): EncounterRow | null {
  let rest = text.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim();
  let link: EncounterRow['link'] = null;
  rest = rest.replace(/\{(monster|card):([^}\s]{1,200})\}\s*$/i, (_m, kind: string, id: string) => { link = { kind: kind.toLowerCase() as 'monster' | 'card', id, label: '' }; return ''; }).trim();
  let count = 1, name = rest;
  const before = /^(\d{1,3})\s*[x×*]\s*(.+)$/i.exec(rest), after = /^(.+?)\s*[x×]\s*(\d{1,3})$/i.exec(rest);
  if (before) { count = Number(before[1]); name = before[2]; } else if (after) { count = Number(after[2]); name = after[1]; }
  const [row] = normalizeEncounter({ rows: [{ name, count, link }] }).rows;
  return row ?? null;
}
/** A pasted list: one creature per line, or separated by commas. */
export function parseEncounterList(text: string): EncounterRow[] {
  return text.split(/\r?\n|[,;]/).map(part => parseEncounterLine(part)).filter((row): row is EncounterRow => !!row);
}

/** A Markdown alert of this family as HTML, or null when it is not one. `word` is the text between "[!" and "]". */
export function prepAlertToHtml(word: string, firstLine: string, rest: string[]): string | null {
  const meta = ALERT_WORDS[word.toUpperCase()]; if (!meta) return null;
  const comment = [firstLine, ...rest].map(line => COMMENT.exec(line.trim())).find(Boolean);
  if (comment) {
    try { return prepBlockHtml(meta.kind, JSON.parse(comment[1])); } catch { /* falls back to the words */ }
  }
  const lines = rest.filter(line => !COMMENT.test(line.trim()));
  if (meta.kind === 'check') {
    const text = firstLine.trim(), found = /^(.*?)\s*\b(?:CD|DC)\s*(\d{1,2})\b\s*(?:[—–:|]|-{1,2})?\s*(.*)$/i.exec(text);
    const skillOf = (value: string) => value.replace(/^(?:prueba\s+de\s+|check\s*:?\s*)/i, '').replace(/\s+check$/i, '').trim();
    return prepBlockHtml('check', normalizeCheck(found ? { skill: skillOf(found[1]), dc: Number(found[2]), note: [found[3], ...lines].filter(Boolean).join(' '), lang: meta.lang } : { skill: skillOf(text), note: lines.join(' '), lang: meta.lang }));
  }
  if (meta.kind === 'encounter') {
    const title = firstLine.replace(/^(?:encuentro|encounter)\s*:\s*/i, '').trim();
    return prepBlockHtml('encounter', normalizeEncounter({ title, rows: lines.map(parseEncounterLine).filter(Boolean), lang: meta.lang }));
  }
  const images = lines.map(line => /^(?:image|imagen)\s*:\s*(\S+)$/i.exec(line.trim())?.[1]).filter(Boolean);
  const [label, when] = firstLine.replace(/^(?:material para jugadores|player handout)\s*:\s*/i, '').split(/\s+(?:—|–|\|)\s+/, 2);
  return prepBlockHtml('handout', normalizeHandout({ label: label ?? '', when: (when ?? '').replace(/^(?:se entrega|hand out)\s*:\s*/i, ''), imageId: images[0] ?? '', lang: meta.lang }));
}
