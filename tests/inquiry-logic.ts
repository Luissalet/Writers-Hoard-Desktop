// Pure logic of the investigation engine: dates, grading, derived claim state,
// ACH scoring, the citation check and the report. No database, no DOM.
import en from '../src/locales/en';
import { computeAch } from '../src/engines/inquiry/ach';
import { checkCitations, isFactualSentence, markersIn } from '../src/engines/inquiry/citationCheck';
import {
  containsDate, intervalsOverlap, looseStartDay, normalizePartial, parsePartial, PartialDateError, dayToIso,
} from '../src/engines/inquiry/dates';
import {
  buildChronology, deriveClaim, deriveClaims, filterViews, findContradictions, retractionImpact, citationChangeImpact,
} from '../src/engines/inquiry/derive';
import { buildReport, REPORT_COPY_KEYS, type ReportCopy } from '../src/engines/inquiry/report';
import type { InquiryClaim, InquiryHypothesis, InquiryRating } from '../src/engines/inquiry/types';
import { gradeLabel, originOf, parseGrade, registrableHost } from '../src/services/sourceGrading';
import type { CodexEntry } from '../src/types';
import type { Citation } from '../src/types/projectTools';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}
function throwsPartialDate(action: () => unknown, message: string) {
  try { action(); } catch (error) { assert(error instanceof PartialDateError, message); return; }
  throw new Error(`${message}: expected a PartialDateError`);
}

const NOW = new Date(2026, 5, 15, 12).getTime(); // 2026-06-15 local
const P = 'project';

function citation(id: string, extra: Partial<Citation> = {}): Citation {
  return {
    id, projectId: P, title: `Source ${id}`, authors: [], accessedAt: '2026-05-01', writingIds: [], tags: [],
    researchEvidence: [{ id: `${id}-e1`, statement: 's', kind: 'fact', quote: 'q', locator: '', status: 'pending', notes: '', createdAt: 1, updatedAt: 1 }],
    createdAt: 1, updatedAt: 1, ...extra,
  };
}

let claimSeq = 0;
function claim(statement: string, cites: string[], extra: Partial<InquiryClaim> = {}): InquiryClaim {
  claimSeq += 1;
  return {
    id: `c${claimSeq}`, projectId: P, statement, confidence: 0.5, notes: '', placeIds: [], tags: [],
    supports: cites.map(id => ({ citationId: id, evidenceId: `${id}-e1` })), createdAt: claimSeq, updatedAt: claimSeq, ...extra,
  };
}

const copy = Object.fromEntries(REPORT_COPY_KEYS.map(key => [key, (en as Record<string, string>)[`inquiry.report.${key}`]])) as ReportCopy;
assert(REPORT_COPY_KEYS.every(key => copy[key]), 'every report copy key exists in English');

function testDates() {
  equal(dayToIso(parsePartial('2019')!.start), '2019-01-01', 'year starts on 1 January');
  equal(dayToIso(parsePartial('2019')!.end), '2019-12-31', 'year ends on 31 December');
  equal(dayToIso(parsePartial('2020-02')!.end), '2020-02-29', 'leap February');
  equal(normalizePartial('2019-5-3'), '2019-05-03', 'normalises padding');
  equal(normalizePartial('  '), undefined, 'blank is no date');
  throwsPartialDate(() => parsePartial('2019-02-30'), 'Feb 30 is rejected');
  throwsPartialDate(() => parsePartial('soon'), 'free text is rejected');
  throwsPartialDate(() => parsePartial('2019-13'), 'month 13 is rejected');
  assert(containsDate('2019', '2019', '2019-07-04'), 'a year contains a day inside it');
  assert(!containsDate('2019', '2019', '2020-01-01'), 'a year ends on its last day');
  assert(containsDate(undefined, '2019', '2010'), 'open start');
  assert(containsDate('2019', undefined, '2030'), 'open end');
  assert(containsDate('2019', '2019', undefined), 'no asOf means yes');
  assert(intervalsOverlap('2019', '2020', '2020', '2021'), 'touching years overlap');
  assert(!intervalsOverlap('2019', '2019-06', '2019-07', '2020'), 'disjoint months do not overlap');
  assert(intervalsOverlap(undefined, undefined, '2019', '2019'), 'open intervals may overlap');
  equal(dayToIso(looseStartDay('March 2019')!), '2019-01-01', 'free text falls back to the year');
  equal(looseStartDay('n.d.'), null, 'no year no day');
}

