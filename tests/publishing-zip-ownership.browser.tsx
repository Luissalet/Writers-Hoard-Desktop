// Causal regression from the independent C42 ZIP ownership oracle.
// Original stage SHA-256: 485f20c90085b221a211b26fcc147b761a843f092da5687e10366790a556d542.
// The two scenario bodies and promise boundaries are unchanged; only the exported entry replaces auto-run.
import {act} from 'react';import{createRoot}from'react-dom/client';import{Packer}from'docx';import JSZip from'jszip';
import PublishingProfileModal from '@/components/project/PublishingProfileModal';import{db}from'@/db';import{deleteProject}from'@/db/operations';import{useLocaleStore}from'@/stores/localeStore';
import type{Project,Writing}from'@/types';import type{PublishingProfile}from'@/types/projectTools';
const wait=(ms=30)=>new Promise(r=>setTimeout(r,ms));const check=(v:unknown,m:string)=>{if(!v)throw Error(m)};
async function until(fn:()=>boolean,message:string){const end=Date.now()+12000;while(!fn()){check(Date.now()<end,message);await act(async()=>{await wait()})}}
function deferred(){let resolve!:(v?:unknown)=>void;const promise=new Promise(r=>{resolve=r});return{promise,resolve}}
async function scenario(outcome:'resolve'|'reject'){
 const id='qa-own-zip-owner-'+crypto.randomUUID(),project:Project={id,title:'Own captured A',description:'Independent disposable ZIP owner fixture',mode:'custom',type:'standalone',color:'#777777',status:'draft',enabledEngines:['writings'],engineOrder:['writings'],createdAt:1,updatedAt:1};
 const writing:Writing={id:id+'-writing',projectId:id,title:'Own chapter',content:'<p>Own ZIP A prose remains.</p>',wordCount:5,status:'draft',tags:[],createdAt:1,updatedAt:1};
 const profile:PublishingProfile={id:id+'-profile',projectId:id,name:'Own profile A',format:'manuscript',includeTitlePage:false,includeCover:false,includeSynopsis:false,includeBibliography:false,citationStyle:'apa',selectionMode:'all',selectedWritingIds:[writing.id],createdAt:1,updatedAt:1};
 await db.transaction('rw',[db.projects,db.writings,db.publishingProfiles],async()=>{await db.projects.add(project);await db.writings.add(writing);await db.publishingProfiles.add(profile)});
 const originalProfile=JSON.stringify(await db.publishingProfiles.get(profile.id)),host=document.getElementById('root')!;const root=createRoot(host);
 const oldZipGate=deferred(),oldZipEntered=deferred(),newPackGate=deferred(),newPackEntered=deferred();
 const originalZip=JSZip.prototype.generateAsync,originalPack=Packer.toBlob,originalClick=HTMLAnchorElement.prototype.click;
 let downloads=0;HTMLAnchorElement.prototype.click=function(){downloads++};
 const button=(s:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===s);
 const render=(eraId?:string)=>root.render(<PublishingProfileModal open onClose={()=>{}} project={project} writings={[writing]} initialProfile={profile} variant="edit" eraId={eraId}/>);
 let observation:Record<string,unknown>={outcome};
 try{
  await import('@/components/common/ModalBody');await act(async()=>{render();await wait(100)});await until(()=>!!button('Preparar archivos'),'modal missing');
  const section=document.querySelector('section[aria-label="Preparar archivos"]')!;
  await act(async()=>{for(const label of section.querySelectorAll('label')){const input=label.querySelector<HTMLInputElement>('input[type="checkbox"]');if(input&&input.checked&&label.textContent?.trim()!=='HTML')input.click()}});
  await act(async()=>{button('Preparar archivos')!.click()});await until(()=>!!button('Descargar listos en ZIP')&&!button('Descargar listos en ZIP')!.disabled,'initial HTML capture did not settle');
  // Real JSZip creates its Blob; only delivery of that old promise is held.
  JSZip.prototype.generateAsync=async function(...args:Parameters<typeof originalZip>){const blob=await originalZip.apply(this,args);oldZipEntered.resolve();await oldZipGate.promise;if(outcome==='reject')throw Error('OWN_OLD_ZIP_FAILURE');return blob} as typeof originalZip;
  await act(async()=>{button('Descargar listos en ZIP')!.click()});await oldZipEntered.promise;
  await act(async()=>{render(id+'-era-B');await wait()});await act(async()=>{render();await wait()});
  // Keep a NEW real DOCX preparation pending independently of the old ZIP.
  Packer.toBlob=async function(...args:Parameters<typeof originalPack>){newPackEntered.resolve();await newPackGate.promise;return originalPack.apply(this,args)};
  await act(async()=>{for(const label of section.querySelectorAll('label')){const input=label.querySelector<HTMLInputElement>('input[type="checkbox"]');if(input&&label.textContent?.trim()==='DOCX'&&!input.checked)input.click()}});
  await act(async()=>{button('Preparar archivos')!.click()});await newPackEntered.promise;
  check(button('Preparar archivos')!.disabled,'fixture failed to keep new preparation busy');
  await act(async()=>{oldZipGate.resolve();await wait(180)});
  const newBusy=button('Preparar archivos')!.disabled,obsoleteError=document.body.textContent?.includes('OWN_OLD_ZIP_FAILURE')===true;
  observation={outcome,oldZipWasReal:true,scopeRoundtrip:'A→B→A',newPackStillHeld:true,newPreparationRemainsBusy:newBusy,obsoleteErrorVisible:obsoleteError,downloads,profileUnchanged:JSON.stringify(await db.publishingProfiles.get(profile.id))===originalProfile};
  return{ok:newBusy&&!obsoleteError&&downloads===0,...observation};
 }finally{
  oldZipGate.resolve();newPackGate.resolve();JSZip.prototype.generateAsync=originalZip;Packer.toBlob=originalPack;
  await act(async()=>{await wait(250);root.unmount();await wait()});HTMLAnchorElement.prototype.click=originalClick;
  await deleteProject(id);check(await db.projects.get(id)===undefined,'own project cleanup');
 }
}
export async function testPublishingZipOwnership(){
 const previous=useLocaleStore.getState().locale;useLocaleStore.setState({locale:'es'});
 try{
  const tests=[];for(const outcome of ['resolve','reject']as const)tests.push(await scenario(outcome));
  for(const test of tests)check(test.ok,JSON.stringify(test));
  const counts:Record<string,number>={};for(const table of db.tables)counts[table.name]=await table.count();
  return{ok:tests.every(t=>t.ok),tests,cleanup:{tables:Object.keys(counts).length,allZero:Object.values(counts).every(n=>n===0)},attribution:'Normal real UI capture/HTML/DOCX/JSZip. Injected promise gates only at old real ZIP Blob delivery and new DOCX pack; no Browser/desktop/server/model/PDF.'};
 }finally{useLocaleStore.setState({locale:previous})}
}
