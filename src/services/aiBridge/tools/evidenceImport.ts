// ============================================================================
// AI bridge — filing a research station's evidence pack (wh_import_evidence)
// ============================================================================

import { callFamily } from '@/services/familyBridge/client';
import { EvidencePackError, filePack, normalizePack } from '@/services/evidencePack';
import { BridgeError, assertRowInScope, optString, resolveProjectId, withAudit, type ToolArgs } from './shared';

const REPORT_ID = /^[A-Za-z0-9_.:-]{1,120}$/;

async function packFromArgs(args: ToolArgs): Promise<unknown> {
  const reportId = optString(args, 'coaseReportId');
  if (args.pack !== undefined && reportId) throw new BridgeError('bad-args', 'Pass either pack or coaseReportId, not both.');
  if (args.pack !== undefined) return args.pack;
  if (!reportId) throw new BridgeError('bad-args', 'Pass coaseReportId (a Coase dossier report) or pack (sources and claims with quotes).');
  if (!REPORT_ID.test(reportId)) throw new BridgeError('bad-args', 'coaseReportId is the id of a Coase report (from coase_reports).');
  const answer = await callFamily('coase', 'coase_report', { report_id: reportId }, { timeoutS: 60 });
  if (!answer.ok) {
    throw new BridgeError('unavailable', `Coase did not hand over report ${reportId}: ${answer.error}. Start Coase's Hoard from the Hub and try again.`);
  }
  const report = answer.result as Record<string, unknown> | null;
  return report && typeof report === 'object' ? { ...report, ref: `hoard://coase/report/${reportId}` } : report;
}

export async function whImportEvidence(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  assertRowInScope(args, projectId);
  const raw = await packFromArgs(args);
  let filed;
  try {
    const pack = normalizePack(raw, optString(args, 'ref') ?? '');
    filed = await filePack(projectId, pack);
  } catch (error) {
    if (error instanceof EvidencePackError) throw new BridgeError('bad-args', error.message);
    throw error;
  }
  const result = {
    ref: filed.ref,
    sourcesCreated: filed.createdCitationIds.length,
    claims: filed.claims.map(c => ({
      claim: c.claim, quote: c.quote, sourceId: c.sourceId, evidenceId: c.evidenceId, alreadyFiled: !c.created,
    })),
    next: 'Cite a claim in a chapter with wh_edit_writing_editorial, operation {kind:"insertCitation", sourceId, evidenceId, '
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
