import Dexie from 'dexie';
import { CURRENT_DB_VERSION, db } from '@/db';
import {
  addHypothesis, createClaim, deleteClaim, deleteHypothesis, getCase, loadInquirySnapshot, rateHypothesis,
  restoreClaim, retractClaim, saveCase, updateClaim, updateHypothesis,
} from '@/engines/inquiry/operations';
import { computeAch } from '@/engines/inquiry/ach';
import { deriveClaims } from '@/engines/inquiry/derive';
import { buildPublishingArtifacts, deleteCitation, formatCitation, saveCitation } from '@/services/projectTools';
import { gradeCitation, restoreCitation, retractCitation, SourceGradingError } from '@/services/sourceGradingOps';
import { gradeLabel } from '@/services/sourceGrading';
import { saveResearchEvidence } from '@/services/researchEvidence';
import type { Project } from '@/types';
import type { Citation, PublishingProfile } from '@/types/projectTools';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

async function rejectsWith(action: () => Promise<unknown>, code: string, message: string) {
  try { await action(); } catch (error) {
    const got = (error as { code?: string }).code;
    assert(got === code, `${message}: expected ${code}, got ${got ?? String(error)}`);
    return;
  }
  throw new Error(`${message}: expected a rejection with ${code}`);
}

function project(id: string): Project {
  const now = Date.now();
  return { id, title: id, mode: 'novelist', type: 'standalone', color: '#000', description: '', status: 'draft', enabledEngines: ['inquiry'], engineOrder: ['inquiry'], createdAt: now, updatedAt: now };
}

async function makeCitation(projectId: string, title: string, url: string, quotes: string[]): Promise<{ citation: Citation; evidenceIds: string[] }> {
  const citation = await saveCitation({ projectId, title, authors: [], accessedAt: '2026-05-01', url, writingIds: [], tags: [] });
  const evidenceIds: string[] = [];
  for (const quote of quotes) {
    const evidence = await saveResearchEvidence(projectId, { citationId: citation.id }, { statement: `About ${title}`, kind: 'fact', quote, locator: 'p. 1', status: 'pending', notes: '' });
    evidenceIds.push(evidence.id);
  }
  return { citation: (await db.citations.get(citation.id))!, evidenceIds };
}

/** Schema string of a Dexie table as the current code declares it, for building faithful older fixtures. */
function schemaString(table: Dexie['tables'][number]): string {
  const parts = [table.schema.primKey.src, ...table.schema.indexes.map(index => index.src)];
  return parts.join(', ');
}

export async function testInquiryMigration(): Promise<string[]> {
  const newTables = ['inquiryCases', 'inquiryClaims', 'inquiryHypotheses', 'inquiryRatings', 'enrichmentRuns'];
  assert(CURRENT_DB_VERSION === 35, `the inquiry tables belong to schema v35, code says v${CURRENT_DB_VERSION}`);
  await db.open();
  const stores: Record<string, string> = {};
  for (const table of db.tables) if (!newTables.includes(table.name)) stores[table.name] = schemaString(table);
  db.close();
  await Dexie.delete('WritersHoardDB');

  // The previous schema, rebuilt from the real one minus the new tables.
  const previous = new Dexie('WritersHoardDB');
  previous.version(34).stores(stores);
  await previous.open();
  assert(previous.verno === 34, `fixture must open at v34, got v${previous.verno}`);
  const now = Date.now();
  await previous.table('projects').add({ ...project('legacy-inquiry'), enabledEngines: ['writings', 'codex'] });
  await previous.table('citations').add({
    id: 'legacy-citation', projectId: 'legacy-inquiry', title: 'Old source', authors: ['A. Writer'], accessedAt: '2024-01-02',
    url: 'https://example.org/old', writingIds: [], tags: ['t'], createdAt: now, updatedAt: now,
    researchEvidence: [{ id: 'legacy-evidence', statement: 'It rained', kind: 'fact', quote: 'rain', locator: '', status: 'reviewed', notes: '', reviewedAt: now, createdAt: now, updatedAt: now }],
  });
  await previous.table('codexEntries').add({
    id: 'legacy-entry', projectId: 'legacy-inquiry', type: 'character', title: 'Old person', fields: { role: 'clerk' }, content: '<p>x</p>', tags: [], relations: [], createdAt: now, updatedAt: now,
  });
  previous.close();

  await db.open();
  assert(db.verno === 35, `expected v35 after upgrade, got v${db.verno}`);
  for (const name of newTables) assert(db.tables.some(table => table.name === name), `missing table ${name}`);
  for (const name of newTables) assert((await db.table(name).count()) === 0, `${name} must arrive empty`);
  const citation = await db.citations.get('legacy-citation');
  assert(citation?.title === 'Old source' && citation.researchEvidence?.[0].quote === 'rain', 'the upgrade lost a citation or its evidence');
  assert(gradeLabel(citation) === null && citation.retractedAt === undefined, 'an old citation reads as ungraded and not retracted');
  const entry = await db.codexEntries.get('legacy-entry');
  assert(entry?.fields.role === 'clerk' && entry.publicFigure === undefined, 'an old person is private by default and intact');
  // Usable at once, and an old citation can back a claim.
  const claim = await createClaim('legacy-inquiry', { statement: 'It rained on the day.', supports: [{ citationId: 'legacy-citation', evidenceId: 'legacy-evidence' }] });
  assert((await db.inquiryClaims.count()) === 1 && claim.supports.length === 1, 'the new table is writable right after the upgrade');
  await db.inquiryClaims.clear();
  await db.projects.delete('legacy-inquiry');
  await db.citations.delete('legacy-citation');
  await db.codexEntries.delete('legacy-entry');
  return ['Dexie migration v35: rows written at v34 survive; inquiry tables arrive empty and usable; old citations read as ungraded'];
}

