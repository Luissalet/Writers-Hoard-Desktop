// Pacing report: the x-ray of the project's manuscript with the outline's beats
// placed on the same axis. One function feeds the panel beside the manuscript
// and the AI bridge.
import { db } from '@/db';
import { htmlToText } from '@/engines/_shared/anchoring/htmlToText';
import { buildPacing, type PacingReport } from '@/engines/writings/pacing/pacing';

export interface PacingBeat {
  id: string;
  outlineId: string;
  title: string;
  level: string;
  /** 0…1 on the manuscript axis: the linked chapter's start, else the beat's story position. */
  at: number;
  writingId?: string;
}

export interface ProjectPacing extends PacingReport {
  projectId: string;
  /** Chapter label by writing id. */
  titles: Record<string, string>;
  beats: PacingBeat[];
  /** Tension is not stored per scene or chapter in this app, so the curve uses the computed pace alone. */
  tension: null;
}

export async function buildPacingReport(projectId: string, outlineId?: string): Promise<ProjectPacing> {
  const [writings, outlines, beats] = await Promise.all([
    db.writings.where('projectId').equals(projectId).toArray(),
    db.outlines.where('projectId').equals(projectId).toArray(),
    db.outlineBeats.where('projectId').equals(projectId).toArray(),
  ]);
  const ordered = [...writings].sort((a, b) => (a.chapter ?? 1e9) - (b.chapter ?? 1e9) || a.title.localeCompare(b.title));
  // The editor's scene break is a horizontal rule; it becomes a break line before the text is read.
  const report = buildPacing(ordered.map((w) => ({ writingId: w.id, chapter: typeof w.chapter === 'number' ? w.chapter : null, title: w.title, text: htmlToText((w.content ?? '').replace(/<hr\b[^>]*>/gi, '<p>***</p>')) })));
  // A chapter starts where its first scene starts.
  const starts = new Map<string, number>();
  let done = 0;
  for (const scene of report.scenes) {
    if (!starts.has(scene.writingId)) starts.set(scene.writingId, report.words ? done / report.words : 0);
    done += scene.words;
  }
  const story = outlines.filter((o) => o.kind !== 'session' && (!outlineId || o.id === outlineId)).map((o) => o.id);
  const placed: PacingBeat[] = beats.filter((b) => story.includes(b.outlineId)).flatMap((b) => {
    const linked = b.linkedWritingId ? starts.get(b.linkedWritingId) : undefined;
    const at = linked ?? (typeof b.storyPosition === 'number' ? Math.max(0, Math.min(1, b.storyPosition / 100)) : undefined);
    return at === undefined ? [] : [{ id: b.id, outlineId: b.outlineId, title: b.title, level: b.level, at: Math.round(at * 1e4) / 1e4, ...(b.linkedWritingId ? { writingId: b.linkedWritingId } : {}) }];
  }).sort((a, b) => a.at - b.at || a.title.localeCompare(b.title));
  return {
    ...report, projectId,
    titles: Object.fromEntries(ordered.map((w) => [w.id, typeof w.chapter === 'number' ? `${w.chapter}. ${w.title}` : w.title])),
    beats: placed, tension: null,
  };
}
