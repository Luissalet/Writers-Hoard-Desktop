// Pacing x-ray: dialogue, narration and description, length and action density
// per scene and chapter, a pace curve over the manuscript and the stretches that
// stay flat or lean too far one way. Pure and deterministic: plain text in.
import { splitParagraph } from '../voice/dialogue';

export interface PacingSource {
  writingId: string;
  chapter: number | null;
  title: string;
  text: string;
  sceneTension?: readonly SceneTension[];
}

export interface SceneAnchor { index: number; opening: string; closing: string }
export interface SceneTension extends SceneAnchor { value: number }

export interface PacingScene {
  /** `<writingId>#<index>`. */
  id: string;
  writingId: string;
  chapter: number | null;
  index: number;
  anchor: SceneAnchor;
  /** First words of the scene, to find it in the chapter. */
  quote: string;
  words: number;
  /** Shares of the scene's words; they add up to 1. */
  dialogue: number;
  narration: number;
  description: number;
  /** Action verbs per 100 words of prose (not dialogue). */
  action: number;
  /** Words per sentence. */
  sentence: number;
  /** 0 slow … 1 fast: dialogue, action and short sentences push it up. */
  pace: number;
  /** Optional author-set value on the curve, from 0 to 1. */
  tension?: number;
  /** Position of the scene's middle in the manuscript, 0…1 by words. */
  at: number;
}

export interface PacingChapter { writingId: string; chapter: number | null; title: string; words: number; dialogue: number; narration: number; description: number; action: number; pace: number; scenes: number }

export type PacingFlagKind = 'flat' | 'description-heavy' | 'dialogue-only' | 'no-dialogue' | 'overlong';
export interface PacingFlag { kind: PacingFlagKind; sceneIds: string[]; detail: string }

export interface PacingReport { scenes: PacingScene[]; chapters: PacingChapter[]; flags: PacingFlag[]; words: number }