function testGrading() {
  equal(gradeLabel({ reliability: 'B', credibility: 2 }), 'B2', 'grade label');
  equal(gradeLabel({}), null, 'ungraded is null, not a default');
  equal(gradeLabel({ reliability: 'C' }), 'C', 'one axis only');
  equal(JSON.stringify(parseGrade('b2')), JSON.stringify({ reliability: 'B', credibility: 2 }), 'parse b2');
  equal(parseGrade('Z9'), null, 'invalid grade');
  equal(registrableHost('news.bbc.co.uk'), 'bbc.co.uk', 'co.uk registry');
  equal(registrableHost('www.nytimes.com'), 'nytimes.com', 'www stripped');
  equal(originOf(citation('a', { url: 'https://www.example.org/a/b' })), 'example.org', 'origin from URL host');
  equal(originOf(citation('a', { url: 'https://x.example.org/', origin: ' Reuters ' })), 'reuters', 'explicit origin wins');
  equal(originOf(citation('a', { publisher: 'The Times' })), 'the times', 'publisher fallback');
  assert(originOf(citation('a')) !== originOf(citation('b')), 'unknown origins are not lumped together');
}

function testDerivedStatusAndIndependence() {
  const cites = [
    citation('a', { url: 'https://news.example.com/1' }),
    citation('b', { url: 'https://blog.example.com/2' }), // same registrable host as a
    citation('c', { url: 'https://other.org/3' }),
    citation('r', { url: 'https://retracted.net/4', retractedAt: 5 }),
  ];
  const none = claim('Nobody backs this.', []);
  equal(deriveClaim(none, cites, { now: NOW }).status, 'unsupported', 'no supports is unsupported');
  const one = claim('One source says it.', ['a']);
  equal(deriveClaim(one, cites, { now: NOW }).status, 'claimed', 'one source is claimed');
  const sameOrigin = claim('Two pages of one publisher.', ['a', 'b']);
  const sameView = deriveClaim(sameOrigin, cites, { now: NOW });
  equal(sameView.status, 'claimed', 'same origin is not corroboration');
  equal(sameView.evidenceCount, 2, 'both excerpts count as evidence');
  equal(sameView.independentCount, 1, 'but only one independent source');
  const two = claim('Two publishers agree.', ['a', 'c']);
  const twoView = deriveClaim(two, cites, { now: NOW });
  equal(twoView.status, 'corroborated', 'independent origins corroborate');
  equal(twoView.independentCount, 2, 'independent count');
  const retractedOnly = claim('Its only source was withdrawn.', ['r']);
  const retractedView = deriveClaim(retractedOnly, cites, { now: NOW });
  equal(retractedView.status, 'unsupported', 'retracted-source support does not count');
  equal(retractedView.inactiveCount, 1, 'the inactive support is reported');
  equal(retractedView.supports[0].problem, 'retracted', 'and says why');
  const mixed = claim('One good, one withdrawn.', ['c', 'r']);
  equal(deriveClaim(mixed, cites, { now: NOW }).status, 'claimed', 'retracted support is dropped from corroboration');
  equal(deriveClaim(claim('Gone.', ['nope']), cites, { now: NOW }).supports[0].problem, 'missing-citation', 'missing citation');
  equal(deriveClaim(claim('No excerpt.', ['a'], { supports: [{ citationId: 'a', evidenceId: 'zzz' }] }), cites, { now: NOW }).status, 'unsupported', 'missing excerpt');

  equal(deriveClaim(claim('Manual confirm.', ['a'], { manualStatus: 'confirmed', manualReason: 'seen the archive' }), cites, { now: NOW }).status, 'confirmed', 'manual confirmed');
  equal(deriveClaim(claim('Confirm without evidence.', ['r'], { manualStatus: 'confirmed', manualReason: 'x' }), cites, { now: NOW }).status, 'unsupported', 'a confirmation cannot outlive its evidence');
  equal(deriveClaim(claim('Disputed.', ['a', 'c'], { manualStatus: 'disputed', manualReason: 'x' }), cites, { now: NOW }).status, 'disputed', 'manual disputed beats corroboration');
  equal(deriveClaim(claim('Withdrawn by me.', ['a', 'c'], { retractedAt: 9, manualStatus: 'confirmed', manualReason: 'x' }), cites, { now: NOW }).status, 'retracted', 'author retraction wins');
}

