// ============================================
// Lector de pruebas — the proofreader
// ============================================
//
// The cockpit already DERIVES continuity signals; it only ever showed them as
// counts. This module turns the same local data into a list the writer can
// actually clear: every finding names a real entity, says in one line why it
// matters, points at the engine that owns it, and — where the action is
// unambiguous and reversible — carries a fix that can be applied in place.
//
// Three rules shape the implementation:
//
//  1. EVERY TABLE IS READ ONCE. `collectProofreaderInput` is the only function
//     here that touches Dexie during analysis; the eight checks below are pure
//     functions over what it returns, so each one is testable on its own and
//     none of them can smuggle in a second query.
//
//  2. NO BASE64 EVER LANDS IN A LIST. `codexEntries` carries `avatar` and
//     `avatarOriginal`; `writings` carries a whole manuscript per row. Neither
//     is read with `toArray()` — both are streamed with a Dexie cursor and
//     projected down to the handful of fields the checks need, so peak memory
//     is one row rather than the whole table.
//
//  3. THE MANUSCRIPT IS READ IN ONE PASS. The character-appearance check
//     builds one lowercase token haystack per writing and probes the candidate
//     title set against it — never a regex per (writing × codex entry). On the
//     reference project (400 writings × 4 000 words, 800 codex entries) that is
//     400 strip+tokenise passes instead of 320 000 regex executions.
//
// Reading every chapter is still real work, so `runProofreader` is NOT wired
// to a liveQuery: the panel calls it from an explicit "analyse" action.

import { db } from '@/db';
import { getSetting, PROJECT_SETTING_PREFIXES, updateSetting } from '@/db/operations';
import { PROJECT_MODES } from '@/engines/_registry';
import {
  findNameAppearances,
  indexNameCandidates,
  tokenizeNameText,
  type NameCandidate,
} from '@/engines/_shared/nameAppearances';
import { castKeyOf } from '@/engines/dialog-scene/importPersist';
import { computeSeedStatus, type Payoff, type Seed } from '@/engines/seeds/types';
import { shiftLocalDateKey, toLocalDateKey } from '@/engines/writing-stats/date';
import { compareManuscriptOrder as compareChapters } from '@/engines/writings/chapterOrder';
import { t } from '@/i18n/useTranslation';
import { generateId } from '@/utils/idGenerator';
import { stripHtml } from '@/utils/text';
import { getTemplateFields, type CodexEntry, type CodexEntryType, type ProjectMode, type WritingStatus } from '@/types';
import type { OutlineBeat } from '@/engines/outline/types';
import type { Relationship } from '@/engines/relationships/types';
import type { DialogBlockType, Scene } from '@/engines/dialog-scene/types';

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export type ProofreaderSeverity = 'info' | 'warning';

export const PROOFREADER_CHECK_IDS = [
  'seed-without-payoff',
  'beat-without-scene',
  'writing-outside-outline',
  'character-disappears',
  'scene-without-pov',
  'speaker-not-in-codex',
  'relationship-broken-endpoint',
  'stale-draft',
] as const;

export type ProofreaderCheckId = (typeof PROOFREADER_CHECK_IDS)[number];

/**
 * A fix is a named, replayable action — never a free-form callback — so the
 * panel can render it, confirm it, and this module can execute it without the
 * two agreeing on anything but data.
 */
export type ProofreaderFixAction =
  | {
      kind: 'clear-dead-beat-link';
      beatId: string;
      clearWriting: boolean;
      clearScene: boolean;
    }
  | {
      kind: 'map-speaker-to-codex';
      projectId: string;
      /** Lower-cased `castKeyOf` cue, the same identity pov-audit groups by. */
      castKey: string;
      /** The cue exactly as the script writes it, used as the entry title. */
      displayName: string;
      /** Present when a Codex character with this name already exists. */
      entryId?: string;
    };

export interface ProofreaderFix {
  /** Button label, already translated. */
  label: string;
  /** Confirmation dialog title, already translated. */
  confirmTitle: string;
  /** Confirmation dialog body — says exactly what will change. */
  confirmMessage: string;
  action: ProofreaderFixAction;
}

export interface ProofreaderFinding {
  /** Stable across runs — dismissals are keyed by it. */
  id: string;
  checkId: ProofreaderCheckId;
  severity: ProofreaderSeverity;
  title: string;
  detail: string;
  /** Engine that owns the thing to fix, for `navigateToEntity`. */
  engineId: string;
  entityId: string;
  /**
   * In-app route to open instead of the engine, for the rare finding whose
   * repair lives in a cockpit view rather than on an entity — the narrative
   * spine, which is the only screen where a beat is linked to a chapter.
   */
  route?: string;
  fix?: ProofreaderFix;
}

export interface ProofreaderCheckGroup {
  id: ProofreaderCheckId;
  title: string;
  description: string;
  /**
   * False when the project cannot be judged by this check at all (POV on a
   * project whose mode never audits it). The panel says so instead of
   * pretending the check passed.
   */
  applicable: boolean;
  /** Why the check was skipped, when `applicable` is false. */
  notApplicableReason?: string;
  findings: ProofreaderFinding[];
}

export interface ProofreaderReport {
  generatedAt: number;
  /** Every finding, in check order. Dismissals are applied by the caller. */
  findings: ProofreaderFinding[];
  groups: ProofreaderCheckGroup[];
  scanned: {
    writings: number;
    codexEntries: number;
    scenes: number;
  };
}

// ---------------------------------------------------------------------------
// Thresholds — named so the reasoning is visible instead of buried in a `<`
// ---------------------------------------------------------------------------

