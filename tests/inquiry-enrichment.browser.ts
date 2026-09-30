import { db } from '@/db';
import {
  applyEnrichment, EnrichmentError, enrichEntry, listEnrichmentRuns, previewEnrichment, searchCandidates, setPublicFigure,
  undoEnrichment, type WikidataTransport,
} from '@/engines/inquiry/enrichment';
import { createClaim } from '@/engines/inquiry/operations';
import type { Project } from '@/types';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

async function rejectsWith(action: () => Promise<unknown>, code: string, message: string): Promise<EnrichmentError> {
  try { await action(); } catch (error) {
    assert(error instanceof EnrichmentError && error.code === code, `${message}: expected ${code}, got ${String(error)}`);
    return error;
  }
  throw new Error(`${message}: expected a rejection with ${code}`);
}

const time = (value: string, precision: number) => ({ rank: 'normal', mainsnak: { snaktype: 'value', property: 'P569', datavalue: { type: 'time', value: { time: value, precision } } } });

export async function testInquiryEnrichment(): Promise<string[]> {
  const projectId = `enrich-${crypto.randomUUID()}`;
  const otherId = `${projectId}-other`;
  const now = Date.now();
  const base: Project = { id: projectId, title: 'Enrichment', mode: 'reporter', type: 'standalone', color: '#000', description: '', status: 'draft', enabledEngines: ['codex', 'inquiry'], engineOrder: ['codex', 'inquiry'], createdAt: now, updatedAt: now };
  await db.projects.bulkAdd([base, { ...base, id: otherId }]);
  const entry = (id: string, type: 'character' | 'faction' | 'location', title: string, fields: Record<string, string> = {}, extra: object = {}) =>
    ({ id, projectId, type, title, fields, content: '', tags: [], relations: [], createdAt: now, updatedAt: now, ...extra });
  await db.codexEntries.bulkAdd([
    entry('person', 'character', 'Ada Lovelace', { role: '' }),
    entry('org', 'faction', 'Acme', { name: 'Acme', type: '', founded: '1950 (my own note)' }),
    entry('place', 'location', 'Lisbon'),
    { ...entry('foreign', 'faction', 'Foreign'), projectId: otherId },
  ]);

  const calls: string[] = [];
  const transport: WikidataTransport = async request => {
    calls.push(request.op === 'search' ? `search:${request.query}` : request.op === 'entity' ? `entity:${request.qid}` : `labels:${request.qids.join(',')}`);
    if (request.op === 'search') return { ok: true, data: { search: [{ id: 'Q7', label: 'Acme Corp', description: 'a company' }] } };
    if (request.op === 'entity') {
      if (request.qid === 'Q404') return { ok: true, data: { entities: { Q404: { id: 'Q404', missing: '' } } } };
      return { ok: true, data: { entities: { [request.qid]: {
        id: request.qid, labels: { en: { language: 'en', value: 'Acme Corp' } }, descriptions: { en: { language: 'en', value: 'a company' } },
        claims: {
          P571: [time('+1949-00-00T00:00:00Z', 9)],
          P159: [{ rank: 'normal', mainsnak: { snaktype: 'value', property: 'P159', datavalue: { type: 'wikibase-entityid', value: { id: 'Q90' } } } }],
          P569: [time('+1815-12-10T00:00:00Z', 11)],
        },
      } } } };
    }
    return { ok: true, data: { entities: { Q90: { id: 'Q90', labels: { en: { language: 'en', value: 'Paris' } } } } } };
  };

  try {
    // Privacy guard: nothing about a private person leaves the machine.
    const refused = await rejectsWith(() => searchCandidates(projectId, 'person', { transport }), 'private_person', 'searching a private person');
    assert(refused.hint.includes('public figure'), 'the refusal says how to allow it');
    await rejectsWith(() => previewEnrichment(projectId, 'person', 'Q7', { transport }), 'private_person', 'previewing a private person');
    assert(calls.length === 0, 'no request was made for a private person');
    await rejectsWith(() => setPublicFigure(projectId, 'org', true), 'not_person', 'only people carry the flag');
    await rejectsWith(() => searchCandidates(projectId, 'foreign', { transport }), 'scope', 'another project\'s entry');
    await rejectsWith(() => setPublicFigure(otherId, 'person', true), 'scope', 'flagging through the wrong project');

    // Organisations and places need no flag.
    const found = await searchCandidates(projectId, 'org', { transport });
    assert(found.query === 'Acme' && found.candidates[0].qid === 'Q7', 'candidates come back for disambiguation');
    await searchCandidates(projectId, 'org', { transport, query: 'Acme Corporation' });
    assert(calls.join('|') === 'search:Acme|search:Acme Corporation', 'only the typed query is sent');
    await rejectsWith(() => previewEnrichment(projectId, 'org', 'nope', { transport }), 'qid', 'a malformed item id');
    await rejectsWith(() => previewEnrichment(projectId, 'org', 'Q404', { transport }), 'not_found', 'a missing item');

    const preview = await previewEnrichment(projectId, 'org', 'Q7', { transport });
    assert(preview.willFill.map(row => row.field).sort().join() === 'description,headquarters', 'only empty fields are offered to fill');
    assert(preview.alreadyFilled.map(row => row.field).join() === 'founded', 'a field the author wrote is left alone');
    assert(preview.labels.Q90 === 'Paris', 'item values are resolved to labels');

    const { run } = await enrichEntry(projectId, 'org', 'Q7', { transport });
    const enriched = (await db.codexEntries.get('org'))!;
    assert(enriched.wikidataQid === 'Q7' && enriched.fields.description === 'a company' && enriched.fields.headquarters === 'Paris', 'fields filled and the item id stored');
    assert(enriched.fields.founded === '1950 (my own note)', 'the author\'s text was not overwritten');
    assert(run.changes.some(change => change.field === 'fields.headquarters' && change.before === null && change.after === 'Paris'), 'the run records before and after');
    const citation = (await db.citations.get(run.citationId))!;
    assert(citation.url === 'https://www.wikidata.org/wiki/Q7' && citation.origin === 'wikidata.org' && citation.reliability === 'C' && citation.credibility === 3, 'a C3 citation from wikidata.org was recorded');
    assert(citation.researchEvidence?.length === 1 && citation.researchEvidence[0].quote.includes('Acme Corp (Q7)'), 'the citation carries the item as an excerpt');
    assert(run.createdCitationIds.join() === citation.id, 'the run lists the citation it created');

    // A second apply of the same item reuses the citation and changes nothing more.
    const again = await enrichEntry(projectId, 'org', 'Q7', { transport });
    assert(again.run.createdCitationIds.length === 0 && again.run.citationId === citation.id, 'the same item reuses its citation');
    assert(again.run.changes.length === 0, 'nothing left to change');
    assert((await listEnrichmentRuns(projectId, 'org')).length === 2, 'runs are logged');

    // Undo: edited fields are kept, the citation goes unless claims rest on it.
    await db.codexEntries.update('org', { fields: { ...enriched.fields, headquarters: 'Lyon (I corrected this)' } });
    const undone = await undoEnrichment(projectId, run.id);
    const after = (await db.codexEntries.get('org'))!;
    assert(undone.status === 'undone' && undone.undoNotes?.includes('kept-edited:headquarters') && undone.undoNotes.includes('restored:description'), 'undo says what it restored and what it kept');
    assert(after.fields.headquarters === 'Lyon (I corrected this)' && !('description' in after.fields) && after.wikidataQid === undefined, 'edited field kept, the rest restored');
    assert(after.fields.founded === '1950 (my own note)', 'untouched fields stay');
    assert(!(await db.citations.get(citation.id)), 'the citation the run created is removed');
    await rejectsWith(() => undoEnrichment(projectId, run.id), 'already_undone', 'undoing twice');
    await rejectsWith(() => undoEnrichment(otherId, run.id), 'run_not_found', 'undoing through the wrong project');

    const second = await enrichEntry(projectId, 'place', 'Q7', { transport });
    const cited = second.run.citationId;
    const claim = await createClaim(projectId, { statement: 'Lisbon is a company.', supports: [{ citationId: cited, evidenceId: (await db.citations.get(cited))!.researchEvidence![0].id }] });
    const undoneInUse = await undoEnrichment(projectId, second.run.id);
    assert(undoneInUse.undoNotes?.includes('citation-kept') && (await db.citations.get(cited)), 'a citation that claims rely on is kept');
    assert((await db.inquiryClaims.get(claim.id)) !== undefined, 'claims are untouched');

    // A person becomes enrichable once marked public, and the flag is rechecked at apply time.
    const flagged = await setPublicFigure(projectId, 'person', true);
    assert(flagged.publicFigure === true, 'the flag is stored');
    const personPreview = await previewEnrichment(projectId, 'person', 'Q7', { transport });
    assert(personPreview.willFill.some(row => row.field === 'born' && row.value === '1815-12-10'), 'a public figure gets person fields');
    await setPublicFigure(projectId, 'person', false);
    await rejectsWith(() => applyEnrichment(personPreview), 'private_person', 'applying after the flag was removed');
    assert(!(await db.codexEntries.get('person'))!.wikidataQid, 'nothing was written');
    assert(!('publicFigure' in (await db.codexEntries.get('person'))!), 'unflagging removes the key, so the row is private by default again');

    // Failures are surfaced, never swallowed.
    const timeout = await rejectsWith(() => searchCandidates(projectId, 'org', { transport: async () => ({ ok: false, code: 'timeout', error: 'slow' }) }), 'timeout', 'a timeout');
    assert(timeout.hint.includes('did not answer'), 'the timeout carries a hint');
    await rejectsWith(() => searchCandidates(projectId, 'org', { transport: async () => { throw new Error('boom'); } }), 'network', 'a transport that throws');
    await rejectsWith(() => searchCandidates(projectId, 'org', { transport: async () => ({ ok: false, code: 'http', error: 'HTTP 503' }) }), 'http', 'an HTTP error');
    await rejectsWith(() => searchCandidates(projectId, 'org'), 'unavailable', 'no desktop bridge');
    return ['enrichment: privacy refusals before any request, fill-empty-only, C3 citation, reuse, undo keeps edits and in-use citations, errors surfaced'];
  } finally {
    await db.enrichmentRuns.where('projectId').anyOf(projectId, otherId).delete();
    await db.inquiryClaims.where('projectId').anyOf(projectId, otherId).delete();
    await db.citations.where('projectId').anyOf(projectId, otherId).delete();
    await db.codexEntries.where('projectId').anyOf(projectId, otherId).delete();
    await db.projects.bulkDelete([projectId, otherId]);
  }
}
