import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import '@/engines';
import '@/services/aiBridge/dispatch';
import {db} from '@/db';
import {EnginePaneContext} from '@/engines/_shared/EnginePaneContext';
import {registerLocalToolModules} from '@/engines/local/registry';
import {saveWorldEra} from '@/services/worldEras/store';
import {createLocalToolClient} from '@/engines/local/storage';
import {exportProjectData,importProjectData} from '@/db/operations';
import {createProjectZipArchive,importProjectZip} from '@/services/zipBackup';
import type {Project} from '@/types';
import fixture from './fixtures/local-tools/native';
import {defineLocalTool} from '@/engines/local/sdk';
const P='sdk-native',pause=(ms=50)=>new Promise(done=>setTimeout(done,ms));
function assert(value:unknown,message:string):asserts value{if(!value)throw new Error(message);}
const host=document.getElementById('root')!,root=createRoot(host);let navigated='';
const [engine]=registerLocalToolModules({'./installed/tests.native/module.tsx':{default:fixture}}),Component=engine.component;
const render=async(eraId?:string)=>{await act(async()=>{root.render(<MemoryRouter><EnginePaneContext.Provider value={{instanceId:'sdk-pane',projectId:P,eraId,visible:true,navigate:to=>{navigated=to;}}}><Component projectId={P}/></EnginePaneContext.Provider></MemoryRouter>);await pause(100);});await act(async()=>{await pause(100);});for(let i=0;i<100&&host.querySelector<HTMLButtonElement>('button')?.disabled;i++)await act(async()=>{await pause();});};
async function init(){
 let refused=false;try{defineLocalTool({...fixture,namespace:'tests.invalid',operations:[{...fixture.operations![0],inputSchema:{type:'object',properties:{value:{$ref:'#/missing'}}}}]});}catch{refused=true;}assert(refused,'Unsupported schema assertion was silently registered');
 const project:Project={id:P,title:'SDK world',description:'Unrelated metadata',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['codex','notes','media'],engineOrder:[],createdAt:1,updatedAt:1,localToolStates:{'tests.sibling':{revision:1,updatedAt:1,data:{keep:true}}}};await db.projects.put(project);await db.projects.put({...project,id:'sdk-foreign'});
 await db.codexEntries.bulkPut([{id:'sdk-native-card',projectId:P,title:'SDK source card',type:'custom',content:'<p>SDK world source.</p>',fields:{amount:'4'},propertyDefinitions:[{id:'amount-id',key:'amount',label:'Amount',kind:'number'},{id:'total-id',key:'total',label:'Total',kind:'number',formula:'=@[Amount]*3'}],tags:[],relations:[],createdAt:1,updatedAt:1},{id:'sdk-foreign-card',projectId:'sdk-foreign',title:'Foreign card',type:'custom',content:'',fields:{},tags:[],relations:[],createdAt:1,updatedAt:1}]);
 for(const id of ['future','sibling'])await saveWorldEra(P,{id,name:id,description:'',revision:0,createdAt:1,updatedAt:1},null);
 Reflect.set(window,'__sdkNativeReady',true);
}
Reflect.set(window,'__sdkUIWrite',async(text:string)=>{const area=host.querySelector('textarea')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,text);area.dispatchEvent(new Event('input',{bubbles:true}));await pause();});await act(async()=>{[...host.querySelectorAll('button')].find(button=>button.textContent==='Save compiled notes')!.click();await pause();});return{value:area.value,status:host.querySelector('[role=status]')?.textContent};});
Reflect.set(window,'__sdkUIScope',async(eraId?:string)=>{await render(eraId);return host.querySelector<HTMLTextAreaElement>('textarea')?.value;});
Reflect.set(window,'__sdkOpen',async()=>{await act(async()=>{[...host.querySelectorAll('button')].find(button=>button.textContent==='Open source card')!.click();await pause(100);});return navigated;});
Reflect.set(window,'__sdkSnapshot',async()=>JSON.parse(JSON.stringify(await db.projects.get(P))));
Reflect.set(window,'__sdkPortable',async()=>{const base=createLocalToolClient(P,fixture),era=createLocalToolClient(P,fixture,{eraId:'future'}),before=(await era.read()).data.notes;const clone=await importProjectData(await exportProjectData(P)),copy=await db.projects.get(clone),ownEra=copy!.worldEras!.find(row=>row.name==='future')!;assert((await createLocalToolClient(clone,fixture,{eraId:ownEra.id}).read()).data.notes===before&&ownEra.localToolStates?.[fixture.namespace].revision===0,'JSON clone lost own era state or revisions');const archive=await createProjectZipArchive(P);await db.projects.update(P,{localToolStates:undefined,worldEras:[]});await importProjectZip(new File([archive.blob],'sdk-native.zip'),{replaceProjectIds:[P]});assert((await era.read()).data.notes===before&&(await base.read()).data.notes==='UI before MCP + native','ZIP lost scoped source state');return{cloned:true,zip:true,compiledCodeInstalled:false};});
init().catch(error=>Reflect.set(window,'__sdkNativeFailure',error.stack||String(error)));