function testRetractionCascade() {
  const cites = [citation('a', { url: 'https://a.com/' }), citation('c', { url: 'https://c.org/' }), citation('d', { url: 'https://d.net/' })];
  const claims = [
    claim('Only on A.', ['a']),
    claim('On A and C.', ['a', 'c']),
    claim('On C and D.', ['c', 'd']),
    claim('Already withdrawn by the author.', ['a'], { retractedAt: 3 }),
  ];
  const impact = retractionImpact(claims, cites, 'a', { now: NOW });
  equal(impact.affected.length, 2, 'live claims leaning on A (author-retracted excluded)');
  equal(impact.becomeUnsupported.length, 1, 'one claim loses everything');
  equal(impact.weakened.length, 1, 'one claim keeps a source');
  equal(impact.becomeUnsupported[0].statement, 'Only on A.', 'the right claim loses support');
  // The real retraction is just a stamp on the citation: derive again.
  const after = cites.map(c => (c.id === 'a' ? { ...c, retractedAt: 5 } : c));
  const views = deriveClaims(claims, after, { now: NOW });
  equal(views[0].status, 'unsupported', 'cascade: sole-source claim unsupported');
  equal(views[1].status, 'claimed', 'cascade: corroborated claim drops to claimed');
  equal(views[2].status, 'corroborated', 'cascade: untouched claim stays');
  const restored = citationChangeImpact(claims, after, cites[0], { now: NOW });
  equal(restored.regainSupport.length, 1, 'restoring regains the sole-source claim');
  equal(restored.strengthened.length, 1, 'and strengthens the other');
  equal(retractionImpact(claims, after, 'a', { now: NOW }).affected.length, 0, 'retracting twice affects nothing new');
}

function testEndedStaleAndAsOf() {
  const cites = [citation('a', { url: 'https://a.com/', accessedAt: '2026-06-01' })];
  const ended = deriveClaim(claim('He was CEO.', ['a'], { validFrom: '2010', validTo: '2015', observedAt: '2015-06' }), cites, { now: NOW });
  equal(ended.timeState, 'ended', 'validTo in the past is ended');
  const stale = deriveClaim(claim('She is the CEO.', ['a'], { validFrom: '2010', observedAt: '2024-01-01' }), cites, { now: NOW });
  equal(stale.timeState, 'stale', 'still current but observed long ago is stale');
  const fresh = deriveClaim(claim('She is the CEO today.', ['a'], { validFrom: '2010', observedAt: '2026-03-01' }), cites, { now: NOW });
  equal(fresh.timeState, 'current', 'recent observation is current');
  const tuned = deriveClaim(claim('Tighter window.', ['a'], { observedAt: '2026-03-01' }), cites, { now: NOW, staleDays: 30 });
  equal(tuned.timeState, 'stale', 'stale threshold is configurable');
  const fallback = deriveClaim(claim('Falls back to the source access date.', ['a']), cites, { now: NOW });
  equal(fallback.timeState, 'current', 'recent access date counts as a recent observation');
  equal(dayToIso(fallback.observedDay!), '2026-06-01', 'observation day taken from the source');
  const futureEnd = deriveClaim(claim('Until 2030.', ['a'], { validTo: '2030', observedAt: '2026-01-01' }), cites, { now: NOW });
  equal(futureEnd.timeState, 'current', 'a future end date has not ended');

  const views = deriveClaims([
    claim('Was CEO then.', ['a'], { subject: { kind: 'text', text: 'Ana' }, predicate: 'ceo_of', object: { kind: 'text', text: 'Acme' }, validFrom: '2010', validTo: '2015' }),
    claim('Is CEO now.', ['a'], { validFrom: '2016' }),
    claim('Undated.', ['a']),
  ], cites, { now: NOW, asOf: '2012-05-05' });
  equal(views.filter(v => v.inEffect).length, 2, 'asOf hides claims out of effect (undated stays)');
  equal(filterViews(views, { asOf: '2012-05-05' }).length, 2, 'filter honours asOf');
  const line = buildChronology(views, { asOf: '2012-05-05' });
  equal(line.entries.length, 2, 'chronology honours asOf');
  equal(line.entries[0].view.claim.statement, 'Was CEO then.', 'dated first');
  equal(line.entries[1].view.claim.statement, 'Undated.', 'undated last');
}

