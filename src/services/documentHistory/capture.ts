import { historyCodexDefinitions } from './dependencies';
import type { Project } from '@/types';
import Dexie, { type DBCore, type DBCoreMutateRequest, type DBCoreTransaction } from 'dexie';
import type { EraDocument, EraDocumentKind, EraRow, WorldEraAsset } from '@/services/worldEras/types';
import { eraDocumentVersion } from '@/services/worldEras/adapters';
import { eraAdapters, eraAdapterForTable } from '@/services/worldEras/registry';
import { encodeHistoryAssets, type HistoryAssetAccess } from './assets';
import { historyCaptureSuppressed } from './context';
import { installHistoryMutationBoundary } from './middleware';
import type { DocumentHistoryEntry } from './types';
import { announceDocumentHistory } from './events';
const historyTable = 'documentHistory';
const childrenOf = (kind: EraDocumentKind) => kind === 'writings' ? {} : eraAdapters[kind].children ?? {};
const captured = new WeakMap<DBCoreTransaction, Set<string>>();
const assetLocks = new WeakMap<DBCoreTransaction, Map<string, Promise<string>>>();
const key = (projectId: string, kind: EraDocumentKind, entityId: string) => JSON.stringify([projectId, kind, entityId]);
const ignored = new Set(['updatedAt', 'revision']);
async function same(left: unknown, right: unknown): Promise<boolean> {
  const clean = (row: unknown) => row && typeof row === 'object' && !Array.isArray(row) ? Object.fromEntries(Object.entries(row).filter(([name]) => !ignored.has(name))) : row;
  return await eraDocumentVersion({ root: { id: 'compare', value: clean(left) }, children: {} }) === await eraDocumentVersion({ root: { id: 'compare', value: clean(right) }, children: {} });
}
const read = (core: DBCore, trans: DBCoreTransaction, table: string, id: string): Promise<EraRow | undefined> => core.table(table).get({ trans, key: id });
const query = async (core: DBCore, trans: DBCoreTransaction, name: string, field: string | string[], value: unknown): Promise<EraRow[]> => { const table = core.table(name); return (await table.query({ trans, values: true, query: { index: table.schema.getIndexByKeyPath(field)!, range: { type: 1, lower: value, upper: value } } })).result; };
async function aggregate(core: DBCore, trans: DBCoreTransaction, kind: EraDocumentKind, id: string, projectId?: string): Promise<EraDocument | undefined> {
  const adapter = eraAdapters[kind];
  const root = adapter.table ? await read(core, trans, adapter.table, id) : ((await read(core, trans, 'projects', projectId!))?.[adapter.metadata!] as EraRow[] | undefined)?.find(row => row.id === id);
  if (!root) return undefined;
  const children: Record<string, EraRow[]> = {};
  for (const [table, parent] of Object.entries(childrenOf(kind))) children[table] = await query(core, trans, table, parent, id);
  return { root, children };
}
function provisional(document: EraDocument | undefined): boolean { const memo = document?.root.voiceMemo as { recording?: { state?: string } } | undefined; return ['recording', 'paused', 'recovered'].includes(memo?.recording?.state ?? ''); }
async function prepare(name: string, request: DBCoreMutateRequest, core: DBCore) {
  if (historyCaptureSuppressed(request.trans)) return async () => {};
  const trans = request.trans, table = core.table(name), values: readonly EraRow[] = 'values' in request ? request.values : [];
  const oldRows: EraRow[] = request.type === 'deleteRange' ? (await table.query({ trans, values: true, query: { index: table.schema.primaryKey, range: request.range } })).result : await table.getMany({ trans, keys: request.keys ?? values.map(value => table.schema.primaryKey.extractKey!(value)) });
  const touched = captured.get(trans) ?? new Set<string>(); captured.set(trans, touched);
  const pending = new Map<string, { kind: EraDocumentKind; id: string; projectId: string; document?: EraDocument; codexPropertyDefinitions?: DocumentHistoryEntry['codexPropertyDefinitions']; operations: number[] }>();
  const consider = async (kind: EraDocumentKind, id: string, projectId: string, operation: number) => {
    const token = key(projectId, kind, id); if (touched.has(token) || historyCaptureSuppressed(trans, projectId, kind, id)) return;
    const current = pending.get(token); if (current) { current.operations.push(operation); return; }
    if(!projectId)return;const project=await read(core,trans,'projects',projectId);if(!project)return;
    const document = await aggregate(core, trans, kind, id, projectId);
    pending.set(token, { kind, id, projectId, document, codexPropertyDefinitions: document?historyCodexDefinitions(kind,document,project as unknown as Project):undefined, operations: [operation] });
  };
  for (let index = 0; index < Math.max(oldRows.length, values.length); index++) {
    const old = oldRows[index], next = values[index];
    if (name === 'projects') {
      const projectId = String(old?.id ?? next?.id ?? '');
      // Project creation/cleanup/import are lifecycle events, not document edits.
      if (!old || !next) continue;
      for (const [kind, adapter] of Object.entries(eraAdapters)) if (adapter.metadata) {
        if (request.type === 'put' && request.changeSpec && !Object.keys(request.changeSpec).some(field => field === adapter.metadata || field.startsWith(`${adapter.metadata}.`))) continue;
        const before = new Map(((old[adapter.metadata] ?? []) as EraRow[]).map(row => [row.id, row])), after = new Map(((next[adapter.metadata] ?? []) as EraRow[]).map(row => [row.id, row]));
        for (const id of new Set([...before.keys(), ...after.keys()])) if (!await same(before.get(id), after.get(id))) await consider(kind as EraDocumentKind, id, projectId, index);
      }
      continue;
    }
    const adapter = eraAdapterForTable(name); if (!adapter) continue;
    if (old && next && await same(old, next)) continue;
    if (adapter.kind === 'worldgen' && old && next && await same({ ...old, thumbnail: undefined }, { ...next, thumbnail: undefined })) continue;
    for (const row of [old, next].filter(Boolean)) {
      const id = String(adapter.parentField ? row[adapter.parentField] : row.id), root = await aggregate(core, trans, adapter.kind, id);
      const projectId = String(root?.root.projectId ?? row.projectId ?? '');
      if (adapter.kind === 'media' && (provisional(root) || provisional(next ? { root: next, children: {} } : undefined))) continue;
      await consider(adapter.kind, id, projectId, index);
    }
  }
  return async (response: Awaited<ReturnType<typeof table.mutate>>) => {
    for (const [token, candidate] of pending) {
      if (touched.has(token) || candidate.operations.every(index => !!response.failures[index])) continue;
      touched.add(token); const document = candidate.document; if (!document) continue;
      const pendingAssets = assetLocks.get(trans) ?? new Map<string,Promise<string>>(); assetLocks.set(trans,pendingAssets);
      const access: HistoryAssetAccess = {
        pending: pendingAssets,
        get: id => read(core, trans, 'worldEraAssets', id) as unknown as Promise<WorldEraAsset | undefined>,
        find: async (projectId, hash) => (await query(core, trans, 'worldEraAssets', ['projectId', 'sha256'], [projectId, hash]))[0] as unknown as WorldEraAsset | undefined,
        put: async asset => { const result = await core.table('worldEraAssets').mutate({ trans, type: 'put', values: [asset] }); if (result.numFailures) throw Error('history_asset_write_failed'); },
      };
      const version = await eraDocumentVersion(document), encoded = await encodeHistoryAssets(candidate.projectId, candidate.kind, document, access);
      const entry: DocumentHistoryEntry = { id: crypto.randomUUID(), projectId: candidate.projectId, kind: candidate.kind, entityId: candidate.id, title: String(document.root.title ?? document.root.name ?? document.root.text ?? candidate.id), createdAt: Date.now(), version, reason: 'edit', codexPropertyDefinitions:candidate.codexPropertyDefinitions, ...encoded };
      const result = await core.table(historyTable).mutate({ trans, type: 'add', values: [entry] }); if (result.numFailures) throw Error('history_write_failed');
      announceDocumentHistory(trans, candidate.projectId);
    }
  };
}
export function installDocumentHistory(database: Dexie): void {
  const trackedTables = new Set(['projects']);
  for (const [kind, adapter] of Object.entries(eraAdapters)) { if (adapter.table) trackedTables.add(adapter.table); for (const child of Object.keys(childrenOf(kind as EraDocumentKind))) trackedTables.add(child); }
  const stores = [...trackedTables, 'worldEraAssets', historyTable];
  installHistoryMutationBoundary(database, { stores, trackedTables, skip: historyCaptureSuppressed, capture: prepare });
}
