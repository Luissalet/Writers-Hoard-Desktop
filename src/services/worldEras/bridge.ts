import { db } from '@/db';
import { BridgeError, optString, requireString, resolveProjectId, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { hideEraDocument, listWorldDocuments, readWorldDocument, resetEraDocument, restoreEraVersion, saveEraDocument, saveWorldEra } from './store';
import { eraDocumentKinds, type EraDocument, type EraDocumentKind, type WorldEra, type WorldEraScope } from './types';
import { decodeEraValue, encodeEraValue } from './portability';
const scope = (args: ToolArgs): WorldEraScope => ({ projectId: resolveProjectId(args), eraId: optString(args, 'eraId') });
function kind(args: ToolArgs): EraDocumentKind { const value = requireString(args, 'kind'); if (!(eraDocumentKinds as readonly string[]).includes(value)) throw new BridgeError('bad-args', 'Unsupported document kind.'); return value as EraDocumentKind; }
function revision(args: ToolArgs, field = 'expectedRevision'): number { const value = args[field]; if (!Number.isSafeInteger(value) || Number(value) < 1) throw new BridgeError('bad-args', `${field} must be the current positive revision.`); return value as number; }
export const WORLD_ERA_HANDLERS = {
  async wh_world_era_list(args: ToolArgs) { const projectId = resolveProjectId(args), project = await db.projects.get(projectId); if (!project) throw new BridgeError('not-found', 'Project not found.'); return { projectId, eras: project.worldEras ?? [], base: { eraId: null, name: 'Shared base' } }; },
  async wh_world_era_save(args: ToolArgs) {
    const projectId = resolveProjectId(args); if (!args.era || typeof args.era !== 'object' || Array.isArray(args.era)) throw new BridgeError('bad-args', 'era is required.');
    const now = Date.now(), input = args.era as Partial<WorldEra>, era = { id: crypto.randomUUID(), name: '', description: '', revision: 0, createdAt: now, updatedAt: now, ...input };
    return { projectId, era: await saveWorldEra(projectId, era, args.expectedRevision === null ? null : revision(args)) };
  },
  async wh_world_era_documents(args: ToolArgs) { const target = scope(args), documentKind = kind(args); return { ...target, kind: documentKind, documents: (await listWorldDocuments(target, documentKind)).map(read => ({ entityId: read.document.root.id, title: read.document.root.title ?? read.document.root.name ?? read.document.root.text, provenance: read.provenance, version: read.version, variantRevision: read.variantRevision })) }; },
  async wh_world_era_document_get(args: ToolArgs) { const target = scope(args), documentKind = kind(args), entityId = requireString(args, 'entityId'), document = await readWorldDocument(target, documentKind, entityId); if (!document) throw new BridgeError('not-found', 'Document is absent in this era.'); return { ...target, kind: documentKind, ...document, document: await encodeEraValue(document.document) }; },
  async wh_world_era_document_save(args: ToolArgs) {
    const target = scope(args), documentKind = kind(args); if (!args.document || typeof args.document !== 'object' || Array.isArray(args.document)) throw new BridgeError('bad-args', 'document is required.');
    if (args.expectedVersion !== null && typeof args.expectedVersion !== 'string') throw new BridgeError('bad-args', 'Read expectedVersion before editing.');
    const saved = await saveEraDocument(target, documentKind, decodeEraValue(args.document) as EraDocument, args.expectedVersion as string | null);
    return { ...target, kind: documentKind, ...saved, document: await encodeEraValue(saved.document) };
  },
  async wh_world_era_document_hide(args: ToolArgs) { const target = scope(args); await hideEraDocument(target, kind(args), requireString(args, 'entityId'), requireString(args, 'expectedVersion')); return { ...target, hidden: true }; },
  async wh_world_era_document_reinherit(args: ToolArgs) { const target = scope(args); await resetEraDocument(target, kind(args), requireString(args, 'entityId'), revision(args)); return { ...target, inherited: true }; },
  async wh_world_era_versions(args: ToolArgs) { const target = scope(args); if (!target.eraId) throw new BridgeError('bad-args', 'eraId is required.'); return { ...target, variants: (await db.worldEraVariants.where('[projectId+eraId]').equals([target.projectId, target.eraId]).toArray()).map(row => ({ ...row, document: undefined, title: row.document?.root.title ?? row.document?.root.name, history: row.history?.map(({ revision, updatedAt, hidden, archived }) => ({ revision, updatedAt, hidden, archived })) })) }; },
  async wh_world_era_document_restore(args: ToolArgs) { const target = scope(args); await restoreEraVersion(target, kind(args), requireString(args, 'entityId'), revision(args), revision(args, 'sourceRevision')); return { ...target, restored: true }; },
};
