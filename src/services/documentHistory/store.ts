import { historyCodexDefinitions } from './dependencies';
import {renewToolDockGeneration,type ToolDockLayout} from '@/engines/writings/toolDock/types';
import Dexie from 'dexie';
import { announceDocumentHistory } from './events';
import { db } from '@/db';
import { eraAdapters, eraDocumentVersion, validateEraDocument } from '@/services/worldEras/adapters';
import { announceEraChange } from '@/services/worldEras/store';
import type { EraDocument, EraDocumentKind, EraRow } from '@/services/worldEras/types';
import { decodeHistoryAssets, encodeHistoryAssets, databaseHistoryAssets } from './assets';
import { suppressDocumentHistoryForDocument } from './context';
import { DocumentHistoryConflict, type DocumentHistoryEntry, type DocumentHistorySummary, type DocumentHistoryUndo } from './types';

/** Reads never open a broad transaction; binary hashes keep only a caller's existing transaction alive. */
export async function readHistoryPresent(projectId: string, kind: EraDocumentKind, entityId: string): Promise<{ document: EraDocument; version: string } | undefined> {
  const adapter = eraAdapters[kind]; if (!adapter) throw Error('document_history_kind_invalid');
  const project = await db.projects.get(projectId); if (!project) throw Error('project_missing');
  const root = adapter.table ? await db.table(adapter.table).get(entityId) as EraRow | undefined : ((project[adapter.metadata!] ?? []) as EraRow[]).find(row => row.id === entityId);
  if (!root || adapter.table && root.projectId !== projectId) return undefined;
  const children: Record<string, EraRow[]> = {};
  for (const [table, parent] of Object.entries(kind === 'writings' ? {} : adapter.children ?? {})) children[table] = await db.table(table).where(parent).equals(entityId).toArray();
  const document = { root, children }; return { document, version: await eraDocumentVersion(document) };
}
export async function listDocumentHistory(projectId: string, kind: EraDocumentKind, entityId: string): Promise<DocumentHistorySummary[]> {
  if (!eraAdapters[kind] || !await db.projects.get(projectId)) throw Error('document_history_scope_invalid');
  const result: DocumentHistorySummary[] = [];
  await db.documentHistory.where('[projectId+kind+entityId]').equals([projectId, kind, entityId]).each(row => { const { document: _document, assetIds: _assets, codexPropertyDefinitions: _definitions, ...summary } = row; void _document; void _assets; void _definitions; result.push(summary); });
  return result.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}
