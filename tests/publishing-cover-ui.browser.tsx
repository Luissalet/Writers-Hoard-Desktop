import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import PublishingProfileModal from '@/components/project/PublishingProfileModal';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {useLocaleStore} from '@/stores/localeStore';
import {preparePublishingArtifacts} from '@/services/projectTools';
import {manuscriptProject} from '@/engines/writings/manuscripts';
import type {Project,Writing} from '@/types';
import type {ReaderPresentation} from '@/engines/writings/readerPresentationTypes';
import type {CoverElement} from '@/engines/writings/coverDesign/types';
import {coverTestFixture,coverTestRaster} from './publishing-cover-capture.browser';

function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const wait=(ms=50)=>new Promise(resolve=>setTimeout(resolve,ms));
const own=new Set<string>();
const MARKER='Writer integrated front cover QA v1';
const PROFILE_NAME='QA front cover profile';
function assertOwnProject(project:Project|undefined,id:string):asserts project is Project{check(/^qa-cover-ui-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id)&&project?.id===id&&project.description===MARKER,'Unknown cleanup/load project');}
function colored(cover:ReaderPresentation['cover'],color:string){const next=structuredClone(cover);next.jacket!.elements[1]={...next.jacket!.elements[1],src:coverTestRaster(color)} as CoverElement;return next;}
export async function createCoverUiFixture(){
 const seed=coverTestFixture(),id='qa-cover-ui-'+crypto.randomUUID(),eraId=id+'-era',manuscriptId=id+'-second';
 const project:Project={...seed.project,id,description:MARKER,mode:'custom',type:'standalone',color:'#777777',status:'draft',enabledEngines:['writings'],engineOrder:['writings'],createdAt:1,updatedAt:1,worldEras:[{id:eraId,name:'Green era',description:'',revision:0,createdAt:1,updatedAt:1}],manuscriptCatalog:{revision:0,entries:[{id:manuscriptId,title:'Blue manuscript',reader:{cover:colored(seed.project.readerPresentation.cover,'#0000ff')},eraCovers:{[eraId]:colored(seed.project.readerPresentation.cover,'#00ff00')},createdAt:1,updatedAt:1}]}};
 const writings:Writing[]=[{...seed.writing,id:id+'-main',projectId:id},{...seed.writing,id:id+'-second-writing',projectId:id,manuscriptId,title:'Second chapter',content:'<p>Second manuscript authored prose.</p>'}];
 await db.projects.add(project);own.add(id);await db.writings.bulkAdd(writings);
 return{project,writings,eraId,manuscriptId,profile:{...seed.profile,id:'',projectId:id,name:PROFILE_NAME,includeCover:false}};
}
/** Reload only exact, marked QA already created here. Does not seed or regenerate cover/prose. */
export async function loadCoverUiFixture(id:string){
 const project=await db.projects.get(id);assertOwnProject(project,id);
 const profiles=(await db.publishingProfiles.where('projectId').equals(id).toArray()).filter(row=>row.name===PROFILE_NAME);check(profiles.length===1&&profiles[0].id,'Own saved profile unavailable/ambiguous');
 const writings=await db.writings.where('projectId').equals(id).toArray(),eraId=id+'-era',manuscriptId=id+'-second';
 check(project.worldEras?.some(row=>row.id===eraId)&&project.manuscriptCatalog?.entries.some(row=>row.id===manuscriptId),'Own stored metadata missing');own.add(id);
 return{project,writings,eraId,manuscriptId,profile:profiles[0]};
}
export async function cleanupCoverUiFixture(id:string){
 check(own.has(id),'Unknown cleanup target');const project=await db.projects.get(id);assertOwnProject(project,id);const beforeDelete={projectId:id,marker:MARKER,project};await deleteProject(id);const counts:Record<string,number>={projects:await db.projects.where('id').equals(id).count()};for(const table of db.tables)if(table.name!=='projects'&&('projectId' in table.schema.idxByName||table.schema.primKey.name==='projectId'))counts[table.name]=await table.where('projectId').equals(id).count();counts.settings=(await db.settings.toArray()).filter(row=>row.key.includes(id)).length;check(Object.values(counts).every(n=>n===0),'Own fixture not cleaned');own.delete(id);return{beforeDelete,projectId:id,counts};
}
async function pixel(src:string){const image=new Image();image.src=src;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);return [...ctx.getImageData(8,8,1,1).data].join(',');}
export async function testPublishingCoverUi(){
 useLocaleStore.setState({locale:'es'});const fixture=await createCoverUiFixture(),before=JSON.stringify(await db.projects.get(fixture.project.id)),prose=JSON.stringify(await db.writings.where('projectId').equals(fixture.project.id).toArray());
 const host=document.getElementById('root');check(host,'root');let root:Root|undefined,savedId='';
 const render=(eraId?:string)=>root!.render(<PublishingProfileModal open onClose={()=>{}} project={fixture.project} writings={fixture.writings} initialProfile={fixture.profile} variant="edit" eraId={eraId} onSaved={profile=>{savedId=profile.id;}}/>);
 const cover=()=>document.querySelector<HTMLImageElement>('[data-testid="publishing-preview-cover"] img');
 async function settled(color:string){const until=Date.now()+10000;while(!cover()){check(Date.now()<until,'Cover preview timed out');await act(async()=>{await wait(80);});}check(await pixel(cover()!.src)===color,'Effective cover wrong: '+cover()!.alt);}
 try{
  await act(async()=>{root=createRoot(host);render();});await act(async()=>{await wait(150);});
  const checkbox=document.querySelector<HTMLInputElement>('[data-testid="publishing-include-cover"]');check(checkbox&&!checkbox.checked&&!cover(),'Cover default changed');
  await act(async()=>{checkbox.click();});await settled('255,0,0,255');check(cover()!.alt==='Captured cover A','Main cover/title');check(fixture.project.readerPresentation?.cover.showAtStart===false,'Reader independence fixture');
  const scope=[...document.querySelectorAll<HTMLSelectElement>('select')].find(select=>[...select.options].some(option=>option.value===fixture.manuscriptId));check(scope,'Manuscript selection');
  await act(async()=>{scope.value=fixture.manuscriptId;scope.dispatchEvent(new Event('change',{bubbles:true}));});check(!cover(),'Old main cover visible after scope changed');await settled('0,0,255,255');check(cover()!.alt==='Blue manuscript','Secondary cover/title');
  await act(async()=>{render(fixture.eraId);});check(!cover(),'Old Base cover visible after era changed');await settled('0,255,0,255');
  const effective=manuscriptProject(fixture.project,{kind:'manuscript',id:fixture.manuscriptId},fixture.eraId),result=await preparePublishingArtifacts(effective,{...fixture.profile,includeCover:true,writingScope:{kind:'manuscript',id:fixture.manuscriptId}},[fixture.writings[1]],[]);check(await pixel(result.document.cover!.src)==='0,255,0,255','Export/preview era cover disagree');
  const save=[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.trim()==='Guardar Cambios');check(save&&!save.disabled,'Normal Save unavailable');await act(async()=>{save.click();await wait(150);});check(savedId,'Normal profile save failed');const stored=await db.publishingProfiles.get(savedId);check(stored?.includeCover&&stored.writingScope?.kind==='manuscript'&&stored.writingScope.id===fixture.manuscriptId,'Normal save lost cover or manuscript');
  check(JSON.stringify(await db.projects.get(fixture.project.id))===before,'Preview/save mutated cover/Reader metadata');check(JSON.stringify(await db.writings.where('projectId').equals(fixture.project.id).toArray())===prose,'Preview/save mutated authored prose');
  const reloaded=await loadCoverUiFixture(fixture.project.id);check(reloaded.profile.id===savedId&&reloaded.profile.includeCover&&JSON.stringify(reloaded.project)===before&&JSON.stringify(reloaded.writings)===prose,'Load stored fixture regenerated/lost saved state');
  let refused=false;try{await loadCoverUiFixture('not-own-project');}catch{refused=true;}check(refused,'Load unmarked project accepted');
  await act(async()=>{checkbox.click();});await act(async()=>{await wait(450);});check(!cover(),'Disabled cover retained');
  return ['Normal modal includeCover opt-in, real PNG preview despite Reader.showAtStart=false; main red -> secondary blue -> era green with stale preview hidden immediately; export same effective green; normal Save persists flag/scope only; project metadata/prose exact; flag off clears cover; isolated cleanup.'];
 }finally{await act(async()=>{root?.unmount();});await cleanupCoverUiFixture(fixture.project.id);}
}
