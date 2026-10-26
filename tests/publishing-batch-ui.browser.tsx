import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {Packer} from 'docx';
import JSZip from 'jszip';
import PublishingProfileModal from '@/components/project/PublishingProfileModal';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {useLocaleStore} from '@/stores/localeStore';
import type {Project,Writing} from '@/types';
import type {PublishingProfile} from '@/types/projectTools';
function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const wait=(ms=40)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(test:()=>boolean,message:string){const end=Date.now()+15000;while(!test()){check(Date.now()<end,message);await act(async()=>{await wait();});}}
export async function testPublishingBatchUi(){
 const locale=useLocaleStore.getState().locale;useLocaleStore.setState({locale:'es'});
 const id='qa-c42-ui-'+crypto.randomUUID();
 const project:Project={id,title:'Captured A',description:'Owned C42 UI fixture',mode:'custom',type:'standalone',color:'#777777',status:'draft',enabledEngines:['writings'],engineOrder:['writings'],createdAt:1,updatedAt:1};
 const writing:Writing={id:id+'-writing',projectId:id,title:'Chapter A',content:'<p>Captured authored prose A.</p>',wordCount:5,status:'draft',tags:[],createdAt:1,updatedAt:1};
 const profile:PublishingProfile={id:id+'-profile',projectId:id,name:'Captured profile A',format:'manuscript',includeTitlePage:true,includeCover:false,includeSynopsis:false,includeBibliography:false,citationStyle:'apa',selectionMode:'all',selectedWritingIds:[writing.id],createdAt:1,updatedAt:1};
 await db.projects.add(project);await db.writings.add(writing);await db.publishingProfiles.add(profile);
 const rawProfile=JSON.stringify(await db.publishingProfiles.get(profile.id));
 const host=document.getElementById('root');check(host,'root');const root=createRoot(host);
 const create=URL.createObjectURL,click=HTMLAnchorElement.prototype.click,toBlob=Packer.toBlob;
 const urls=new Map<string,Blob>(),downloads:{filename:string;blob:Blob}[]=[];
 URL.createObjectURL=(blob:Blob)=>{const url=create.call(URL,blob);urls.set(url,blob);return url;};
 HTMLAnchorElement.prototype.click=function(){const blob=urls.get(this.href);check(blob,'Missing download Blob');downloads.push({filename:this.download,blob});};
 const buttons=()=>[...document.querySelectorAll<HTMLButtonElement>('button')];
 const button=(label:string)=>buttons().find(element=>element.textContent?.trim()===label);
 const render=(eraId?:string)=>root.render(<PublishingProfileModal open onClose={()=>{}} project={project} writings={[writing]} initialProfile={profile} variant="edit" eraId={eraId}/>);
 try{
  await import('@/components/common/ModalBody');await act(async()=>{render();await wait(100);});await until(()=>!!button('Preparar archivos'),'Modal did not mount');
  check(button('PDF'),'PDF action must be visible without Electron');
  const section=document.querySelector('section[aria-label="Preparar archivos"]');check(section,'Batch section');
  await act(async()=>{for(const label of section.querySelectorAll('label')){const input=label.querySelector<HTMLInputElement>('input[type="checkbox"]');if(input&&input.checked&&!['HTML','DOCX'].includes(label.textContent?.trim()??''))input.click();}});
  let fail=true;
  Packer.toBlob=async function(...args:Parameters<typeof Packer.toBlob>){if(fail){fail=false;throw Error('Owned transient DOCX packing failure');}return toBlob.apply(this,args);};
  await act(async()=>{button('Preparar archivos')!.click();});
  await until(()=>!!button('Reintentar pendientes')&&!button('Reintentar pendientes')!.disabled,'First batch did not settle');
  check(downloads.length===0,'Preparation triggered automatic downloads');
  check(section.textContent?.includes('HTML · Listo')&&section.textContent.includes('DOCX · Error')&&section.textContent.includes('1 listos de 2 solicitados'),'Partial results/count wrong');
  check(JSON.stringify(await db.publishingProfiles.get(profile.id))===rawProfile,'Export saved profile draft');
  await db.transaction('rw',[db.projects,db.writings],async()=>{await db.projects.update(id,{title:'Live B'});await db.writings.update(writing.id,{content:'<p>Live authored prose B.</p>'});});
  db.close();
  await act(async()=>{button('Reintentar pendientes')!.click();});
  await until(()=>section.textContent?.includes('DOCX · Listo')===true&&!button('Reintentar pendientes'),'Retry without DB failed');
  check(section.textContent?.includes('2 listos de 2 solicitados'),'Ready count wrong after retry');
  await act(async()=>{button('Descargar listos en ZIP')!.click();});await until(()=>downloads.length===1,'ZIP download not delivered');
  const zip=await JSZip.loadAsync(await downloads[0].blob.arrayBuffer()),names=Object.keys(zip.files);check(names.length===2&&names.some(name=>name.endsWith('.html'))&&names.some(name=>name.endsWith('.docx')),'ZIP contents wrong');
  const html=await zip.file(names.find(name=>name.endsWith('.html'))!)!.async('text');check(html.includes('Captured authored prose A.')&&!html.includes('Live authored prose B.'),'Ready HTML lost capture A');
  const word=await JSZip.loadAsync(await zip.file(names.find(name=>name.endsWith('.docx'))!)!.async('uint8array'));const xml=await word.file('word/document.xml')!.async('text');check(xml.includes('Captured authored prose A.')&&!xml.includes('Live authored prose B.'),'Retry DOCX lost capture A');
  // Change host context during the final Blob wait. No obsolete download.
  const originalArrayBuffer=Blob.prototype.arrayBuffer;let release!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),atBlob=new Promise<void>(resolve=>{entered=resolve;});let held=false;
  Blob.prototype.arrayBuffer=async function(){const bytes=await originalArrayBuffer.call(this);if(!held){held=true;entered();await gate;}return bytes;};
  try{await act(async()=>{button('Descargar')!.click();});await atBlob;await act(async()=>{render(id+'-other-era');});release();await act(async()=>{await wait(100);});check(downloads.length===1,'Stale final-await download escaped host guard');}finally{release?.();Blob.prototype.arrayBuffer=originalArrayBuffer;}
  await act(async()=>{useLocaleStore.setState({locale:'en'});await wait();});check(button('Prepare files')&&document.body.textContent?.includes('This capture belongs to another context'),'English/context state missing');
  return ['Normal batch modal: HTML ready + injected DOCX pack failure, no automatic downloads/profile save; live B then DB closed; retry uses A, real DOCX + HTML ZIP retains A; post-Blob host change blocks stale individual download; PDF visible and ES/EN labels.'];
 }finally{
  Packer.toBlob=toBlob;URL.createObjectURL=create;HTMLAnchorElement.prototype.click=click;
  await act(async()=>{root.unmount();});await db.open();await deleteProject(id);check(await db.projects.get(id)===undefined&&await db.writings.where('projectId').equals(id).count()===0&&await db.publishingProfiles.where('projectId').equals(id).count()===0,'Own UI cleanup incomplete');useLocaleStore.setState({locale});
 }
}
