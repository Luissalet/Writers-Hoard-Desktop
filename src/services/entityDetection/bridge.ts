import { db } from '@/db';
import type { CodexEntry, CodexEntryType } from '@/types';
import { assertWorldEra, listEraRows } from '@/services/worldEras/store';
import { optString, requireString, resolveProjectForEngine, withAudit, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { createEntityCandidate, entityPreferences, newEntityCandidates, updateEntityDetectionPreferences } from './service';
import type { EntityDetectionPreferences, EntitySpan } from './types';
function api() { const value = window.electronAPI?.entityDetection; if (!value) throw Error('entity_detection_desktop_required'); return value; }
async function scopeFor(args: ToolArgs) { const scope = { projectId: await resolveProjectForEngine(args, 'codex'), eraId: optString(args, 'eraId') }; await assertWorldEra(scope); return scope; }
export const ENTITY_DETECTION_HANDLERS = {
  wh_entity_detection_status: () => api().status(),
  wh_entity_detection_prepare: () => api().prepare(),
  async wh_entity_preferences(args: ToolArgs) { const scope = await scopeFor(args); return { projectId: scope.projectId, scope: 'shared-project', preferences: entityPreferences((await db.projects.get(scope.projectId))!) }; },
  async wh_entity_preferences_save(args: ToolArgs) {
    const scope = await scopeFor(args), patch: Partial<Omit<EntityDetectionPreferences, 'revision'>> = {};
    for (const key of ['detectNewEntities', 'autoLinkMentions', 'animateNewLinks'] as const) if (args[key] !== undefined) { if (typeof args[key] !== 'boolean') throw Error('entity_preferences_invalid'); patch[key] = args[key]; }
    if (!Object.keys(patch).length || !Number.isSafeInteger(args.expectedRevision)) throw Error('entity_preferences_invalid');
    return { projectId: scope.projectId, scope: 'shared-project', preferences: await updateEntityDetectionPreferences(scope.projectId, patch, args.expectedRevision as number) };
  },
  async wh_entity_detect(args: ToolArgs) {
    const scope = await scopeFor(args), text = requireString(args, 'text'), spans = await api().detect(text);
    // Resolve current names after inference: a card created while the worker ran is already known.
    await assertWorldEra(scope);
    const entries = scope.eraId ? await listEraRows<CodexEntry>(scope, 'codexEntries') : await db.codexEntries.where('projectId').equals(scope.projectId).toArray();
    return { ...scope, candidates: newEntityCandidates(text, spans, entries) };
  },
  async wh_entity_candidate_create(args: ToolArgs) {
    const scope = await scopeFor(args), entry = await createEntityCandidate({ ...scope, text: requireString(args, 'text'), candidate: args.candidate as EntitySpan, type: requireString(args, 'type') as CodexEntryType });
    return withAudit({ id: entry.id, title: entry.title, type: entry.type, created: true }, { projectId: scope.projectId, entityId: entry.id, table: 'codexEntries', kind: 'create', summary: `created ${entry.type} "${entry.title}" from an entity candidate` });
  },
};
