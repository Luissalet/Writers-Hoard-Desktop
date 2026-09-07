// ============================================================================
// AI bridge tools — Judge's scoped, citation-first review surface
// ============================================================================

import { db } from '@/db';
import {
  listJudgeFindings,
  listJudgeRuns,
  listProjectReferenceLinks,
  retrieveAuthorizedLensEvidence,
  runJudge,
  type JudgeContextPermissions,
  type JudgeMode,
  type JudgeSourceMode,
} from '@/services/judge';
import {
  assertEngineEnabled,
  assertRowInScope,
  BridgeError,
  optBoolean,
  optEnum,
  optNumber,
  optString,
  optStringArray,
  requireString,
  resolveProjectId,
  withAudit,
  type ToolArgs,
} from './shared';

const MODES = ['judge', 'questions', 'reader', 'story-state'] as const satisfies readonly JudgeMode[];
const SOURCE_MODES = ['reference', 'continuity', 'both'] as const satisfies readonly JudgeSourceMode[];

function bridgeJudgeError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('judge-remote-consent-required')) {
    throw new BridgeError(
      'consent-required',
      'The configured Judge route is remote and this project has not granted a remote-text policy. Ask the user to approve it in the app; an external agent cannot grant that consent.',
    );
  }
  if (message.includes('reference-lens-not-authorized')) {
    throw new BridgeError('policy', 'That lens is not active for this project.');
  }
  throw error;
}

export async function whListJudgeLenses(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const includeInactive = optBoolean(args, 'includeInactive') ?? false;
  const links = await listProjectReferenceLinks(projectId);
  return {
    projectId,
    lenses: links
      .filter(link => includeInactive || link.active)
      .map(link => ({
        lensId: link.lensId,
        name: link.lensName,
        documentId: link.documentId,
        documentName: link.documentName,
        documentHash: link.documentHash,
        documentVersion: link.documentVersion,
        status: link.status,
        active: link.active,
        selectedSections: link.sectionIds.length,
        approvedCriteria: link.criteria.filter(criterion => criterion.approved).map(criterion => criterion.text),
      })),
  };
}

export async function whGetJudgeEvidence(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const lensId = requireString(args, 'lensId');
  const query = requireString(args, 'query');
  try {
    const evidence = await retrieveAuthorizedLensEvidence(
      projectId,
      lensId,
      query,
      optNumber(args, 'limit') ?? 6,
    );
    return {
      projectId,
      lensId,
      evidence,
      notice: 'Only locally ranked, project-authorized fragments are returned. The original path and unselected sections are not exposed.',
    };
  } catch (error) {
    bridgeJudgeError(error);
  }
}

export async function whRunJudge(args: ToolArgs): Promise<unknown> {
  const writingId = requireString(args, 'writingId');
  const writing = await db.writings.get(writingId);
  if (!writing) throw new BridgeError('not-found', `No writing with id "${writingId}".`);
  await assertEngineEnabled(writing.projectId, 'writings');
  assertRowInScope(args, writing.projectId);
  const expectedUpdatedAt = optNumber(args, 'expectedUpdatedAt');
  if (expectedUpdatedAt !== undefined && writing.updatedAt !== expectedUpdatedAt) {
    throw new BridgeError(
      'conflict',
      `The writing moved from revision ${expectedUpdatedAt} to ${writing.updatedAt}. Read it again before requesting a review.`,
    );
  }
  const mode = optEnum(args, 'mode', MODES) ?? 'judge';
  const sourceMode = optEnum(args, 'sourceMode', SOURCE_MODES) ?? 'both';
  const lensIds = optStringArray(args, 'lensIds') ?? [];
  const links = await listProjectReferenceLinks(writing.projectId);
  const authorized = new Set(links.filter(link => link.active && link.status === 'ready').map(link => link.lensId));
  const unauthorized = lensIds.filter(id => !authorized.has(id));
  if (unauthorized.length) throw new BridgeError('policy', `Lens ids are not active for this project: ${unauthorized.join(', ')}`);
  const context: JudgeContextPermissions = {
    previousWritings: optBoolean(args, 'previousWritings') ?? true,
    selectedWritingIds: optStringArray(args, 'selectedWritingIds') ?? [],
    codex: optBoolean(args, 'codex') ?? false,
    outline: optBoolean(args, 'outline') ?? false,
    timeline: optBoolean(args, 'timeline') ?? false,
  };
  // Reader's future exclusion is enforced again inside runJudge before any
  // retrieval. An external caller cannot weaken it with selectedWritingIds.
  try {
    const result = await runJudge({
      projectId: writing.projectId,
      writing,
      currentContent: writing.content,
      mode,
      scope: 'chapter',
      sourceMode,
      lensIds,
      context,
      outputLanguage: optString(args, 'language'),
      allowRemote: false,
    });
    return withAudit(
      {
        runId: result.run.id,
        writingId,
        writingRevision: writing.updatedAt,
        mode,
        findings: result.findings,
        invalidFindingsRejected: result.invalidFindings,
        payloadReceipt: result.run.payload,
      },
      {
        projectId: writing.projectId,
        entityId: writingId,
        summary: `ran grounded ${mode} review for "${writing.title}"`,
      },
    );
  } catch (error) {
    bridgeJudgeError(error);
  }
}

export async function whGetJudgeReview(args: ToolArgs): Promise<unknown> {
  const runId = requireString(args, 'runId');
  const run = await db.judgeRuns.get(runId);
  if (!run) throw new BridgeError('not-found', `No Judge review with id "${runId}".`);
  assertRowInScope(args, run.projectId);
  return { run, findings: await listJudgeFindings(runId) };
}

export async function whListJudgeReviews(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const writingId = optString(args, 'writingId');
  if (writingId) {
    const writing = await db.writings.get(writingId);
    if (!writing) throw new BridgeError('not-found', `No writing with id "${writingId}".`);
    assertRowInScope(args, writing.projectId);
    return { projectId, reviews: await listJudgeRuns(projectId, writingId) };
  }
  const reviews = await db.judgeRuns.where('projectId').equals(projectId).reverse().sortBy('createdAt');
  return { projectId, reviews };
}