/** A seed planted in the first two thirds of the story is overdue, not pending. */
const SEED_OVERDUE_POSITION = 66;
/** Fallback for seeds with no story position: wall-clock age, in local days. */
const SEED_OVERDUE_DAYS = 30;
/** A draft untouched for this long is stale enough to name. */
const STALE_DRAFT_DAYS = 30;
/** …and this long is stale enough to raise the severity. */
const STALE_DRAFT_WARNING_DAYS = 90;
/** Below this many chapters "first third" and "last third" mean nothing. */
const MIN_WRITINGS_FOR_THIRDS = 3;
/** Titles shorter than this match too much prose to be evidence of anything. */
const MIN_APPEARANCE_TITLE_LENGTH = 4;
/** A vanished walk-on is a note; a vanished regular is a warning. */
const RECURRING_CHARACTER_APPEARANCES = 3;

/**
 * Below this many identical findings, naming each row is still the clearest
 * report. At or above it — and only when NOTHING in the project uses the link
 * at all — the check is describing a habit rather than a list of omissions,
 * and says so once. See `findWritingsOutsideOutline`.
 */
const UNUSED_LINK_MIN = 3;

/**
 * Words that would match half the manuscript on their own. Only entries of
 * four characters or more can reach this list — shorter titles are already
 * excluded — so it holds no `el`, `la`, `the` or `and`.
 */
const COMMON_WORDS = new Set([
  // English
  'about', 'after', 'again', 'against', 'almost', 'alone', 'along', 'already', 'also',
  'always', 'another', 'anyone', 'around', 'away', 'back', 'because', 'been', 'before',
  'behind', 'being', 'below', 'better', 'between', 'both', 'came', 'come', 'could',
  'does', 'done', 'down', 'during', 'each', 'either', 'else', 'enough', 'even',
  'ever', 'every', 'first', 'from', 'girl', 'give', 'goes', 'going', 'gone', 'good',
  'great', 'hand', 'have', 'here', 'himself', 'house', 'into', 'itself', 'just', 'keep',
  'kind', 'knew', 'know', 'last', 'later', 'least', 'left', 'less', 'life', 'like',
  'little', 'long', 'look', 'made', 'make', 'many', 'might', 'more', 'most', 'much',
  'must', 'near', 'need', 'never', 'next', 'night', 'nothing', 'only', 'open', 'other',
  'over', 'part', 'people', 'perhaps', 'place', 'right', 'room', 'said', 'same', 'seem',
  'seen', 'shall', 'should', 'side', 'since', 'some', 'something', 'soon', 'still',
  'such', 'sure', 'take', 'than', 'that', 'their', 'them', 'then', 'there', 'these',
  'they', 'thing', 'think', 'this', 'those', 'though', 'through', 'time', 'together',
  'told', 'took', 'toward', 'under', 'until', 'upon', 'very', 'want', 'water', 'well',
  'went', 'were', 'what', 'when', 'where', 'which', 'while', 'whole', 'will', 'with',
  'without', 'word', 'work', 'world', 'would', 'year', 'your',
  // Spanish
  'agua', 'ahora', 'algo', 'alguien', 'alguna', 'algunas', 'alguno', 'algunos', 'ante',
  'antes', 'aquel', 'aquella', 'aquello', 'aunque', 'bien', 'cada', 'casa', 'casi',
  'como', 'contra', 'cosa', 'cual', 'cuando', 'cuanto', 'desde', 'dentro', 'donde',
  'ella', 'ellas', 'ellos', 'entonces', 'entre', 'eran', 'esta', 'estaba', 'estar',
  'este', 'esto', 'estos', 'gran', 'hace', 'hacia', 'hasta', 'hombre', 'luego', 'lugar',
  'mano', 'mientras', 'misma', 'mismo', 'mucho', 'muchos', 'nada', 'nadie', 'noche',
  'nunca', 'otra', 'otro', 'para', 'pero', 'poco', 'porque', 'primera', 'primero',
  'puede', 'pues', 'quien', 'siempre', 'sido', 'sobre', 'solo', 'tambien', 'tampoco',
  'tanto', 'tenia', 'tiempo', 'todo', 'todos', 'tras', 'vida', 'vuelta',
]);

// ---------------------------------------------------------------------------
// Local-calendar arithmetic (never `toISOString`, which shifts the day in
// every timezone west of Greenwich)
// ---------------------------------------------------------------------------

/** Parse a local `YYYY-MM-DD` key at local noon, so DST cannot move the day. */
function localNoon(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day, 12).getTime();
}

/** Whole local days between two `YYYY-MM-DD` keys, `from` earlier than `to`. */
export function localDaysBetween(fromKey: string, toKey: string): number {
  return Math.round((localNoon(toKey) - localNoon(fromKey)) / 86_400_000);
}

/** True when `timestamp` falls on or before the day `days` before `todayKey`. */
/**
 * "hace 0 días" is what a seed planted this morning used to read. Days are a
 * unit people stop using at the near end, so the first two get their own words
 * — the same three shapes the project card already uses.
 */
function ageDetail(
  t: (key: string) => string,
  seedTitle: string,
  ageInDays: number,
): string {
  const key = ageInDays <= 0
    ? 'proofreader.finding.seedWithoutPayoff.detailToday'
    : ageInDays === 1
      ? 'proofreader.finding.seedWithoutPayoff.detailYesterday'
      : 'proofreader.finding.seedWithoutPayoff.detailAge';
  return t(key).replace('{seed}', seedTitle).replace('{days}', String(ageInDays));
}

function olderThanDays(timestamp: number, todayKey: string, days: number): boolean {
  return toLocalDateKey(new Date(timestamp)) <= shiftLocalDateKey(todayKey, -days);
}

// ---------------------------------------------------------------------------
// Slim row shapes — what the checks are allowed to see
// ---------------------------------------------------------------------------

export interface ProofreaderCodexRow {
  id: string;
  type: CodexEntryType;
  title: string;
}

export interface ProofreaderWritingRow {
  id: string;
  title: string;
  status: WritingStatus;
  chapter?: number;
  createdAt: number;
  updatedAt: number;
  /** False for a row whose body is empty — a stub, not a page of the book. */
  hasProse: boolean;
  /** Ids of the codex characters whose title occurs in this writing's prose. */
  appearances: Set<string>;
}

