import {db} from '@/db';
import {deleteCodexEntry} from '@/db/operations';
import type {CodexEntry} from '@/types';
import {announceEraChange,getEraProject,hideEraDocument,readWorldDocument,saveEraDocument,updateWorldEraDefaults} from '@/services/worldEras/store';
import {eraDocumentVersion} from '@/services/worldEras/adapters';
import type {EraRow,WorldEraScope} from '@/services/worldEras/types';
import {applyWorkspaceLibraryAction,readWorkspaceLibrary,WorkspaceLibraryConflict} from './model';
import {workspaceDocumentKey,type WorkspaceLibrary,type WorkspacePlacement} from './types';
import {listWorkspaceDocuments} from './catalog';

export interface LibraryCodexCreation {entryId:string;version:string;placement:WorkspacePlacement}
export async function readLibraryCreationContext(scope:WorldEraScope){
 return db.transaction('r',db.tables,async()=>{const project=await getEraProject(scope);return{...scope,...readWorkspaceLibrary(project),documents:await listWorkspaceDocuments(scope.projectId,project,scope.eraId)};});
}
async function saveLibrary(scope:WorldEraScope,library:WorkspaceLibrary){
 const changes={workspaceFolders:library.folders,workspacePlacements:library.placements,workspaceRevision:library.revision};
 if(scope.eraId)await updateWorldEraDefaults(scope,changes);
 else await db.projects.update(scope.projectId,{...changes,updatedAt:Date.now()});
 announceEraChange(scope.projectId,true);
}

/** Creating a card in a folder is one commit, including the explicit era overlay. */
export async function createLibraryCodex(scope:WorldEraScope,entry:CodexEntry,expectedRevision:number,folderId?:string):Promise<LibraryCodexCreation>{
 if(entry.projectId!==scope.projectId||!entry.id||!entry.title.trim())throw Error('library_card_invalid');
 return db.transaction('rw',db.tables,async()=>{
  const project=await getEraProject(scope);if(!project.enabledEngines.includes('codex'))throw Error('library_codex_disabled');
  const library=readWorkspaceLibrary(project);if(library.revision!==expectedRevision)throw new WorkspaceLibraryConflict('library_changed');
  const document={engineId:'codex' as const,entityId:entry.id,title:entry.title,route:''};
  const catalog=await listWorkspaceDocuments(scope.projectId,project,scope.eraId);
  const next=applyWorkspaceLibraryAction(library,{kind:'place',documents:[document],folderId},[...catalog,document]);
  if(await readWorldDocument(scope,'codex',entry.id))throw Error('library_card_identity_occupied');
  if(scope.eraId)await saveEraDocument(scope,'codex',{root:structuredClone(entry) as unknown as EraRow,children:{}},null);
  else await db.codexEntries.add(structuredClone(entry));
  await saveLibrary(scope,next);
  const version=await eraDocumentVersion({root:entry as unknown as EraRow,children:{}});
  return{entryId:entry.id,version,placement:next.placements.find(row=>workspaceDocumentKey(row)===workspaceDocumentKey(document))!};
 });
}

/** Reverse only this unchanged card/placement; keep unrelated folder edits. */
export async function undoLibraryCodexCreation(scope:WorldEraScope,receipt:LibraryCodexCreation):Promise<void>{
 await db.transaction('rw',db.tables,async()=>{
  const current=await readWorldDocument(scope,'codex',receipt.entryId),project=await getEraProject(scope),library=readWorkspaceLibrary(project);
  const key=workspaceDocumentKey({engineId:'codex',entityId:receipt.entryId}),placement=library.placements.find(row=>workspaceDocumentKey(row)===key);
  if(!current||await eraDocumentVersion(current.document)!==receipt.version||JSON.stringify(placement)!==JSON.stringify(receipt.placement))throw new WorkspaceLibraryConflict('library_created_card_changed');
  if(scope.eraId)await hideEraDocument(scope,'codex',receipt.entryId,current.version);else await deleteCodexEntry(receipt.entryId);
  await saveLibrary(scope,{...library,placements:library.placements.filter(row=>workspaceDocumentKey(row)!==key),revision:library.revision+1});
 });
}
