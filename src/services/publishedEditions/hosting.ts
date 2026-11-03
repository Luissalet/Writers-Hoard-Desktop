import {writingSelection} from '@/engines/writings/manuscripts';
import {
  WIKI_HOST_MANAGE_PATH,
  type ReadHostAddress, type ReadHostChange, type ReadHostListScope, type WikiHostAudience,
} from '@/services/wikiProfiles/hostingTypes';
import type {PublishedEdition} from './types';

/** Who owns a reading address: the saved edition's writing scope and source era, never a caller-supplied id. */
export interface EditionHostOwner {scope:'world'|'manuscript';manuscriptId?:string;eraId?:string}

export function editionOwnerKey(edition:Pick<PublishedEdition,'writingScope'|'eraId'>):string{
 const selection=writingSelection(edition.writingScope);
 return JSON.stringify([selection.kind,selection.kind==='manuscript'?selection.id:null,edition.eraId??null]);
}
export function describeEditionOwner(ownerKey:string):EditionHostOwner|undefined{
 try{const [scope,manuscriptId,eraId]=JSON.parse(ownerKey) as unknown[];if(scope!=='world'&&scope!=='manuscript')return;
  return{scope,...(typeof manuscriptId==='string'?{manuscriptId}:{}),...(typeof eraId==='string'?{eraId}:{})};}catch{return;}
}

async function manage<T>(action:string,input:object):Promise<T>{
 const response=await fetch(WIKI_HOST_MANAGE_PATH,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,input})});
 const body=await response.json().catch(()=>null);
 if(!response.ok||body===null)throw Error(body?.error??'wiki_host_unavailable');
 return body as T;
}

export function listEditionAddresses(scope:ReadHostListScope){return manage<ReadHostAddress[]>('read-list',scope);}

/** Serve one saved edition at /read/<slug>. The owner and the frozen HTML both come from the stored edition. */
export async function serveEditionAddress(input:{projectId:string;editionId:string;slug:string;audience:WikiHostAudience;expectedRevision:number}){
 const {getPublishedEdition}=await import('./store');
 const edition=await getPublishedEdition(input.projectId,input.editionId);
 return manage<ReadHostAddress>('read-publish',{...input,ownerKey:editionOwnerKey(edition),sha256:edition.reader.sha256,html:edition.reader.html});
}

export function withdrawEditionAddress(input:ReadHostChange){return manage<ReadHostAddress>('read-withdraw',input);}
