import { db } from '@/db';
import {
  loadCoverageMatrix,
  loadTimelineEvidence,
  setCoverageCell,
  setTimelineEvidence,
  type CoverageRole,
  type EvidenceStatus,
} from '@/services/narrativeXray/coverageEvidence';
import {
  buildManuscriptBoard,
  type ManuscriptViewMode,
} from '@/services/narrativeXray/manuscriptViews';
import {
  buildPhraseRecurrence,
  type PhraseLocale,
} from '@/services/narrativeXray/phraseRecurrence';
import { BridgeError, resolveProjectId, type ToolArgs } from './shared';

const ROLES = new Set<CoverageRole>(['absent', 'mention', 'presence', 'pov']);
const EVIDENCE = new Set<EvidenceStatus>([
  'narrated',
  'not_narrated',
  'contradiction',
  'unverified',
]);
const VIEWS = new Set<ManuscriptViewMode>(['list', 'binder', 'kanban']);

export async function whGetNarrativeCoverage(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const matrix = await loadCoverageMatrix(projectId);
  return {
    projectId: matrix.projectId,
    characters: matrix.characters,
    writings: matrix.writings,
    cells: matrix.cells,
    emptyLinkedBeats: matrix.emptyLinkedBeats,
    hint:
      'mention = name in that chapter only. plannedPresence/plannedPov are planning links and do not raise role. presence needs a manual override (stores chapter contentHash; overrideStale falls back to inference). POV only from pov: tags or manual. emptyLinkedBeats = outline beats whose linked writing has no prose.',
  };
}

export async function whSetCoverageCell(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const characterId = typeof args.characterId === 'string' ? args.characterId : '';
  const writingId = typeof args.writingId === 'string' ? args.writingId : '';
  if (!characterId || !writingId) {
    throw new BridgeError('bad-args', 'characterId and writingId are required.');
  }
  const clear = args.clear === true;
  let role: CoverageRole | null = null;
  if (!clear) {
    if (typeof args.role !== 'string' || !ROLES.has(args.role as CoverageRole)) {
      throw new BridgeError('bad-args', 'role must be absent|mention|presence|pov (or pass clear:true).');
    }
    role = args.role as CoverageRole;
  }
  try {
    const cell = await setCoverageCell({ projectId, characterId, writingId, role });
    return { projectId, cell };
  } catch (error) {
    throw new BridgeError('bad-args', error instanceof Error ? error.message : String(error));
  }
}

export async function whListTimelineEvidence(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const report = await loadTimelineEvidence(projectId);
  return {
    projectId: report.projectId,
    rows: report.rows,
    hint:
      'stale=true (writing or manuscript hash changed, or legacy override without hash) forces unverified. Narrated requires an anchored multi-token title witness in one non-empty chapter (word boundaries; think/remember/avoid frames do not count). A single title token never certifies narration. witness carries chapter+excerpt when inferred narrated.',
  };
}

export async function whSetTimelineEvidence(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const eventId = typeof args.eventId === 'string' ? args.eventId : '';
  if (!eventId) throw new BridgeError('bad-args', 'eventId is required.');
  const clear = args.clear === true;
  let status: EvidenceStatus | null = null;
  if (!clear) {
    if (typeof args.status !== 'string' || !EVIDENCE.has(args.status as EvidenceStatus)) {
      throw new BridgeError(
        'bad-args',
        'status must be narrated|not_narrated|contradiction|unverified (or pass clear:true).',
      );
    }
    status = args.status as EvidenceStatus;
  }
  const writingId = typeof args.writingId === 'string' ? args.writingId : undefined;
  const note = typeof args.note === 'string' ? args.note : undefined;
  try {
    const row = await setTimelineEvidence({ projectId, eventId, status, writingId, note });
    return { projectId, row };
  } catch (error) {
    throw new BridgeError('bad-args', error instanceof Error ? error.message : String(error));
  }
}

export async function whGetManuscriptBoard(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const mode =
    typeof args.mode === 'string' && VIEWS.has(args.mode as ManuscriptViewMode)
      ? (args.mode as ManuscriptViewMode)
      : 'list';
  const writings = await db.writings.where('projectId').equals(projectId).toArray();
  const board = buildManuscriptBoard(writings, mode);
  return {
    projectId,
    ...board,
    hint: 'Same Writing rows as wh_list_writings; status changes via wh_update_writing. No parallel board store.',
  };
}

export async function whListPhraseRecurrence(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const locale: PhraseLocale = args.locale === 'en' ? 'en' : 'es';
  const fillers = Array.isArray(args.fillers)
    ? args.fillers.filter((x): x is string => typeof x === 'string')
    : undefined;
  const exclusions = Array.isArray(args.exclusions)
    ? args.exclusions.filter((x): x is string => typeof x === 'string')
    : undefined;
  const writings = await db.writings.where('projectId').equals(projectId).toArray();
  const report = buildPhraseRecurrence({
    locale,
    writings: writings.map((w) => ({ id: w.id, content: w.content })),
    fillers,
    exclusions,
  });
  return {
    projectId,
    ...report,
    hint: 'Marks recurrence only; does not rewrite prose. Distinct from wh_build_world_bible.',
  };
}
