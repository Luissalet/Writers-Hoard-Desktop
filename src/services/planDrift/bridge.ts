// AI bridge handlers for plan drift.
import { assertEngineEnabled, BridgeError, optString, requireString, resolveProjectId, withAudit, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { buildDriftReport, type ProjectDrift } from './report';
import { applyBeatProposal } from './ops';

const names = (report: ProjectDrift, ids: readonly string[]) => ids.map((id) => report.titles[id] ?? id);

export const PLAN_DRIFT_HANDLERS = {
  async wh_plan_drift(args: ToolArgs) {
    const projectId = resolveProjectId(args);
    const report = await buildDriftReport(projectId, optString(args, 'outlineId'), optString(args, 'eraId'));
    const status = optString(args, 'status');
    return {
      projectId,
      beats: report.beats.filter((b) => !status || b.status === status).map((b) => ({
        beatId: b.beatId, beat: report.beatRows[b.beatId]?.title, outline: report.outlines[b.outlineId], outlineId: b.outlineId,
        writingId: b.writingId, chapter: b.writingId ? report.titles[b.writingId] : null, status: b.status, score: b.score,
        expected: { characters: names(report, b.expected.characters), places: names(report, b.expected.places), others: names(report, b.expected.others), promises: names(report, b.expected.promises) },
        missing: { characters: names(report, b.missing.characters), places: names(report, b.missing.places), others: names(report, b.missing.others), promises: names(report, b.missing.promises) },
        extra: { characters: names(report, b.extra.characters), places: names(report, b.extra.places) },
        ...(b.proposal ? { proposal: b.proposal } : {}),
      })),
      unplanned: report.unplanned.map((id) => ({ writingId: id, chapter: report.titles[id] })),
    };
  },

  async wh_plan_drift_apply(args: ToolArgs) {
    const projectId = resolveProjectId(args);
    await assertEngineEnabled(projectId, 'outline');
    const beatId = requireString(args, 'beatId');
    const report = await buildDriftReport(projectId, undefined, optString(args, 'eraId'));
    const drift = report.beats.find((b) => b.beatId === beatId);
    if (!drift) throw new BridgeError('not-found', `No story-outline beat "${beatId}" in this project.`);
    if (!drift.proposal) throw new BridgeError('bad-args', 'This beat has no proposal: its chapter already does what it says, or it has no chapter.');
    const receipt = await applyBeatProposal(projectId, beatId, { title: optString(args, 'title') ?? drift.proposal.title, description: optString(args, 'description') ?? drift.proposal.description });
    return withAudit({ beatId, title: receipt.after.title, description: receipt.after.description }, { projectId, entityId: beatId, kind: 'update', summary: 'Update an outline beat from its chapter', before: { __planDrift: receipt } });
  },
};