function testContradictionsAndGaps() {
  const cites = [citation('a', { url: 'https://a.com/' })];
  const ana = { kind: 'codex', id: 'ana' } as const;
  const views = deriveClaims([
    claim('Ana was born in Lyon.', ['a'], { subject: ana, predicate: 'born in', object: { kind: 'text', text: 'Lyon' } }),
    claim('Ana was born in Paris.', ['a'], { subject: ana, predicate: 'born_in', object: { kind: 'text', text: 'Paris' } }),
    claim('Ana was born in Nice (withdrawn).', ['a'], { subject: ana, predicate: 'born_in', object: { kind: 'text', text: 'Nice' }, retractedAt: 4 }),
    claim('Ana likes tea.', ['a'], { subject: ana, predicate: 'likes', object: { kind: 'text', text: 'tea' } }),
    claim('Ana likes coffee.', ['a'], { subject: ana, predicate: 'likes', object: { kind: 'text', text: 'coffee' } }),
  ], cites, { now: NOW });
  const conflicts = findContradictions(views);
  equal(conflicts.length, 1, 'one functional conflict (retracted and non-functional ignored)');
  equal(conflicts[0].predicate, 'born_in', 'predicate keys are normalised');
  equal(findContradictions(views, { functionalPredicates: ['likes'] }).length, 2, 'author-declared functional predicates count');

  const periods = deriveClaims([
    claim('Bo led Acme 2000-2005.', ['a'], { subject: { kind: 'text', text: 'Acme' }, predicate: 'ceo_of', object: { kind: 'text', text: 'Bo' }, validFrom: '2000', validTo: '2005' }),
    claim('Cy led Acme from 2008.', ['a'], { subject: { kind: 'text', text: 'Acme' }, predicate: 'ceo_of', object: { kind: 'text', text: 'Cy' }, validFrom: '2008' }),
  ], cites, { now: NOW });
  equal(findContradictions(periods).length, 0, 'disjoint periods do not conflict');
  const chronology = buildChronology(periods);
  equal(chronology.gaps.length, 1, 'the unknown stretch between two CEOs is reported');
  equal(dayToIso(chronology.gaps[0].fromDay), '2006-01-01', 'gap starts after the previous end');
  equal(dayToIso(chronology.gaps[0].toDay), '2007-12-31', 'gap ends before the next start');

  const spouses = deriveClaims([
    claim('A is married to B.', ['a'], { subject: { kind: 'text', text: 'A' }, predicate: 'spouse_of', object: { kind: 'text', text: 'B' } }),
    claim('B is married to C.', ['a'], { subject: { kind: 'text', text: 'B' }, predicate: 'spouse_of', object: { kind: 'text', text: 'C' } }),
    claim('B is married to A.', ['a'], { subject: { kind: 'text', text: 'B' }, predicate: 'spouse_of', object: { kind: 'text', text: 'A' } }),
  ], cites, { now: NOW });
  equal(findContradictions(spouses).length, 2, 'symmetric predicates are read from both ends');
}

