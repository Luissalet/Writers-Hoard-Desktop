// ============================================
// Investigation report (pure)
// ============================================
//
// Builds the Markdown report from the derived state. Every statement a source
// backs carries a numeric marker; the numbers resolve to the graded source list
// at the end. Text comes in through `ReportCopy` so the same builder serves
// English and Spanish (see reportCopy.ts) and the tests.

import type { Citation } from '@/types/projectTools';
import type { CodexEntry } from '@/types';
import { gradeLabel, isRetracted, originOf } from '@/services/sourceGrading';
import type { AchResult } from './ach';
import { checkCitations, type CheckSource, type CitationCheckResult } from './citationCheck';
import { dayToIso } from './dates';
import type { Chronology, ClaimView } from './derive';
import { claimEntityIds, countByStatus } from './derive';
import { CLAIM_STATUSES, type ClaimStatus, type InquiryCase, type InquiryHypothesis } from './types';

export const REPORT_COPY_KEYS = [
  'title', 'question', 'noQuestion', 'asOf', 'summary', 'counts', 'noClaims', 'keyEntities', 'entityClaims',
  'privatePerson', 'publicFigure', 'claimsByStatus', 'excerpts', 'independent', 'ended', 'stale', 'lastSeen',
  'chronology', 'undated', 'conflict', 'gap', 'hypotheses', 'leastContradicted', 'tied', 'noRatings', 'caveat',
  'sensitivity', 'unratedCells', 'discarded', 'score', 'openQuestions', 'openUnsupported', 'openDisputed',
  'openStale', 'openNoHypotheses', 'sources', 'ungraded', 'retractedSource', 'retractedLabel', 'modelSummary',
  'flagUncited', 'flagRetracted', 'flagUnknown', 'claim',
  'status.confirmed', 'status.corroborated', 'status.claimed', 'status.disputed', 'status.unsupported', 'status.retracted',
] as const;

export type ReportCopyKey = typeof REPORT_COPY_KEYS[number];
export type ReportCopy = Readonly<Record<ReportCopyKey, string>>;

function fmt(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_all, key: string) => String(values[key] ?? `{${key}}`));
}

export interface ReportInput {
  projectTitle: string;
  inquiryCase?: InquiryCase;
  views: readonly ClaimView[];
  chronology: Chronology;
  ach: AchResult;
  hypotheses: readonly InquiryHypothesis[];
  entries: readonly CodexEntry[];
  citations: readonly Citation[];
  copy: ReportCopy;
  asOf?: string | null;
  /** A summary the AI wrote, inserted after it is checked. */
  modelSummary?: string;
}

export interface ReportSource {
  number: number;
  citation: Citation;
  active: boolean;
}

export interface BuiltReport {
  markdown: string;
  sources: ReportSource[];
  checkSources: CheckSource[];
  /** The check over the claims and chronology sections and the model summary. */
  check: CitationCheckResult;
  /** Issues found in the model summary alone (also printed under it). */
  summaryCheck?: CitationCheckResult;
}

/** Sections the citation check leaves alone: they list, count or label; they do not assert. */
export function uncheckedSections(copy: ReportCopy): string[] {
  return [copy.summary, copy.keyEntities, copy.hypotheses, copy.openQuestions, copy.sources];
}

/** Numbers for every citation the claims touch (retracted ones included, marked as such). */
export function numberSources(views: readonly ClaimView[], citations: readonly Citation[]): ReportSource[] {
  const byId = new Map(citations.map(citation => [citation.id, citation]));
  const order: string[] = [];
  for (const view of views) {
    for (const support of view.supports) {
      if (byId.has(support.citationId) && !order.includes(support.citationId)) order.push(support.citationId);
    }
  }
  return order.map((id, index) => {
    const citation = byId.get(id)!;
    return { number: index + 1, citation, active: !isRetracted(citation) };
  });
}

