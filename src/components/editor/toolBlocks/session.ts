import { createLocalDraftStore } from '@/hooks/localDraftStore';
import { sheetDraftStore } from '@/engines/character-sheets/drafts';
import { saveSheet } from '@/engines/character-sheets/operations';
import { radarDraftStore } from '@/engines/radar/operations';
import { saveRadarChart } from '@/engines/radar/operations';
import { dictionaryDrafts } from '@/engines/dictionary/drafts';
import { saveDictionary,saveWord } from '@/engines/dictionary/operations';
import type { DictionaryWord,WorldDictionary } from '@/engines/dictionary/types';
import { saveRelationTree } from '@/engines/genealogy/relationTreeStore';
import type { RelationTreeDocument } from '@/engines/genealogy/relationTrees';
import { flushPendingWrites } from '@/services/pendingWrites';
import type { ToolDocumentTarget } from './model';

/** Explicit-save tools retain their own CAS journals. A modal close commits
 * those journals with the same APIs as their Save button; it never writes a
 * stale Project snapshot. A rejection keeps both source and recovery open. */
export function createToolDocumentSession(target:ToolDocumentTarget, eraId?: string) {
  const {projectId,kind,documentId}=target;
  const sheets=sheetDraftStore(projectId, eraId),radars=radarDraftStore(projectId, eraId),words=dictionaryDrafts(projectId, eraId);
  const trees=createLocalDraftStore<{tree:RelationTreeDocument;baseRevision:number;dirty:boolean}>(`wh.relation-trees.v1.${projectId}${eraId ? `.era:${eraId}` : ''}`,(value):value is {tree:RelationTreeDocument;baseRevision:number;dirty:boolean}=>!!value&&typeof value==='object'&&'tree'in value&&'baseRevision'in value);
  const baseline = new Map<string,string>();
  const journals = () => kind==='character-sheets'?sheets:kind==='radar'?radars:kind==='dictionary'?words:kind==='relation-tree'?trees:null;
  journals()?.forEach((value,key)=>baseline.set(key,JSON.stringify(value)));
  return { async flush():Promise<boolean> {
    const pending=await flushPendingWrites(); if(!pending.ok)return false;
    try {
      const journal=journals();if(!journal)return true;
      for(const [id,value]of [...journal]) {
        const belongs=id===documentId||kind==='dictionary'&&('dictionaryId'in value?value.dictionaryId===documentId:'value'in value&&value.value.id===documentId);
        if(!belongs&&baseline.get(id)===JSON.stringify(value))continue;
        // Skip clean pre-existing journals for other documents in this project.
        if(kind==='character-sheets') {const draft=sheets.get(id)!;await saveSheet(projectId,draft.sheet,draft.base,eraId);}
        if(kind==='radar') {const draft=radars.get(id)!;await saveRadarChart(projectId,draft.chart,draft.base,eraId);}
        if(kind==='relation-tree') {const draft=trees.get(id)!;if(draft.dirty)await saveRelationTree(projectId,draft.tree,draft.baseRevision,eraId);}
        if(kind==='dictionary') {const draft=words.get(id)!;if(draft.kind==='language')await saveDictionary(projectId,draft.value as WorldDictionary,draft.existing?draft.base as WorldDictionary:undefined,eraId);else await saveWord(projectId,draft.dictionaryId!,draft.value as DictionaryWord,draft.existing?draft.base as DictionaryWord:undefined,eraId);}
        // Preserve a concurrently replaced journal rather than clearing it.
        if(journal.get(id)!==value) return false;
        journal.delete(id);
      }
      return (await flushPendingWrites()).ok;
    } catch {return false;}
  }};
}