export async function testInquiryOperations(): Promise<string[]> {
  const projectId = `inq-${crypto.randomUUID()}`;
  const otherId = `${projectId}-other`;
  await db.projects.bulkAdd([project(projectId), project(otherId)]);
  const now = Date.now();
  await db.codexEntries.bulkAdd([
    { id: 'ana', projectId, type: 'character', title: 'Ana', fields: {}, content: '', tags: [], relations: [], createdAt: now, updatedAt: now },
    { id: 'foreign', projectId: otherId, type: 'character', title: 'Foreign', fields: {}, content: '', tags: [], relations: [], createdAt: now, updatedAt: now },
  ]);
  try {
    const a = await makeCitation(projectId, 'Letter', 'https://archive.example.org/letter', ['She arrived on the 3rd.']);
    const b = await makeCitation(projectId, 'Paper', 'https://news.example.net/paper', ['Arrival noted on the third.']);
    const foreign = await makeCitation(otherId, 'Foreign', 'https://foreign.example.org/', ['elsewhere']);
    const sA = { citationId: a.citation.id, evidenceId: a.evidenceIds[0] };
    const sB = { citationId: b.citation.id, evidenceId: b.evidenceIds[0] };

    // Creation rules.
    await rejectsWith(() => createClaim(projectId, { statement: 'No support.', supports: [] }), 'support', 'a claim needs a support');
    await rejectsWith(() => createClaim(projectId, { statement: '  ', supports: [sA] }), 'statement', 'empty statement');
    await rejectsWith(() => createClaim(projectId, { statement: 'Bad date.', validFrom: '2019-02-30', supports: [sA] }), 'date', 'impossible date');
    await rejectsWith(() => createClaim(projectId, { statement: 'Backwards.', validFrom: '2020', validTo: '2019', supports: [sA] }), 'date', 'from after to');
    await rejectsWith(() => createClaim(projectId, { statement: 'Foreign source.', supports: [{ citationId: foreign.citation.id, evidenceId: foreign.evidenceIds[0] }] }), 'support', 'another project\'s citation');
    await rejectsWith(() => createClaim(projectId, { statement: 'Missing excerpt.', supports: [{ citationId: a.citation.id, evidenceId: 'nope' }] }), 'support', 'unknown excerpt');
    await rejectsWith(() => createClaim(projectId, { statement: 'Foreign entity.', subject: { kind: 'codex', id: 'foreign' }, supports: [sA] }), 'ref', 'another project\'s entity');
    await rejectsWith(() => createClaim(projectId, { statement: 'Confidence.', confidence: 2, supports: [sA] }), 'confidence', 'confidence range');
    assert((await db.inquiryClaims.count()) === 0, 'rejected claims leave nothing behind');

    // A quote becomes an excerpt in the same transaction; a failure rolls both back.
    const evidenceBefore = (await db.citations.get(a.citation.id))!.researchEvidence!.length;
    await rejectsWith(() => createClaim(projectId, {
      statement: 'Atomic.', fromQuotes: [{ citationId: a.citation.id, quote: 'first' }, { citationId: 'missing', quote: 'second' }],
    }), 'source', 'a failing second quote');
    assert((await db.citations.get(a.citation.id))!.researchEvidence!.length === evidenceBefore, 'the first quote was rolled back with the failed claim');
    const fromQuote = await createClaim(projectId, {
      statement: 'Ana arrived on the 3rd.', subject: { kind: 'codex', id: 'ana' }, predicate: 'Arrived At', object: { kind: 'text', text: 'the station' },
      validFrom: '1936-5-3', confidence: 0.8, tags: ['arrival', 'arrival'],
      supports: [sA], fromQuotes: [{ citationId: b.citation.id, quote: 'Ana stepped off the train.', locator: 'p. 9' }],
    });
    assert(fromQuote.supports.length === 2 && fromQuote.validFrom === '1936-05-03' && fromQuote.predicate === 'arrived_at', 'normalised fields');
    assert(fromQuote.tags.length === 1, 'tags are de-duplicated');
    assert((await db.citations.get(b.citation.id))!.researchEvidence!.some(row => row.quote === 'Ana stepped off the train.' && row.status === 'pending'), 'the quote became a pending excerpt');

    // Derived state from the database.
    const plain = await createClaim(projectId, { statement: 'Only the letter says it.', supports: [sA] });
    let snap = await loadInquirySnapshot(projectId);
    let views = deriveClaims(snap.claims, snap.citations);
    const view = (id: string) => views.find(v => v.claim.id === id)!;
    assert(view(fromQuote.id).status === 'corroborated' && view(fromQuote.id).independentCount === 2, 'two hosts corroborate');
    assert(view(plain.id).status === 'claimed', 'one source is claimed');

    // Grade, then retract: the cascade is reported and nothing is deleted.
    await rejectsWith(() => gradeCitation(projectId, a.citation.id, { reliability: 'Z' as never }), 'grade', 'invalid grade');
    const graded = await gradeCitation(projectId, a.citation.id, { reliability: 'B', credibility: 2 });
    assert(graded.changed && gradeLabel(graded.citation) === 'B2', 'grade stored as B2');
    assert(!(await gradeCitation(projectId, a.citation.id, { reliability: 'B', credibility: 2 })).changed, 'regrading the same is a no-op');
    try { await gradeCitation(otherId, a.citation.id, { reliability: 'A' }); throw new Error('scope'); } catch (error) {
      assert(error instanceof SourceGradingError && error.code === 'scope', 'grading another project\'s citation is refused');
    }
    const retracted = await retractCitation(projectId, a.citation.id, 'forged letter');
    assert(retracted.changed && retracted.impact.affected === 2, 'retraction says how many claims lean on it');
    assert(retracted.impact.becameUnsupported === 1 && retracted.impact.weakened === 1, 'one claim loses everything, one is weakened');
    const afterRetract = await db.citations.get(a.citation.id);
    assert(afterRetract?.retractedAt && afterRetract.researchEvidence?.length === 1, 'retracting never deletes the citation or its excerpts');
    snap = await loadInquirySnapshot(projectId);
    views = deriveClaims(snap.claims, snap.citations);
    assert(view(plain.id).status === 'unsupported', 'sole-source claim becomes unsupported at once');
    assert(view(fromQuote.id).status === 'claimed' && view(fromQuote.id).evidenceCount === 1, 'corroborated claim drops to claimed');
    assert(snap.claims.find(c => c.id === plain.id)!.updatedAt === plain.updatedAt, 'no claim row was rewritten by the cascade');
    assert(!(await retractCitation(projectId, a.citation.id)).changed, 'retracting twice is a no-op');

    // Protections around citations.
    const stale = (await db.citations.get(a.citation.id))!;
    await saveCitation({ ...stale, retractedAt: undefined, retractReason: undefined, reliability: 'A', title: 'Edited title' });
    const kept = (await db.citations.get(a.citation.id))!;
    assert(kept.title === 'Edited title' && kept.retractedAt && kept.reliability === 'B', 'an edit form cannot undo a retraction or a grade');
    try { await deleteCitation(a.citation.id, { projectId, expectedUpdatedAt: kept.updatedAt }); throw new Error('deleted'); } catch (error) {
      assert(String((error as Error).message).includes('investigation claim'), 'a citation that supports claims cannot be deleted');
    }
    const restored = await restoreCitation(projectId, a.citation.id);
    assert(restored.changed && restored.impact.regainedSupport === 1 && restored.impact.strengthened === 1, 'restore reports what it gave back');
    assert(!(await db.citations.get(a.citation.id))!.retractedAt, 'restored');

    // Updating claims.
    const edited = await updateClaim(projectId, plain.id, { statement: 'Only the letter says so.', confidence: 0.2 }, { expectedUpdatedAt: plain.updatedAt });
    await rejectsWith(() => updateClaim(projectId, plain.id, { notes: 'x' }, { expectedUpdatedAt: plain.updatedAt }), 'conflict', 'stale edit');
    await rejectsWith(() => updateClaim(projectId, plain.id, { supports: [] }), 'support', 'cannot drop the last support');
    await rejectsWith(() => updateClaim(projectId, plain.id, { manualStatus: 'confirmed' }), 'reason', 'override needs a reason');
    const confirmed = await updateClaim(projectId, plain.id, { manualStatus: 'confirmed', manualReason: 'Checked the archive in person.' });
    assert(confirmed.manualStatus === 'confirmed', 'manual confirmation stored with a reason');
    const cleared = await updateClaim(projectId, plain.id, { manualStatus: null });
    assert(!cleared.manualStatus && !cleared.manualReason, 'override cleared');
    assert((await updateClaim(projectId, plain.id, {})).updatedAt === cleared.updatedAt, 'an empty patch changes nothing');
    await rejectsWith(() => updateClaim(otherId, plain.id, { notes: 'x' }), 'not_found', 'another project cannot edit a claim');
    const withPlace = await updateClaim(projectId, edited.id, { supports: [sA, sB] });
    assert(withPlace.supports.length === 2, 'supports can be replaced');

    // Author retraction of a claim.
    const withdrawn = await retractClaim(projectId, plain.id, 'I misread it');
    assert(withdrawn.retractedAt && withdrawn.retractReason === 'I misread it', 'claim retracted');
    snap = await loadInquirySnapshot(projectId);
    views = deriveClaims(snap.claims, snap.citations);
    assert(view(plain.id).status === 'retracted', 'shows as retracted');
    assert(!(await restoreClaim(projectId, plain.id)).retractedAt, 'claim restored');

    // Hypotheses, ratings and cascades.
    const h1 = await addHypothesis(projectId, 'She arrived by train');
    const h2 = await addHypothesis(projectId, 'She arrived by car');
    assert(h1.order === 0 && h2.order === 1, 'hypotheses keep an order');
    await rejectsWith(() => addHypothesis(projectId, ' '), 'hypothesis', 'empty hypothesis');
    await rejectsWith(() => rateHypothesis(projectId, h1.id, fromQuote.id, 'XX' as never), 'rating', 'invalid rating');
    await rejectsWith(() => rateHypothesis(otherId, h1.id, fromQuote.id, 'C'), 'not_found', 'cross-project rating');
    await rateHypothesis(projectId, h1.id, fromQuote.id, 'CC', 'the quote says train');
    await rateHypothesis(projectId, h2.id, fromQuote.id, 'II');
    await rateHypothesis(projectId, h1.id, fromQuote.id, 'C'); // put: replaces, not duplicates
    assert((await db.inquiryRatings.count()) === 2, 'one rating per pair');
    snap = await loadInquirySnapshot(projectId);
    views = deriveClaims(snap.claims, snap.citations);
    const ach = computeAch(snap.hypotheses, views, snap.ratings);
    assert(ach.leastContradictedIds.join() === h1.id, 'ACH reads the stored ratings');
    await updateHypothesis(projectId, h2.id, { status: 'discarded' });
    assert((await db.inquiryHypotheses.get(h2.id))!.status === 'discarded', 'hypothesis discarded');
    assert((await deleteHypothesis(projectId, h2.id)).ratingsRemoved === 1, 'deleting a hypothesis removes its ratings');
    assert((await deleteClaim(projectId, fromQuote.id)).ratingsRemoved === 1, 'deleting a claim removes its ratings');
    assert((await db.citations.get(b.citation.id)) !== undefined, 'deleting a claim keeps its sources');
    assert((await db.inquiryRatings.count()) === 0, 'no orphan ratings');
    await rateHypothesis(projectId, h1.id, plain.id, 'N');
    await rateHypothesis(projectId, h1.id, plain.id, null);
    assert((await db.inquiryRatings.count()) === 0, 'null clears a rating');

    // The research question.
    assert(!(await getCase(projectId)), 'no case until one is saved');
    const saved = await saveCase(projectId, { question: 'When did she arrive?', staleDays: 90, functionalPredicates: ['Arrived At'] });
    assert(saved.staleDays === 90 && saved.functionalPredicates?.[0] === 'arrived_at', 'case saved');
    await rejectsWith(() => saveCase(projectId, { staleDays: 0 }), 'field', 'invalid stale days');
    assert((await saveCase(projectId, { question: 'Changed?' })).staleDays === 90 && (await db.inquiryCases.count()) === 1, 'the case is one row per project');
    return ['inquiry operations: validation, atomic quotes, derived status, retraction cascade, protections, hypotheses, ratings, case'];
  } finally {
    await db.inquiryRatings.where('projectId').anyOf(projectId, otherId).delete();
    await db.inquiryClaims.where('projectId').anyOf(projectId, otherId).delete();
    await db.inquiryHypotheses.where('projectId').anyOf(projectId, otherId).delete();
    await db.inquiryCases.where('projectId').anyOf(projectId, otherId).delete();
    await db.citations.where('projectId').anyOf(projectId, otherId).delete();
    await db.codexEntries.where('projectId').anyOf(projectId, otherId).delete();
    await db.projects.bulkDelete([projectId, otherId]);
  }
}