/** A line that is only a scene break: ***, * * *, #, ~, ⁂, — o —. */
const SCENE_BREAK = /^\s*(?:\*\s*){3,}\s*$|^\s*[#~⁂]+\s*$|^\s*[-—–]\s*o\s*[-—–]\s*$/;
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu;
const count = (text: string) => (text.match(WORD) ?? []).length;
const tokens = (text: string) => (text.toLowerCase().match(WORD) ?? []);

/** Plain action verbs, Spanish and English; Spanish preterites ending in -ó count too. */
const ACTION_WORDS = new Set([
  'corrió', 'saltó', 'golpeó', 'empujó', 'disparó', 'huyó', 'cayó', 'agarró', 'lanzó', 'tiró', 'gritó', 'abrió', 'cerró', 'giró', 'sacó', 'atacó', 'esquivó', 'rompió', 'arrancó', 'subió', 'bajó', 'cruzó', 'entró', 'salió', 'volvió', 'llegó', 'mató', 'hirió', 'atrapó', 'escapó', 'soltó', 'clavó', 'corrieron', 'huyeron', 'cayeron', 'atacaron',
  'ran', 'jumped', 'hit', 'pushed', 'shot', 'fled', 'fell', 'grabbed', 'threw', 'shouted', 'opened', 'slammed', 'turned', 'pulled', 'attacked', 'dodged', 'broke', 'climbed', 'crossed', 'struck', 'stabbed', 'escaped', 'rushed', 'kicked', 'punched', 'dashed', 'leapt', 'leaped',
]);
/** Imperfect and stative forms that describe rather than move. */
const DESCRIPTIVE = new Set(['era', 'eran', 'estaba', 'estaban', 'había', 'habían', 'parecía', 'parecían', 'tenía', 'tenían', 'olía', 'sonaba', 'brillaba', 'was', 'were', 'seemed', 'looked', 'smelled', 'stood', 'lay']);

const isAction = (w: string) => ACTION_WORDS.has(w) || (w.length >= 4 && /[^aeiou]ó$/.test(w));
const isStill = (w: string) => DESCRIPTIVE.has(w) || (w.length >= 5 && /(?:aba|aban|ía|ían)$/.test(w));

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

/** Scenes of a chapter: its text split at scene-break lines. */
export function splitScenes(text: string): string[][] {
  const scenes: string[][] = [[]];
  for (const paragraph of text.split(/\n+/)) {
    if (!paragraph.trim()) continue;
    if (SCENE_BREAK.test(paragraph)) { if (scenes[scenes.length - 1].length) scenes.push([]); continue; }
    scenes[scenes.length - 1].push(paragraph);
  }
  return scenes.filter((s) => s.length);
}

const compact = (text: string) => text.trim().replace(/\s+/g, ' ');

export function sceneAnchor(paragraphs: string[], index: number): SceneAnchor {
  return { index, opening: compact(paragraphs[0]).slice(0, 96), closing: compact(paragraphs.at(-1)!).slice(-96) };
}

function anchorScore(candidate: SceneAnchor, stored: SceneAnchor): number {
  // After splitting a scene, its tension follows the opening fragment.
  return (candidate.opening === stored.opening ? 2 : 0) + (candidate.closing === stored.closing ? 1 : 0);
}

export function findSceneAnchor(anchors: readonly SceneAnchor[], stored: SceneAnchor): SceneAnchor | undefined {
  let best = 0;
  let candidates: SceneAnchor[] = [];
  for (const anchor of anchors) {
    const score = anchorScore(anchor, stored);
    if (!score || score < best) continue;
    if (score > best) candidates = [];
    best = score;
    candidates.push(anchor);
  }
  return candidates.length === 1 ? candidates[0] : candidates.find((anchor) => anchor.index === stored.index);
}

export function resolveTensions(anchors: readonly SceneAnchor[], stored: readonly SceneTension[]): Map<number, SceneTension> {
  const resolved = new Map<number, SceneTension>();
  for (const mark of stored) {
    if (!(typeof mark.value === 'number' && mark.value >= 0 && mark.value <= 1)) continue;
    const anchor = findSceneAnchor(anchors, mark);
    if (!anchor) continue;
    const prior = resolved.get(anchor.index);
    if (!prior || anchorScore(anchor, mark) >= anchorScore(anchor, prior)) resolved.set(anchor.index, mark);
  }
  return resolved;
}

/** Word shares, action density and sentence length of a run of paragraphs. */
export function measure(paragraphs: readonly string[]) {
  let dialogue = 0, description = 0, narration = 0, actionVerbs = 0, sentences = 0, words = 0;
  for (const paragraph of paragraphs) {
    const split = splitParagraph(paragraph);
    const speech = split ? split.speech.join(' ') : '';
    const prose = split ? split.narration : paragraph;
    dialogue += count(speech);
    for (const sentence of `${speech} ${prose}`.split(/[.!?…]+/)) if (count(sentence) > 0) sentences++;
    for (const sentence of prose.split(/[.!?…;]+/)) {
      const list = tokens(sentence);
      if (!list.length) continue;
      const action = list.filter(isAction).length, still = list.filter(isStill).length;
      if (still > action) description += list.length;
      else narration += list.length;
      actionVerbs += action;
    }
    words += count(paragraph);
  }
  const total = Math.max(1, dialogue + description + narration);
  const prose = description + narration;
  return { words, dialogue: dialogue / total, description: description / total, narration: narration / total, action: prose ? (actionVerbs / prose) * 100 : 0, sentence: words / Math.max(1, sentences) };
}

/** Pace from 0 to 1: dialogue share, action density (8 per 100 words is fast) and short sentences. */
export function paceOf(m: { dialogue: number; action: number; sentence: number }): number {
  return round(0.4 * m.dialogue + 0.4 * Math.min(1, m.action / 8) + 0.2 * (1 - Math.min(1, m.sentence / 30)));
}

/** A run of this many scenes whose curve values stay within FLAT_SPREAD reads as flat. */
export const FLAT_RUN = 4;
export const FLAT_SPREAD = 0.04;

export const curveValue = (scene: PacingScene): number => scene.tension ?? scene.pace;

function flatFlags(scenes: readonly PacingScene[]): PacingFlag[] {
  const flags: PacingFlag[] = [];
  const values = scenes.map(curveValue);
  // Keep the window's extrema in monotonic queues, so moving its start
  // past a short false start never discards a later, overlapping flat stretch.
  const minima: number[] = [], maxima: number[] = [];
  let minHead = 0, maxHead = 0, start = 0;
  const emit = (end: number, low: number, high: number) => {
    if (end - start >= FLAT_RUN) {
      flags.push({ kind: 'flat', sceneIds: scenes.slice(start, end).map((s) => s.id), detail: String(round((low + high) / 2)) });
    }
  };
  const tooWide = (low: number, high: number) => high - low > FLAT_SPREAD + Number.EPSILON;
  for (let end = 0; end < scenes.length; end++) {
    const next = values[end];
    if (end > start) {
      const low = values[minima[minHead]], high = values[maxima[maxHead]];
      if (tooWide(Math.min(low, next), Math.max(high, next))) emit(end, low, high);
    }
    while (minima.length > minHead && values[minima.at(-1)!] >= next) minima.pop();
    while (maxima.length > maxHead && values[maxima.at(-1)!] <= next) maxima.pop();
    minima.push(end);
    maxima.push(end);
    while (tooWide(values[minima[minHead]], values[maxima[maxHead]])) {
      if (minima[minHead] === start) minHead++;
      if (maxima[maxHead] === start) maxHead++;
      start++;
    }
  }
  emit(scenes.length, values[minima[minHead]], values[maxima[maxHead]]);
  return flags;
}

export function buildPacing(sources: readonly PacingSource[]): PacingReport {
  const scenes: PacingScene[] = [];
  for (const source of sources) {
    const parts = splitScenes(source.text).map((paragraphs, index) => ({
      first: paragraphs[0].trim(), anchor: sceneAnchor(paragraphs, index), measures: measure(paragraphs),
    })).filter((part) => part.measures.words);
    const tensionByIndex = resolveTensions(parts.map((part) => part.anchor), source.sceneTension ?? []);
    for (const { first, anchor, measures: m } of parts) {
      const { index } = anchor;
      const tension = tensionByIndex.get(index)?.value;
      scenes.push({
        id: `${source.writingId}#${index}`, writingId: source.writingId, chapter: source.chapter, index, anchor,
        quote: first.slice(0, Math.max(20, first.search(/[.!?…]/) + 1 || 80)).slice(0, 80).trim(),
        words: m.words, dialogue: round(m.dialogue), narration: round(m.narration), description: round(m.description),
        action: round(m.action, 1), sentence: round(m.sentence, 1), pace: paceOf(m), at: 0,
        ...(tension === undefined ? {} : { tension }),
      });
    }
  }
  const total = scenes.reduce((s, x) => s + x.words, 0);
  let done = 0;
  for (const scene of scenes) { scene.at = round(total ? (done + scene.words / 2) / total : 0, 4); done += scene.words; }

  const chapters: PacingChapter[] = sources.map((source) => {
    const own = scenes.filter((s) => s.writingId === source.writingId);
    const words = own.reduce((s, x) => s + x.words, 0);
    const avg = (key: 'dialogue' | 'narration' | 'description' | 'action' | 'pace') => round(words ? own.reduce((s, x) => s + x[key] * x.words, 0) / words : 0);
    return { writingId: source.writingId, chapter: source.chapter, title: source.title, words, dialogue: avg('dialogue'), narration: avg('narration'), description: avg('description'), action: avg('action'), pace: avg('pace'), scenes: own.length };
  }).filter((c) => c.words > 0);

  const flags = flatFlags(scenes);
  const lengths = scenes.map((s) => s.words).sort((a, b) => a - b);
  const median = lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0;
  for (const s of scenes) {
    if (s.words < 150) continue;
    if (s.description > 0.6) flags.push({ kind: 'description-heavy', sceneIds: [s.id], detail: String(s.description) });
    else if (s.dialogue > 0.85) flags.push({ kind: 'dialogue-only', sceneIds: [s.id], detail: String(s.dialogue) });
    else if (s.dialogue === 0 && s.words > 1500) flags.push({ kind: 'no-dialogue', sceneIds: [s.id], detail: String(s.words) });
    if (median && scenes.length >= 4 && s.words > median * 3) flags.push({ kind: 'overlong', sceneIds: [s.id], detail: String(round(s.words / median, 1)) });
  }
  return { scenes, chapters, flags, words: total };
}