function testAch() {
  claimSeq = 0; // the ratings below refer to c1..c4
  const cites = [citation('a', { url: 'https://a.com/' }), citation('b', { url: 'https://b.org/' }), citation('r', { retractedAt: 1 })];
  const claims = [claim('Evidence one.', ['a']), claim('Evidence two.', ['b']), claim('Evidence three.', ['a', 'b']), claim('Evidence four.', ['r'])];
  const hyps: InquiryHypothesis[] = ['h1', 'h2', 'h3'].map((id, order) => ({ id, projectId: P, statement: `Hypothesis ${id}`, status: 'open', order, createdAt: order, updatedAt: order }));
  const rate = (hypothesisId: string, claimId: string, rating: InquiryRating['rating']): InquiryRating => ({ id: `${hypothesisId}|${claimId}`, projectId: P, hypothesisId, claimId, rating, note: '', updatedAt: 1 });
  const views = deriveClaims(claims, cites, { now: NOW });
  const ratings = [
    rate('h1', 'c1', 'C'), rate('h2', 'c1', 'II'), rate('h3', 'c1', 'C'),
    rate('h1', 'c2', 'I'), rate('h2', 'c2', 'N'), rate('h3', 'c2', 'N'),
    rate('h1', 'c3', 'CC'), rate('h2', 'c3', 'CC'), rate('h3', 'c3', 'CC'),
    rate('h1', 'c4', 'II'), // claim four is unsupported: its rating must not count
  ];
  const result = computeAch(hyps, views, ratings);
  const score = (id: string) => result.hypotheses.find(row => row.hypothesis.id === id)!.score;
  equal(score('h1'), 1, 'I is one point, unsupported claim ignored');
  equal(score('h2'), 2, 'II is two points');
  equal(score('h3'), 0, 'consistent ratings score nothing');
  equal(result.leastContradictedIds.join(','), 'h3', 'fewest inconsistencies');
  equal(result.excludedClaimIds.join(','), 'c4', 'unsupported claim is excluded from the matrix');
  const row = (id: string) => result.claims.find(r => r.view.claim.id === id)!;
  equal(row('c1').diagnosticity, 3, 'C vs II separates the hypotheses most');
  equal(row('c3').diagnosticity, 0, 'all CC tells nothing apart');
  assert(row('c1').pivotal && !row('c3').pivotal, 'pivotal is the most diagnostic claim');
  equal(result.hypotheses.find(r => r.hypothesis.id === 'h3')!.rank, 1, 'rank 1 for the leader');
  equal(result.unratedCells, 0, 'all counted cells rated');
  assert(result.sensitivity.length > 0, 'dropping the pivotal claim changes the leader here');
  assert(result.sensitivity.some(s => s.claimId === 'c2'), 'c2 alone separates h1 from h3');

  const tied = computeAch(hyps, views, [rate('h1', 'c1', 'C'), rate('h2', 'c1', 'C'), rate('h3', 'c1', 'C')]);
  assert(tied.tied, 'identical scores are a tie');
  const empty = computeAch(hyps, views, []);
  equal(empty.leastContradictedIds.length, 0, 'nothing rated, nobody leads');
  equal(empty.hypotheses[0].rank, null, 'nothing rated, no rank');
  const discarded = computeAch(hyps.map(h => (h.id === 'h3' ? { ...h, status: 'discarded' as const } : h)), views, ratings);
  equal(discarded.leastContradictedIds.join(','), 'h1', 'discarded hypotheses are not ranked');
  // Retract the source behind claim two: the leader changes without touching any row.
  const after = deriveClaims(claims, cites.map(c => (c.id === 'b' ? { ...c, retractedAt: 2 } : c)), { now: NOW });
  const shifted = computeAch(hyps, after, ratings);
  equal(shifted.hypotheses.find(r => r.hypothesis.id === 'h1')!.score, 0, 'retraction removed the evidence against h1');
}

function testCitationCheck() {
  equal(markersIn('Fact [1, 2] and [3][4].').join(','), '1,2,3,4', 'markers parse');
  assert(isFactualSentence('Ana Ruiz was born in 1950.'), 'digits make it factual');
  assert(isFactualSentence('The company moved to Madrid quickly.'), 'a mid-sentence name makes it factual');
  assert(!isFactualSentence('Is that so?'), 'questions are not factual');
  assert(!isFactualSentence('See below for more.'), 'short lines are not factual');
  const sources = [{ number: 1, active: true }, { number: 2, active: false }];
  const text = [
    '# Report', '',
    'Ana Ruiz was born in 1950 [1].',
    'The firm moved to Madrid in 1999.',
    'Bo Diaz joined the board in 2001 [2].',
    'It cites nothing real [9] for 2005.',
    'Trailing marker placement works in 2010. [1]',
    '```', 'Code 1999 is ignored here.', '```',
    '## Sources', 'Skipped Madrid line 1999 here.',
  ].join('\n');
  const result = checkCitations(text, sources, { skipSections: ['Sources'] });
  const kinds = result.issues.map(issue => `${issue.kind}:${issue.marker ?? ''}`).sort().join(' ');
  equal(kinds, 'retracted-marker:2 uncited: uncited: uncited: unknown-marker:9', 'uncited, retracted and unknown markers are flagged');
  assert(!result.ok, 'not ok with issues');
  equal(result.citedSentences, 2, 'two factual sentences carry an active marker');
  assert(checkCitations('Ana Ruiz was born in 1950 [1].', sources).ok, 'a clean text passes');
}

function entry(id: string, title: string, type: CodexEntry['type'], publicFigure?: boolean): CodexEntry {
  return { id, projectId: P, type, title, fields: {}, content: '', tags: [], relations: [], publicFigure, createdAt: 1, updatedAt: 1 };
}

