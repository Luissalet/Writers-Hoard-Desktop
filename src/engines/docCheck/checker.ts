// Markdown document check: a document declares one kind and holds only what that kind is for, a fact has one home,
// durable pages carry no fast-changing values, pointers name a file or symbol, finished pages do not talk to whoever
// asked for them. Pure module (no DOM, no database, no imports) so Writer, the MCP bridge and other apps can share it.
// Conventions and the `allow` comment syntax follow seiso (MIT, https://github.com/scarletkc/seiso); the rules here
// are written from its published convention, not copied from its source. Notice in THIRD_PARTY/NOTICE.

export const DOC_KINDS = ['readme', 'howto', 'reference', 'runbook', 'adr', 'plan', 'changelog', 'explanation', 'generated'] as const;
export type DocKind = (typeof DOC_KINDS)[number];
export type DocSeverity = 'error' | 'warning';

export interface DocInput { id?: string; title?: string; path?: string; markdown: string; kind?: DocKind }
export interface DocOriginal { id?: string; title: string; path?: string; line: number; link: string }
export interface DocDiagnostic {
  rule: string; severity: DocSeverity; line: number; column: number; endLine: number;
  message: string; fix: string; excerpt: string; original?: DocOriginal;
}
export interface DocCheckOptions {
  /** Kind to use when the document declares none (a setting of the host, never a frontmatter claim). */
  kind?: DocKind;
  /** Other pages of the same set; a fact found here is flagged in this page with a link to the original. */
  others?: readonly DocInput[];
  /** Rule codes to skip entirely. */
  disable?: readonly string[];
}
export interface DocCheckReport {
  kind: DocKind | null; kindSource: 'frontmatter' | 'option' | 'none';
  diagnostics: DocDiagnostic[]; suppressed: Array<{ rule: string; line: number; reason: string }>;
  counts: { error: number; warning: number; suppressed: number }; ok: boolean;
}

export const RULES: Record<string, { severity: DocSeverity; title: string; fix: string }> = {
  KND001: { severity: 'error', title: 'The document declares no kind', fix: 'Add frontmatter with `kind: howto` (readme, howto, reference, runbook, adr, plan, changelog or explanation).' },
  KND002: { severity: 'error', title: 'Unknown or not allowed kind', fix: 'Use one of readme, howto, reference, runbook, adr, plan, changelog, explanation. `generated` can only be set by the host.' },
  KND003: { severity: 'error', title: 'Content that does not belong to the declared kind', fix: 'Move the foreign content to a page of its own kind and link to it, or change the declared kind.' },
  DUP001: { severity: 'error', title: 'A fact that already has a home in another page', fix: 'Keep the fact in the original page and replace this text with a link to it.' },
  VOL001: { severity: 'warning', title: 'A value that changes faster than a durable page', fix: 'Remove the value, or point to where it is kept up to date (a file, a command that prints it).' },
  PTR001: { severity: 'error', title: 'A pointer that names nothing concrete', fix: 'Name the file, symbol or page: `src/engines/docCheck/checker.ts` or `checkMarkdownDoc`, or add a link.' },
  FIN001: { severity: 'error', title: 'A finished page addresses its requester or narrates how it was made', fix: 'Rewrite the sentence as a statement about the subject; leave the history of the edit to the version control.' },
  SUP001: { severity: 'warning', title: 'Exception without a reason', fix: 'Write the reason after the codes: `<!-- doccheck: allow DUP001 -- the license text must be repeated here. -->`.' },
  SUP002: { severity: 'warning', title: 'Exception that suppresses nothing', fix: 'Remove the comment, or fix the code (a complete rule code such as DUP001).' },
};

