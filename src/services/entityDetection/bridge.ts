import { db } from '@/db';
import type { CodexEntry, CodexEntryType } from '@/types';
import { assertWorldEra, listEraRows } from '@/services/worldEras/store';
import { optString, requireString, resolveProjectForEngine, withAudit, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { actOnEntityCandidateDismissal, getEntityCandidateDismissals, createEntityCandidate, entityPreferences, newEntityCandidates, updateEntityDetectionPreferences, type EntityCandidateDismissalAction } from './service';
import { candidateKey, validateEntityCandidateContext } from './dismissalTypes';
import type { EntityDetectionPreferences, EntitySpan } from './types';
import { getEntityDetectionAPI as api } from './api';
function jobOptions(args: ToolArgs) {
  if (args.jobId !== undefined && (typeof args.jobId !== 'string' || !args.jobId.trim())) throw Error('entity_job_id_invalid');
  return { jobId: optString(args, 'jobId') };
}
async function scopeFor(args: ToolArgs) { const scope = { projectId: await resolveProjectForEngine(args, 'codex'), eraId: optString(args, 'eraId') }; await assertWorldEra(scope); return scope; }
function dismissalScope(args: ToolArgs) { return { projectId: requireString(args, 'projectId'), eraId: optString(args, 'eraId') }; }
export const ENTITY_DETECTION_HANDLERS = {
  wh_entity_detection_status: () => api().status(),
  wh_entity_detection_prepare: (args: ToolArgs = {}) => api().prepare(jobOptions(args)),
  async wh_entity_detection_cancel(args: ToolArgs) {
    const port = api(), jobId = requireString(args, 'jobId');
    return port.cancel ? port.cancel(jobId) : { supported: false, cancelled: false };
  },
  async wh_entity_preferences(args: ToolArgs) { const scope = await scopeFor(args); return { projectId: scope.projectId, scope: 'shared-project', preferences: entityPreferences((await db.projects.get(scope.projectId))!) }; },
  async wh_entity_preferences_save(args: ToolArgs) {
    const scope = await scopeFor(args), patch: Partial<Omit<EntityDetectionPreferences, 'revision'>> = {};
    for (const key of ['detectNewEntities', 'autoLinkMentions', 'animateNewLinks'] as const) if (args[key] !== undefined) { if (typeof args[key] !== 'boolean') throw Error('entity_preferences_invalid'); patch[key] = args[key]; }
    if (!Object.keys(patch).length || !Number.isSafeInteger(args.expectedRevision)) throw Error('entity_preferences_invalid');
    return { projectId: scope.projectId, scope: 'shared-project', preferences: await updateEntityDetectionPreferences(scope.projectId, patch, args.expectedRevision as number) };
  },
  async wh_entity_detect(args: ToolArgs) {
    const scope = await scopeFor(args), text = requireString(args, 'text'), spans = await api().detect(text, jobOptions(args));
    // Resolve current names after inference: a card created while the worker ran is already known.
    await assertWorldEra(scope);
    const entries = scope.eraId ? await listEraRows<CodexEntry>(scope, 'codexEntries') : await db.codexEntries.where('projectId').equals(scope.projectId).toArray();
    const candidates = newEntityCandidates(text, spans, entries);
    if (args.context === undefined) return { ...scope, candidates };
    validateEntityCandidateContext(args.context);
    const state = await getEntityCandidateDismissals({ ...scope, context: args.context });
    return { ...scope, context: state.context, lifetime: state.lifetime, dismissalRevision: state.revision, candidates: candidates.filter(row => !state.decisions.some(decision => decision.discarded && decision.key === candidateKey(row.text))) };
  },
  async wh_entity_candidate_dismissals(args: ToolArgs) {
    requireString(args, 'projectId'); validateEntityCandidateContext(args.context);
    return getEntityCandidateDismissals({ ...dismissalScope(args), context: args.context });
  },
  async wh_entity_candidate_dismissal_action(args: ToolArgs) {
    requireString(args, 'projectId'); validateEntityCandidateContext(args.context);
    const action = requireString(args, 'action'); let input: EntityCandidateDismissalAction;
    const reject = (fields: string[]) => { if (fields.some(key => args[key] !== undefined)) throw Error('entity_candidate_dismissal_action_invalid'); };
    if (action === 'undo') { reject(['text', 'candidate', 'key', 'expectedVersion']); input = { action, receiptId: requireString(args, 'receiptId') }; }
    else {
      if (typeof args.expectedVersion !== 'string') throw Error('entity_candidate_dismissal_version_required');
      if (action === 'dismiss') { reject(['key', 'receiptId']); input = { action, text: requireString(args, 'text'), candidate: args.candidate as EntitySpan, expectedVersion: args.expectedVersion }; }
      else if (action === 'restore') { reject(['text', 'candidate', 'receiptId']); input = { action, key: requireString(args, 'key'), expectedVersion: args.expectedVersion }; }
      else throw Error('entity_candidate_dismissal_action_invalid');
    }
    return actOnEntityCandidateDismissal({ ...dismissalScope(args), context: args.context }, input);
  },
  async wh_entity_candidate_create(args: ToolArgs) {
    const scope = await scopeFor(args), entry = await createEntityCandidate({ ...scope, text: requireString(args, 'text'), candidate: args.candidate as EntitySpan, type: requireString(args, 'type') as CodexEntryType });
    return withAudit({ id: entry.id, title: entry.title, type: entry.type, created: true }, { projectId: scope.projectId, entityId: entry.id, table: 'codexEntries', kind: 'create', summary: `created ${entry.type} "${entry.title}" from an entity candidate` });
  },
};
