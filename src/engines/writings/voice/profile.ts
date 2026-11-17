// Voice profile of each character from their dialogue lines, the lines that
// leave it, and the blind test. Pure and deterministic: the same lines give the
// same profiles, outliers and sample.
import type { DialogueLine } from './dialogue';

export interface AddressCounts { tu: number; usted: number; vos: number }
export type Register = 'formal' | 'informal' | 'neutral';

export interface VoiceProfile {
  characterId: string;
  lines: number;
  words: number;
  /** Words per sentence. */
  sentenceMean: number;
  sentenceSd: number;
  /** Share of lines with an exclamation, a question, an ellipsis. */
  exclamations: number;
  questions: number;
  ellipses: number;
  /** Forms of address the character uses. */
  address: AddressCounts;
  /** Dominant form when one stands out (≥ 75 % of at least 3 uses). */
  addressForm: keyof AddressCounts | null;
  longWords: number;
  register: Register;
  /** Words the character uses far more than the rest of the cast. */
  distinctive: Array<{ word: string; count: number; score: number }>;
  /** Openings, endings and phrases they repeat. */
  catchphrases: Array<{ phrase: string; count: number }>;
}

export type OutlierReason = 'closer-to' | 'length' | 'address';
export interface VoiceOutlier {
  lineId: string;
  speakerId: string;
  reason: OutlierReason;
  /** closer-to: the character whose profile fits the line better. */
  otherId?: string;
  /** How far out it is: score margin per word, z of the length, or the form used. */
  detail: string;
}

/** Fewer lines than this give no profile worth comparing against. */
export const MIN_PROFILE_LINES = 5;
/** Shorter lines say too little to judge. */
export const MIN_JUDGED_WORDS = 4;

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu;
export function words(text: string): string[] {
  return (text.toLowerCase().match(WORD) ?? []);
}

function sentences(text: string): number[] {
  return text.split(/[.!?¡¿…]+/).map((s) => words(s).length).filter((n) => n > 0);
}

const TU = new Set(['tú', 'ti', 'contigo', 'tienes', 'eres', 'estás', 'puedes', 'quieres', 'sabes', 'vienes', 'dime', 'mira', 'oye']);
const USTED = new Set(['usted', 'ustedes', 'vuestra', 'vuesa', 'merced']);
const VOS = new Set(['vos', 'sos', 'tenés', 'querés', 'podés', 'sabés', 'venís', 'mirá', 'decime']);

export function addressOf(text: string): AddressCounts {
  const counts: AddressCounts = { tu: 0, usted: 0, vos: 0 };
  for (const w of words(text)) {
    if (TU.has(w)) counts.tu++;
    else if (USTED.has(w)) counts.usted++;
    else if (VOS.has(w)) counts.vos++;
  }
  return counts;
}

function dominant(a: AddressCounts): keyof AddressCounts | null {
  const total = a.tu + a.usted + a.vos;
  if (total < 3) return null;
  const best = (Object.keys(a) as Array<keyof AddressCounts>).sort((x, y) => a[y] - a[x])[0];
  return a[best] / total >= 0.75 ? best : null;
}

/** Articles, prepositions and conjunctions say little about a voice on their own; forms of address are kept. */
const FUNCTION_WORDS = new Set([
  'a', 'al', 'de', 'del', 'el', 'la', 'las', 'lo', 'los', 'un', 'una', 'unos', 'unas', 'y', 'e', 'o', 'u', 'en', 'con', 'por', 'para', 'que', 'se', 'su', 'sus', 'es',
  'the', 'an', 'of', 'to', 'in', 'and', 'or', 'on', 'at', 'for', 'is', 'it', 'that', 'with',
]);

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const sd = (xs: number[], m: number) => (xs.length > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)) : 0);
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

function counts(lines: readonly DialogueLine[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of lines) for (const w of words(line.text)) out.set(w, (out.get(w) ?? 0) + 1);
  return out;
}

const total = (m: Map<string, number>) => [...m.values()].reduce((s, x) => s + x, 0);