const DURABLE: ReadonlySet<DocKind> = new Set(['readme', 'howto', 'reference', 'runbook', 'explanation']);
const MIN_FACT_WORDS = 8;
const WORD = (source: string) => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`, 'iu');

interface Block { type: 'heading' | 'paragraph' | 'item' | 'code' | 'quote'; line: number; endLine: number; text: string; raw: string }
interface Allow { line: number; codes: string[]; reason: string; blockLine: number; used: boolean }
interface Parsed { lines: string[]; kind?: string; frontmatterError: boolean; blocks: Block[]; allows: Allow[] }

function parse(markdown: string): Parsed {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let start = 0; let kind: string | undefined; let frontmatterError = false;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((value, index) => index > 0 && value.trim() === '---');
    if (end < 0) frontmatterError = true;
    else { for (const row of lines.slice(1, end)) { const m = /^kind\s*:\s*["']?([^"'#\s]+)["']?/i.exec(row); if (m) kind = m[1].toLowerCase(); } start = end + 1; }
  }
  const blocks: Block[] = []; const allows: Allow[] = [];
  let open: Block | null = null; let fence: string | null = null;
  const close = () => { if (open) { open.text = open.raw.replace(/\s+/g, ' ').trim(); blocks.push(open); open = null; } };
  for (let index = start; index < lines.length; index++) {
    const row = lines[index]; const number = index + 1; const trimmed = row.trim();
    if (fence) { open!.raw += '\n' + row; open!.endLine = number; if (trimmed.startsWith(fence)) { fence = null; close(); } continue; }
    const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed);
    if (fenceMatch) { close(); fence = fenceMatch[1]; open = { type: 'code', line: number, endLine: number, text: '', raw: row }; continue; }
    const allow = /^<!--\s*(?:doccheck|seiso)\s*:\s*allow\s+([A-Z]{3}\d{3}(?:\s*,\s*[A-Z]{3}\d{3})*)\s*(?:--\s*(.*?))?\s*-->$/.exec(trimmed);
    if (allow) { close(); allows.push({ line: number, codes: allow[1].split(',').map(code => code.trim()), reason: (allow[2] ?? '').trim(), blockLine: 0, used: false }); continue; }
    if (!trimmed) { close(); continue; }
    const heading = /^#{1,6}\s+\S/.test(trimmed);
    const item = /^(?:[-*+]|\d+[.)])\s+\S/.test(trimmed);
    const quote = trimmed.startsWith('>');
    if (heading) { close(); blocks.push({ type: 'heading', line: number, endLine: number, text: trimmed.replace(/^#+\s*/, ''), raw: trimmed }); continue; }
    if (item) { close(); open = { type: 'item', line: number, endLine: number, text: '', raw: trimmed }; continue; }
    if (open && open.type !== 'code') { open.raw += ' ' + trimmed; open.endLine = number; continue; }
    close(); open = { type: quote ? 'quote' : 'paragraph', line: number, endLine: number, text: '', raw: trimmed };
  }
  close();
  for (const allow of allows) allow.blockLine = blocks.find(block => block.line > allow.line)?.line ?? 0;
  return { lines, kind, frontmatterError, blocks, allows };
}

const strip = (text: string) => text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*_~]/g, '');
const normalise = (text: string) => strip(text).toLowerCase().replace(/^(?:[-*+]|\d+[.)])\s+/, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const wordCount = (normalised: string) => (normalised ? normalised.split(' ').length : 0);
const sentencesOf = (text: string) => strip(text).split(/(?<=[.!?])\s+(?=[\p{Lu}¿¡"«(\d])/u);
const proseBlocks = (blocks: Block[]) => blocks.filter(block => block.type !== 'code');
const excerptOf = (text: string) => (text.length > 140 ? `${text.slice(0, 137)}...` : text);

interface Fact { doc: DocInput; line: number }
function factIndex(others: readonly DocInput[]): Map<string, Fact> {
  const index = new Map<string, Fact>();
  for (const doc of others) {
    for (const block of parse(doc.markdown).blocks) {
      if (block.type === 'code' || block.type === 'heading') continue;
      const whole = normalise(block.text);
      if (wordCount(whole) >= MIN_FACT_WORDS && !index.has(whole)) index.set(whole, { doc, line: block.line });
      for (const sentence of sentencesOf(block.text)) {
        const key = normalise(sentence);
        if (wordCount(key) >= MIN_FACT_WORDS && !index.has(key)) index.set(key, { doc, line: block.line });
      }
    }
  }
  return index;
}

function original(fact: Fact): DocOriginal {
  const title = fact.doc.title ?? fact.doc.path ?? fact.doc.id ?? 'document';
  const target = `${fact.doc.path ?? fact.doc.id ?? title}#L${fact.line}`;
  return { id: fact.doc.id, title, path: fact.doc.path, line: fact.line, link: `[${title}](${target})` };
}

