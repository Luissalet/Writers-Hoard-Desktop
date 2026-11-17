// Plan drift: what each written chapter does against the outline beat it was
// meant to fulfil — the way back from `outline/beatToChapter.ts`. Pure and
// deterministic: names from the Codex, links from the outline and the seeds.
import { foldText, nameIndex, namedIn } from '../voice/dialogue';

export interface DriftEntity { id: string; name: string; aliases: readonly string[]; type: string }
export interface DriftBeat { id: string; outlineId: string; title: string; description: string; level: string; order: number; linkedWritingId?: string }
export interface DriftChapter { writingId: string; chapter: number | null; title: string; synopsis: string; text: string }
/** A seed (promise) or its payoff linked to a beat; found in a chapter by its link or its title in the text. */
export interface DriftPromise { id: string; kind: 'seed' | 'payoff'; title: string; linkedBeatId?: string; linkedWritingId?: string }
/** A map story event told in a chapter, with who is there. */
export interface DriftEvent { writingId: string; who: readonly string[] }

export type DriftStatus = 'kept' | 'drifted' | 'unwritten';

export interface EntitySet { characters: string[]; places: string[]; others: string[] }
export interface BeatDrift {
  beatId: string;
  outlineId: string;
  writingId: string | null;
  status: DriftStatus;
  /** Share of what the beat names that the chapter has (1 when the beat names nothing). */
  score: number;
  expected: EntitySet & { promises: string[] };
  missing: EntitySet & { promises: string[] };
  /** Named in the chapter, not in the beat. */
  extra: EntitySet;
  /** What the beat would say if it followed the chapter; absent when it already does. */
  proposal?: { title: string; description: string };
}

export interface DriftReport {
  beats: BeatDrift[];
  /** Chapters with text that no beat points at. */
  unplanned: string[];
}

/** Below this share of what it names, a written beat counts as drifted. */
export const DRIFT_THRESHOLD = 0.5;

const PLACE_TYPES = new Set(['location', 'place', 'region', 'city']);
function split(ids: readonly string[], types: ReadonlyMap<string, string>): EntitySet {
  const out: EntitySet = { characters: [], places: [], others: [] };
  for (const id of ids) {
    const type = types.get(id) ?? '';
    (type === 'character' ? out.characters : PLACE_TYPES.has(type) ? out.places : out.others).push(id);
  }
  return out;
}
const minus = (a: readonly string[], b: readonly string[]) => a.filter((x) => !b.includes(x));

/** The chapter's opening, at most two sentences and 300 characters, as a plan line. */
export function openingOf(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const sentences = flat.match(/[^.!?…]+[.!?…]+/g) ?? [flat];
  return sentences.slice(0, 2).map((s) => s.trim()).join(' ').slice(0, 300);
}

export function checkDrift(
  beats: readonly DriftBeat[],
  chapters: readonly DriftChapter[],
  entities: readonly DriftEntity[],
  promises: readonly DriftPromise[] = [],
  events: readonly DriftEvent[] = [],
  labels: { characters: string; places: string } = { characters: 'Characters', places: 'Place' },
): DriftReport {
  const names = nameIndex(entities.map((e) => ({ id: e.id, name: e.name, aliases: e.aliases })));
  const types = new Map(entities.map((e) => [e.id, e.type]));
  const titleOf = new Map(entities.map((e) => [e.id, e.name]));
  const byId = new Map(chapters.map((c) => [c.writingId, c]));
  const out: BeatDrift[] = [];
  for (const beat of [...beats].sort((a, b) => a.outlineId.localeCompare(b.outlineId) || a.order - b.order)) {
    const expectedIds = namedIn(`${beat.title}\n${beat.description}`, names);
    const expected = split(expectedIds, types);
    const expectedPromises = promises.filter((p) => p.linkedBeatId === beat.id);
    const chapter = beat.linkedWritingId ? byId.get(beat.linkedWritingId) : undefined;
    const base = { beatId: beat.id, outlineId: beat.outlineId, expected: { ...expected, promises: expectedPromises.map((p) => p.id) } };
    if (!chapter || !chapter.text.trim()) {
      out.push({ ...base, writingId: chapter?.writingId ?? null, status: 'unwritten', score: 0, missing: { ...expected, promises: expectedPromises.map((p) => p.id) }, extra: { characters: [], places: [], others: [] } });
      continue;
    }
    const foundIds = [...new Set([...namedIn(chapter.text, names), ...events.filter((e) => e.writingId === chapter.writingId).flatMap((e) => e.who)])];
    const folded = foldText(chapter.text);
    const kept = (p: DriftPromise) => p.linkedWritingId === chapter.writingId || (p.title.trim().length >= 3 && folded.includes(foldText(p.title.trim())));
    const missingIds = minus(expectedIds, foundIds);
    const missingPromises = expectedPromises.filter((p) => !kept(p)).map((p) => p.id);
    const total = expectedIds.length + expectedPromises.length;
    const score = total ? Math.round(((total - missingIds.length - missingPromises.length) / total) * 100) / 100 : 1;
    const extra = split(minus(foundIds, expectedIds).filter((id) => types.get(id) === 'character' || PLACE_TYPES.has(types.get(id) ?? '')), types);
    const status: DriftStatus = total && score < DRIFT_THRESHOLD ? 'drifted' : 'kept';
    const drift: BeatDrift = { ...base, writingId: chapter.writingId, status, score, missing: { ...split(missingIds, types), promises: missingPromises }, extra };
    if (status === 'drifted' || extra.characters.length || extra.places.length) {
      const present = split(foundIds, types);
      const who = present.characters.map((id) => titleOf.get(id)!).join(', ');
      const where = present.places.map((id) => titleOf.get(id)!).join(', ');
      const summary = chapter.synopsis.trim() || openingOf(chapter.text);
      drift.proposal = {
        // A drifted beat takes the chapter's title, since its own still names what the chapter no longer does.
        title: status === 'drifted' ? chapter.title.trim() || beat.title : beat.title.trim() || chapter.title,
        description: [summary, who && `${labels.characters}: ${who}.`, where && `${labels.places}: ${where}.`].filter(Boolean).join('\n'),
      };
    }
    out.push(drift);
  }
  const linked = new Set(beats.map((b) => b.linkedWritingId).filter(Boolean));
  return { beats: out, unplanned: chapters.filter((c) => c.text.trim() && !linked.has(c.writingId)).map((c) => c.writingId) };
}
