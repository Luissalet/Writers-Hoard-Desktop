// Pacing report: the x-ray of the project's manuscript with the outline's beats
// placed on the same axis. One function feeds the panel beside the manuscript
// and the AI bridge.
import { db } from '@/db';
import { htmlToText } from '@/engines/_shared/anchoring/htmlToText';
import { buildPacing, type PacingReport } from '@/engines/writings/pacing/pacing';
import { listEraRows } from '@/services/worldEras/store';
import type { Writing } from '@/types';

/** Keep the editor's horizontal rules alongside the manuscript's text breaks. */
export function pacingText(content: string | undefined): string {
  return htmlToText((content ?? '').replace(/<hr\b[^>]*>/gi, '<p>***</p>'));
}

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
  /** Author-set values by scene id, or null when the entire curve uses measured pace. */
  tension: Record<string, number> | null;
}

export async function buildPacingReport(projectId: string, outlineId?: string, eraId?: string): Promise<ProjectPacing> {
  const [writings, outlines, beats] = await Promise.all([
    eraId ? listEraRows<Writing>({ projectId, eraId }, 'writings') : db.writings.where('projectId').equals(projectId).toArray(),
    db.outlines.where('projectId').equals(projectId).toArray(),
    db.outlineBeats.where('projectId').equals(projectId).toArray(),
  ]);
  const ordered = [...writings].sort((a, b) => (a.chapter ?? 1e9) - (b.chapter ?? 1e9) || a.title.localeCompare(b.title));
  const report = buildPacing(ordered.map((w) => ({
    writingId: w.id, chapter: typeof w.chapter === 'number' ? w.chapter : null, title: w.title,
    text: pacingText(w.content), sceneTension: w.sceneTension,
  })));
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
  const tension = report.scenes.flatMap((scene) => scene.tension === undefined ? [] : [[scene.id, scene.tension] as const]);
  return {
    ...report, projectId,
    titles: Object.fromEntries(ordered.map((w) => [w.id, typeof w.chapter === 'number' ? `${w.chapter}. ${w.title}` : w.title])),
    beats: placed, tension: tension.length ? Object.fromEntries(tension) : null,
  };
}