const VOLATILE: Array<[string, RegExp]> = [
  ['a version number', /(?<![\p{L}\p{N}.])(?:(?:version|versión|v)\s?\d+\.\d+(?:\.\d+)?|\d+\.\d+\.\d+)(?![\p{L}\p{N}])/iu],
  ['a count', WORD('\\d[\\d.,]*\\s+(?:tests?|pruebas|files?|archivos|ficheros|tools?|herramientas|endpoints?|users?|usuarios|pages?|páginas|commits|issues|modules?|módulos|rules?|reglas|dependencies|dependencias|chapters?|capítulos)')],
  ['a time-relative statement', WORD('currently|at the moment|right now|as of|so far|actualmente|ahora mismo|por ahora|a día de hoy|de momento|hasta la fecha|en este momento')],
  ['a status', WORD('in progress|work in progress|WIP|en curso|en desarrollo|deployed|desplegad[oa]|en producción')],
  ['a dated update', WORD('last updated|updated on|actualizado el|última actualización')],
];
const VAGUE = [
  WORD('(?:see|check|read|consult|refer to|look at|browse)\\s+(?:the\\s+)?(?:code|source(?: code)?|codebase|implementation|repo(?:sitory)?|docs?|documentation)'),
  WORD('(?:ver|consulta|consultar|revisa|mira|lee|véase|vea)\\s+(?:el\\s+|la\\s+)?(?:código|codigo|fuente|código fuente|implementación|repositorio|documentación|repo)'),
  WORD('(?:see|ver)\\s+(?:above|below|arriba|abajo)'),
];
const CONCRETE = /`|\]\(|[\w-]+\.(?:ts|tsx|js|mjs|cjs|py|md|json|rs|go|cs|java|css|html|ya?ml|toml)\b|[\w.-]+[\\/][\w./-]+/;
const REQUESTER = [
  WORD("as (?:you )?(?:requested|asked)|per your (?:request|instructions)|at your request|here(?:'s| is) (?:the|your|a) (?:updated |revised |final )?(?:document|doc|page|version|summary|draft)|i(?:'ve| have)? (?:updated|added|created|written|rewritten|removed|fixed|generated|drafted)|(?:this|the) (?:document|page|doc) (?:was|has been) (?:generated|written|created|updated|drafted)|let me know if|hope this helps|as an ai|ai[- ]generated"),
  WORD('como (?:me )?(?:pediste|pidió|pidiste|solicitaste|solicitó)|tal como (?:pediste|solicitaste)|a petición tuya|según tu (?:petición|solicitud)|aquí (?:tienes|está)|he (?:actualizado|añadido|creado|escrito|reescrito|eliminado|corregido|generado|redactado)|(?:este|el) (?:documento|página) (?:ha sido|fue) (?:generad[oa]|escrit[oa]|cread[oa]|actualizad[oa]|redactad[oa])|avísame si|espero que (?:te )?(?:sirva|ayude)'),
];

function kindContent(kind: DocKind, blocks: Block[]): Array<{ line: number; endLine: number; message: string; excerpt: string }> {
  const out: Array<{ line: number; endLine: number; message: string; excerpt: string }> = [];
  const headings = blocks.filter(block => block.type === 'heading');
  const ordered = blocks.filter(block => block.type === 'item' && /^\d+[.)]\s/.test(block.raw));
  const hasCode = blocks.some(block => block.type === 'code');
  if (kind === 'adr') {
    const has = (re: RegExp) => headings.some(heading => re.test(heading.text));
    if (!has(/context|contexto/i) || !has(/decision|decisión/i)) out.push({ line: headings[0]?.line ?? 1, endLine: headings[0]?.line ?? 1, message: 'An ADR records its context and its decision; a heading for each is missing.', excerpt: headings[0]?.text ?? '' });
  } else if (kind === 'howto' || kind === 'runbook') {
    if (ordered.length < 2 && !hasCode) out.push({ line: headings[0]?.line ?? 1, endLine: headings[0]?.line ?? 1, message: `A ${kind} is a sequence of steps; there is no numbered list and no command.`, excerpt: headings[0]?.text ?? '' });
    if (kind === 'howto') for (const heading of headings) if (/^(?:background|history|why|overview|antecedentes|historia|por qué|motivación|motivation)\b/i.test(heading.text)) out.push({ line: heading.line, endLine: heading.line, message: 'Background and rationale belong to an explanation or an ADR, not to a how-to.', excerpt: heading.text });
  } else if (kind === 'reference') {
    let run: Block[] = [];
    const flush = () => { if (run.length >= 4) out.push({ line: run[0].line, endLine: run[run.length - 1].endLine, message: 'A numbered procedure of four or more steps belongs in a how-to; a reference lists facts.', excerpt: run[0].text }); run = []; };
    for (const block of blocks) { if (block.type === 'item' && /^\d+[.)]\s/.test(block.raw)) run.push(block); else flush(); }
    flush();
    for (const heading of headings) if (/^(?:how to|cómo|tutorial|paso a paso|step by step)\b/i.test(heading.text)) out.push({ line: heading.line, endLine: heading.line, message: 'A how-to section inside a reference page.', excerpt: heading.text });
  } else if (kind === 'changelog') {
    if (!headings.some(heading => /\d+\.\d+|\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4}|unreleased|sin publicar/i.test(heading.text))) out.push({ line: headings[0]?.line ?? 1, endLine: headings[0]?.line ?? 1, message: 'A changelog is a list of dated or numbered releases; no heading carries a version or a date.', excerpt: headings[0]?.text ?? '' });
  }
  return out;
}

const isKind = (value: string | undefined): value is DocKind => !!value && (DOC_KINDS as readonly string[]).includes(value);

export function checkMarkdownDoc(doc: DocInput, options: DocCheckOptions = {}): DocCheckReport {
  const parsed = parse(doc.markdown);
  const off = new Set(options.disable ?? []);
  const found: DocDiagnostic[] = [];
  const add = (rule: string, line: number, endLine: number, message: string, excerpt: string, extra: Partial<DocDiagnostic> = {}) => {
    if (off.has(rule)) return;
    found.push({ rule, severity: RULES[rule].severity, line, column: 1, endLine, message, fix: RULES[rule].fix, excerpt: excerptOf(excerpt), ...extra });
  };

  let kind: DocKind | null = null; let kindSource: DocCheckReport['kindSource'] = 'none';
  const hostKind = doc.kind ?? options.kind;
  if (parsed.kind) {
    const line = parsed.lines.findIndex(row => /^kind\s*:/i.test(row)) + 1;
    if (isKind(parsed.kind) && parsed.kind !== 'generated') { kind = parsed.kind; kindSource = 'frontmatter'; }
    else add('KND002', line, line, parsed.kind === 'generated' ? 'Frontmatter cannot declare a page as generated; only the host can.' : `Unknown kind "${parsed.kind}".`, parsed.lines[line - 1] ?? '');
  } else if (isKind(hostKind)) { kind = hostKind; kindSource = 'option'; }
  else add('KND001', 1, 1, parsed.frontmatterError ? 'The frontmatter is not closed, so the kind cannot be read.' : 'The document declares no kind.', '');

  const blocks = parsed.blocks; const prose = proseBlocks(blocks);
  if (kind && kind !== 'generated') {
    for (const issue of kindContent(kind, blocks)) add('KND003', issue.line, issue.endLine, issue.message, issue.excerpt);
  }
  if (kind !== 'generated') {
    const facts = options.others?.length ? factIndex(options.others) : null;
    for (const block of prose) {
      if (block.type === 'heading') { for (const pattern of REQUESTER) if (pattern.test(block.text)) add('FIN001', block.line, block.endLine, 'A heading addresses the requester or narrates the edit.', block.text); continue; }
      for (const pattern of REQUESTER) { const m = pattern.exec(block.text); if (m) { add('FIN001', block.line, block.endLine, `"${m[0]}" addresses the requester or narrates how the page was made.`, block.text); break; } }
      for (const pattern of VAGUE) { const m = pattern.exec(block.text); if (m && !CONCRETE.test(block.raw)) { add('PTR001', block.line, block.endLine, `"${m[0]}" does not say where.`, block.text); break; } }
      if (kind && DURABLE.has(kind)) for (const [label, pattern] of VOLATILE) { const m = pattern.exec(block.text); if (m) add('VOL001', block.line, block.endLine, `"${m[0]}" is ${label}; this page is meant to outlast it.`, block.text); }
      if (facts && block.type !== 'quote') {
        const keys = [normalise(block.text), ...sentencesOf(block.text).map(normalise)];
        for (const key of keys) {
          const fact = wordCount(key) >= MIN_FACT_WORDS ? facts.get(key) : undefined;
          if (fact) { const source = original(fact); add('DUP001', block.line, block.endLine, `This fact already has a home: ${source.link}.`, block.text, { original: source }); break; }
        }
      }
    }
  }

  const suppressed: DocCheckReport['suppressed'] = []; const kept: DocDiagnostic[] = [];
  const blockEnd = (allow: Allow) => blocks.find(block => block.line === allow.blockLine)?.endLine ?? 0;
  for (const diagnostic of found) {
    const allow = parsed.allows.find(item => item.reason && item.codes.includes(diagnostic.rule) && item.blockLine && diagnostic.line >= item.blockLine && diagnostic.line <= blockEnd(item));
    if (allow) { allow.used = true; suppressed.push({ rule: diagnostic.rule, line: diagnostic.line, reason: allow.reason }); } else kept.push(diagnostic);
  }
  for (const allow of parsed.allows) {
    if (!allow.reason) add('SUP001', allow.line, allow.line, 'This exception gives no reason, so it does not suppress anything.', parsed.lines[allow.line - 1] ?? '');
    else if (!allow.used) add('SUP002', allow.line, allow.line, `Nothing in the next block triggers ${allow.codes.join(', ')}.`, parsed.lines[allow.line - 1] ?? '');
  }
  const all = [...kept, ...found.filter(item => item.rule.startsWith('SUP') && !kept.includes(item))];
  all.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
  const counts = { error: all.filter(item => item.severity === 'error').length, warning: all.filter(item => item.severity === 'warning').length, suppressed: suppressed.length };
  return { kind, kindSource, diagnostics: all, suppressed, counts, ok: counts.error === 0 };
}

/** Checks a set of pages; each page is compared with the pages before it, so the first page owns a shared fact. */
export function checkMarkdownCorpus(docs: readonly DocInput[], options: Omit<DocCheckOptions, 'others'> = {}): Array<{ doc: DocInput; report: DocCheckReport }> {
  return docs.map((doc, index) => ({ doc, report: checkMarkdownDoc(doc, { ...options, others: docs.slice(0, index) }) }));
}
