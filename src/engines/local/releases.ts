import {toolDockSourceEnvelopes} from '@/engines/writings/toolDock/types';
import {findLocalToolBlocksInHtml} from './blocks/types';
import {validateBlockForDefinition} from './blocks/definitions';
import Dexie,{type Transaction} from 'dexie';
import {db} from '@/db';
import {notifyProjectsChanged} from '@/db/operations';
import {notifyDataChanged} from '@/engines/_shared/dataChanged';
import type {Project} from '@/types';
import {getLocalToolDefinition,getLocalToolReleases} from './definitions';
import {validateLocalToolInstallations,type LocalToolInstallation} from './installations';
import {localToolContentHash} from './releaseFormat.mjs';
import {parseLocalToolState} from './clientContract';
import {localToolNamespace} from './stateTypes';
export function resolveProjectLocalTool(namespace:string,project:Pick<Project,'localToolInstallations'>){validateLocalToolInstallations(project.localToolInstallations);const pin=project.localToolInstallations?.[namespace],definition=getLocalToolDefinition(namespace,pin?.contentHash);if(!definition)throw Error(pin?.contentHash?'local_tool_pinned_release_unavailable':getLocalToolReleases(namespace).length?'local_tool_pin_required':'local_tool_source_unavailable');return definition;}
export async function pinLocalToolRelease(projectId:string,namespace:string,contentHash:string|null,expectedRevision:number|null):Promise<LocalToolInstallation>{
 if(!localToolNamespace(namespace)||contentHash!==null&&!localToolContentHash(contentHash)||expectedRevision!==null&&(!Number.isSafeInteger(expectedRevision)||expectedRevision<0))throw Error('local_tool_pin_invalid');
 const definition=getLocalToolDefinition(namespace,contentHash);if(!definition)throw Error('local_tool_release_not_compiled');
 const result=await db.transaction('rw',[db.projects,db.worldEraVariants,db.documentHistory,db.documentArchives,db.codexEntries,db.writings,db.boardNodes],async tx=>{const project=await db.projects.get(projectId);if(!project)throw Error('project_missing');validateLocalToolInstallations(project.localToolInstallations);const current=project.localToolInstallations?.[namespace];if((current?.revision??null)!==expectedRevision)throw Error('local_tool_pin_conflict');for(const states of [project.localToolStates,...(project.worldEras??[]).map(era=>era.localToolStates)])if(states?.[namespace])parseLocalToolState(definition,states[namespace].data);// Hidden, reinherited and historic source states can be restored by normal
 // product actions. Validate raw retained roots too, without loading source code
 // or hashing documents in a database hook or a second transaction.
 const validateDocument=(document:unknown)=>{if(!document||typeof document!=='object'||Array.isArray(document))return;const row=document as {namespace?:unknown;data:Parameters<typeof parseLocalToolState>[1]};if(row.namespace!==namespace)return;if(!definition.document)throw Error('local_tool_document_host_required');parseLocalToolState(definition,row.data);};
 for(const document of project.sourceToolDocuments??[])validateDocument(document);
 for(const variant of await db.worldEraVariants.where('projectId').equals(projectId).filter(row=>row.kind==='local-tool').toArray())for(const state of [variant,...variant.history??[]])validateDocument(state.document?.root);
 for(const entry of await db.documentHistory.where('projectId').equals(projectId).filter(row=>row.kind==='local-tool').toArray())validateDocument(entry.document.root);
 for(const entry of await db.documentArchives.where('projectId').equals(projectId).filter(row=>row.kind==='local-tool').toArray())validateDocument(entry.metadata?.item);
 const validateBlocks=(value:unknown):void=>{if(Array.isArray(value)){value.forEach(validateBlocks);return;}if(!value||typeof value!=='object'||value instanceof Blob)return;for(const [key,child]of Object.entries(value)){if(['toolDock','writingToolDock'].includes(key)){for(const envelope of toolDockSourceEnvelopes(child)){if(envelope.namespace!==namespace)continue;const block=definition.blocks?.find(block=>block.key===envelope.key);if(!block)throw Error('local_tool_block_definition_changed');validateBlockForDefinition(envelope,block);}continue;}if(['data','localToolStates'].includes(key))continue;if(['content','html','body','richContent'].includes(key)&&typeof child==='string'&&child.includes('data-wh-source-block'))for(const {envelope}of findLocalToolBlocksInHtml(child)){if(envelope.namespace!==namespace)continue;const block=definition.blocks?.find(block=>block.key===envelope.key);if(!block)throw Error('local_tool_block_definition_changed');validateBlockForDefinition(envelope,block);}else if(child&&typeof child==='object')validateBlocks(child);}};
 validateBlocks(project);for(const table of [db.codexEntries,db.writings,db.boardNodes])for(const row of await table.where('projectId').equals(projectId).toArray())validateBlocks(row);
 for(const variant of await db.worldEraVariants.where('projectId').equals(projectId).toArray())validateBlocks(variant);
 for(const entry of await db.documentHistory.where('projectId').equals(projectId).toArray())validateBlocks(entry.document);
 for(const entry of await db.documentArchives.where('projectId').equals(projectId).toArray())validateBlocks(entry);
 const revision=(current?.revision??0)+1;if(!Number.isSafeInteger(revision))throw Error('local_tool_pin_conflict');const pin={contentHash,revision,updatedAt:Math.max(Date.now(),(current?.updatedAt??0)+1)};await db.projects.update(projectId,{localToolInstallations:{...project.localToolInstallations,[namespace]:pin},updatedAt:Math.max(pin.updatedAt,project.updatedAt+1)});let outer:Transaction=tx;while(outer.parent)outer=outer.parent;outer.on('complete',()=>Dexie.ignoreTransaction(()=>{notifyProjectsChanged();notifyDataChanged({source:'other',projectId});}));return pin;});return result;
}