/** Phrases of 1–3 words that open or close at least three of the character's lines and few of the others'. */
function catchphrasesOf(own: readonly DialogueLine[], others: readonly DialogueLine[]): Array<{ phrase: string; count: number }> {
  const edges = (line: DialogueLine) => {
    const w = words(line.text);
    const out = new Set<string>();
    for (let n = 1; n <= 3 && n <= w.length; n++) { out.add(w.slice(0, n).join(' ')); out.add(w.slice(-n).join(' ')); }
    return out;
  };
  const tally = (lines: readonly DialogueLine[]) => {
    const m = new Map<string, number>();
    for (const line of lines) for (const p of edges(line)) m.set(p, (m.get(p) ?? 0) + 1);
    return m;
  };
  const mine = tally(own), theirs = tally(others);
  const found = [...mine.entries()]
    .filter(([phrase, count]) => count >= 3 && count / own.length >= 0.15 && (theirs.get(phrase) ?? 0) / Math.max(1, others.length) < (count / own.length) / 3 && (phrase.includes(' ') || phrase.length >= 4))
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]));
  // A longer phrase hides the shorter ones it contains with the same count.
  const kept: Array<{ phrase: string; count: number }> = [];
  for (const [phrase, count] of found) if (!kept.some((k) => k.count === count && k.phrase.includes(phrase))) kept.push({ phrase, count });
  return kept.slice(0, 6);
}