function testReport() {
  const cites = [
    citation('a', { url: 'https://a.com/x', title: 'Archive letter', reliability: 'B', credibility: 2, publishedAt: '1999' }),
    citation('b', { url: 'https://b.org/y', title: 'Newspaper piece' }),
    citation('r', { url: 'https://r.net/z', title: 'Discredited memoir', retractedAt: 5, retractReason: 'forged' }),
  ];
  const claims = [
    claim('Ana Ruiz founded the firm in 1999.', ['a', 'b'], { subject: { kind: 'codex', id: 'ana' }, predicate: 'founder_of', object: { kind: 'codex', id: 'firm' }, validFrom: '1999', observedAt: '2026-01-01' }),
    claim('The firm opened an office in Lyon.', ['r']),
    claim('Bo Diaz owns the building.', ['a'], { subject: { kind: 'codex', id: 'bo' } }),
  ];
  const hyps: InquiryHypothesis[] = [{ id: 'h1', projectId: P, statement: 'Ana founded it alone', status: 'open', order: 0, createdAt: 1, updatedAt: 1 }];
  const views = deriveClaims(claims, cites, { now: NOW });
  const ach = computeAch(hyps, views, []);
  const build = (modelSummary?: string) => buildReport({
    projectTitle: 'The firm', inquiryCase: { id: 'i', projectId: P, question: 'Who founded the firm?', staleDays: 365, createdAt: 1, updatedAt: 1 },
    views, chronology: buildChronology(views), ach, hypotheses: hyps,
    entries: [entry('ana', 'Ana Ruiz', 'character', true), entry('bo', 'Bo Diaz', 'character'), entry('firm', 'The Firm', 'faction')],
    citations: cites, copy, modelSummary,
  });
  const report = build();
  assert(report.markdown.includes('Who founded the firm?'), 'question appears');
  assert(/Ana Ruiz founded the firm in 1999\. ?\[1\]\[2\]|Ana Ruiz founded the firm in 1999 \[1\]\[2\]/.test(report.markdown), 'claim line carries its source markers');
  assert(report.markdown.includes('Bo Diaz (character) — private person'), 'a non-public person is marked private');
  assert(report.markdown.includes('Ana Ruiz (character) — public figure'), 'a public figure is marked');
  assert(report.markdown.includes('Least contradicted') === false, 'no verdict without ratings');
  assert(report.markdown.includes('[1] Archive letter') && report.markdown.includes('B2'), 'graded source list');
  assert(report.markdown.includes('ungraded'), 'ungraded sources are labelled');
  assert(report.markdown.includes('retracted: forged'), 'retracted source listed with its reason');
  assert(report.check.issues.some(issue => issue.kind === 'uncited' && issue.sentence.includes('Lyon')), 'the claim whose only source was retracted is flagged');
  assert(!report.check.issues.some(issue => issue.sentence.includes('Ana Ruiz founded')), 'the corroborated claim is not flagged');
  assert(report.markdown.includes('Needs a source: The firm opened an office in Lyon.'), 'open questions list unsupported claims');

  const summarised = build('Ana Ruiz founded the firm in 1999 [1]. The firm grew to 40 staff by 2005.');
  assert(summarised.summaryCheck && !summarised.summaryCheck.ok, 'model summary with an unsourced line is flagged');
  assert(summarised.markdown.includes('The firm grew to 40 staff by 2005.'), 'flagged text is kept, not hidden');
  assert(summarised.markdown.includes('> No active source: “The firm grew'), 'flag is printed under the summary');
  const cleanSummary = build('Ana Ruiz founded the firm in 1999 [1][2].');
  assert(cleanSummary.summaryCheck?.ok === true, 'a sourced summary passes');
  const badMarker = build('The memoir says the firm opened in Lyon in 2001 [3].');
  assert(badMarker.summaryCheck?.issues.some(issue => issue.kind === 'retracted-marker'), 'a marker to a retracted source is flagged');
}

export function runInquiryLogicTests(): string[] {
  testDates();
  testGrading();
  testDerivedStatusAndIndependence();
  testRetractionCascade();
  testEndedStaleAndAsOf();
  testContradictionsAndGaps();
  testAch();
  testCitationCheck();
  testReport();
  const wikidata = runWikidataParsingTests();
  const family = runFamilyParsingTests();
  return [
    'partial dates compare as day ranges and reject impossible dates',
    'source grades read as B2 and ungraded stays ungraded; origin drives independence',
    'claim status is derived: unsupported, claimed, corroborated, manual overrides, retraction',
    'retracting a citation cascades to dependent claims and reports the impact; restore reverses it',
    'ended is distinct from stale; asOf filters claims and the chronology',
    'functional predicates flag contradictions and unknown stretches are reported as gaps',
    'ACH scores inconsistency only, finds diagnostic claims and labels the leader as least contradicted',
    'citation check flags uncited, retracted and unknown markers without hiding text',
    'the report cites claims, marks private people, lists graded sources and flags the model summary',
    ...wikidata,
    ...family,
  ];
}

// ---------- Wikidata parsing (pure) ----------
import {
  evidenceQuote, formatWikidataTime, itemsToResolve, parseEntity, parseLabels, parseSearch, planFields,
} from '../src/engines/inquiry/wikidata';

