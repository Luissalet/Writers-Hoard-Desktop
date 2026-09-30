// AI bridge — source grading and the Investigation tools: schema, behaviour, privacy, undo, scope.
import { db } from '@/db';
import { BRIDGE_TOOLS, getBridgeTool } from '@/services/aiBridge/manifest';
import { TOOL_HANDLERS } from '@/services/aiBridge/tools';
import { DELETABLE } from '@/services/aiBridge/tools/deletion';
import { BridgeError } from '@/services/aiBridge/tools/shared';
import { subscribeBridgeConfirm } from '@/services/aiBridge/confirmation';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { applyProjectScope } from '@/services/aiRuntime/toolPolicy';
import { saveCitation } from '@/services/projectTools';
import { saveResearchEvidence } from '@/services/researchEvidence';
import type { Project } from '@/types';
import type { WikidataRequest, WikidataResponse } from '@/engines/inquiry/wikidata';
import type { FamilySearchRequest, FamilySearchResponse } from '@/engines/inquiry/familySearch';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

type Args = Record<string, unknown>;
type Out = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const call = async (tool: string, args: Args): Promise<Out> => (await TOOL_HANDLERS[tool](args)) as Out;

async function codeOf(tool: string, args: Args): Promise<string> {
  try { await TOOL_HANDLERS[tool](args); return ''; } catch (error) {
    if (error instanceof BridgeError) return error.code;
    throw error;
  }
}

async function messageOf(tool: string, args: Args): Promise<string> {
  try { await TOOL_HANDLERS[tool](args); return ''; } catch (error) {
    if (error instanceof BridgeError) return error.message;
    throw error;
  }
}

async function scopedCodeOf(tool: string, args: Args, scope: string): Promise<string> {
  const spec = getBridgeTool(tool);
  assert(spec, `no manifest entry for ${tool}`);
  const verdict = applyProjectScope(spec, args, { origin: 'copilot', projectId: scope });
  if (!verdict.ok) return verdict.code;
  return codeOf(tool, verdict.args);
}

/** The audit line the executor would write for a result, as undoAuditEntry reads it. */
function auditLine(tool: string, result: Out): Record<string, unknown> {
  const audit = (result.__audit ?? {}) as Record<string, unknown>;
  const inferred = result.created === true ? 'create' : result.deleted === true ? 'delete' : 'update';
  const kind = audit.kind === 'create' || audit.kind === 'update' || audit.kind === 'delete' ? audit.kind : inferred;
  // The audit log is JSON: what cannot survive that round trip must not be relied on.
  return JSON.parse(JSON.stringify({ tool, kind, ...audit }));
}

const time = (value: string, precision: number) => ({ rank: 'normal', mainsnak: { snaktype: 'value', property: 'P569', datavalue: { type: 'time', value: { time: value, precision } } } });

