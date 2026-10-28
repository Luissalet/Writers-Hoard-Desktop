/** Ephemeral Source membership and selected saved fields. No DB, React or app registry. */
import {
  evaluateLocalToolIndex,
  validateLocalToolIndexSpec,
  type LocalToolIndexField,
  type LocalToolIndexPrimitive,
} from './documentIndex';
import {cloneLocalToolJson, localToolNamespace, type LocalToolJson} from './stateTypes';

export interface LocalToolOpenDocumentScope {
  readonly projectId: string;
  readonly eraId?: string;
}
export interface LocalToolOpenDocumentQuery {
  readonly namespace?: string;
  readonly fields: Readonly<Record<string, LocalToolIndexField>>;
}
export interface LocalToolOpenDocumentRow {
  readonly id: string;
  readonly namespace: string;
  readonly title: string;
  readonly provenance: 'base' | 'variant';
  readonly fields: Readonly<Record<string, LocalToolIndexPrimitive | readonly LocalToolIndexPrimitive[]>>;
}
export interface LocalToolOpenDocuments {
  query(input: LocalToolOpenDocumentQuery): Promise<readonly LocalToolOpenDocumentRow[]>;
  subscribe(changed: () => void): () => void;
}
/** Structural subset of SourceToolRead, so production and explicit memory fixtures share the projector. */
export interface LocalToolOpenDocumentRead {
  readonly document: {readonly id: string; readonly namespace: string; readonly title: string; readonly data: LocalToolJson};
  readonly provenance: 'base' | 'variant';
}
export type LocalToolOpenDocumentReader = (
  scope: LocalToolOpenDocumentScope,
  documentId: string,
  namespace: string,
) => Promise<LocalToolOpenDocumentRead | undefined>;

