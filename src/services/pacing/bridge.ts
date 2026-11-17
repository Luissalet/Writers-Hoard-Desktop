// AI bridge handler for the pacing x-ray.
import { optString, resolveProjectId, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { buildPacingReport } from './report';

export const PACING_HANDLERS = {
  async wh_pacing(args: ToolArgs) {
    const projectId = resolveProjectId(args);
    const writingId = optString(args, 'writingId');
    const report = await buildPacingReport(projectId, optString(args, 'outlineId'));
    const scenes = report.scenes.filter((scene) => !writingId || scene.writingId === writingId);
    const keep = new Set(scenes.map((scene) => scene.id));
    return {
      projectId, words: report.words, tension: report.tension,
      chapters: report.chapters.filter((c) => !writingId || c.writingId === writingId).map((c) => ({ ...c, label: report.titles[c.writingId] })),
      scenes: scenes.map((scene) => ({ ...scene, chapterTitle: report.titles[scene.writingId] })),
      flags: report.flags.filter((flag) => flag.sceneIds.some((id) => keep.has(id))),
      beats: report.beats,
    };
  },
};
