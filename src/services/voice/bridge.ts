// AI bridge handlers for the voice profile.
import { assertEngineEnabled, BridgeError, optBoolean, optNumber, optString, requireString, resolveProjectId, withAudit, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { useLocaleStore } from '@/stores/localeStore';
import { buildVoiceReport, describeVoice, lineSource, type VoiceReport } from './report';
import { readVoiceCard, setVoiceDescription } from './ops';

async function characterIn(projectId: string, characterId: string, eraId?: string) {
  const entry = await readVoiceCard(projectId, characterId, eraId);
  if (!entry || entry.projectId !== projectId) throw new BridgeError('not-found', `No Codex card "${characterId}" in this project.`);
  if (entry.type !== 'character') throw new BridgeError('bad-args', `"${entry.title}" is not a character card.`);
  return entry;
}

function lineView(report: VoiceReport, id: string) {
  const line = report.lines.find((l) => l.id === id)!;
  return { id: line.id, text: line.text, quote: line.quote, source: lineSource(report, line), ...(line.writingId ? { writingId: line.writingId, anchor: line.anchor } : {}), ...(line.sceneId ? { sceneId: line.sceneId } : {}) };
}

export const VOICE_HANDLERS = {
  async wh_voice_profile(args: ToolArgs) {
    const projectId = resolveProjectId(args);
    const characterId = optString(args, 'characterId'), eraId = optString(args, 'eraId');
    if (characterId) await characterIn(projectId, characterId, eraId);
    const report = await buildVoiceReport(projectId, eraId);
    const profiles = report.profiles.filter((p) => !characterId || p.characterId === characterId).map((p) => ({
      character: report.titles[p.characterId] ?? p.characterId, ...p,
      ...(report.descriptions[p.characterId] !== undefined ? { description: report.descriptions[p.characterId] } : {}),
    }));
    return {
      projectId, lines: report.lines.length, unattributed: report.unattributed, profiles,
      ...(optBoolean(args, 'includeLines') ? { dialogue: report.lines.filter((l) => !characterId || l.speakerId === characterId).map((l) => ({ ...lineView(report, l.id), speakerId: l.speakerId, speaker: l.speakerId ? report.titles[l.speakerId] : null, attribution: l.attribution })) } : {}),
    };
  },

  async wh_voice_outliers(args: ToolArgs) {
    const projectId = resolveProjectId(args);
    const characterId = optString(args, 'characterId'), writingId = optString(args, 'writingId');
    const report = await buildVoiceReport(projectId, optString(args, 'eraId'));
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
    const eraId = optString(args, 'eraId');
    await characterIn(projectId, characterId, eraId);
    let text = typeof args.text === 'string' ? args.text : undefined;
    let model: string | undefined;
    if (text === undefined) {
      try { text = await describeVoice(await buildVoiceReport(projectId, eraId), characterId, useLocaleStore.getState().locale === 'es'); model = 'global'; }
      catch (error) { throw new BridgeError('bad-args', error instanceof Error ? error.message : String(error)); }
    }
    const receipt = await setVoiceDescription(projectId, characterId, text || null, model, eraId);
    return withAudit({ characterId, description: receipt.after?.description ?? null }, { projectId, entityId: characterId, kind: 'update', summary: 'Set voice description', table: 'codexEntries', before: { __voiceDescription: receipt } });
  },
};