export async function getDocumentHistory(projectId: string, kind: EraDocumentKind, entityId: string, historyId: string): Promise<DocumentHistoryEntry> {
  const row = await db.documentHistory.get(historyId);
  if (!row || row.projectId !== projectId || row.kind !== kind || row.entityId !== entityId || !await db.projects.get(projectId)) throw Error('document_history_missing');
  return { ...row, document: await decodeHistoryAssets(projectId, row.document) };
}
async function retain(projectId: string, kind: EraDocumentKind, document: EraDocument, reason: DocumentHistoryEntry['reason']): Promise<DocumentHistoryEntry> {
  const row: DocumentHistoryEntry = { id: crypto.randomUUID(), projectId, kind, entityId: document.root.id, title: String(document.root.title ?? document.root.name ?? document.root.text ?? document.root.id), createdAt: Date.now(), version: await eraDocumentVersion(document), reason, codexPropertyDefinitions:historyCodexDefinitions(kind,document,(await db.projects.get(projectId))!), ...await encodeHistoryAssets(projectId, kind, document, databaseHistoryAssets) };
  await db.documentHistory.add(row); announceDocumentHistory(Dexie.currentTransaction!.idbtrans, projectId); return row;
}
export async function saveDocumentHistory(projectId: string, kind: EraDocumentKind, entityId: string, expectedVersion: string): Promise<DocumentHistorySummary> {
  return db.transaction('rw', db.tables, async () => {
    const current = await readHistoryPresent(projectId, kind, entityId); if (!current || current.version !== expectedVersion) throw new DocumentHistoryConflict();
    const { document: _document, assetIds: _assets, codexPropertyDefinitions: _definitions, ...summary } = await retain(projectId, kind, current.document, 'manual'); void _document; void _assets; void _definitions; return summary;
  });
}
export async function restoreDocumentHistory(projectId: string, kind: EraDocumentKind, entityId: string, historyId: string, expectedVersion: string | null): Promise<{ version: string; undo?: DocumentHistoryUndo }> {
  const result = await db.transaction('rw', db.tables, async () => {
    const current = await readHistoryPresent(projectId, kind, entityId); if ((current?.version ?? null) !== expectedVersion) throw new DocumentHistoryConflict();
    const selected = await getDocumentHistory(projectId, kind, entityId, historyId), document = structuredClone(selected.document);
    validateEraDocument(projectId, kind, entityId, document);
    if(kind==='codex' && !document.root.propertyDefinitions && selected.codexPropertyDefinitions && !(await db.projects.get(projectId))?.codexTemplates?.some(template=>template.id===document.root.templateId))document.root.propertyDefinitions=structuredClone(selected.codexPropertyDefinitions);
    // Writing snapshots are immutable recovery records, never part of this rewind.
    if (kind === 'writings') document.children = {};
    const displaced = current ? await retain(projectId, kind, current.document, 'pre-restore') : undefined;
    suppressDocumentHistoryForDocument(projectId, kind, entityId);
    const adapter = eraAdapters[kind], now = Math.max(Date.now(), Number(current?.document.root.updatedAt ?? 0) + 1);
    if(kind==='local-tool')document.root.generation=crypto.randomUUID();
    if(kind==='writings'&&document.root.toolDock)document.root.toolDock=renewToolDockGeneration(document.root.toolDock as ToolDockLayout,crypto.randomUUID());
    if ('updatedAt' in document.root) document.root.updatedAt = now;
    if ('revision' in document.root) document.root.revision = Number(current?.document.root.revision ?? 0) + 1;
    if (adapter.metadata) {
      const project = (await db.projects.get(projectId))!, rows = (project[adapter.metadata] ?? []) as EraRow[];
      await db.projects.update(projectId, target => { Object.assign(target, { [adapter.metadata!]: rows.some(row => row.id === entityId) ? rows.map(row => row.id === entityId ? document.root : row) : [...rows, document.root], updatedAt: Math.max(now, project.updatedAt + 1) }); });
    } else {
      const occupiedRoot = await db.table(adapter.table!).get(entityId); if (occupiedRoot && occupiedRoot.projectId !== projectId) throw Error('document_history_root_identity_conflict');
      // A child ID occupied by another document must never be stolen by restore.
      for (const [table, parent] of Object.entries(kind === 'writings' ? {} : adapter.children ?? {})) {
        const children = document.children[table] ?? [];
        for (const row of children) { const occupied = await db.table(table).get(row.id); if (occupied && occupied[parent] !== entityId) throw Error('document_history_child_identity_conflict'); }
        await db.table(table).where(parent).equals(entityId).delete(); if (children.length) await db.table(table).bulkPut(children);
      }
      await db.table(adapter.table!).put(document.root);
    }
    const version = (await readHistoryPresent(projectId, kind, entityId))!.version;
    return { version, undo: { projectId, kind, entityId, historyId: displaced?.id ?? null, expectedVersion: version } };
  });
  announceEraChange(projectId, !!eraAdapters[kind].metadata); return result;
}
export async function undoDocumentHistory(receipt: DocumentHistoryUndo): Promise<{ version: string | null; undo?: DocumentHistoryUndo }> {
 if(receipt.historyId) return restoreDocumentHistory(receipt.projectId, receipt.kind, receipt.entityId, receipt.historyId, receipt.expectedVersion);
 const {projectId,kind,entityId}=receipt;
 await db.transaction('rw',db.tables,async()=>{
  const current=await readHistoryPresent(projectId,kind,entityId);if(!current || current.version!==receipt.expectedVersion)throw new DocumentHistoryConflict();
  await retain(projectId,kind,current.document,'pre-restore');suppressDocumentHistoryForDocument(projectId,kind,entityId);
  const adapter=eraAdapters[kind];
  if(adapter.metadata)await db.projects.update(projectId,project=>{Object.assign(project,{[adapter.metadata!]:((project[adapter.metadata!]??[]) as EraRow[]).filter(row=>row.id!==entityId),updatedAt:Math.max(Date.now(),project.updatedAt+1)});});
  else {for(const [table,parent]of Object.entries(kind==='writings'?{}:adapter.children??{}))await db.table(table).where(parent).equals(entityId).delete();await db.table(adapter.table!).delete(entityId);}
 });announceEraChange(projectId,!!eraAdapters[kind].metadata);return{version:null};
}

export async function listProjectHistoryDocuments(projectId: string): Promise<{kind:EraDocumentKind;entityId:string;title:string;versions:number;updatedAt:number}[]> {
 if(!await db.projects.get(projectId))throw Error('project_missing');
 const documents=new Map<string,{kind:EraDocumentKind;entityId:string;title:string;versions:number;updatedAt:number}>();
 await db.documentHistory.where('projectId').equals(projectId).each(row=>{const key=JSON.stringify([row.kind,row.entityId]),current=documents.get(key);documents.set(key,{kind:row.kind,entityId:row.entityId,title:current && current.updatedAt>row.createdAt?current.title:row.title,versions:(current?.versions??0)+1,updatedAt:Math.max(current?.updatedAt??0,row.createdAt)});});
 return [...documents.values()].sort((a,b)=>b.updatedAt-a.updatedAt || a.title.localeCompare(b.title));
}
