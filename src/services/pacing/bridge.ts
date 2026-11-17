// AI bridge handler for the pacing x-ray.
import { assertEngineEnabled, BridgeError, optNumber, optString, requireString, resolveProjectId, withAudit, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { buildPacingReport } from './report';
import { setSceneTension } from './tensionOps';

export const PACING_HANDLERS = {
  async wh_pacing(args: ToolArgs) {
    const projectId = resolveProjectId(args);
    const writingId = optString(args, 'writingId');
    const report = await buildPacingReport(projectId, optString(args, 'outlineId'), optString(args, 'eraId'));
    const scenes = report.scenes.filter((scene) => !writingId || scene.writingId === writingId);
    const keep = new Set(scenes.map((scene) => scene.id));
    return {
      projectId, words: report.words, tension: report.tension,
      chapters: report.chapters.filter((c) => !writingId || c.writingId === writingId).map((c) => ({ ...c, label: report.titles[c.writingId] })),
      scenes: scenes.map(({ anchor: _anchor, ...scene }) => ({ ...scene, chapterTitle: report.titles[scene.writingId] })),
      flags: report.flags.filter((flag) => flag.sceneIds.some((id) => keep.has(id))),
      beats: report.beats,
    };
  },

  async wh_pacing_set_tension(args: ToolArgs) {
    const projectId = resolveProjectId(args);
    await assertEngineEnabled(projectId, 'writings');
    const writingId = requireString(args, 'writingId');
    const sceneIndex = optNumber(args, 'sceneIndex');
    const tension = args.tension === null ? null : optNumber(args, 'tension');
    if (sceneIndex === undefined || tension === undefined) throw new BridgeError('bad-args', 'Pass sceneIndex and tension (a number or null).');
    try {
      const receipt = await setSceneTension({ projectId, eraId: optString(args, 'eraId') }, writingId, sceneIndex, tension);
      return withAudit({ writingId, sceneIndex, tension }, {
        projectId, entityId: writingId, kind: 'update', summary: 'Set scene tension',
        before: { __sceneTension: receipt }, ...(receipt.before === receipt.after ? { reversible: false as const } : {}),
      });
    } catch (error) {
      throw new BridgeError('bad-args', error instanceof Error ? error.message : String(error));
    }
  },
};