const captureBrand: unique symbol = Symbol('local-tool-open-document-capture');
/** Host-only opaque handle. It contains neither saved data nor a reusable producer lease. */
export interface LocalToolOpenDocumentCapture {readonly [captureBrand]: true}
interface Member {
  readonly scope: LocalToolOpenDocumentScope;
  readonly scopeKey: string;
  readonly documentId: string;
  readonly namespace: string;
}
interface CapturedDocument {
  readonly documentId: string;
  readonly namespace: string;
  readonly tokens: readonly symbol[];
}
interface CapturedState {
  readonly scope: LocalToolOpenDocumentScope;
  readonly documents: readonly CapturedDocument[];
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function scopeCopy(scope: LocalToolOpenDocumentScope): LocalToolOpenDocumentScope {
  if (!scope || typeof scope.projectId !== 'string' || !scope.projectId ||
      scope.eraId !== undefined && (typeof scope.eraId !== 'string' || !scope.eraId)) {
    throw Error('local_tool_open_document_scope_invalid');
  }
  return Object.freeze(scope.eraId === undefined ? {projectId: scope.projectId} : {projectId: scope.projectId, eraId: scope.eraId});
}
const scopeKey = (scope: LocalToolOpenDocumentScope) => JSON.stringify([scope.projectId, scope.eraId ?? null]);
const documentKey = (documentId: string, namespace: string) => JSON.stringify([documentId, namespace]);

function queryRecordDescriptors(value: unknown): PropertyDescriptorMap | undefined {
  if (!object(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  return Object.getOwnPropertyDescriptors(value);
}
function queryDataDescriptor(properties: PropertyDescriptorMap, key: string): PropertyDescriptor | undefined {
  const descriptor = Object.hasOwn(properties, key) ? properties[key] : undefined;
  return descriptor && 'value' in descriptor && descriptor.enumerable ? descriptor : undefined;
}
/** Only the two TypeScript optional properties can omit an explicit undefined.
 * Descriptors preserve all other invalid input for the incumbent strict JSON validator.
 * No accessors are read, caller properties are not assigned/deleted, and frozen input is valid.
 */
export function normalizeLocalToolOpenDocumentQuery(value: unknown): LocalToolOpenDocumentQuery {
  const root = queryRecordDescriptors(value);
  let candidate = value;
  if (root) {
    const namespace = queryDataDescriptor(root, 'namespace');
    if (namespace && namespace.value === undefined) delete root.namespace;
    const fieldsProperty = queryDataDescriptor(root, 'fields');
    const fields = fieldsProperty && queryRecordDescriptors(fieldsProperty.value);
    if (fields && fieldsProperty) {
      // Symbols remain in the descriptor map and will be rejected by cloneLocalToolJson.
      for (const alias of Object.keys(fields)) {
        const fieldProperty = queryDataDescriptor(fields, alias);
        const field = fieldProperty && queryRecordDescriptors(fieldProperty.value);
        if (!field || !fieldProperty) continue;
        const mode = queryDataDescriptor(field, 'mode');
        if (mode && mode.value === undefined) delete field.mode;
        fieldProperty.value = Object.create(null, field);
      }
      fieldsProperty.value = Object.create(null, fields);
    }
    candidate = Object.create(null, root);
  }
  const query = cloneLocalToolJson(candidate as LocalToolJson, Infinity);
  if (!object(query) || !Object.hasOwn(query, 'fields') ||
      Object.keys(query).some(key => !['namespace', 'fields'].includes(key)) ||
      query.namespace !== undefined && !localToolNamespace(query.namespace)) {
    throw Error('local_tool_open_document_query_invalid');
  }
  // The existing path/type/mode/alias/selector-budget validator is unchanged.
  validateLocalToolIndexSpec({version: 1, fields: query.fields});
  return query as unknown as LocalToolOpenDocumentQuery;
}
export function validateLocalToolOpenDocumentQuery(value: unknown): asserts value is LocalToolOpenDocumentQuery {
  normalizeLocalToolOpenDocumentQuery(value);
}
function queryCopy(query: LocalToolOpenDocumentQuery): LocalToolOpenDocumentQuery {
  return normalizeLocalToolOpenDocumentQuery(query);
}
function rowCopy(read: LocalToolOpenDocumentRead, query: LocalToolOpenDocumentQuery): LocalToolOpenDocumentRow {
  const projected = evaluateLocalToolIndex({version: 1, fields: query.fields}, read.document.data);
  const row = cloneLocalToolJson({
    id: read.document.id,
    namespace: read.document.namespace,
    title: read.document.title,
    provenance: read.provenance,
    fields: projected.fields,
  }, Infinity);
  for (const value of Object.values(row.fields)) if (Array.isArray(value)) Object.freeze(value);
  Object.freeze(row.fields);
  return Object.freeze(row);
}

/** One factory per actual host environment; no process-wide producer singleton is created here. */
export function createLocalToolOpenDocumentRegistry() {
  const members = new Map<symbol, Member>();
  const listeners = new Map<string, Set<() => void>>();
  const captures = new WeakMap<LocalToolOpenDocumentCapture, CapturedState>();
  function changed(key: string) {
    const scoped = listeners.get(key);
    // Notify after the lease/cleanup has returned. One observer cannot strand another producer's lease.
    for (const listener of scoped ?? []) queueMicrotask(() => {
      if (listeners.get(key) === scoped && scoped?.has(listener)) listener();
    });
  }
  function captured(handle: LocalToolOpenDocumentCapture): CapturedState {
    const state = captures.get(handle);
    if (!state) throw Error('local_tool_open_document_capture_invalid');
    return state;
  }
  const live = (document: CapturedDocument) => document.tokens.some(token => members.has(token));
  function revalidateCaptured(handle: LocalToolOpenDocumentCapture, rows: readonly LocalToolOpenDocumentRow[]): readonly LocalToolOpenDocumentRow[] {
    const state = captured(handle);
    const retained = rows.filter(row => state.documents.some(document =>
      document.documentId === row.id && document.namespace === row.namespace && live(document)));
    return Object.freeze(retained);
  }
  return Object.freeze({
    register(scope: LocalToolOpenDocumentScope, documentId: string, namespace: string): () => void {
      const ownScope = scopeCopy(scope);
      if (typeof documentId !== 'string' || !documentId || !localToolNamespace(namespace)) {
        throw Error('local_tool_open_document_identity_invalid');
      }
      const token = Symbol('local-tool-open-document-member');
      const key = scopeKey(ownScope);
      members.set(token, Object.freeze({scope: ownScope, scopeKey: key, documentId, namespace}));
      changed(key);
      // A removed Symbol is never inserted again; reopening creates another token.
      return () => {if (members.delete(token)) changed(key);};
    },
    subscribe(scope: LocalToolOpenDocumentScope, listener: () => void): () => void {
      const key = scopeKey(scopeCopy(scope));
      const scoped = listeners.get(key) ?? new Set<() => void>();
      // Distinct subscriptions remain independent even when they use the same callback.
      const own = () => listener();
      scoped.add(own);
      listeners.set(key, scoped);
      return () => {scoped.delete(own); if (!scoped.size && listeners.get(key) === scoped) listeners.delete(key);};
    },
    /** Call synchronously at public entry, before project/era validation or any other await. */
    capture(scope: LocalToolOpenDocumentScope, namespace?: string): LocalToolOpenDocumentCapture {
      const ownScope = scopeCopy(scope), key = scopeKey(ownScope);
      if (namespace !== undefined && !localToolNamespace(namespace)) throw Error('local_tool_open_document_query_invalid');
      const groups = new Map<string, {documentId: string; namespace: string; tokens: symbol[]}>();
      for (const [token, member] of members) if (member.scopeKey === key && (namespace === undefined || member.namespace === namespace)) {
        const id = documentKey(member.documentId, member.namespace);
        const group = groups.get(id) ?? {documentId: member.documentId, namespace: member.namespace, tokens: []};
        group.tokens.push(token);
        groups.set(id, group);
      }
      const handle = Object.freeze({[captureBrand]: true as const});
      const documents = Object.freeze([...groups.values()].map(group => Object.freeze({...group, tokens: Object.freeze(group.tokens)})));
      captures.set(handle, Object.freeze({scope: ownScope, documents}));
      return handle;
    },
    /** Reads every document from the original capture; no post-await membership resnapshot. */
    async projectCaptured(handle: LocalToolOpenDocumentCapture, input: LocalToolOpenDocumentQuery, reader: LocalToolOpenDocumentReader): Promise<readonly LocalToolOpenDocumentRow[]> {
      const state = captured(handle), query = queryCopy(input);
      const rows = await Promise.all(state.documents.filter(document =>
        query.namespace === undefined || document.namespace === query.namespace).map(async document => {
        const read = await reader(state.scope, document.documentId, document.namespace);
        if (!read || read.document.id !== document.documentId || read.document.namespace !== document.namespace) return undefined;
        return rowCopy(read, query);
      }));
      // Revalidate ALL rows together after the last reader has settled, including earlier fast rows.
      const projected = rows.filter((row): row is LocalToolOpenDocumentRow => row !== undefined);
      projected.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id) || a.namespace.localeCompare(b.namespace));
      return revalidateCaptured(handle, projected);
    },
    // Public adapters call this synchronously after their final await/current-context validation too.
    revalidateCaptured,
  });
}
export type LocalToolOpenDocumentRegistry = ReturnType<typeof createLocalToolOpenDocumentRegistry>;