export interface ProofreaderBlockRow {
  sceneId: string;
  type: DialogBlockType;
  characterId?: string;
  characterName: string;
}

export interface ProofreaderCastRow {
  sceneId: string;
  characterId?: string;
  characterName: string;
}

export interface ProofreaderInput {
  projectId: string;
  mode: ProjectMode;
  enabledEngines: string[];
  /** Local calendar day the analysis ran on. */
  todayKey: string;
  /** Manuscript order — the same order the publishing profile defaults to. */
  writings: ProofreaderWritingRow[];
  codexEntries: ProofreaderCodexRow[];
  /** Script order (`Scene.order`). */
  scenes: Scene[];
  blocks: ProofreaderBlockRow[];
  casts: ProofreaderCastRow[];
  outlineBeats: OutlineBeat[];
  seeds: Seed[];
  payoffs: Payoff[];
  relationships: Relationship[];
  timelineEventIds: Set<string>;
}

// ---------------------------------------------------------------------------
// Text scanning
// ---------------------------------------------------------------------------
//
// The tokeniser and the one-pass matcher live in `_shared/nameAppearances`:
// the Codex and the real atlas ask the same question of the same manuscript,
// and one scanner means one answer. Names are matched whole, case- and
// accent-insensitively («Jose» finds «José»); no plurals here, a character
// is rarely pluralised and «Martas» would be somebody else.

/** A codex character to look for, tokenised; the shared scanner's candidate. */
export type AppearanceCandidate = NameCandidate;

/**
 * Which codex characters are worth looking for in the prose.
 *
 * A one-word title shorter than four characters, or a title that is a common
 * word, matches so much ordinary text that its "appearance" says nothing.
 */
export function buildAppearanceCandidates(
  codexEntries: readonly ProofreaderCodexRow[],
): AppearanceCandidate[] {
  const candidates: AppearanceCandidate[] = [];
  for (const entry of codexEntries) {
    if (entry.type !== 'character') continue;
    const trimmed = entry.title.trim();
    if (trimmed.length < MIN_APPEARANCE_TITLE_LENGTH) continue;
    const tokens = tokenizeNameText(trimmed);
    if (tokens.length === 0) continue;
    if (tokens.length === 1) {
      if (tokens[0].length < MIN_APPEARANCE_TITLE_LENGTH) continue;
      if (COMMON_WORDS.has(tokens[0])) continue;
    }
    candidates.push({ entryId: entry.id, tokens });
  }
  return candidates;
}

/**
 * One pass over one manuscript. Candidates are indexed by their first token,
 * so a chapter costs `O(words)` map lookups no matter how large the codex is.
 */
export function findAppearances(
  text: string,
  byFirstToken: ReadonlyMap<string, AppearanceCandidate[]>,
): Set<string> {
  return findNameAppearances(text, byFirstToken);
}

// ---------------------------------------------------------------------------
// Collection — the only place this module reads the database
// ---------------------------------------------------------------------------

/**
 * Manuscript order — the app's one definition of it, not a third copy.
 *
 * This used to be a private comparator whose comment said it "mirrors
 * `defaultPublishingOrder`". It did not: on an unnumbered row it sorted by
 * creation time ascending while the chapter list sorts by last edit descending,
 * so the "opening third" the disappearing-character check reads was not the
 * opening third the writer sees. Two comparators that must agree and are
 * written twice will disagree; there is now one, in `chapterOrder.ts`, and both
 * the export path and this one call it.
 */
function compareManuscriptOrder(
  left: ProofreaderWritingRow,
  right: ProofreaderWritingRow,
): number {
  return compareChapters(left, right);
}

export async function collectProofreaderInput(projectId: string): Promise<ProofreaderInput> {
  const [project, scenes, outlineBeats, seeds, payoffs, relationships, timelineEventKeys] =
    await Promise.all([
      db.projects.get(projectId),
      // Sorted by the scene's own `order` so "the first scene this cue speaks
      // in" means the first one in the script, not the first one written.
      db.scenes.where('projectId').equals(projectId).sortBy('order'),
      db.outlineBeats.where('projectId').equals(projectId).toArray(),
      db.seeds.where('projectId').equals(projectId).toArray(),
      db.payoffs.where('projectId').equals(projectId).toArray(),
      db.relationships.where('projectId').equals(projectId).toArray(),
      // Keys only: a relationship endpoint only ever needs to know whether the
      // event still exists.
      db.timelineEvents.where('projectId').equals(projectId).primaryKeys(),
    ]);
  if (!project) throw new Error('Project not found');

  // A codex row carries two base64 avatars. No index carries the title, so the
  // titles have to come off the rows — but a cursor keeps peak memory at one
  // row instead of eight hundred portraits.
  const codexEntries: ProofreaderCodexRow[] = [];
  await db.codexEntries
    .where('projectId')
    .equals(projectId)
    .each(row => {
      codexEntries.push({ id: row.id, type: row.type, title: row.title });
    });

  const sceneIds = scenes.map(scene => scene.id);
  const candidates = buildAppearanceCandidates(codexEntries);
  const byFirstToken = indexNameCandidates(candidates);

  const writings: ProofreaderWritingRow[] = [];
  const blocks: ProofreaderBlockRow[] = [];
  await Promise.all([
    // Same cursor reasoning as the codex, for a much larger payload: the whole
    // manuscript is walked one chapter at a time and only the appearance set
    // survives the row.
    db.writings
      .where('projectId')
      .equals(projectId)
      .each(row => {
        // One strip per chapter, read twice: `stripHtml` already trims and
        // collapses, so an empty result is exactly "this row has no prose".
        const prose = stripHtml(row.content);
        writings.push({
          id: row.id,
          title: row.title,
          status: row.status,
          chapter: row.chapter,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          hasProse: prose.length > 0,
          appearances: findAppearances(prose, byFirstToken),
        });
      }),
    db.dialogBlocks
      .where('projectId')
      .equals(projectId)
      .each(row => {
        blocks.push({
          sceneId: row.sceneId,
          type: row.type,
          characterId: row.characterId,
          characterName: row.characterName,
        });
      }),
  ]);
  writings.sort(compareManuscriptOrder);

  // `sceneCasts` has no `projectId` of its own — pov-audit reaches it through
  // the scene ids for exactly the same reason.
  const casts: ProofreaderCastRow[] = [];
  if (sceneIds.length > 0) {
    await db.sceneCasts
      .where('sceneId')
      .anyOf(sceneIds)
      .each(row => {
        casts.push({
          sceneId: row.sceneId,
          characterId: row.characterId,
          characterName: row.characterName,
        });
      });
  }

  return {
    projectId,
    mode: project.mode,
    enabledEngines: project.enabledEngines,
    todayKey: toLocalDateKey(),
    writings,
    codexEntries,
    scenes,
    blocks,
    casts,
    outlineBeats,
    seeds,
    payoffs,
    relationships,
    timelineEventIds: new Set(timelineEventKeys as string[]),
  };
}

