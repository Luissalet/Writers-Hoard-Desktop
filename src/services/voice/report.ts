// Voice report: dialogue lines of the project's manuscript and Dialog Scene
// blocks, each character's profile and the lines that leave it. One function
// feeds the panel beside the manuscript, the Codex card and the AI bridge.
import { db } from '@/db';
import { htmlToText } from '@/engines/_shared/anchoring/htmlToText';
import { readAliases } from '@/services/codexReference/aliases';
import { extractDialogue, type DialogueLine, type VoiceCharacter } from '@/engines/writings/voice/dialogue';
import { buildProfiles, findOutliers, type VoiceOutlier, type VoiceProfile } from '@/engines/writings/voice/profile';

export interface VoiceReport {
  projectId: string;
  characters: VoiceCharacter[];
  titles: Record<string, string>;
  /** Chapter label by writing id, and scene title by scene id. */
  sources: Record<string, string>;
  lines: DialogueLine[];
  profiles: VoiceProfile[];
  outliers: VoiceOutlier[];
  /** Lines nobody could be attributed to. */
  unattributed: number;
}

export async function buildVoiceReport(projectId: string): Promise<VoiceReport> {
  const [writings, codex, scenes, blocks] = await Promise.all([
    db.writings.where('projectId').equals(projectId).toArray(),
    db.codexEntries.where('projectId').equals(projectId).toArray(),
    db.scenes.where('projectId').equals(projectId).toArray(),
    db.dialogBlocks.where('projectId').equals(projectId).toArray(),
  ]);
  const characters: VoiceCharacter[] = codex.filter((e) => e.type === 'character')
    .map((e) => ({ id: e.id, name: e.title, aliases: readAliases(e.fields ?? {}) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const ordered = [...writings].sort((a, b) => (a.chapter ?? 1e9) - (b.chapter ?? 1e9) || a.title.localeCompare(b.title));
  const known = new Set(characters.map((c) => c.id));
  const lines = extractDialogue(
    ordered.map((w) => ({ writingId: w.id, chapter: typeof w.chapter === 'number' ? w.chapter : null, title: w.title, text: htmlToText(w.content) })),
    characters,
    blocks.filter((b) => b.type === 'dialog' && b.characterId && known.has(b.characterId)).sort((a, b) => a.sceneId.localeCompare(b.sceneId) || a.order - b.order)
      .map((b) => ({ id: b.id, sceneId: b.sceneId, characterId: b.characterId!, text: htmlToText(b.content) })),
  );
  const profiles = buildProfiles(lines);
  return {
    projectId, characters,
    titles: Object.fromEntries(codex.map((e) => [e.id, e.title])),
    sources: {
      ...Object.fromEntries(ordered.map((w) => [w.id, typeof w.chapter === 'number' ? `${w.chapter}. ${w.title}` : w.title])),
      ...Object.fromEntries(scenes.map((s) => [s.id, s.title])),
    },
    lines, profiles, outliers: findOutliers(lines, profiles),
    unattributed: lines.filter((l) => !l.speakerId).length,
  };
}

/** Where a line is, for people: its chapter or scene. */
export function lineSource(report: VoiceReport, line: DialogueLine): string {
  return (line.writingId ? report.sources[line.writingId] : line.sceneId ? report.sources[line.sceneId] : '') ?? '';
}

const DESCRIBE_SYSTEM = (spanish: boolean) => `You describe how a fiction character speaks, from statistics of their dialogue and a few of their lines. Respond in ${spanish ? 'Spanish (Spain)' : 'English'}, plain text, at most five sentences, no lists, no headings. Describe only what the data shows: sentence length, vocabulary, repeated phrases, form of address, register, punctuation. Never invent biography.`;

/** A prose description of a profile by the global model; nothing is stored unless the caller saves it. */
export async function describeVoice(report: VoiceReport, characterId: string, spanish: boolean): Promise<string> {
  const profile = report.profiles.find((p) => p.characterId === characterId);
  if (!profile) throw new Error(`No dialogue attributed to "${report.titles[characterId] ?? characterId}".`);
  const { callAi } = await import('@/services/aiService');
  const { useAiStore } = await import('@/stores/aiStore');
  const sample = report.lines.filter((l) => l.speakerId === characterId).slice(0, 12).map((l) => `- ${l.text}`).join('\n');
  const stats = JSON.stringify({ ...profile, characterId: undefined, name: report.titles[characterId] });
  return (await callAi(DESCRIBE_SYSTEM(spanish), `Profile: ${stats}\nLines:\n${sample}`, useAiStore.getState().config)).trim();
}
