import Dexie from 'dexie';
import {db} from '@/db';
import {notifyProjectsChanged} from '@/db/operations';
import {sha256Hex} from '@/services/judge/text';
import {buildWorldWiki,loadWorldWikiData} from '@/services/worldWikiExport';
import type {WorldWikiOptions} from '@/types/worldWiki';
import type {Project} from '@/types';
import type {WikiEdition,WikiProfile,WikiProfilesProject} from './types';
import {validateWikiProfilesProject,validateWikiOptions} from './validation';
import {captureWikiSnapshot,captureWikiSources,wikiSource,wikiSourceFingerprint} from './snapshot';
type WikiProject=Project&WikiProfilesProject;
const conflict=()=>new Error('wiki_profile_conflict');
const expected=(profile:WikiProfile|undefined,revision:number|null)=>{if(profile?revision!==profile.revision:revision!==null)throw conflict();};
async function getProject(projectId:string){const project=await db.projects.get(projectId)as WikiProject|undefined;if(!project)throw Error('project_missing');validateWikiProfilesProject(project);return project;}
function profileFor(project:WikiProject,id:string){const profile=project.wikiProfiles?.find(profile=>profile.id===id);if(!profile)throw Error('wiki_profile_missing');return profile;}
function era(project:WikiProject,options:WorldWikiOptions){if(options.eraId&&!project.worldEras?.some(era=>era.id===options.eraId))throw Error('world_era_missing');}
function write(project:WikiProject,profiles:WikiProfile[]){validateWikiProfilesProject({wikiProfiles:profiles});return db.projects.update(project.id,{wikiProfiles:profiles,updatedAt:Math.max(Date.now(),project.updatedAt+1)}as Partial<WikiProject>);}
export async function listWikiProfiles(projectId:string){return(await getProject(projectId)).wikiProfiles?.map(profile=>({...structuredClone(profile),editions:profile.editions?.map(edition=>({...edition,reader:{...edition.reader,html:''}}))}))??[];}
export async function getWikiProfile(projectId:string,id:string){return structuredClone(profileFor(await getProject(projectId),id));}
export async function saveWikiProfile(projectId:string,input:{id?:string;name:string;options:WorldWikiOptions},expectedRevision:number|null){
 validateWikiOptions(input.options);if(!input.name?.trim())throw Error('wiki_profile_name_required');
 const result=await db.transaction('rw',db.projects,async()=>{const project=await getProject(projectId),profiles=structuredClone(project.wikiProfiles??[]),current=input.id?profiles.find(profile=>profile.id===input.id):undefined;if(input.id&&!current&&expectedRevision!==null)throw conflict();expected(current,expectedRevision);era(project,input.options);const now=Math.max(Date.now(),(current?.updatedAt??0)+1),next:WikiProfile={id:current?.id??input.id??crypto.randomUUID(),name:input.name.trim(),options:structuredClone(input.options),revision:(current?.revision??-1)+1,createdAt:current?.createdAt??now,updatedAt:now,editions:current?.editions};if(current)profiles[profiles.indexOf(current)]=next;else profiles.push(next);await write(project,profiles);return next;});notifyProjectsChanged();return structuredClone(result);
}
export async function deleteWikiProfile(projectId:string,id:string,expectedRevision:number){await db.transaction('rw',db.projects,async()=>{const project=await getProject(projectId),profile=profileFor(project,id);expected(profile,expectedRevision);await write(project,project.wikiProfiles!.filter(item=>item.id!==id));});notifyProjectsChanged();}
export async function prepareWikiEdition(projectId:string,id:string,expectedRevision:number){
 const initial=await getWikiProfile(projectId,id);expected(initial,expectedRevision);const snapshot=await captureWikiSnapshot({projectId,eraId:initial.options.eraId}),profile=profileFor(snapshot.publication.project as WikiProject,id);expected(profile,expectedRevision);
 const source=wikiSource(snapshot),artifact=buildWorldWiki(await loadWorldWikiData(projectId,profile.options,source),profile.options),edition:WikiEdition={id:crypto.randomUUID(),publishedAt:Date.now(),profileName:profile.name,options:structuredClone(profile.options),sourceFingerprint:await wikiSourceFingerprint(snapshot),reader:{...artifact,sha256:await sha256Hex(artifact.html)}};return edition;
}
export async function commitWikiEdition(projectId:string,id:string,edition:WikiEdition,expectedRevision:number){
 const result=await db.transaction('rw',db.tables,tx=>Dexie.Promise.resolve(captureWikiSources(tx,{projectId,eraId:edition.options.eraId})).then(snapshot=>{const project=snapshot.publication.project as WikiProject,profile=profileFor(project,id);expected(profile,expectedRevision);if(JSON.stringify(profile.options)!==JSON.stringify(edition.options)||profile.name!==edition.profileName)throw conflict();return Dexie.waitFor(Promise.all([wikiSourceFingerprint(snapshot),sha256Hex(edition.reader.html)])).then(([fingerprint,digest])=>{if(fingerprint!==edition.sourceFingerprint||digest!==edition.reader.sha256)throw conflict();const next={...profile,revision:profile.revision+1,updatedAt:Math.max(Date.now(),profile.updatedAt+1),editions:[...profile.editions??[],structuredClone(edition)]},profiles=project.wikiProfiles!.map(item=>item.id===id?next:item);validateWikiProfilesProject({wikiProfiles:profiles});return tx.table('projects').update(projectId,{wikiProfiles:profiles,updatedAt:Math.max(Date.now(),project.updatedAt+1)}).then(()=>structuredClone(next));});}));notifyProjectsChanged();return result;
}
export async function publishWikiProfile(projectId:string,id:string,expectedRevision:number){return commitWikiEdition(projectId,id,await prepareWikiEdition(projectId,id,expectedRevision),expectedRevision);}
export async function getWikiEdition(projectId:string,profileId:string,editionId:string){const profile=await getWikiProfile(projectId,profileId),edition=profile.editions?.find(edition=>edition.id===editionId);if(!edition)throw Error('wiki_edition_missing');if(await sha256Hex(edition.reader.html)!==edition.reader.sha256)throw Error('wiki_edition_artifact_changed');return structuredClone(edition);}
export async function restoreWikiConfiguration(projectId:string,profileId:string,editionId:string,expectedRevision:number){const edition=await getWikiEdition(projectId,profileId,editionId),profile=await getWikiProfile(projectId,profileId);return saveWikiProfile(projectId,{id:profileId,name:profile.name,options:edition.options},expectedRevision);}
