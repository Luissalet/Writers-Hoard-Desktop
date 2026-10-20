import { db } from '@/db';
import { archiveMetadataWithMutation } from '@/services/documentArchive/metadata';
import { notifyProjectsChanged } from '@/db/operations';
import { validateSheet, type CharacterSheet } from './types';
export class SheetConflict extends Error {readonly current:CharacterSheet|undefined;constructor(current:CharacterSheet|undefined){super('sheet_conflict');this.name='SheetConflict';this.current=current;}}
export async function saveSheet(projectId:string,draft:CharacterSheet,expectedRevision:number|null):Promise<CharacterSheet>{
  validateSheet(draft);
  const saved=await db.transaction('rw',db.projects,db.codexEntries,async()=>{
    const project=await db.projects.get(projectId);if(!project)throw new Error('project_missing');
    const sheets=project.characterSheets??[],current=sheets.find(item=>item.id===draft.id);
    if(expectedRevision===null?current!==undefined:current?.revision!==expectedRevision)throw new SheetConflict(current);
    if(draft.linkedEntryId){const entry=await db.codexEntries.get(draft.linkedEntryId);if(!entry||entry.projectId!==projectId)throw new Error('invalid_codex_link');}
    const now=Math.max(Date.now(),(current?.updatedAt??0)+1);
    const next=structuredClone({...draft,title:draft.title.trim(),revision:(current?.revision??0)+1,createdAt:current?.createdAt??draft.createdAt,updatedAt:now});
    if(!next.title)throw new Error('title_required');
    await db.projects.update(projectId,{characterSheets:current?sheets.map(item=>item.id===next.id?next:item):[...sheets,next],updatedAt:Math.max(now,project.updatedAt+1)});return next;
  });notifyProjectsChanged();return saved;
}
export async function deleteSheet(projectId:string,id:string,revision:number):Promise<void>{
  await archiveMetadataWithMutation('character-sheets',projectId,id,()=>db.transaction('rw',db.projects,async()=>{const project=await db.projects.get(projectId);if(!project)throw new Error('project_missing');const current=project.characterSheets?.find(item=>item.id===id);if(current?.revision!==revision)throw new SheetConflict(current);await db.projects.update(projectId,{characterSheets:project.characterSheets!.filter(item=>item.id!==id),updatedAt:Math.max(Date.now(),project.updatedAt+1)});}));notifyProjectsChanged();
}

export function sheetDraftKey(projectId:string){return `wh.character-sheets.v1.${projectId}`;}
