// ============================================================================
// AI bridge — filing a research station's evidence pack (wh_import_evidence)
// ============================================================================

import { callFamily } from '@/services/familyBridge/client';
import { EvidencePackError, filePack, normalizePack, packFromHandoff, type EvidencePack } from '@/services/evidencePack';
import { BridgeError, assertRowInScope, optString, resolveProjectId, withAudit, type ToolArgs } from './shared';

const REPORT_ID = /^[A-Za-z0-9_.:-]{1,120}$/;

async function packFromArgs(args: ToolArgs): Promise<unknown> {
  const reportId = optString(args, 'coaseReportId');
  if (args.pack !== undefined && reportId) throw new BridgeError('bad-args', 'Pass either pack or coaseReportId, not both.');
  if (args.pack !== undefined) return args.pack;
  if (!reportId) throw new BridgeError('bad-args', 'Pass coaseReportId (a Coase dossier report), nightingale (a Nightingale chart or table) or pack (sources and claims with quotes).');
  if (!REPORT_ID.test(reportId)) throw new BridgeError('bad-args', 'coaseReportId is the id of a Coase report (from coase_reports).');
  const answer = await callFamily('coase', 'coase_report', { report_id: reportId }, { timeoutS: 60 });
  if (!answer.ok) {
    throw new BridgeError('unavailable', `Coase did not hand over report ${reportId}: ${answer.error}. Start Coase's Hoard from the Hub and try again.`);
  }
  const report = answer.result as Record<string, unknown> | null;
  return report && typeof report === 'object' ? { ...report, ref: `hoard://coase/report/${reportId}` } : report;
}

/** Nightingale's own table, asked through the Hub: its figures and provenance arrive as Nightingale computed them. */
async function packFromNightingale(args: ToolArgs): Promise<EvidencePack> {
  if (args.pack !== undefined || args.coaseReportId !== undefined) throw new BridgeError('bad-args', 'Pass nightingale alone, without pack or coaseReportId.');
  const raw = args.nightingale;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BridgeError('bad-args', 'nightingale is {chart_id} or {dataset, columns?, filter?}.');
  const given = raw as Record<string, unknown>;
  const request: Record<string, unknown> = {};
  const chartId = given.chart_id ?? given.chartId;
  if (chartId !== undefined) {
    if (typeof chartId !== 'number' || !Number.isInteger(chartId) || chartId < 1) throw new BridgeError('bad-args', 'nightingale.chart_id is the id of a saved Nightingale chart.');
    request.chart_id = chartId;
  }
  if (typeof given.dataset === 'string' && given.dataset.trim()) request.dataset = given.dataset.trim();
  if ((request.chart_id === undefined) === (request.dataset === undefined)) throw new BridgeError('bad-args', 'Pass nightingale.chart_id or nightingale.dataset, not both.');
  if (Array.isArray(given.columns) && given.columns.every(c => typeof c === 'string')) request.columns = given.columns;
  if (typeof given.filter === 'string' && given.filter.trim()) request.filter = given.filter.trim();
  if (typeof given.limit === 'number') request.limit = given.limit;
  const answer = await callFamily('nightingale', 'data_handoff', request, { timeoutS: 60 });
  if (!answer.ok) {
    throw new BridgeError('unavailable', `Nightingale did not hand over the table: ${answer.error}. Start Nightingale's Hoard from the Hub and try again.`);
  }
  return packFromHandoff(answer.result);
}

export async function whImportEvidence(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  assertRowInScope(args, projectId);
  let filed;
  let pack: EvidencePack;
  try {
    pack = args.nightingale !== undefined ? await packFromNightingale(args) : normalizePack(await packFromArgs(args), optString(args, 'ref') ?? '');
    filed = await filePack(projectId, pack);
  } catch (error) {
    if (error instanceof EvidencePackError) throw new BridgeError('bad-args', error.message);
    throw error;
  }
  const table = pack.sources.find(source => source.table)?.table;
  const tableSourceId = table ? filed.claims[0]?.sourceId : undefined;
  const result = {
    ref: filed.ref,
    sourcesCreated: filed.createdCitationIds.length,
    claims: filed.claims.map(c => ({
      claim: c.claim, quote: c.quote, sourceId: c.sourceId, evidenceId: c.evidenceId, alreadyFiled: !c.created,
    })),
    ...(table && tableSourceId ? {
      table: { sourceId: tableSourceId, columns: table.columns, rows: table.rows.length, version: table.version, fingerprint: table.fingerprint },
    } : {}),
    next: (table ? 'Insert the table, cited, with wh_edit_writing_editorial operation {kind:"insertDataTable", sourceId, at?}. ' : '')
      + 'Cite a claim in a chapter with wh_edit_writing_editorial, operation {kind:"insertCitation", sourceId, evidenceId, '
      + 'range:{from:p,to:p}} (a collapsed range inserts without touching the text). The quotes are pending: check them before relying on them.',
  };
  const added = filed.appended.reduce((sum, row) => sum + row.evidenceIds.length, 0);
  if (!filed.createdCitationIds.length && !added) return result;
  // Undo removes the sources this call created and the claims it added to
  // sources filed before (__evidenceAppended); rows already there stay.
  return withAudit({ ...result, ...(filed.createdCitationIds.length ? { created: true } : {}), claimsAdded: added }, {
    projectId,
    entityIds: filed.createdCitationIds,
    entityId: filed.createdCitationIds[0] ?? filed.appended[0].citationId,
    table: 'citations',
    kind: filed.createdCitationIds.length ? 'create' : 'update',
    before: { __evidenceAppended: filed.appended },
    summary: `filed ${filed.claims.length} claim(s) from ${filed.createdCitationIds.length} new and ${filed.appended.length} known source(s) of ${filed.ref}`,
  });
}