// ---------------------------------------------------------------------------
// Shared helpers for the checks
// ---------------------------------------------------------------------------

function named(title: string | undefined): string {
  const trimmed = (title ?? '').trim();
  return trimmed || t('proofreader.untitled');
}

/**
 * Does point of view matter here?
 *
 * pov-audit owns no tables and is never a default engine — it is offered by
 * the modes whose work is scene-and-cast shaped (novelist, realist,
 * playwright). Reading that from `PROJECT_MODES` keeps the answer correct when
 * a mode's engine list changes, which a hard-coded list of modes would not.
 */
export function povMattersForProject(mode: ProjectMode, enabledEngines: readonly string[]): boolean {
  if (enabledEngines.includes('pov-audit')) return true;
  const config = PROJECT_MODES.find(candidate => candidate.id === mode);
  if (!config) return false;
  return (
    config.defaultEngines.includes('pov-audit') || config.suggestedEngines.includes('pov-audit')
  );
}

// ---------------------------------------------------------------------------
// Check 1 — a seed that was planted and never paid off
// ---------------------------------------------------------------------------

/**
 * `computeSeedStatus` already owns the definition of an orphan: an un-cut seed
 * with no payoff. Severity rises with how long the reader has been carrying
 * it — by story position when the seed has one (a seed planted at 10% and
 * still open is louder than one planted at 95%), and by wall-clock age when it
 * does not.
 */