export async function testInquiryBridge(): Promise<string[]> {
  const passed: string[] = [];
  const A = `inq-bridge-a-${Date.now()}`;
  const B = `inq-bridge-b-${Date.now()}`;
  const OFF = `inq-bridge-off-${Date.now()}`;
  const now = Date.now();
  const engines = ['codex', 'inquiry'];
  const base: Project = { id: A, title: 'Bridge A', mode: 'reporter', type: 'standalone', color: '#000', description: '', status: 'draft', enabledEngines: engines, engineOrder: engines, createdAt: now, updatedAt: now };
  await db.projects.bulkAdd([base, { ...base, id: B, title: 'Bridge B' }, { ...base, id: OFF, title: 'Bridge off', enabledEngines: ['codex'], engineOrder: ['codex'] }]);
  const entry = (id: string, projectId: string, type: 'character' | 'faction' | 'location', title: string, fields: Record<string, string> = {}, extra: object = {}) =>
    ({ id, projectId, type, title, fields, content: '', tags: [], relations: [], createdAt: now, updatedAt: now, ...extra });
  await db.codexEntries.bulkAdd([
    entry(`${A}-ana`, A, 'character', 'Ana Ruiz'),
    entry(`${A}-lee`, A, 'character', 'Lee Han', {}, { publicFigure: true }),
    entry(`${A}-acme`, A, 'faction', 'Acme', { name: 'Acme' }),
    entry(`${A}-paris`, A, 'location', 'Paris'),
    entry(`${A}-lyon`, A, 'location', 'Lyon'),
    entry(`${B}-other`, B, 'faction', 'Other'),
  ]);
  const source = async (projectId: string, title: string, url: string, quote: string) => {
    const citation = await saveCitation({ projectId, title, authors: [], accessedAt: '2026-05-01', url, writingIds: [], tags: [] });
    const evidence = await saveResearchEvidence(projectId, { citationId: citation.id }, { statement: title, kind: 'fact', quote, locator: 'p. 1', status: 'pending', notes: '' });
    return { citationId: citation.id, evidenceId: evidence.id };
  };
  const registry = await source(A, 'Company registry', 'https://registry.example.org/acme', 'Acme was founded in 1999.');
  const registry2 = await source(A, 'Registry annex', 'https://www.registry.example.org/acme-annex', 'Founded 1999 (annex).');
  const paper = await source(A, 'Trade paper', 'https://trade.example.net/acme', 'Founded 1999, says the paper.');
  const foreign = await source(B, 'Foreign source', 'https://foreign.example.com/x', 'Something else entirely.');

  const priorApi = (window as unknown as { electronAPI?: unknown }).electronAPI;
  const wikidataCalls: string[] = [];
  const familyCalls: FamilySearchRequest[] = [];
  let hubDown = false;
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    wikidata: {
      request: async (request: WikidataRequest): Promise<WikidataResponse> => {
        wikidataCalls.push(request.op === 'search' ? `search:${request.query}` : request.op === 'entity' ? `entity:${request.qid}` : 'labels');
        if (request.op === 'search') return { ok: true, data: { search: [{ id: 'Q7', label: 'Acme Corp', description: 'a company' }] } };
        if (request.op === 'entity') {
          return { ok: true, data: { entities: { [request.qid]: { id: request.qid, labels: { en: { language: 'en', value: 'Acme Corp' } }, descriptions: { en: { language: 'en', value: 'a company' } }, claims: { P569: [time('+1815-12-10T00:00:00Z', 11)] } } } } };
        }
        return { ok: true, data: { entities: {} } };
      },
    },
    family: {
      search: async (request: FamilySearchRequest): Promise<FamilySearchResponse> => {
        familyCalls.push(request);
        if (hubDown) return { ok: false, code: 'hub_unreachable', error: 'The hub is not running at http://127.0.0.1:8810.' };
        if (request.app === 'links') return { ok: true, data: { items: [{ id: 'l1', title: 'Saved page about Acme', url: 'https://news.example.com/acme', snippet: 'Acme raised money.' }] } };
        return { ok: true, data: { results: [{ id: 'd9', title: 'Acme: a history', excerpt: 'A company founded in 1999.' }] } };
      },
    },
  };

  try {
    // ---- Manifest: shape, flags, groups ------------------------------------
    const reads = ['wh_list_claims', 'wh_inquiry_timeline', 'wh_ach_matrix', 'wh_inquiry_report'];
    const writes = ['wh_grade_source', 'wh_retract_source', 'wh_add_claim', 'wh_update_claim', 'wh_add_hypothesis', 'wh_rate_hypothesis', 'wh_enrich_codex', 'wh_undo_enrichment', 'wh_search_library'];
    for (const name of [...reads, ...writes]) {
      const tool = getBridgeTool(name);
      assert(tool, `${name} is missing from the manifest`);
      assert(tool.group === 'research', `${name} is not in the research group`);
      assert(tool.writes === writes.includes(name), `${name} has the wrong write flag`);
      assert(tool.description.split('\n')[0].length <= 110, `${name} first line too long`);
      for (const required of tool.schema.required ?? []) assert(required in tool.schema.properties, `${name} requires "${required}" which it does not declare`);
      assert(tool.schema.additionalProperties === false, `${name} must reject unknown arguments`);
      assert(typeof TOOL_HANDLERS[name] === 'function', `${name} has no handler`);
      const enginetool = name !== 'wh_grade_source' && name !== 'wh_retract_source';
      assert(enginetool ? tool.engineId === 'inquiry' : tool.engineId === undefined, `${name} carries the wrong engine`);
      if (tool.writes && tool.engineId && tool.schema.properties.projectId) {
        assert(await codeOf(name, { projectId: OFF }) === 'engine-disabled', `${name} wrote into a project with the engine off`);
      }
    }
    assert(BRIDGE_TOOLS.filter(tool => tool.engineId === 'inquiry').length === 11, 'eleven tools belong to the Investigation engine');
    assert(!BRIDGE_TOOLS.some(tool => /proven|prove/i.test(tool.name)), 'no tool claims to prove anything');
    assert(DELETABLE['inquiry-claim'] && DELETABLE['inquiry-hypothesis'], 'claims and hypotheses are deletable through wh_delete only');
    const deleteEnum = (getBridgeTool('wh_delete')!.schema.properties.type as { enum: string[] }).enum;
    assert(deleteEnum.includes('inquiry-claim') && deleteEnum.includes('inquiry-hypothesis'), 'wh_delete offers them');
    passed.push('Bridge manifest: 13 tools, flags, research group, engine ids, strict schemas, engine guard, deletion registry');

    // ---- Grading ------------------------------------------------------------
    const graded = await call('wh_grade_source', { projectId: A, citationId: registry.citationId, reliability: 'B', credibility: 2 });
    assert(graded.grade === 'B2' && graded.changed === true && graded.originSetByHand === false, 'graded B2');
    assert(String(graded.origin) === 'example.org', 'the origin is derived from the address');
    assert(await codeOf('wh_grade_source', { projectId: A, citationId: registry.citationId }) === 'bad-args', 'nothing to change is refused');
    assert(await codeOf('wh_grade_source', { projectId: A, citationId: registry.citationId, reliability: 'Z' }) === 'bad-args', 'a bad reliability is refused');
    assert(await codeOf('wh_grade_source', { projectId: A, citationId: registry.citationId, credibility: 7 }) === 'bad-args', 'a bad credibility is refused');
    assert(await codeOf('wh_grade_source', { projectId: A, citationId: registry.citationId, clear: true, reliability: 'A' }) === 'bad-args', 'clear with a grade is ambiguous');
    assert(await codeOf('wh_grade_source', { projectId: A, citationId: foreign.citationId, reliability: 'A' }) === 'scope', 'another project\'s source is out of scope');
    assert(await codeOf('wh_grade_source', { projectId: A, citationId: 'nope', reliability: 'A' }) === 'not-found', 'a missing source is not found');
    assert(await scopedCodeOf('wh_grade_source', { citationId: foreign.citationId, reliability: 'A' }, A) === 'scope', 'a copilot pinned to A cannot grade a source of B');
    const gradeAudit = auditLine('wh_grade_source', await call('wh_grade_source', { projectId: A, citationId: paper.citationId, reliability: 'C', credibility: 3, origin: 'Trade Group' }));
    assert((await db.citations.get(paper.citationId))!.origin === 'Trade Group', 'an origin set by hand is stored');
    const undoGrade = await undoAuditEntry({ entry: gradeAudit });
    const afterUndo = (await db.citations.get(paper.citationId))!;
    assert(undoGrade.undone && afterUndo.reliability === undefined && afterUndo.credibility === undefined && afterUndo.origin === undefined, 'undo makes the source ungraded again and removes the origin it added');
    await call('wh_grade_source', { projectId: A, citationId: paper.citationId, reliability: 'C', credibility: 3 });
    const cleared = await call('wh_grade_source', { projectId: A, citationId: paper.citationId, clear: true });
    assert(cleared.grade === 'ungraded', 'clear makes it ungraded');
    passed.push('Bridge grading: B2, validation, scope, derived vs set origin, clear, undo restores ungraded');

    // ---- Claims -------------------------------------------------------------
    assert(await codeOf('wh_add_claim', { projectId: A, statement: 'Acme was founded in 1999.' }) === 'bad-args', 'a claim without a support is refused');
    assert((await messageOf('wh_add_claim', { projectId: A, statement: 'Acme was founded in 1999.' })).includes('wh_get_research_evidence'), 'the refusal says where excerpts come from');
    assert(await codeOf('wh_add_claim', { projectId: A, statement: 'x', supports: [{ citationId: registry.citationId, evidenceId: 'nope' }] }) === 'bad-args', 'an excerpt that does not exist is refused');
    assert(await codeOf('wh_add_claim', { projectId: A, statement: 'x', supports: [foreign] }) === 'scope', 'an excerpt of another project is out of scope');
    assert(await codeOf('wh_add_claim', { projectId: A, statement: 'x', supports: [registry], subjectId: `${B}-other` }) === 'scope', 'a codex entry of another project is out of scope');
    assert(await codeOf('wh_add_claim', { projectId: A, statement: 'x', supports: [registry], subjectId: `${A}-acme`, subjectText: 'Acme' }) === 'bad-args', 'an id and a text together are ambiguous');
    assert(await codeOf('wh_add_claim', { projectId: A, statement: 'x', supports: [registry], validFrom: '2020-13' }) === 'bad-args', 'an impossible date is refused');
    assert(await codeOf('wh_add_claim', { projectId: A, statement: 'x', supports: [registry], confidence: 3 }) === 'bad-args', 'a confidence outside 0-1 is refused');
    assert(await codeOf('wh_add_claim', { projectId: A, statement: 'x', supports: 'nope' }) === 'bad-args', 'supports must be a list');
    assert(await scopedCodeOf('wh_add_claim', { statement: 'x', supports: [foreign] }, A) === 'scope', 'a pinned copilot cannot lean on B\'s source');

    const one = await call('wh_add_claim', {
      projectId: A, statement: 'Acme was founded in 1999.', subjectId: `${A}-acme`, predicate: 'Founded In', objectText: '1999',
      validFrom: '1999', observedAt: '2026-04-01', supports: [registry], tags: ['origin'],
    });
    assert(one.created === true && one.claim.status === 'claimed' && one.claim.evidenceCount === 1 && one.claim.independentSources === 1, 'one source makes it claimed');
    assert(one.claim.predicate === 'founded_in' && one.claim.subject.title === 'Acme', 'the triple is stored and the subject named');
    const oneId = one.id as string;
    const same = await call('wh_add_claim', { projectId: A, statement: 'Acme began in 1999.', supports: [registry, registry2] });
    assert(same.claim.evidenceCount === 2 && same.claim.independentSources === 1 && same.claim.status === 'claimed', 'two excerpts from one origin count as ONE independent source');
    const corroborated = await call('wh_add_claim', { projectId: A, statement: 'Acme dates from 1999.', supports: [registry], quotes: [{ citationId: paper.citationId, quote: 'Since 1999.', locator: 'p. 2' }] });
    assert(corroborated.claim.status === 'corroborated' && corroborated.claim.independentSources === 2, 'two independent origins corroborate');
    assert((await db.citations.get(paper.citationId))!.researchEvidence!.some(row => row.quote === 'Since 1999.' && row.locator === 'p. 2' && row.status === 'pending'), 'a quote is recorded as a pending excerpt of its source');
    assert(!('status' in (getBridgeTool('wh_add_claim')!.schema.properties)), 'status cannot be set on creation');

    const listed = await call('wh_list_claims', { projectId: A });
    assert(listed.total === 3 && listed.counts.claimed === 2 && listed.counts.corroborated === 1, 'counts by status');
    assert(listed.claims.every((claim: Out) => typeof claim.evidenceCount === 'number' && typeof claim.independentSources === 'number'), 'every claim shows both counts');
    assert((await call('wh_list_claims', { projectId: A, status: 'corroborated' })).claims.length === 1, 'status filter');
    assert((await call('wh_list_claims', { projectId: A, entityId: `${A}-acme` })).total === 1, 'entity filter');
    assert((await call('wh_list_claims', { projectId: A, tag: 'origin' })).total === 1, 'tag filter');
    assert((await call('wh_list_claims', { projectId: A, query: 'dates from' })).total === 1, 'text filter');
    assert((await call('wh_list_claims', { projectId: A, limit: 1 })).nextOffset === 1, 'pagination');
    assert(await codeOf('wh_list_claims', { projectId: A, status: 'proven' }) === 'bad-args', 'an unknown status is refused');
    assert(await codeOf('wh_list_claims', { projectId: A, asOf: 'last year' }) === 'bad-args', 'a bad asOf is refused');
    assert(listed.claims.find((claim: Out) => claim.id === oneId).supports[0].grade === 'B2', 'supports carry the source grade');
    passed.push('Bridge claims: support required (existing or quoted), scope, derived status with independence, filters, pagination');

    // ---- Retraction and the cascade -------------------------------------------
    const retract = await call('wh_retract_source', { projectId: A, citationId: paper.citationId, reason: 'Outlet issued a correction' });
    assert(retract.retracted === true && retract.impact.claimsAffected === 1, 'the cascade says how many claims were affected');
    assert(retract.impact.weakened === 1 && retract.impact.becameUnsupported === 0, 'the claim kept another source');
    assert((await call('wh_list_claims', { projectId: A, status: 'corroborated' })).total === 0, 'the claim is no longer corroborated');
    assert((await db.citations.get(paper.citationId)) !== undefined, 'retracting never deletes');
    assert((await call('wh_retract_source', { projectId: A, citationId: paper.citationId })).changed === false, 'retracting twice changes nothing');
    const wipe = await call('wh_retract_source', { projectId: A, citationId: registry.citationId, reason: 'Fabricated' });
    assert(wipe.impact.claimsAffected === 3 && wipe.impact.becameUnsupported >= 1, 'the registry carried three claims');
    assert((await call('wh_list_claims', { projectId: A, status: 'unsupported' })).total >= 1, 'claims without an active source read unsupported');
    const evidence = await call('wh_get_research_evidence', { projectId: A, citationId: registry.citationId });
    assert(evidence.evidence[0].citation.retracted === true && evidence.evidence[0].citation.grade === 'B2', 'the evidence tool shows grade and retraction');
    const restoreResult = await call('wh_retract_source', { projectId: A, citationId: registry.citationId, restore: true });
    assert(restoreResult.retracted === false && restoreResult.impact.claimsAffected === 3, 'restore reports what came back');
    assert(await codeOf('wh_retract_source', { projectId: A, citationId: foreign.citationId }) === 'scope', 'another project\'s source cannot be retracted');
    const undoAudit = auditLine('wh_retract_source', await call('wh_retract_source', { projectId: A, citationId: registry2.citationId, reason: 'oops' }));
    await undoAuditEntry({ entry: undoAudit });
    assert(!(await db.citations.get(registry2.citationId))!.retractedAt, 'undo of a retraction restores the source');
    await call('wh_retract_source', { projectId: A, citationId: paper.citationId, restore: true });
    passed.push('Bridge retraction: cascade counts, nothing deleted, restore, evidence tool shows grade/retraction, undo');

    // ---- Updating, manual overrides, undo --------------------------------------
    assert(await codeOf('wh_update_claim', { id: oneId }) === 'bad-args', 'nothing to change is refused');
    assert(await codeOf('wh_update_claim', { id: oneId, manualStatus: 'confirmed' }) === 'bad-args', 'an override needs a reason');
    assert(await codeOf('wh_update_claim', { id: oneId, retract: true, restore: true }) === 'bad-args', 'retract and restore together are ambiguous');
    assert(await codeOf('wh_update_claim', { id: 'nope', statement: 'x' }) === 'not-found', 'a missing claim is not found');
    assert(await scopedCodeOf('wh_update_claim', { id: oneId, statement: 'x' }, B) === 'scope', 'a copilot pinned to B cannot edit a claim of A');
    assert(await codeOf('wh_update_claim', { id: oneId, supports: [] }) === 'bad-args', 'a claim cannot lose its last excerpt');
    const confirmed = await call('wh_update_claim', { id: oneId, manualStatus: 'confirmed', reason: 'Checked the filing myself', validTo: '2005' });
    assert(confirmed.claim.status === 'confirmed' && confirmed.claim.manualStatus.reason === 'Checked the filing myself', 'manual confirmation recorded');
    assert(confirmed.claim.timeState === 'ended', 'validTo in the past reads as ended, not stale');
    const undoUpdate = await undoAuditEntry({ entry: auditLine('wh_update_claim', confirmed) });
    const reverted = (await db.inquiryClaims.get(oneId))!;
    assert(undoUpdate.undone && reverted.manualStatus === undefined && reverted.validTo === undefined && reverted.validFrom === '1999', 'undo restores changed fields and removes the ones that were added');
    const retractedClaim = await call('wh_update_claim', { id: oneId, retract: true, reason: 'Withdrawn' });
    assert(retractedClaim.claim.status === 'retracted' && retractedClaim.claim.retracted.reason === 'Withdrawn', 'a claim can be retracted');
    assert((await call('wh_update_claim', { id: oneId, restore: true })).claim.status === 'claimed', 'and restored');
    const clearedFields = await call('wh_update_claim', { id: oneId, subjectText: '', validFrom: '', predicate: '' });
    assert(clearedFields.claim.subject === null && clearedFields.claim.validFrom === null && clearedFields.claim.predicate === null, 'an empty string clears');
    const asOfList = await call('wh_list_claims', { projectId: A, asOf: '2030' });
    assert(asOfList.asOf === '2030', 'asOf is echoed');
    passed.push('Bridge update: manual override needs a reason, derived status, ended vs stale, retract/restore, clearing, undo restores and removes');

    // ---- Chronology ----------------------------------------------------------------
    await call('wh_add_claim', { projectId: A, statement: 'Lee Han was born in Paris.', subjectId: `${A}-lee`, predicate: 'born_in', objectId: `${A}-paris`, supports: [paper], validFrom: '1970' });
    await call('wh_add_claim', { projectId: A, statement: 'Lee Han was born in Lyon.', subjectId: `${A}-lee`, predicate: 'born_in', objectId: `${A}-lyon`, supports: [paper], validFrom: '1970' });
    await call('wh_add_claim', { projectId: A, statement: 'Lee Han led Acme until 2010.', subjectId: `${A}-lee`, predicate: 'ceo_of', objectId: `${A}-acme`, supports: [paper], validFrom: '2000', validTo: '2010' });
    await call('wh_add_claim', { projectId: A, statement: 'Lee Han returned to lead Acme in 2015.', subjectId: `${A}-lee`, predicate: 'ceo_of', objectId: `${A}-acme`, supports: [paper], validFrom: '2015' });
    const timeline = await call('wh_inquiry_timeline', { projectId: A });
    assert(timeline.contradictions.length === 1 && timeline.contradictions[0].predicate === 'born_in' && timeline.contradictions[0].subject === 'Lee Han', 'a functional predicate with two values is a contradiction');
    assert(timeline.contradictions[0].values.sort().join() === 'Lyon,Paris', 'the conflicting values are named');
    assert(timeline.gaps.length === 1 && timeline.gaps[0].from === '2011-01-01' && timeline.gaps[0].to === '2014-12-31', 'an unknown stretch is reported, not filled');
    assert(timeline.entries.some((row: Out) => row.when === null) || timeline.undated === 0, 'undated count is reported');
    const early = await call('wh_inquiry_timeline', { projectId: A, asOf: '1980' });
    assert(early.entries.every((row: Out) => row.statement !== 'Lee Han returned to lead Acme in 2015.'), 'asOf leaves out claims not yet in effect');
    passed.push('Bridge chronology: contradictions by functional predicate, gaps reported not filled, asOf');

    // ---- Hypotheses and ACH ---------------------------------------------------------
    const h1 = await call('wh_add_hypothesis', { projectId: A, statement: 'Lee Han was born in Paris.' });
    const h2 = await call('wh_add_hypothesis', { projectId: A, statement: 'Lee Han was born in Lyon.' });
    assert(h1.created === true && await codeOf('wh_add_hypothesis', { projectId: A, statement: '  ' }) === 'bad-args', 'hypotheses need a statement');
    const claims = (await call('wh_list_claims', { projectId: A, query: 'born in' })).claims as Out[];
    const parisClaim = claims.find(claim => claim.statement.includes('Paris'))!;
    const lyonClaim = claims.find(claim => claim.statement.includes('Lyon'))!;
    const before = await call('wh_ach_matrix', { projectId: A });
    assert(before.leastContradictedSoFar.length === 0 && before.verdict.includes('Nothing is rated'), 'nothing rated: no leader is named');
    const rated = await call('wh_rate_hypothesis', { hypothesisId: h1.id, claimId: parisClaim.id, rating: 'CC' });
    assert(rated.created === true && rated.rating === 'CC', 'a rating is stored');
    await call('wh_rate_hypothesis', { hypothesisId: h1.id, claimId: lyonClaim.id, rating: 'II', note: 'directly contradicts' });
    await call('wh_rate_hypothesis', { hypothesisId: h2.id, claimId: parisClaim.id, rating: 'I' });
    await call('wh_rate_hypothesis', { hypothesisId: h2.id, claimId: lyonClaim.id, rating: 'CC' });
    const matrix = await call('wh_ach_matrix', { projectId: A });
    assert(matrix.hypotheses[0].inconsistencyScore === 2 && matrix.hypotheses[1].inconsistencyScore === 1, 'only inconsistency is scored');
    assert(matrix.leastContradictedSoFar.join() === h2.id, 'the leader is the least contradicted');
    assert(/least contradicted so far/.test(matrix.verdict) && !/proven/i.test(matrix.verdict.replace('not proof', '').replace(/Never.*/, '')), 'the wording is "least contradicted so far", never proven');
    assert(matrix.claims.some((claim: Out) => claim.pivotal && claim.diagnosticity > 0), 'diagnostic claims are marked');
    const again = await call('wh_rate_hypothesis', { hypothesisId: h1.id, claimId: parisClaim.id, rating: 'C' });
    assert(again.previous === 'CC' && again.rating === 'C' && !again.created, 'rating again replaces it');
    const undoRating = await undoAuditEntry({ entry: auditLine('wh_rate_hypothesis', again) });
    assert(undoRating.undone && (await db.inquiryRatings.get(`${h1.id}|${parisClaim.id}`))!.rating === 'CC', 'undo restores the previous rating');
    const clearedRating = await call('wh_rate_hypothesis', { hypothesisId: h2.id, claimId: parisClaim.id, rating: 'none' });
    assert(clearedRating.deleted === true && !(await db.inquiryRatings.get(`${h2.id}|${parisClaim.id}`)), 'none clears the cell');
    await undoAuditEntry({ entry: auditLine('wh_rate_hypothesis', clearedRating) });
    assert((await db.inquiryRatings.get(`${h2.id}|${parisClaim.id}`))?.rating === 'I', 'undo of a clear puts the rating back');
    assert((await call('wh_rate_hypothesis', { hypothesisId: h2.id, claimId: parisClaim.id, rating: 'I' })).rating === 'I', 'rating the same again is harmless');
    assert(await codeOf('wh_rate_hypothesis', { hypothesisId: h1.id, claimId: parisClaim.id, rating: 'maybe' }) === 'bad-args', 'an unknown rating is refused');
    assert(await codeOf('wh_rate_hypothesis', { hypothesisId: h1.id, claimId: 'nope', rating: 'C' }) === 'not-found', 'an unknown claim is not found');
    assert(await codeOf('wh_rate_hypothesis', { hypothesisId: h1.id, claimId: `${B}-none`, rating: 'C' }) === 'not-found', 'a claim that is not there is not found');
    assert(await scopedCodeOf('wh_rate_hypothesis', { hypothesisId: h1.id, claimId: parisClaim.id, rating: 'C' }, B) === 'scope', 'a copilot pinned to B cannot rate in A');
    // Retracting the source the claims rest on reshapes the matrix.
    await call('wh_retract_source', { projectId: A, citationId: paper.citationId, reason: 'test' });
    const reshaped = await call('wh_ach_matrix', { projectId: A });
    assert(reshaped.excludedClaims.length > 0 && reshaped.claims.length < matrix.claims.length, 'claims without an active source leave the matrix');
    await call('wh_retract_source', { projectId: A, citationId: paper.citationId, restore: true });
    const undoHyp = await undoAuditEntry({ entry: auditLine('wh_add_hypothesis', await call('wh_add_hypothesis', { projectId: A, statement: 'Temporary.' })) });
    assert(undoHyp.undone, 'undo removes a hypothesis through the engine operation');
    passed.push('Bridge hypotheses: ratings, inconsistency-only scoring, "least contradicted so far", replace/clear/undo, retraction reshapes the matrix');

    // ---- Enrichment and the privacy guard -----------------------------------------------
    const refusedPerson = await messageOf('wh_enrich_codex', { projectId: A, entryId: `${A}-ana` });
    assert(await codeOf('wh_enrich_codex', { projectId: A, entryId: `${A}-ana` }) === 'private-person' && refusedPerson.includes('public figure'), 'a private person is refused with a hint');
    assert(await codeOf('wh_enrich_codex', { projectId: A, entryId: `${A}-ana`, action: 'apply', qid: 'Q7' }) === 'private-person', 'apply is refused too');
    assert(wikidataCalls.length === 0, 'nothing was sent for a private person');
    assert(await codeOf('wh_enrich_codex', { projectId: A, entryId: `${B}-other` }) === 'scope', 'an entry of another project is out of scope');
    assert(await codeOf('wh_enrich_codex', { projectId: A, entryId: `${A}-acme`, action: 'apply' }) === 'bad-args', 'apply needs a qid');
    assert(await codeOf('wh_enrich_codex', { projectId: A, entryId: `${A}-acme`, action: 'apply', qid: 'nope' }) === 'bad-args', 'a malformed qid is refused');
    const candidates = await call('wh_enrich_codex', { projectId: A, entryId: `${A}-acme` });
    assert(candidates.candidates[0].qid === 'Q7' && !(await db.codexEntries.get(`${A}-acme`))!.wikidataQid, 'candidates write nothing');
    assert(wikidataCalls.join('|') === 'search:Acme', 'only the entry title is sent');
    const applied = await call('wh_enrich_codex', { projectId: A, entryId: `${A}-acme`, action: 'apply', qid: 'Q7' });
    assert(applied.applied === true && applied.filled.some((row: Out) => row.field === 'description' && row.value === 'a company') && applied.sourceCreated === true, 'apply fills empty fields and files a source');
    const enriched = (await db.codexEntries.get(`${A}-acme`))!;
    assert(enriched.wikidataQid === 'Q7' && enriched.fields.name === 'Acme', 'the QID is stored and the author\'s field untouched');
    const sourceRow = (await db.citations.get(applied.sourceId))!;
    assert(sourceRow.reliability === 'C' && sourceRow.credibility === 3 && sourceRow.origin === 'wikidata.org', 'a C3 wikidata.org source was recorded');
    assert((await db.enrichmentRuns.get(applied.runId))?.status === 'ok', 'the run is logged');
    const undoneEnrichment = await call('wh_undo_enrichment', { runId: applied.runId });
    const restored = (await db.codexEntries.get(`${A}-acme`))!;
    assert(undoneEnrichment.undone === true && restored.wikidataQid === undefined && !('description' in restored.fields) && restored.fields.name === 'Acme', 'undo restores the previous values');
    assert(!(await db.citations.get(applied.sourceId)), 'undo removes what the run added');
    assert(await codeOf('wh_undo_enrichment', { runId: applied.runId }) === 'bad-args', 'a run is undone once');
    assert(await codeOf('wh_undo_enrichment', { runId: 'nope' }) === 'not-found', 'an unknown run is not found');
    const second = await call('wh_enrich_codex', { projectId: A, entryId: `${A}-paris`, action: 'apply', qid: 'Q7' });
    const viaAudit = await undoAuditEntry({ entry: auditLine('wh_enrich_codex', second) });
    assert(viaAudit.undone && (await db.codexEntries.get(`${A}-paris`))!.wikidataQid === undefined && (await db.enrichmentRuns.get(second.runId))?.status === 'undone', 'the audit undo reverses the run itself');
    assert(await scopedCodeOf('wh_undo_enrichment', { runId: applied.runId }, B) === 'scope', 'a copilot pinned to B cannot undo a run of A');
    const publicFigure = await call('wh_enrich_codex', { projectId: A, entryId: `${A}-lee` });
    assert(publicFigure.candidates.length === 1, 'a person marked public can be looked up');
    passed.push('Bridge enrichment: private people refused with a hint and nothing sent, candidates write nothing, apply fills empty fields only, undo and audit undo reverse the run');

    // ---- Report -------------------------------------------------------------------------------
    const report = await call('wh_inquiry_report', { projectId: A });
    assert(typeof report.markdown === 'string' && report.markdown.includes('Acme') && report.sources.length >= 2, 'the report names claims and lists sources');
    assert(typeof report.citationCheck.ok === 'boolean' && Array.isArray(report.citationCheck.issues), 'the citation check is returned');
    assert(report.sources.every((source: Out) => typeof source.grade === 'string'), 'sources carry a grade or "ungraded"');
    assert(/public figure/i.test(report.markdown), 'a flagged person is marked a public figure');
    await call('wh_add_claim', { projectId: A, statement: 'Ana Ruiz works at Acme.', subjectId: `${A}-ana`, predicate: 'works_at', objectId: `${A}-acme`, supports: [paper] });
    const privateReport = await call('wh_inquiry_report', { projectId: A });
    assert(/private person/i.test(privateReport.markdown), 'an unflagged person is marked a private person');
    assert(!/\bproven\b/i.test(privateReport.markdown), 'the report never says proven');
    await call('wh_retract_source', { projectId: A, citationId: paper.citationId, reason: 'check' });
    const flagged = await call('wh_inquiry_report', { projectId: A });
    assert(flagged.sources.some((source: Out) => source.retracted), 'retracted sources are listed and marked');
    await call('wh_retract_source', { projectId: A, citationId: paper.citationId, restore: true });
    assert(await codeOf('wh_inquiry_report', { projectId: A, asOf: 'soon' }) === 'bad-args', 'a bad asOf is refused');
    passed.push('Bridge report: Markdown with citation check, graded sources, private vs public figure, retracted sources marked');

    // ---- Family library search ---------------------------------------------------------------------
    hubDown = false;
    const found = await call('wh_search_library', { projectId: A, q: 'Acme history' });
    assert(found.available === true && found.apps.borges.hits[0].ref === 'hoard://borges/document/d9' && found.apps.links.hits[0].url === 'https://news.example.com/acme', 'hits come back from both apps');
    assert(familyCalls.map(row => `${row.app}:${row.q}`).sort().join('|') === 'borges:Acme history|links:Acme history', 'the query is sent to each app');
    const filedLinks = (await db.citations.where('projectId').equals(A).toArray()).filter(row => row.tags.includes('family'));
    assert(filedLinks.length === 2 && filedLinks.every(row => row.reliability === undefined && (row.researchEvidence?.[0]?.status ?? 'pending') === 'pending'), 'hits are filed as ungraded sources with pending excerpts');
    assert(filedLinks.some(row => row.notes?.includes('hoard://borges/document/d9') && !row.url), 'a library document is referenced in the notes, not in the address field');
    const repeat = await call('wh_search_library', { projectId: A, q: 'Acme history' });
    assert(repeat.created === undefined && repeat.apps.borges.hits[0].filed === false, 'the same hit is not filed twice');
    assert((await db.citations.where('projectId').equals(A).toArray()).filter(row => row.tags.includes('family')).length === 2, 'no duplicate sources');
    const lookOnly = await call('wh_search_library', { projectId: A, q: 'another topic', save: false });
    assert(lookOnly.saved === false && lookOnly.apps.borges.hits[0].sourceId === null, 'save:false only looks');
    familyCalls.length = 0;
    const redacted = await call('wh_search_library', { projectId: A, q: 'Ana Ruiz Acme', save: false });
    assert(redacted.redacted === true && familyCalls.every(row => row.q === 'Acme'), 'a private person is taken out of the query before it is sent');
    familyCalls.length = 0;
    const publicQuery = await call('wh_search_library', { projectId: A, q: 'Lee Han Acme', save: false });
    assert(publicQuery.redacted === false && familyCalls.every(row => row.q === 'Lee Han Acme'), 'a public figure stays in the query');
    familyCalls.length = 0;
    assert(await codeOf('wh_search_library', { projectId: A, q: 'Ana Ruiz' }) === 'private-person' && familyCalls.length === 0, 'a query made only of a private name is refused and nothing is sent');
    assert(await codeOf('wh_search_library', { projectId: A, q: 'x', apps: ['nonsense'] }) === 'bad-args', 'an unknown app is refused');
    hubDown = true;
    const down = await call('wh_search_library', { projectId: A, q: 'Acme history' });
    assert(down.available === false && down.apps.borges.status === 'unavailable' && /hub is not running/i.test(down.apps.borges.error) && String(down.hint).includes('hub'), 'a hub that is down degrades clearly');
    hubDown = false;
    const lastFiled = await call('wh_search_library', { projectId: A, q: 'fresh topic', apps: ['links'] });
    const fresh = lastFiled.apps.links.hits[0];
    assert(fresh.filed === false, 'the links hit already existed by address');
    const libraryFresh = await call('wh_search_library', { projectId: A, q: 'yet another', apps: ['borges'], limit: 1 });
    assert(libraryFresh.apps.borges.hits.length === 1, 'the limit is honoured');
    // Undo of filed sources, unless claims rest on them.
    (window as unknown as { electronAPI: { family: { search: unknown } } }).electronAPI.family.search = async (request: FamilySearchRequest): Promise<FamilySearchResponse> => ({ ok: true, data: { items: [{ id: `new-${request.app}`, title: 'Brand new', snippet: 'Brand new text.' }] } });
    const brandNew = await call('wh_search_library', { projectId: A, q: 'brand new' });
    const newIds = (brandNew.__audit.entityIds as string[]);
    assert(newIds.length === 2, 'two new sources were filed');
    const newCitation = (await db.citations.get(newIds[0]))!;
    await call('wh_add_claim', { projectId: A, statement: 'Brand new things exist.', supports: [{ citationId: newCitation.id, evidenceId: newCitation.researchEvidence![0].id }] });
    let refusedUndo = '';
    try { await undoAuditEntry({ entry: auditLine('wh_search_library', brandNew) }); } catch (error) { refusedUndo = error instanceof BridgeError ? error.code : String(error); }
    assert(refusedUndo === 'cannot-undo', 'a filed source that claims now rest on is not removed by undo');
    passed.push('Bridge library search: both apps, hits filed as ungraded pending sources, no duplicates, private names redacted or refused, hub down degrades, undo protects sources in use');

    // ---- Deletion through the registry only -------------------------------------------------------------
    const stop = subscribeBridgeConfirm(pending => { if (pending) pending.settle(true); });
    try {
      const doomed = await call('wh_add_claim', { projectId: A, statement: 'A claim to delete.', supports: [registry] });
      await call('wh_rate_hypothesis', { hypothesisId: h1.id, claimId: doomed.id, rating: 'N' });
      const gone = await call('wh_delete', { type: 'inquiry-claim', id: doomed.id });
      assert(gone.deleted === true && !(await db.inquiryClaims.get(doomed.id)) && !(await db.inquiryRatings.get(`${h1.id}|${doomed.id}`)), 'wh_delete removes the claim and its ratings');
      assert((await db.citations.get(registry.citationId)) !== undefined, 'the source stays');
      assert(await scopedCodeOf('wh_delete', { type: 'inquiry-claim', id: oneId }, B) === 'scope', 'a copilot pinned to B cannot delete a claim of A');
      const gonePaper = await call('wh_delete', { type: 'inquiry-hypothesis', id: h2.id });
      assert(gonePaper.deleted === true && !(await db.inquiryRatings.where('hypothesisId').equals(h2.id).count()), 'wh_delete removes a hypothesis with its ratings');
    } finally { stop(); }
    passed.push('Bridge deletion: claims and hypotheses only through wh_delete, ratings cascade, sources stay, scope enforced');

    // ---- Reads work while the engine is off ------------------------------------------------------------
    assert((await call('wh_list_claims', { projectId: OFF })).total === 0, 'reading a project with the engine off still answers');
    passed.push('Bridge: reads answer while the engine is off, writes refuse with engine-disabled');
  } finally {
    await Promise.all([A, B, OFF].map(async projectId => {
      await Promise.all([db.codexEntries, db.citations, db.inquiryClaims, db.inquiryHypotheses, db.inquiryRatings, db.inquiryCases, db.enrichmentRuns].map(table => table.where('projectId').equals(projectId).delete()));
      await db.projects.delete(projectId);
    }));
    if (priorApi === undefined) delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    else (window as unknown as { electronAPI: unknown }).electronAPI = priorApi;
  }
  return passed;
}