/** Profiles of every character with at least one attributed line. */
export function buildProfiles(lines: readonly DialogueLine[]): VoiceProfile[] {
  const bySpeaker = new Map<string, DialogueLine[]>();
  for (const line of lines) if (line.speakerId) bySpeaker.set(line.speakerId, [...(bySpeaker.get(line.speakerId) ?? []), line]);
  const all = counts(lines.filter((l) => l.speakerId));
  const allTotal = total(all);
  const profiles: VoiceProfile[] = [];
  for (const [characterId, own] of [...bySpeaker.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const mine = counts(own), mineTotal = total(mine);
    const restTotal = allTotal - mineTotal;
    const lengths = own.flatMap((l) => sentences(l.text));
    const m = mean(lengths);
    const address = own.reduce((acc, l) => { const a = addressOf(l.text); return { tu: acc.tu + a.tu, usted: acc.usted + a.usted, vos: acc.vos + a.vos }; }, { tu: 0, usted: 0, vos: 0 });
    const allWords = own.flatMap((l) => words(l.text));
    const longWords = allWords.length ? allWords.filter((w) => w.length >= 8).length / allWords.length : 0;
    const form = dominant(address);
    // Log-odds with a shared prior: a word the rest of the cast never says still needs repeats to count.
    const distinctive = [...mine.entries()].filter(([word, c]) => c >= 2 && !FUNCTION_WORDS.has(word)).map(([word, c]) => {
      const rest = (all.get(word) ?? 0) - c;
      const prior = (all.get(word) ?? 0) / Math.max(1, allTotal) * 10;
      const score = Math.log((c + prior) / (mineTotal + 10 - c - prior)) - Math.log((rest + prior) / (Math.max(1, restTotal) + 10 - rest - prior));
      return { word, count: c, score: round(score) };
    }).filter((d) => d.score > 0.5).sort((a, b) => b.score - a.score || b.count - a.count || a.word.localeCompare(b.word)).slice(0, 12);
    profiles.push({
      characterId, lines: own.length, words: allWords.length,
      sentenceMean: round(m, 1), sentenceSd: round(sd(lengths, m), 1),
      exclamations: round(own.filter((l) => /[!¡]/.test(l.text)).length / own.length),
      questions: round(own.filter((l) => /[?¿]/.test(l.text)).length / own.length),
      ellipses: round(own.filter((l) => /…|\.\.\./.test(l.text)).length / own.length),
      address, addressForm: form, longWords: round(longWords),
      register: form === 'usted' || longWords > 0.22 ? 'formal' : form === 'tu' || form === 'vos' || (own.filter((l) => /[!¡]/.test(l.text)).length / own.length > 0.35) ? 'informal' : 'neutral',
      distinctive, catchphrases: catchphrasesOf(own, lines.filter((l) => l.speakerId && l.speakerId !== characterId)),
    });
  }
  return profiles;
}

/** Per-word log-likelihood of a line under a speaker's word counts (add-one smoothing over the cast vocabulary). */
function lineScore(lineWords: readonly string[], speaker: Map<string, number>, speakerTotal: number, vocabulary: number): number {
  let s = 0;
  for (const w of lineWords) s += Math.log(((speaker.get(w) ?? 0) + 1) / (speakerTotal + vocabulary));
  return s / Math.max(1, lineWords.length);
}

/** Margin, per word, by which another profile must fit a line better before it is flagged. */
export const CLOSER_MARGIN = 0.25;

/** Lines that leave their speaker's profile: closer to another voice, far from their usual length, or the other form of address. */
export function findOutliers(lines: readonly DialogueLine[], profiles: readonly VoiceProfile[]): VoiceOutlier[] {
  const candidates = profiles.filter((p) => p.lines >= MIN_PROFILE_LINES);
  if (!candidates.length) return [];
  const bySpeaker = new Map<string, Map<string, number>>();
  for (const p of candidates) bySpeaker.set(p.characterId, counts(lines.filter((l) => l.speakerId === p.characterId)));
  const vocabulary = new Set(lines.filter((l) => l.speakerId).flatMap((l) => words(l.text))).size;
  const out: VoiceOutlier[] = [];
  for (const line of lines) {
    const own = candidates.find((p) => p.characterId === line.speakerId);
    if (!own) continue;
    const lineWords = words(line.text);
    if (lineWords.length < MIN_JUDGED_WORDS) continue;
    // Leave the line out of its own speaker's counts, or every line fits its speaker by construction.
    const ownCounts = new Map(bySpeaker.get(own.characterId)!);
    for (const w of lineWords) ownCounts.set(w, (ownCounts.get(w) ?? 1) - 1);
    const scores = candidates.map((p) => {
      const m = p.characterId === own.characterId ? ownCounts : bySpeaker.get(p.characterId)!;
      return { id: p.characterId, score: lineScore(lineWords, m, total(m), vocabulary) };
    }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const ownScore = scores.find((s) => s.id === own.characterId)!.score;
    if (scores[0].id !== own.characterId && scores[0].score - ownScore > CLOSER_MARGIN) {
      out.push({ lineId: line.id, speakerId: own.characterId, reason: 'closer-to', otherId: scores[0].id, detail: String(round(scores[0].score - ownScore)) });
      continue;
    }
    const length = mean(sentences(line.text));
    const z = own.sentenceSd > 0 ? (length - own.sentenceMean) / Math.max(2, own.sentenceSd) : 0;
    if (Math.abs(z) >= 2.5) { out.push({ lineId: line.id, speakerId: own.characterId, reason: 'length', detail: String(round(z, 1)) }); continue; }
    if (own.addressForm) {
      const a = addressOf(line.text);
      const used = (Object.keys(a) as Array<keyof AddressCounts>).find((k) => a[k] > 0 && k !== own.addressForm);
      if (used && a[own.addressForm] === 0) out.push({ lineId: line.id, speakerId: own.characterId, reason: 'address', detail: used });
    }
  }
  return out;
}

/** A small deterministic generator, so a test can be replayed from its seed. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export interface BlindItem { lineId: string; text: string; answerId: string }

/** Lines with enough words from characters with a profile, mixed by the seed; at most `count`, spread across speakers. */
export function blindSample(lines: readonly DialogueLine[], profiles: readonly VoiceProfile[], count: number, seed: number): BlindItem[] {
  const voices = new Set(profiles.filter((p) => p.lines >= MIN_PROFILE_LINES).map((p) => p.characterId));
  if (voices.size < 2) return [];
  const rand = random(seed);
  const pool = lines.filter((l) => l.speakerId && voices.has(l.speakerId) && words(l.text).length >= MIN_JUDGED_WORDS)
    .map((l) => ({ l, k: rand() })).sort((a, b) => a.k - b.k).map(({ l }) => l);
  // Round-robin over speakers so one talkative character does not fill the test.
  const queues = new Map<string, DialogueLine[]>();
  for (const l of pool) queues.set(l.speakerId!, [...(queues.get(l.speakerId!) ?? []), l]);
  const picked: DialogueLine[] = [];
  const order = [...queues.keys()].sort();
  while (picked.length < count && [...queues.values()].some((q) => q.length)) {
    for (const id of order) { const next = queues.get(id)!.shift(); if (next && picked.length < count) picked.push(next); }
  }
  return picked.map((l) => ({ lineId: l.id, text: l.text, answerId: l.speakerId! })).map((item) => ({ item, k: rand() })).sort((a, b) => a.k - b.k).map(({ item }) => item);
}

export interface BlindResult {
  correct: number;
  total: number;
  /** Pairs the author mixed up: the real speaker and who they guessed, most frequent first. */
  confusions: Array<{ actualId: string; guessedId: string; count: number }>;
}

export function scoreBlind(items: readonly BlindItem[], guesses: Readonly<Record<string, string>>): BlindResult {
  let correct = 0, answered = 0;
  const pairs = new Map<string, number>();
  for (const item of items) {
    const guess = guesses[item.lineId];
    if (!guess) continue;
    answered++;
    if (guess === item.answerId) correct++;
    else pairs.set(`${item.answerId}\u0000${guess}`, (pairs.get(`${item.answerId}\u0000${guess}`) ?? 0) + 1);
  }
  const confusions = [...pairs.entries()].map(([key, n]) => { const [actualId, guessedId] = key.split('\u0000'); return { actualId, guessedId, count: n }; })
    .sort((a, b) => b.count - a.count || a.actualId.localeCompare(b.actualId));
  return { correct, total: answered, confusions };
}