export function runWikidataParsingTests(): string[] {
  equal(formatWikidataTime('+1950-03-02T00:00:00Z', 11), '1950-03-02', 'day precision');
  equal(formatWikidataTime('+1950-03-00T00:00:00Z', 10), '1950-03', 'month precision');
  equal(formatWikidataTime('+1950-00-00T00:00:00Z', 9), '1950', 'year precision');
  equal(formatWikidataTime('+1950-01-01T00:00:00Z', 8), '1950', 'decade precision reads as the year');
  equal(formatWikidataTime('-0044-03-15T00:00:00Z', 11), '44 BC', 'BCE dates are labelled');
  equal(formatWikidataTime('garbage', 11), null, 'garbage is not a time');

  const candidates = parseSearch({ search: [
    { id: 'Q42', label: 'Douglas Adams', description: 'English writer' },
    { id: 'P31', label: 'property, not an item' },
    { id: 'Q1', description: 'no label' },
    'nonsense',
  ] });
  equal(candidates.length, 2, 'only items are candidates');
  equal(candidates[1].label, 'Q1', 'a missing label falls back to the id');
  equal(candidates[0].url, 'https://www.wikidata.org/wiki/Q42', 'candidate links point at the item page');
  equal(parseSearch(null).length, 0, 'garbage yields no candidates');

  const snak = (property: string, type: string, value: unknown, rank = 'normal') => ({ rank, mainsnak: { snaktype: 'value', property, datavalue: { type, value } } });
  const data = { entities: { Q9: {
    id: 'Q9',
    labels: { en: { language: 'en', value: 'Acme' } },
    descriptions: { en: { language: 'en', value: 'a company' } },
    aliases: { en: [{ language: 'en', value: 'Acme Corp' }] },
    claims: {
      P571: [snak('P571', 'time', { time: '+1949-00-00T00:00:00Z', precision: 9 })],
      P17: [snak('P17', 'wikibase-entityid', { id: 'Q30' }, 'deprecated'), snak('P17', 'wikibase-entityid', { id: 'Q142' })],
      P159: [snak('P159', 'wikibase-entityid', { id: 'Q90' }), snak('P159', 'wikibase-entityid', { id: 'Q60' }, 'preferred')],
      P856: [snak('P856', 'string', 'https://acme.example')],
      bad: [snak('bad', 'string', 'x')],
    },
  } } };
  const item = parseEntity(data, 'Q9', 'en')!;
  equal(item.label, 'Acme', 'label parsed');
  equal(item.aliases[0], 'Acme Corp', 'aliases parsed');
  equal(item.claims.P17.length, 1, 'deprecated claims are dropped');
  assert(item.claims.P17[0].kind === 'item' && item.claims.P17[0].qid === 'Q142', 'the surviving claim is the normal one');
  assert(item.claims.P159.length === 1 && item.claims.P159[0].kind === 'item' && item.claims.P159[0].qid === 'Q60', 'preferred claims win');
  assert(!('bad' in item.claims), 'unknown property ids are ignored');
  equal(parseEntity({ entities: { Q9: { id: 'Q9', missing: '' } } }, 'Q9', 'en'), null, 'a missing item is null');
  equal(parseEntity(data, 'Q10', 'en'), null, 'the wrong id is null');
  const ids = itemsToResolve('faction', item);
  equal(ids.sort().join(','), 'Q142,Q60', 'only items that will be shown are resolved');
  const labelMap = parseLabels({ entities: { Q142: { labels: { en: { value: 'France' } } }, Q60: { labels: { es: { value: 'Nueva York' }, en: { value: 'New York' } } } } }, 'es');
  equal(labelMap.get('Q60'), 'Nueva York', 'preferred language wins');
  equal(labelMap.get('Q142'), 'France', 'English is the fallback');
  const planned = planFields('faction', item, labelMap);
  equal(planned[0].field, 'description', 'the description comes first');
  equal(planned.find(row => row.field === 'headquarters')?.value, 'Nueva York', 'item values use their labels');
  equal(planned.find(row => row.field === 'founded')?.value, '1949', 'times are formatted');
  assert(!planned.some(row => row.field === 'born'), 'fields of other types are not offered');
  assert(evidenceQuote(item, planned).startsWith('Acme (Q9)\na company'), 'the excerpt carries the label, id and description');
  equal(planFields('magic', item, labelMap).length, 1, 'types without a mapping still get the description');
  return ['Wikidata parsing: time precision, candidates, deprecated/preferred ranks, labels, per-type field plans'];
}