function markersFor(view: ClaimView, numbers: ReadonlyMap<string, number>): string {
  const list = [...new Set(view.supports.filter(s => s.active).map(s => numbers.get(s.citationId)).filter((n): n is number => n !== undefined))].sort((a, b) => a - b);
  return list.map(n => `[${n}]`).join('');
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function buildReport(input: ReportInput): BuiltReport {
  const { copy, views, chronology, ach } = input;
  const sources = numberSources(views, input.citations);
  const numbers = new Map(sources.map(source => [source.citation.id, source.number]));
  const checkSources: CheckSource[] = sources.map(source => ({ number: source.number, active: source.active }));
  const entryById = new Map(input.entries.map(entry => [entry.id, entry]));
  const viewById = new Map(views.map(view => [view.claim.id, view]));
  const lines: string[] = [];
  const push = (...rows: string[]) => lines.push(...rows);

  const statusLabel = (status: ClaimStatus) => copy[`status.${status}`];
  const meta = (view: ClaimView): string => {
    const parts = [statusLabel(view.status)];
    parts.push(fmt(copy.excerpts, { n: view.evidenceCount }), fmt(copy.independent, { n: view.independentCount }));
    if (view.timeState === 'ended') parts.push(copy.ended);
    if (view.timeState === 'stale' && view.observedDay !== null) parts.push(`${copy.stale} · ${fmt(copy.lastSeen, { date: dayToIso(view.observedDay) })}`);
    return `_(${parts.join(' · ')})_`;
  };
  const entityName = (id: string) => entryById.get(id)?.title ?? id;

  push(`# ${copy.title}: ${oneLine(input.projectTitle)}`, '');
  if (input.asOf) push(`> ${fmt(copy.asOf, { date: input.asOf })}`, '');

  push(`## ${copy.question}`, '', oneLine(input.inquiryCase?.question ?? '') || copy.noQuestion, '');

  const counts = countByStatus(views);
  const countList = CLAIM_STATUSES.filter(status => counts[status] > 0).map(status => `${statusLabel(status)} ${counts[status]}`).join(', ');
  push(`## ${copy.summary}`, '', views.length ? fmt(copy.counts, { n: views.length, list: countList }) : copy.noClaims, '');

  if (input.modelSummary?.trim()) {
    push(`### ${copy.modelSummary}`, '', input.modelSummary.trim(), '');
  }

  // Key entities: codex entries the claims mention, most-mentioned first.
  const mentions = new Map<string, number>();
  for (const view of views) for (const id of claimEntityIds(view.claim)) mentions.set(id, (mentions.get(id) ?? 0) + 1);
  const entities = [...mentions.entries()].sort((a, b) => b[1] - a[1] || entityName(a[0]).localeCompare(entityName(b[0])));
  if (entities.length) {
    push(`## ${copy.keyEntities}`, '');
    for (const [id, count] of entities) {
      const entry = entryById.get(id);
      const flag = entry?.type === 'character' ? ` — ${entry.publicFigure ? copy.publicFigure : copy.privatePerson}` : '';
      push(`- ${entityName(id)}${entry ? ` (${entry.type})` : ''}${flag} — ${fmt(copy.entityClaims, { n: count })}`);
    }
    push('');
  }

  push(`## ${copy.claimsByStatus}`, '');
  for (const status of CLAIM_STATUSES) {
    const group = views.filter(view => view.status === status);
    if (!group.length) continue;
    push(`### ${statusLabel(status)}`, '');
    for (const view of group) {
      const markers = markersFor(view, numbers);
      push(`- ${oneLine(view.claim.statement)}${markers ? ` ${markers}` : ''} ${meta(view)}`);
    }
    push('');
  }

  push(`## ${copy.chronology}`, '');
  for (const entry of chronology.entries) {
    const markers = markersFor(entry.view, numbers);
    const when = entry.anchor ?? copy.undated;
    push(`- ${when}: ${oneLine(entry.view.claim.statement)}${markers ? ` ${markers}` : ''} ${meta(entry.view)}`);
  }
  if (!chronology.entries.length) push(copy.noClaims);
  for (const conflict of chronology.contradictions) {
    const [a, b] = conflict.claimIds.map(id => viewById.get(id));
    if (a && b) push('', `- ${fmt(copy.conflict, { a: oneLine(a.claim.statement), b: oneLine(b.claim.statement), predicate: conflict.predicate })}`);
  }
  for (const gap of chronology.gaps) {
    const next = viewById.get(gap.beforeClaimId);
    push('', `- ${fmt(copy.gap, { from: dayToIso(gap.fromDay), to: dayToIso(gap.toDay), days: gap.days, subject: next ? oneLine(next.claim.statement) : gap.subject })}`);
  }
  push('');

  if (input.hypotheses.length) {
    push(`## ${copy.hypotheses}`, '');
    const open = ach.hypotheses;
    push(`| ${copy.claim} | ${open.map((_row, i) => `H${i + 1}`).join(' | ')} |`, `|---|${open.map(() => '---').join('|')}|`);
    for (const row of ach.claims) {
      push(`| ${oneLine(row.view.claim.statement).replace(/\|/g, '/')} | ${open.map(h => row.ratings[h.hypothesis.id] ?? '·').join(' | ')} |`);
    }
    push(`| ${copy.score} | ${open.map(h => h.score).join(' | ')} |`, '');
    open.forEach((row, i) => push(`- H${i + 1}: ${oneLine(row.hypothesis.statement)}${row.hypothesis.status === 'discarded' ? ` (${copy.discarded})` : ''}`));
    push('');
    if (ach.leastContradictedIds.length && !ach.tied) {
      const names = ach.hypotheses.filter(row => row.leastContradicted).map(row => `H${ach.hypotheses.indexOf(row) + 1}`).join(', ');
      push(`**${fmt(copy.leastContradicted, { list: names })}** ${copy.caveat}`, '');
    } else if (ach.tied) push(copy.tied, '');
    else push(copy.noRatings, '');
    for (const note of ach.sensitivity) {
      const view = viewById.get(note.claimId);
      const names = note.leastContradictedWithout
        .map(id => `H${ach.hypotheses.findIndex(row => row.hypothesis.id === id) + 1}`).join(', ') || '—';
      if (view) push(`- ${fmt(copy.sensitivity, { claim: oneLine(view.claim.statement), list: names })}`);
    }
    if (ach.unratedCells > 0) push('', fmt(copy.unratedCells, { n: ach.unratedCells }));
    push('');
  }

  // Open questions: what the evidence does not settle yet.
  const open: string[] = [];
  for (const view of views) {
    if (view.status === 'unsupported') open.push(`- ${copy.openUnsupported}: ${oneLine(view.claim.statement)}`);
    else if (view.status === 'disputed') open.push(`- ${copy.openDisputed}: ${oneLine(view.claim.statement)}`);
    else if (view.timeState === 'stale' && view.observedDay !== null) {
      open.push(`- ${fmt(copy.openStale, { date: dayToIso(view.observedDay) })}: ${oneLine(view.claim.statement)}`);
    }
  }
  if (input.hypotheses.length === 0 && views.length > 0) open.push(`- ${copy.openNoHypotheses}`);
  if (open.length) push(`## ${copy.openQuestions}`, '', ...open, '');

  push(`## ${copy.sources}`, '');
  for (const source of sources) {
    const { citation } = source;
    const grade = gradeLabel(citation) ?? copy.ungraded;
    const who = [citation.authors.join(', '), citation.publisher].filter(Boolean).join(' — ');
    const tail = isRetracted(citation)
      ? ` — ${copy.retractedLabel}${citation.retractReason ? `: ${oneLine(citation.retractReason)}` : ''}`
      : '';
    push(`[${source.number}] ${oneLine(citation.title)}${who ? `, ${who}` : ''}${citation.publishedAt ? `, ${citation.publishedAt}` : ''}. ${grade} · ${originOf(citation)}${tail}`);
  }
  push('');

  // The model summary is checked on its own so its flags can sit right under it.
  let summaryCheck: CitationCheckResult | undefined;
  if (input.modelSummary?.trim()) {
    summaryCheck = checkCitations(input.modelSummary, checkSources);
    if (!summaryCheck.ok) {
      const at = lines.indexOf(input.modelSummary.trim());
      const flags = summaryCheck.issues.map(issue => {
        const label = issue.kind === 'uncited' ? copy.flagUncited : issue.kind === 'retracted-marker' ? copy.flagRetracted : copy.flagUnknown;
        return `> ${label}: “${oneLine(issue.sentence)}”`;
      });
      if (at >= 0) lines.splice(at + 1, 0, '', ...flags);
    }
  }

  const markdown = lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  const check = checkCitations(markdown, checkSources, { skipSections: uncheckedSections(copy) });
  return { markdown, sources, checkSources, check, summaryCheck };
}