/** A retracted source stays in the bibliography, marked with its date and reason. */
export async function testRetractedBibliography(): Promise<string[]> {
  const projectId = `inquiry-biblio-${Date.now()}`;
  await db.projects.put(project(projectId));
  const kept = await saveCitation({ projectId, title: 'Harbour ledger', authors: ['Alvarez, M.'], accessedAt: '2026-05-01', url: 'https://example.org/ledger', writingIds: [], tags: [] });
  const dropped = await saveCitation({ projectId, title: 'Forged letter', authors: ['Baker, J.'], accessedAt: '2026-05-01', url: 'https://example.org/letter', writingIds: [], tags: [] });
  await retractCitation(projectId, dropped.id, 'the letter is a forgery');
  const citations = (await db.citations.where('projectId').equals(projectId).toArray());
  const retracted = citations.find(citation => citation.id === dropped.id)!;
  const clean = citations.find(citation => citation.id === kept.id)!;
  assert(retracted.retractedAt, 'retraction was not stored on the citation');
  const labels = { locale: 'en-US', unknownAuthor: 'Unknown author', noDate: 'n.d.', accessedLabel: 'Accessed', retractedLabel: 'Retracted' };
  for (const style of ['apa', 'mla', 'chicago'] as const) {
    const line = formatCitation(retracted, style, labels);
    assert(line.includes('[Retracted: ') && line.includes('the letter is a forgery'), `${style} did not mark the retracted source: ${line}`);
    assert(!formatCitation(clean, style, labels).includes('Retracted'), `${style} marked a source that was never retracted`);
  }
  const spanish = formatCitation({ ...retracted, retractReason: '' }, 'apa', { ...labels, locale: 'es-ES', retractedLabel: 'Retirada' });
  assert(/\[Retirada: [^\]—]+\]$/.test(spanish), `Spanish mark or empty reason wrong: ${spanish}`);
  assert(formatCitation(retracted, 'apa').includes('[Retracted: '), 'default labels do not mark retractions');

  const profile: PublishingProfile = {
    id: 'biblio-profile', projectId, name: 'Dossier', format: 'manuscript', includeTitlePage: false, includeSynopsis: false,
    includeBibliography: true, citationStyle: 'apa', selectionMode: 'all', selectedWritingIds: [], writingOrder: [], createdAt: 1, updatedAt: 1,
  };
  const artifacts = buildPublishingArtifacts({ id: projectId, title: 'Dossier' }, profile, [], citations, {
    labels: { ...labels, wordLabel: 'words', chapterLabel: 'Chapter', bibliographyTitle: 'Bibliography' },
    generatedAt: Date.UTC(2026, 8, 30),
  });
  assert(artifacts.document.bibliography.length === 2, 'retracted source was dropped from the bibliography');
  assert(artifacts.markdown.includes('[Retracted: ') && artifacts.html.includes('[Retracted: '), 'published bibliography lost the retraction mark');
  assert(artifacts.document.bibliography.filter(line => line.includes('[Retracted')).length === 1, 'only the retracted source must be marked');

  await restoreCitation(projectId, dropped.id);
  const restored = (await db.citations.get(dropped.id))!;
  assert(!formatCitation(restored, 'apa', labels).includes('Retracted'), 'restored source is still marked as retracted');
  return ['bibliography marks retracted sources in APA, MLA and Chicago, in the publishing artifacts, and drops the mark on restore'];
}

export async function testInquiry(): Promise<string[]> {
  // Migration first: it deletes and recreates the database.
  return [...await testInquiryMigration(), ...await testInquiryOperations(), ...await testRetractedBibliography()];
}