// ---------- Family library search (pure) ----------
import { hasSearchableText, parseHits, redactPrivateNames, refFor } from '../src/engines/inquiry/familySearch';

export function runFamilyParsingTests(): string[] {
  const borges = parseHits('borges', { items: [
    { id: 'doc 7', title: '  The   canal ', snippet: 'Opened in 1869.  Shipping grew.', url: 'https://example.org/a' },
    { id: 'doc 7', title: 'duplicate of the first' },
    { title: 'no id, nothing to point at' },
    { ref: 'hoard://borges/document/42', name: 'By reference', text: 'x'.repeat(3000), url: 'javascript:alert(1)' },
    { ref: 'hoard://links/page/9', id: '9', title: 'a reference into another app is not trusted for this one' },
    'nonsense',
  ] });
  equal(borges.length, 3, 'rows without anything to point at, duplicates and non-objects are skipped');
  equal(borges[0].ref, 'hoard://borges/document/doc%207', 'a bare id becomes an escaped hoard reference');
  equal(borges[0].title, 'The canal', 'titles are flattened');
  equal(borges[0].excerpt, 'Opened in 1869. Shipping grew.', 'excerpts are flattened');
  equal(borges[0].url, 'https://example.org/a', 'a web address is kept');
  equal(borges[1].ref, 'hoard://borges/document/42', 'a matching reference is used as given');
  assert(borges[1].excerpt.length <= 1000, 'excerpts are bounded');
  assert(borges[1].url === undefined, 'a javascript: address is dropped');
  equal(borges[2].ref, 'hoard://borges/document/9', 'a reference into another app falls back to the id');
  equal(parseHits('links', [{ id: 5, title: 'Saved', link: 'http://user:pw@example.org/' }])[0].ref, 'hoard://links/page/5', 'links point at pages; numeric ids work');
  assert(parseHits('links', [{ id: 5, title: 'Saved', link: 'http://user:pw@example.org/' }])[0].url === undefined, 'an address with credentials is dropped');
  equal(parseHits('links', { result: { results: [{ id: 'a' }] } }).length, 1, 'a nested envelope is read');
  equal(parseHits('links', { items: 'no' }).length, 0, 'an unknown envelope yields no hits');
  equal(parseHits('links', null).length, 0, 'garbage yields no hits');
  equal(parseHits('borges', { items: [{ id: '1' }, { id: '2' }, { id: '3' }] }, 2).length, 2, 'the limit is applied');
  equal(refFor('links', { id: 'x/y' }), 'hoard://links/page/x%2Fy', 'slashes in an id cannot forge a path');

  const entries = [
    { type: 'character', title: 'Maria Soler', publicFigure: false },
    { type: 'character', title: 'Ferdinand de Lesseps', publicFigure: true },
    { type: 'character', title: 'Joan', fields: { name: 'Joan Puig' } },
    { type: 'faction', title: 'Suez Canal Company' },
    { type: 'location', title: 'Suez' },
  ];
  let redaction = redactPrivateNames('Maria Soler and the Suez canal', entries);
  equal(redaction.query, 'and the Suez canal', 'a private person is taken out');
  equal(redaction.removed.join('|'), 'Maria Soler', 'the removed people are reported');
  redaction = redactPrivateNames('soler suez', entries);
  equal(redaction.query, 'suez', 'a surname alone is taken out, case-insensitively');
  redaction = redactPrivateNames('Ferdinand de Lesseps Suez Canal Company', entries);
  equal(redaction.query, 'Ferdinand de Lesseps Suez Canal Company', 'a public figure and organisations stay');
  assert(redaction.removed.length === 0, 'nothing is reported when nothing was removed');
  redaction = redactPrivateNames('Puig, Joan: the letters', entries);
  equal(redaction.query, ', : the letters', 'the name field counts too, and the spaces are tidied');
  assert(!hasSearchableText(redaction.query.replace('the letters', '')), 'punctuation alone is not a query');
  equal(redactPrivateNames('Solérs', entries).query, 'Solérs', 'a longer word that merely contains a name is left alone');
  equal(redactPrivateNames('x (Maria) y', entries).query, 'x ( ) y', 'a first name alone counts as the private person');
  equal(redactPrivateNames('Joan', entries).query, '', 'a query that is only a private name becomes empty');
  return ['Family search: hits read leniently (ids, references, envelopes, unsafe addresses, limits); private people are redacted from queries'];
}
