// AI bridge handlers for the voice profile.
import { db } from '@/db';
import { assertEngineEnabled, BridgeError, optBoolean, optNumber, optString, requireString, resolveProjectId, withAudit, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { useLocaleStore } from '@/stores/localeStore';
import { buildVoiceReport, describeVoice, lineSource, type VoiceReport } from './report';
import { setVoiceDescription } from './ops';

async function characterIn(projectId: string, characterId: string) {
  const entry = await db.codexEntries.get(characterId);
  if (!entry || entry.projectId !== projectId) throw new BridgeError('not-found', `No Codex card "${characterId}" in this project.`);
  if (entry.type !== 'character') throw new BridgeError('bad-args', `"${entry.title}" is not a character card.`);
  return entry;
}

function lineView(report: VoiceReport, id: string) {
  const line = report.lines.find((l) => l.id === id)!;
  return { id: line.id, text: line.text, quote: line.quote, source: lineSource(report, line), ...(line.writingId ? { writingId: line.writingId } : {}), ...(line.sceneId ? { sceneId: line.sceneId } : {}) };
}

export const VOICE_HANDLERS = {
  async wh_voice_profile(args: ToolArgs) {
    const projectId = resolveProjectId(args);
    const characterId = optString(args, 'characterId');
    if (characterId) await characterIn(projectId, characterId);
    const report = await buildVoiceReport(projectId);
    const cards = new Map((await db.codexEntries.where('projectId').equals(projectId).toArray()).map((e) => [e.id, e]));
    const profiles = report.profiles.filter((p) => !characterId || p.characterId === characterId).map((p) => ({
      character: report.titles[p.characterId] ?? p.characterId, ...p,
      ...(cards.get(p.characterId)?.voice ? { description: cards.get(p.characterId)!.voice!.description } : {}),
    }));
    return {
      projectId, lines: report.lines.length, unattributed: report.unattributed, profiles,
      ...(optBoolean(args, 'includeLines') ? { dialogue: report.lines.filter((l) => !characterId || l.speakerId === characterId).map((l) => ({ ...lineView(report, l.id), speakerId: l.speakerId, speaker: l.speakerId ? report.titles[l.speakerId] : null, attribution: l.attribution })) } : {}),
    };
  },

  async wh_voice_outliers(args: ToolArgs) {
    const projectId = resolveProjectId(args);
    const characterId = optString(args, 'characterId'), writingId = optString(args, 'writingId');
    const report = await buildVoiceReport(projectId);
    const limit = optNumber(args, 'limit') ?? 50;
    const outliers = report.outliers.filter((o) => (!characterId || o.speakerId === characterId) && (!writingId || report.lines.find((l) => l.id === o.lineId)?.writingId === writingId));
    return {
      projectId, total: outliers.length,
      outliers: outliers.slice(0, limit).map((o) => ({
        speaker: report.titles[o.speakerId] ?? o.speakerId, speakerId: o.speakerId, reason: o.reason, detail: o.detail,
        ...(o.otherId ? { closerTo: report.titles[o.otherId] ?? o.otherId, closerToId: o.otherId } : {}),
        line: lineView(report, o.lineId),
      })),
    };
  },

  async wh_voice_describe(args: ToolArgs) {
    const projectId = resolveProjectId(args);
    await assertEngineEnabled(projectId, 'codex');
    const characterId = requireString(args, 'characterId');
    await characterIn(projectId, characterId);
    let text = typeof args.text === 'string' ? args.text : undefined;
    let model: string | undefined;
    if (text === undefined) {
      try { text = await describeVoice(await buildVoiceReport(projectId), characterId, useLocaleStore.getState().locale === 'es'); model = 'global'; }
      catch (error) { throw new BridgeError('bad-args', error instanceof Error ? error.message : String(error)); }
    }
    const receipt = await setVoiceDescription(projectId, characterId, text || null, model);
    return withAudit({ characterId, description: receipt.after?.description ?? null }, { projectId, entityId: characterId, kind: 'update', summary: 'Set voice description', before: receipt.before ? { voice: receipt.before } : { __absent: ['voice'] } });
  },
};