export function findSeedsWithoutPayoff(input: ProofreaderInput): ProofreaderFinding[] {
  const payoffsBySeed = new Map<string, Payoff[]>();
  for (const payoff of input.payoffs) {
    const group = payoffsBySeed.get(payoff.seedId);
    if (group) group.push(payoff);
    else payoffsBySeed.set(payoff.seedId, [payoff]);
  }
  const beatPositions = new Map(
    input.outlineBeats.map(beat => [beat.id, beat.storyPosition] as const),
  );

  const findings: ProofreaderFinding[] = [];
  for (const seed of input.seeds) {
    if (computeSeedStatus(seed, payoffsBySeed.get(seed.id) ?? []) !== 'orphaned') continue;
    const position =
      seed.plantedAt ?? (seed.linkedBeatId ? beatPositions.get(seed.linkedBeatId) : undefined);
    const age = localDaysBetween(toLocalDateKey(new Date(seed.createdAt)), input.todayKey);
    const overdue =
      position !== undefined && Number.isFinite(position)
        ? position <= SEED_OVERDUE_POSITION
        : age >= SEED_OVERDUE_DAYS;
    const detail =
      position !== undefined && Number.isFinite(position)
        ? t('proofreader.finding.seedWithoutPayoff.detailPosition')
            .replace('{seed}', named(seed.title))
            .replace('{position}', String(Math.round(position)))
        : ageDetail(t, named(seed.title), Math.max(age, 0));
    findings.push({
      id: `seed-without-payoff:${seed.id}`,
      checkId: 'seed-without-payoff',
      severity: overdue ? 'warning' : 'info',
      title: t('proofreader.finding.seedWithoutPayoff.title'),
      detail,
      engineId: 'seeds',
      entityId: seed.id,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Check 2 — a beat with no scene and no chapter
// ---------------------------------------------------------------------------

/**
 * Same predicate `deriveNarrativeContinuity` uses for `unlinked-beat`, and the
 * same id sets `loadProjectCockpit` builds for `linkedBeats`: a link only
 * counts when its target still exists. The two shapes are separated because
 * only one of them can be repaired in place — a pointer at a deleted chapter
 * is dead data, while an empty pointer is a decision the writer has not made.
 */
export function findBeatsWithoutScene(input: ProofreaderInput): ProofreaderFinding[] {
  const writingIds = new Set(input.writings.map(row => row.id));
  const sceneIds = new Set(input.scenes.map(row => row.id));

  // Same reasoning as `findWritingsOutsideOutline`: a beat that points nowhere
  // is worth naming, but a project where NO beat has ever been pointed anywhere
  // is one unstarted habit, not one omission per beat. Only the empty-pointer
  // shape collapses — a pointer at a deleted chapter is dead data and every one
  // of those still gets its own row and its own fix.
  const anyLinked = input.outlineBeats.some(
    beat =>
      (beat.linkedWritingId && writingIds.has(beat.linkedWritingId)) ||
      (beat.linkedSceneId && sceneIds.has(beat.linkedSceneId)),
  );
  const anyDeadPointer = input.outlineBeats.some(
    beat => Boolean(beat.linkedWritingId) || Boolean(beat.linkedSceneId),
  );
  if (!anyLinked && !anyDeadPointer && input.outlineBeats.length >= UNUSED_LINK_MIN) {
    return [
      {
        id: 'beat-without-scene:none-linked',
        checkId: 'beat-without-scene',
        severity: 'info',
        title: t('proofreader.finding.beatsNeverLinked.title'),
        detail: t('proofreader.finding.beatsNeverLinked.detail').replace(
          '{beats}',
          String(input.outlineBeats.length),
        ),
        engineId: 'outline',
        entityId: '',
        route: 'outline',
      },
    ];
  }

  const findings: ProofreaderFinding[] = [];
  for (const beat of input.outlineBeats) {
    const hasWriting = Boolean(beat.linkedWritingId && writingIds.has(beat.linkedWritingId));
    const hasScene = Boolean(beat.linkedSceneId && sceneIds.has(beat.linkedSceneId));
    if (hasWriting || hasScene) continue;

    const deadWriting = Boolean(beat.linkedWritingId);
    const deadScene = Boolean(beat.linkedSceneId);
    const beatTitle = named(beat.title);
    if (!deadWriting && !deadScene) {
      findings.push({
        id: `beat-without-scene:empty:${beat.id}`,
        checkId: 'beat-without-scene',
        severity: 'info',
        title: t('proofreader.finding.beatWithoutScene.title'),
        detail: t('proofreader.finding.beatWithoutScene.detail').replace('{beat}', beatTitle),
        engineId: 'outline',
        entityId: beat.id,
      });
      continue;
    }
    findings.push({
      id: `beat-without-scene:broken:${beat.id}`,
      checkId: 'beat-without-scene',
      severity: 'warning',
      title: t('proofreader.finding.beatBrokenLink.title'),
      detail: t('proofreader.finding.beatBrokenLink.detail').replace('{beat}', beatTitle),
      engineId: 'outline',
      entityId: beat.id,
      fix: {
        label: t('proofreader.fix.clearDeadBeatLink.label'),
        confirmTitle: t('proofreader.fix.clearDeadBeatLink.title'),
        confirmMessage: t('proofreader.fix.clearDeadBeatLink.message').replace('{beat}', beatTitle),
        action: {
          kind: 'clear-dead-beat-link',
          beatId: beat.id,
          clearWriting: deadWriting,
          clearScene: deadScene,
        },
      },
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Check 3 — a chapter no beat links to
// ---------------------------------------------------------------------------

/**
 * Only meaningful once an outline exists: with no beats at all there is no
 * spine to be missing from. Ideas are excluded on purpose — an idea is not yet
 * a chapter, and flagging every stray note would bury the real omissions.
 */
export function findWritingsOutsideOutline(input: ProofreaderInput): ProofreaderFinding[] {
  if (input.outlineBeats.length === 0) return [];
  const linked = new Set(
    input.outlineBeats
      .map(beat => beat.linkedWritingId)
      .filter((id): id is string => Boolean(id)),
  );

  const orphans = input.writings.filter(
    writing => writing.status !== 'idea' && !linked.has(writing.id),
  );

  // No beat in the project points at ANY chapter. That is not "nine chapters
  // are missing from the outline" — it is one fact, that the writer has not
  // started linking the two, and nine identical rows saying so would bury the
  // checks that found something specific. Said once, pointing at the spine
  // where the linking is done.
  if (linked.size === 0 && orphans.length >= UNUSED_LINK_MIN) {
    return [
      {
        id: 'writing-outside-outline:none-linked',
        checkId: 'writing-outside-outline',
        severity: 'info',
        title: t('proofreader.finding.outlineNeverLinked.title'),
        detail: t('proofreader.finding.outlineNeverLinked.detail')
          .replace('{writings}', String(orphans.length))
          .replace('{beats}', String(input.outlineBeats.length)),
        engineId: 'outline',
        entityId: '',
        route: 'outline',
      },
    ];
  }

  const findings: ProofreaderFinding[] = [];
  for (const writing of orphans) {
    findings.push({
      id: `writing-outside-outline:${writing.id}`,
      checkId: 'writing-outside-outline',
      severity: writing.status === 'finished' ? 'warning' : 'info',
      title: t('proofreader.finding.writingOutsideOutline.title'),
      detail: t('proofreader.finding.writingOutsideOutline.detail').replace(
        '{writing}',
        named(writing.title),
      ),
      engineId: 'writings',
      entityId: writing.id,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Check 4 — a character who disappears
// ---------------------------------------------------------------------------

/**
 * Present in the opening third of the manuscript, absent from the closing
 * third. The appearance sets were built during the single manuscript pass, so
 * this function only counts.
 *
 * The thirds are cut from the PROSE, not from every row: `compareManuscriptOrder`
 * parks a writing with no chapter number at the end of the list, so on a project
 * that mixes twelve numbered chapters with eight unnumbered ideas the closing
 * third was six empty stubs — nobody appears in it, and every character in the
 * opening chapters was reported as disappearing. Ideas are dropped for the same
 * reason `findWritingsOutsideOutline` drops them (an idea is not yet a chapter),
 * and empty rows because a row with no prose can neither show a character nor
 * prove one absent. Filtering on the prose rather than on the chapter number
 * keeps the check alive on a manuscript that never numbers its chapters, where
 * creation order IS the reading order.
 */
export function findDisappearingCharacters(input: ProofreaderInput): ProofreaderFinding[] {
  const manuscript = input.writings.filter(
    writing => writing.status !== 'idea' && writing.hasProse,
  );
  const total = manuscript.length;
  if (total < MIN_WRITINGS_FOR_THIRDS) return [];
  const third = Math.floor(total / 3);
  const firstThird = manuscript.slice(0, third);
  const lastThird = manuscript.slice(total - third);

  const openingCounts = new Map<string, number>();
  for (const writing of firstThird) {
    for (const entryId of writing.appearances) {
      openingCounts.set(entryId, (openingCounts.get(entryId) ?? 0) + 1);
    }
  }
  const closing = new Set<string>();
  for (const writing of lastThird) {
    for (const entryId of writing.appearances) closing.add(entryId);
  }
  const totalCounts = new Map<string, number>();
  for (const writing of manuscript) {
    for (const entryId of writing.appearances) {
      totalCounts.set(entryId, (totalCounts.get(entryId) ?? 0) + 1);
    }
  }

  const titles = new Map(input.codexEntries.map(entry => [entry.id, entry.title] as const));
  const findings: ProofreaderFinding[] = [];
  for (const [entryId, openingCount] of openingCounts) {
    if (closing.has(entryId)) continue;
    const appearances = totalCounts.get(entryId) ?? openingCount;
    findings.push({
      id: `character-disappears:${entryId}`,
      checkId: 'character-disappears',
      severity: appearances >= RECURRING_CHARACTER_APPEARANCES ? 'warning' : 'info',
      title: t('proofreader.finding.characterDisappears.title'),
      detail: t('proofreader.finding.characterDisappears.detail')
        .replace('{character}', named(titles.get(entryId)))
        .replace('{count}', String(appearances)),
      engineId: 'codex',
      entityId: entryId,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Check 5 — a scene with nobody behind the camera
// ---------------------------------------------------------------------------

/**
 * pov-audit calls a line attributed when its `characterId` is set, and a scene
 * populated when a `sceneCasts` row names someone. A scene with content and
 * neither has no point of view at all. Omitted scenes are excluded — they are
 * deliberately outside the output.
 */
export function findScenesWithoutPov(input: ProofreaderInput): ProofreaderFinding[] {
  if (!povMattersForProject(input.mode, input.enabledEngines)) return [];

  const attributed = new Set<string>();
  const blockCounts = new Map<string, number>();
  const dialogCounts = new Map<string, number>();
  for (const block of input.blocks) {
    blockCounts.set(block.sceneId, (blockCounts.get(block.sceneId) ?? 0) + 1);
    if (block.type === 'dialog') {
      dialogCounts.set(block.sceneId, (dialogCounts.get(block.sceneId) ?? 0) + 1);
    }
    if (block.characterId) attributed.add(block.sceneId);
  }
  for (const cast of input.casts) {
    if (cast.characterId) attributed.add(cast.sceneId);
  }

  const findings: ProofreaderFinding[] = [];
  for (const scene of input.scenes) {
    if (scene.isOmitted) continue;
    if ((blockCounts.get(scene.id) ?? 0) === 0) continue;
    if (attributed.has(scene.id)) continue;
    const dialogLines = dialogCounts.get(scene.id) ?? 0;
    findings.push({
      id: `scene-without-pov:${scene.id}`,
      checkId: 'scene-without-pov',
      severity: dialogLines > 0 ? 'warning' : 'info',
      title: t('proofreader.finding.sceneWithoutPov.title'),
      detail:
        dialogLines > 0
          ? t('proofreader.finding.sceneWithoutPov.detailSpoken')
              .replace('{scene}', named(scene.title))
              .replace('{lines}', String(dialogLines))
          : t('proofreader.finding.sceneWithoutPov.detailSilent').replace(
              '{scene}',
              named(scene.title),
            ),
      engineId: 'dialog-scene',
      entityId: scene.id,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Check 6 — a speaker who is not in the Codex
// ---------------------------------------------------------------------------

/**
 * pov-audit's "unmapped" row, recomputed from data already in memory rather
 * than by calling `computeUsage` — which would re-read four tables, including
 * every codex avatar. The identity is pov-audit's own: `castKeyOf` lower-cased,
 * so "MARIA (V.O.)" and "Maria" are one speaker.
 */
export function findSpeakersNotInCodex(input: ProofreaderInput): ProofreaderFinding[] {
  const sceneOrder = new Map(input.scenes.map((scene, index) => [scene.id, index] as const));
  const codexByName = new Map<string, ProofreaderCodexRow>();
  for (const entry of input.codexEntries) {
    if (entry.type !== 'character') continue;
    const key = castKeyOf(entry.title).toLowerCase();
    if (key && !codexByName.has(key)) codexByName.set(key, entry);
  }

  interface SpeakerGroup {
    displayName: string;
    lines: number;
    sceneId: string;
    scenePosition: number;
  }
  const groups = new Map<string, SpeakerGroup>();
  const remember = (name: string, sceneId: string, lines: number) => {
    const display = castKeyOf(name);
    const key = display.toLowerCase();
    if (!key) return;
    const position = sceneOrder.get(sceneId) ?? Number.MAX_SAFE_INTEGER;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { displayName: display, lines, sceneId, scenePosition: position });
      return;
    }
    existing.lines += lines;
    if (position < existing.scenePosition) {
      existing.scenePosition = position;
      existing.sceneId = sceneId;
    }
  };

  // Only dialog blocks, exactly as pov-audit counts them: an action line that
  // happens to carry a name is not a speaker.
  for (const block of input.blocks) {
    if (block.type !== 'dialog') continue;
    if (block.characterId || !block.characterName) continue;
    remember(block.characterName, block.sceneId, 1);
  }
  for (const cast of input.casts) {
    if (cast.characterId || !cast.characterName) continue;
    remember(cast.characterName, cast.sceneId, 0);
  }

  const findings: ProofreaderFinding[] = [];
  for (const [castKey, group] of groups) {
    const existing = codexByName.get(castKey);
    findings.push({
      id: `speaker-not-in-codex:${castKey}`,
      checkId: 'speaker-not-in-codex',
      severity: group.lines > 0 ? 'warning' : 'info',
      title: t('proofreader.finding.speakerNotInCodex.title'),
      detail:
        group.lines > 0
          ? t('proofreader.finding.speakerNotInCodex.detailSpoken')
              .replace('{speaker}', group.displayName)
              .replace('{lines}', String(group.lines))
          : t('proofreader.finding.speakerNotInCodex.detailCast').replace(
              '{speaker}',
              group.displayName,
            ),
      engineId: 'dialog-scene',
      entityId: group.sceneId,
      fix: existing
        ? {
            label: t('proofreader.fix.linkSpeaker.label'),
            confirmTitle: t('proofreader.fix.linkSpeaker.title'),
            confirmMessage: t('proofreader.fix.linkSpeaker.message')
              .replace('{speaker}', group.displayName)
              .replace('{entry}', named(existing.title)),
            action: {
              kind: 'map-speaker-to-codex',
              projectId: input.projectId,
              castKey,
              displayName: group.displayName,
              entryId: existing.id,
            },
          }
        : {
            label: t('proofreader.fix.createSpeaker.label'),
            confirmTitle: t('proofreader.fix.createSpeaker.title'),
            confirmMessage: t('proofreader.fix.createSpeaker.message').replace(
              '{speaker}',
              group.displayName,
            ),
            action: {
              kind: 'map-speaker-to-codex',
              projectId: input.projectId,
              castKey,
              displayName: group.displayName,
            },
          },
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Check 7 — a relationship whose other end was deleted
// ---------------------------------------------------------------------------

/**
 * A relationship endpoint is generic by design (`entityAType`), so the check
 * only judges the types this project can actually resolve. An endpoint of an
 * unknown type is left alone rather than reported on a guess.
 */
export function findRelationshipsToMissingEntities(
  input: ProofreaderInput,
): ProofreaderFinding[] {
  const codexIds = new Set(input.codexEntries.map(entry => entry.id));
  const writingIds = new Set(input.writings.map(row => row.id));
  const sceneIds = new Set(input.scenes.map(row => row.id));
  const beatIds = new Set(input.outlineBeats.map(row => row.id));
  const seedIds = new Set(input.seeds.map(row => row.id));
  const universe = new Map<string, ReadonlySet<string>>([
    ['codex', codexIds],
    ['codex-entry', codexIds],
    ['character', codexIds],
    ['location', codexIds],
    ['writing', writingIds],
    ['writings', writingIds],
    ['scene', sceneIds],
    ['dialog-scene', sceneIds],
    ['outline-beat', beatIds],
    ['seed', seedIds],
    ['timeline-event', input.timelineEventIds],
  ]);
  const isMissing = (entityType: string, entityId: string): boolean => {
    const known = universe.get(entityType);
    return known !== undefined && !known.has(entityId);
  };

  const findings: ProofreaderFinding[] = [];
  for (const relationship of input.relationships) {
    const missing: string[] = [];
    if (isMissing(relationship.entityAType, relationship.entityAId)) {
      missing.push(named(relationship.entityAName));
    }
    if (isMissing(relationship.entityBType, relationship.entityBId)) {
      missing.push(named(relationship.entityBName));
    }
    if (missing.length === 0) continue;
    const label =
      relationship.label.trim() ||
      [relationship.entityAName, relationship.entityBName]
        .map(name => name.trim())
        .filter(Boolean)
        .join(' · ');
    findings.push({
      id: `relationship-broken-endpoint:${relationship.id}`,
      checkId: 'relationship-broken-endpoint',
      severity: 'warning',
      title: t('proofreader.finding.relationshipBrokenEndpoint.title'),
      detail: t('proofreader.finding.relationshipBrokenEndpoint.detail')
        .replace('{relationship}', named(label))
        .replace('{missing}', missing.join(', ')),
      engineId: 'relationships',
      entityId: relationship.id,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Check 8 — a draft nobody has touched in a long time
// ---------------------------------------------------------------------------

export function findStaleDrafts(input: ProofreaderInput): ProofreaderFinding[] {
  const findings: ProofreaderFinding[] = [];
  for (const writing of input.writings) {
    if (writing.status !== 'draft') continue;
    if (!olderThanDays(writing.updatedAt, input.todayKey, STALE_DRAFT_DAYS)) continue;
    const days = localDaysBetween(toLocalDateKey(new Date(writing.updatedAt)), input.todayKey);
    findings.push({
      id: `stale-draft:${writing.id}`,
      checkId: 'stale-draft',
      severity: days >= STALE_DRAFT_WARNING_DAYS ? 'warning' : 'info',
      title: t('proofreader.finding.staleDraft.title'),
      detail: t('proofreader.finding.staleDraft.detail')
        .replace('{writing}', named(writing.title))
        .replace('{days}', String(days)),
      engineId: 'writings',
      entityId: writing.id,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/** Group headers, written out literally so the locale gate can verify them. */
function checkDescriptors(): Array<Pick<ProofreaderCheckGroup, 'id' | 'title' | 'description'>> {
  return [
    {
      id: 'seed-without-payoff',
      title: t('proofreader.check.seedWithoutPayoff.title'),
      description: t('proofreader.check.seedWithoutPayoff.detail'),
    },
    {
      id: 'beat-without-scene',
      title: t('proofreader.check.beatWithoutScene.title'),
      description: t('proofreader.check.beatWithoutScene.detail'),
    },
    {
      id: 'writing-outside-outline',
      title: t('proofreader.check.writingOutsideOutline.title'),
      description: t('proofreader.check.writingOutsideOutline.detail'),
    },
    {
      id: 'character-disappears',
      title: t('proofreader.check.characterDisappears.title'),
      description: t('proofreader.check.characterDisappears.detail'),
    },
    {
      id: 'scene-without-pov',
      title: t('proofreader.check.sceneWithoutPov.title'),
      description: t('proofreader.check.sceneWithoutPov.detail'),
    },
    {
      id: 'speaker-not-in-codex',
      title: t('proofreader.check.speakerNotInCodex.title'),
      description: t('proofreader.check.speakerNotInCodex.detail'),
    },
    {
      id: 'relationship-broken-endpoint',
      title: t('proofreader.check.relationshipBrokenEndpoint.title'),
      description: t('proofreader.check.relationshipBrokenEndpoint.detail'),
    },
    {
      id: 'stale-draft',
      title: t('proofreader.check.staleDraft.title'),
      description: t('proofreader.check.staleDraft.detail'),
    },
  ];
}

/** Every check, in the order the panel renders them. */
export function analyseProofreaderInput(input: ProofreaderInput): ProofreaderReport {
  const byCheck: Record<ProofreaderCheckId, ProofreaderFinding[]> = {
    'seed-without-payoff': findSeedsWithoutPayoff(input),
    'beat-without-scene': findBeatsWithoutScene(input),
    'writing-outside-outline': findWritingsOutsideOutline(input),
    'character-disappears': findDisappearingCharacters(input),
    'scene-without-pov': findScenesWithoutPov(input),
    'speaker-not-in-codex': findSpeakersNotInCodex(input),
    'relationship-broken-endpoint': findRelationshipsToMissingEntities(input),
    'stale-draft': findStaleDrafts(input),
  };
  const povApplies = povMattersForProject(input.mode, input.enabledEngines);
  const groups: ProofreaderCheckGroup[] = checkDescriptors().map(descriptor => {
    const applicable = descriptor.id === 'scene-without-pov' ? povApplies : true;
    return {
      ...descriptor,
      applicable,
      notApplicableReason: applicable
        ? undefined
        : t('proofreader.check.sceneWithoutPov.notApplicable'),
      findings: byCheck[descriptor.id],
    };
  });

  return {
    generatedAt: Date.now(),
    findings: groups.flatMap(group => group.findings),
    groups,
    scanned: {
      writings: input.writings.length,
      codexEntries: input.codexEntries.length,
      scenes: input.scenes.length,
    },
  };
}

/** Read the project once, then run every check over what came back. */
export async function runProofreader(projectId: string): Promise<ProofreaderReport> {
  return analyseProofreaderInput(await collectProofreaderInput(projectId));
}

// ---------------------------------------------------------------------------
// Dismissals — "this one is intentional"
// ---------------------------------------------------------------------------
//
// Stored in the existing `settings` key/value table (one row per project) for
// the same reason project recipes and the grounded-AI privacy flags are: this
// is a preference about the writer's own judgement, not project content, and
// it must not become a table that every backup, export and delete path has to
// learn about. The key is declared in `PROJECT_SETTING_PREFIXES`, which is
// what makes `deleteProject` take it with the project it belongs to.

function dismissalKey(projectId: string): string {
  return `${PROJECT_SETTING_PREFIXES.proofreaderDismissed}${projectId}`;
}

function parseDismissedIds(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    // A hand-edited or half-written value must not break the panel; the worst
    // case is that a dismissal is forgotten, never that the list refuses to load.
    return new Set();
  }
}

export async function getDismissedFindingIds(projectId: string): Promise<Set<string>> {
  return parseDismissedIds(await getSetting(dismissalKey(projectId)));
}

/**
 * Change the dismissal set in ONE transaction.
 *
 * Read-then-write across two awaits loses a dismissal whenever two of them
 * overlap — the second call reads the set the first one had not written yet,
 * and the finding the writer hid comes back on the next analysis.
 */
async function updateDismissedFindingIds(
  projectId: string,
  mutate: (ids: Set<string>) => void,
): Promise<Set<string>> {
  let ids = new Set<string>();
  await updateSetting(dismissalKey(projectId), current => {
    ids = parseDismissedIds(current);
    mutate(ids);
    return JSON.stringify([...ids].sort());
  });
  return ids;
}

export async function dismissFinding(projectId: string, findingId: string): Promise<Set<string>> {
  return updateDismissedFindingIds(projectId, ids => {
    ids.add(findingId);
  });
}

export async function restoreFinding(projectId: string, findingId: string): Promise<Set<string>> {
  return updateDismissedFindingIds(projectId, ids => {
    ids.delete(findingId);
  });
}

export async function restoreAllFindings(projectId: string): Promise<Set<string>> {
  return updateDismissedFindingIds(projectId, ids => {
    ids.clear();
  });
}

// ---------------------------------------------------------------------------
// Fixes
// ---------------------------------------------------------------------------

/**
 * Apply one named fix. Both actions are additive or corrective: one deletes a
 * pointer that already resolves to nothing, the other creates (or reuses) a
 * Codex identity and attaches it to the cues that already carry that name.
 * Neither touches a single character of the writer's prose.
 */
export async function applyProofreaderFix(action: ProofreaderFixAction): Promise<void> {
  switch (action.kind) {
    case 'clear-dead-beat-link': {
      // `delete` rather than `update(..., undefined)`, matching the repair in
      // `repairProjectHealthIssue('broken-spine-links')` — the key has to go,
      // not be stored as an explicit undefined.
      await db.outlineBeats
        .where('id')
        .equals(action.beatId)
        .modify(beat => {
          if (action.clearWriting) delete beat.linkedWritingId;
          if (action.clearScene) delete beat.linkedSceneId;
          beat.updatedAt = Date.now();
        });
      break;
    }
    case 'map-speaker-to-codex': {
      let entryId = action.entryId;
      if (entryId) {
        const existing = await db.codexEntries.get(entryId);
        if (!existing || existing.projectId !== action.projectId) {
          throw new Error('Codex entry does not belong to this project');
        }
      } else {
        const now = Date.now();
        const entry: CodexEntry = {
          id: generateId('codex'),
          projectId: action.projectId,
          type: 'character',
          title: action.displayName,
          fields: { ...getTemplateFields('character'), name: action.displayName },
          content: '',
          tags: [],
          relations: [],
          createdAt: now,
          updatedAt: now,
        };
        await db.codexEntries.add(entry);
        entryId = entry.id;
      }

      const attachedId = entryId;
      const stamp = Date.now();
      await db.dialogBlocks
        .where('projectId')
        .equals(action.projectId)
        .modify(block => {
          if (block.characterId || !block.characterName) return;
          if (castKeyOf(block.characterName).toLowerCase() !== action.castKey) return;
          block.characterId = attachedId;
          block.updatedAt = stamp;
        });
      const sceneIds = (await db.scenes
        .where('projectId')
        .equals(action.projectId)
        .primaryKeys()) as string[];
      if (sceneIds.length > 0) {
        await db.sceneCasts
          .where('sceneId')
          .anyOf(sceneIds)
          .modify(cast => {
            if (cast.characterId || !cast.characterName) return;
            if (castKeyOf(cast.characterName).toLowerCase() !== action.castKey) return;
            cast.characterId = attachedId;
          });
      }
      break;
    }
  }
}
