// Plan drift report: each story-outline beat against the chapter linked to it,
// with the Codex names, the seeds and payoffs linked to the beat and the map's
// story events told in the chapter. Feeds the panel and the AI bridge.
import { db } from '@/db';
import { htmlToText } from '@/engines/_shared/anchoring/htmlToText';
import { deserializeEdits } from '@/engines/worldgen/core/edits';
import { storyEventsFrom } from '@/engines/worldgen/core/storyEvents';
import { readAliases } from '@/services/codexReference/aliases';
import { checkDrift, type DriftReport } from '@/engines/writings/planDrift/drift';
import { t } from '@/i18n/useTranslation';
import { listEraRows } from '@/services/worldEras/store';
import type { CodexEntry, Writing } from '@/types';
import type { GeneratedWorld } from '@/engines/worldgen/types';
import type { OutlineBeat } from '@/engines/outline/types';

export interface ProjectDrift extends DriftReport {
  projectId: string;
  titles: Record<string, string>;
  beatRows: Record<string, Pick<OutlineBeat, 'id' | 'outlineId' | 'title' | 'description' | 'level' | 'status'>>;
  outlines: Record<string, string>;
}

export async function buildDriftReport(projectId: string, outlineId?: string, eraId?: string): Promise<ProjectDrift> {
  const scope = { projectId, eraId };
  const [writings, codex, outlines, beats, seeds, payoffs, worlds] = await Promise.all([
    eraId ? listEraRows<Writing>(scope, 'writings') : db.writings.where('projectId').equals(projectId).toArray(),
    eraId ? listEraRows<CodexEntry>(scope, 'codexEntries') : db.codexEntries.where('projectId').equals(projectId).toArray(),
    db.outlines.where('projectId').equals(projectId).toArray(),
    db.outlineBeats.where('projectId').equals(projectId).toArray(),
    db.seeds.where('projectId').equals(projectId).toArray(),
    db.payoffs.where('projectId').equals(projectId).toArray(),
    eraId ? listEraRows<GeneratedWorld>(scope, 'generatedWorlds') : db.generatedWorlds.where('projectId').equals(projectId).toArray(),
  ]);
  const story = outlines.filter((o) => o.kind !== 'session' && (!outlineId || o.id === outlineId));
  const storyIds = new Set(story.map((o) => o.id));
  const ownBeats = beats.filter((b) => storyIds.has(b.outlineId));
  const events = worlds.flatMap((w) => {
    try { return storyEventsFrom(deserializeEdits(w.edits ?? '[]')); } catch { return []; }
  }).filter((e) => e.writingId).map((e) => ({ writingId: e.writingId!, who: e.who ?? [] }));
  const report = checkDrift(
    ownBeats.map((b) => ({ id: b.id, outlineId: b.outlineId, title: b.title, description: b.description ?? '', level: b.level, order: b.order, ...(b.linkedWritingId ? { linkedWritingId: b.linkedWritingId } : {}) })),
    writings.map((w) => ({ writingId: w.id, chapter: typeof w.chapter === 'number' ? w.chapter : null, title: w.title, synopsis: w.synopsis ?? '', text: htmlToText(w.content) })),
    codex.map((e) => ({ id: e.id, name: e.title, aliases: readAliases(e.fields ?? {}), type: e.type })),
    [...seeds.map((s) => ({ id: s.id, kind: 'seed' as const, title: s.title, linkedBeatId: s.linkedBeatId, linkedWritingId: s.linkedWritingId })),
      ...payoffs.map((p) => ({ id: p.id, kind: 'payoff' as const, title: p.title, linkedBeatId: p.linkedBeatId, linkedWritingId: p.linkedWritingId }))],
    events,
    { characters: t('drift.proposal.characters'), places: t('drift.proposal.places') },
  );
  return {
    ...report, projectId,
    titles: {
      ...Object.fromEntries(codex.map((e) => [e.id, e.title])),
      ...Object.fromEntries(writings.map((w) => [w.id, typeof w.chapter === 'number' ? `${w.chapter}. ${w.title}` : w.title])),
      ...Object.fromEntries(seeds.map((s) => [s.id, s.title])),
      ...Object.fromEntries(payoffs.map((p) => [p.id, p.title])),
    },
    beatRows: Object.fromEntries(ownBeats.map((b) => [b.id, { id: b.id, outlineId: b.outlineId, title: b.title, description: b.description ?? '', level: b.level, status: b.status }])),
    outlines: Object.fromEntries(story.map((o) => [o.id, o.title])),
  };
}
