import {act} from 'react';import {createRoot} from 'react-dom/client';
import PublishingProfileModal from '@/components/project/PublishingProfileModal';import {db} from '@/db';import {deleteProject} from '@/db/operations';import {useLocaleStore} from '@/stores/localeStore';import type {Project,Writing} from '@/types';import type {PublishingProfile} from '@/types/projectTools';
function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const wait=(ms=60)=>new Promise(resolve=>setTimeout(resolve,ms));
export async function testPublishingInvalidMargin(){
 const locale=useLocaleStore.getState().locale;useLocaleStore.setState({locale:'es'});const id='qa-c42-invalid-margin-'+crypto.randomUUID();
 const project:Project={id,title:'Margin draft remains editable',description:'Owned margin500 causal fixture',mode:'custom',type:'standalone',color:'#777777',status:'draft',enabledEngines:['writings'],engineOrder:['writings'],createdAt:1,updatedAt:1};
 const writing:Writing={id:id+'-writing',projectId:id,title:'Authored chapter',content:'<p>Owned prose stays exact.</p>',wordCount:5,status:'draft',tags:[],createdAt:1,updatedAt:1};
 const profile:PublishingProfile={id:id+'-profile',projectId:id,name:'Preserved margin draft',format:'manuscript',includeTitlePage:true,includeSynopsis:false,includeBibliography:false,citationStyle:'apa',selectionMode:'all',selectedWritingIds:[writing.id],marginsMm:{top:15,bottom:17,inside:19,outside:14},initialPageNumber:7,createdAt:1,updatedAt:1};
 await db.projects.add(project);await db.writings.add(writing);await db.publishingProfiles.add(profile);const raw=()=>db.transaction('r',[db.projects,db.writings,db.publishingProfiles],async()=>JSON.stringify({project:await db.projects.get(id),writing:await db.writings.get(writing.id),profile:await db.publishingProfiles.get(profile.id)}));const before=await raw();
 const root=createRoot(document.getElementById('root')!);const top=()=>[...document.querySelectorAll('label')].find(label=>label.textContent?.startsWith('Superior (mm)'))?.querySelector<HTMLInputElement>('input');
 const prepare=()=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.trim()==='Preparar archivos');
 const fill=(input:HTMLInputElement,value:string)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
 try{await import('@/components/common/ModalBody');await act(async()=>{root.render(<PublishingProfileModal open onClose={()=>{}} project={project} writings={[writing]} initialProfile={profile} variant="edit"/>);await wait(100);});check(top()&&prepare()&&!prepare()!.disabled,'Initial layout positive control unavailable');
 await act(async()=>{fill(top()!,'500');await wait(500);});
 check(document.querySelector('[role="dialog"]')&&top()?.value==='500','Margin500 crashed or discarded the editable draft');check(document.querySelector('[role="alert"]')?.textContent?.includes('Los márgenes deben dejar espacio de texto'),'Missing localized invalid-margin alert');check(prepare()!.disabled,'Invalid margin allowed preparation');
 check(await raw()===before,'Invalid draft wrote project/prose/profile');
 await act(async()=>{fill(top()!,'15');await wait(500);});
 check(top()?.value==='15'&&!document.querySelector('[role="alert"]')&&!prepare()!.disabled,'Correcting500 to15 did not recover the same draft');check([...document.querySelectorAll<HTMLInputElement>('input')].some(input=>input.value===profile.name),'Correction lost the profile name');check(document.body.textContent?.includes('Owned prose stays exact.'),'Correction lost preview prose');check(await raw()===before,'Correction wrote project/prose/profile');
 return ['Causal invalid physical draft: Superior15 ->500 stays editable, localized alert and prepare disabled; 500->15 recovers same profile/prose without DB writes, including preview debounce.'];
 }finally{await act(async()=>root.unmount());await deleteProject(id);useLocaleStore.setState({locale});}
}
