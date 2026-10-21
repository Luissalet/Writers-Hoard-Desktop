import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {db} from '@/db';
import {deleteProject,importProjectData} from '@/db/operations';
import type {CodexEntry,Project} from '@/types';
import {projectCodexEntry,codexPropertyHtml,codexOptionAppearance} from '@/engines/codex/properties';
import {saveCodexTemplate,deleteCodexTemplate,type CodexTemplate} from '@/engines/codex/templates';
import {previewTemplateSync,applyTemplateSync} from '@/engines/codex/templateSync';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {getBridgeTool} from '@/services/aiBridge/manifest';
import {saveWorldEra} from '@/services/worldEras/store';
import {useLocaleStore} from '@/stores/localeStore';
import CodexTemplateManager from '@/components/codex/CodexTemplateManager';
import CodexEntryForm from '@/components/codex/CodexEntryForm';
import {saveCodexDraft} from '@/engines/codex/operations';

function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const pause=(ms=40)=>new Promise(done=>setTimeout(done,ms));
const project=(id:string):Project=>({id,title:'Synthetic option colors',description:'Unrelated metadata',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['codex'],createdAt:1,updatedAt:1});
const template:CodexTemplate={id:'roles',name:'Travelers',category:'custom',content:'',fields:{roles:'[]',rank:''},propertyDefinitions:[{id:'roles-id',key:'roles',label:'Roles',kind:'multiselect',presets:['Trader','Guide']},{id:'rank-id',key:'rank',label:'Calculated rank',kind:'number',formula:'=2+3'}],revision:0,createdAt:1,updatedAt:1};
async function bridge(name:string,args:Record<string,unknown>){const result=await runBridgeTool(name,args);assert(result.ok,`${name}: ${result.error}`);return result.result;}

export async function testCodexOptionColors(){
 const P=`option-colors-${Date.now()}`,passed:string[]=[];let clone:string|undefined;
 try{
  await db.projects.put(project(P));let saved=await saveCodexTemplate(P,template,null);
  const legacy=codexOptionAppearance(saved.propertyDefinitions![0],'Trader');assert(!legacy.color,'Legacy presets acquired an authored color');
  saved=await bridge('wh_save_codex_template',{projectId:P,expectedRevision:saved.revision,template:{...saved,propertyDefinitions:saved.propertyDefinitions!.map((row,index)=>index?row:{...row,optionColors:{Trader:'#123456',Guide:'#ffff00','Retired value':'#ff0000'}})}}).then(result=>(result as {template:CodexTemplate}).template);
  const schema=getBridgeTool('wh_save_codex_template')!.schema.properties.template as {properties:{propertyDefinitions:{items:{properties:Record<string,unknown>}}}};assert(schema.properties.propertyDefinitions.items.properties.optionColors,'Native schema does not describe option colors');
  const made=await bridge('wh_create_codex_entry',{projectId:P,title:'Travelers',templateId:saved.id,fields:{roles:'["Trader","Legacy custom"]'}})as {id:string};
  const read=await bridge('wh_get_codex_entry',{id:made.id}) as ReturnType<typeof projectCodexEntry>;assert(read.fields.roles==='Trader, Legacy custom'&&read.properties.roles.options?.[0].color==='#123456'&&read.properties.roles.options[0].ink==='#ffffff'&&!read.properties.roles.options[1].color,'Native projection lost colors or legacy custom selections');
  for(const colors of [{Trader:'red'},{Trader:'url(https://invalid)'},{Trader:'#12345'},{'':'#123456'}]){const invalid=await runBridgeTool('wh_save_codex_template',{projectId:P,expectedRevision:saved.revision,template:{...saved,propertyDefinitions:[{...saved.propertyDefinitions![0],optionColors:colors}]}});assert(!invalid.ok,'Invalid color was saved');}
  assert((await db.projects.get(P))!.codexTemplates![0].revision===saved.revision,'Refused metadata replaced a saved template');
  const stale=await runBridgeTool('wh_save_codex_template',{projectId:P,expectedRevision:saved.revision-1,template:saved});assert(!stale.ok,'Stale save unexpectedly succeeded');
  saved=await saveCodexTemplate(P,{...saved,propertyDefinitions:saved.propertyDefinitions!.map(row=>({...row,presets:['Guide','Trader']}))},saved.revision);
  const child=await saveCodexTemplate(P,{...template,id:'child',name:'Junior travelers',parentTemplateId:saved.id,propertyDefinitions:undefined,fields:{roles:'[]'},contentMode:'inherit'},null);
  const preview=await previewTemplateSync(P,saved.id);await applyTemplateSync(preview);const entry=(await db.codexEntries.get(made.id))!;
  assert(entry.fields.roles==='["Trader","Legacy custom"]'&&projectCodexEntry(entry,[saved]).properties.roles.options?.[0].color==='#123456','Reorder/sync changed selected values or moved colors by index');
  assert(projectCodexEntry({...entry,templateId:child.id},[saved,child]).properties.roles.options?.[0].color==='#123456','Inherited property lost its option metadata');
  passed.push('Registered normal template/card operations preserve legacy selections, bind colors by exact value, expose full schema and reject invalid/stale metadata without replacing saved data');
  await saveWorldEra(P,{id:'later',name:'Later',description:'',revision:0,createdAt:1,updatedAt:1},null);
  const own=await bridge('wh_create_codex_entry',{projectId:P,eraId:'later',title:'Later traveler',templateId:saved.id,fields:{roles:'["Guide"]'}})as {id:string};
  await deleteCodexTemplate(P,saved.id,saved.revision);
  const retired=(await db.codexEntries.get(made.id))!,eraRead=await bridge('wh_get_codex_entry',{projectId:P,eraId:'later',id:own.id})as ReturnType<typeof projectCodexEntry>;
  assert(projectCodexEntry(retired).properties.roles.options?.[0].color==='#123456'&&eraRead.properties.roles.options?.[0].color==='#ffff00','Retirement lost Base/era option metadata');
  clone=await importProjectData({project:(await db.projects.get(P))!,codexEntries:[retired]});const copy=(await db.codexEntries.where('projectId').equals(clone).toArray())[0];assert(projectCodexEntry(copy).properties.roles.options?.[0].color==='#123456','JSON clone lost retired option colors');
  passed.push('Normal sync, type retirement in Base and a named era, and project JSON clone retain selected values and option metadata');
  const div=document.createElement('div');div.innerHTML=codexPropertyHtml({...read.properties.roles,options:[{value:'<script>&"',color:'#123456',ink:'#ffffff'}]});assert(!div.querySelector('script')&&div.textContent==='<script>&"','Portable property markup changed authored text or injected markup');document.body.append(div);const chip=div.querySelector('span')!;assert(getComputedStyle(chip).backgroundColor==='rgb(18, 52, 86)'&&getComputedStyle(chip).color==='rgb(255, 255, 255)','Portable output did not retain readable colors');div.remove();
  assert(codexOptionAppearance(saved.propertyDefinitions![0],'Guide').ink==='#000000','Light option needs dark ink');
  passed.push('Portable HTML carries real selected colors and readable ink, escapes option text, and keeps the plain-text field projection unchanged');
  return passed;
 }finally{for(const id of [P,clone])if(id)await deleteProject(id);}
}

const channel=window as unknown as {__want:unknown;__sizeAck?:number;__shot:unknown;__shotDone?:string;__native:unknown;__nativeAck?:number};let sequence=0;
async function wait(check:()=>boolean){for(let i=0;i<200;i++){if(check())return;await pause();}throw Error('Option UI handshake timed out');}
async function native(events:unknown[]){const n=++sequence;await act(async()=>{channel.__native={n,events};await wait(()=>channel.__nativeAck===n);await pause();});}
async function click(node:HTMLElement){assert(node,'Missing UI control');node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect(),point={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),button:'left',clickCount:1};await native([{type:'mouseDown',...point},{type:'mouseUp',...point}]);}
async function text(node:HTMLInputElement,value:string){await click(node);await native([{type:'keyDown',keyCode:'A',modifiers:['control']},{type:'keyUp',keyCode:'A',modifiers:['control']},{type:'text',text:value}]);}
export async function testCodexOptionColorLayout(){
 const P=`option-color-ui-${Date.now()}`,host=document.getElementById('root')!,root=createRoot(host),passed:string[]=[];
 const render=async(node:React.ReactNode)=>{await act(async()=>{root.render(<MemoryRouter>{node}</MemoryRouter>);await pause(180);});await act(async()=>{await pause(160);});};
 try{
  useLocaleStore.setState({locale:'en'});await db.projects.put(project(P));let saved=await saveCodexTemplate(P,template,null);
  const made=await bridge('wh_create_codex_entry',{projectId:P,title:'Mara, the traveler',templateId:saved.id,fields:{roles:'["Trader","Legacy custom"]'}})as {id:string};
  for(const width of [1440,640]){
   const n=++sequence;await act(async()=>{channel.__want={w:width,h:1000,n};await wait(()=>channel.__sizeAck===n);});
   await render(<CodexTemplateManager key={`manager-${width}`} projectId={P} open initial={saved} onClose={()=>{}} onUse={()=>{}}/>);
   const details=document.querySelector<HTMLDetailsElement>('[data-property-definition="roles"]')!;details.open=true;
   await text(document.querySelector<HTMLInputElement>('[aria-label="Color value · roles · Trader"]')!,width===1440?'#123456':'#264653');
   await text(document.querySelector<HTMLInputElement>('[aria-label="Color value · roles · Guide"]')!,'#ffff00');
   details.scrollIntoView({block:'center'});await pause();
   const editorShot=`option-editor-${width}`;await act(async()=>{channel.__shot={name:editorShot};await wait(()=>channel.__shotDone===editorShot);});
   await click([...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.trim()==='Save template')!);await act(async()=>{await pause(200);});saved=(await db.projects.get(P))!.codexTemplates![0];assert(saved.propertyDefinitions!.find(row=>row.key==='roles')!.optionColors?.Trader===(width===1440?'#123456':'#264653'),'Actual property editor did not save its color');
   let entry=(await db.codexEntries.get(made.id))!;await render(<main className="mx-auto max-w-4xl bg-deep p-5"><CodexEntryForm key={`entry-${width}`} projectId={P} entry={entry} onSave={async(candidate,base)=>{await saveCodexDraft(base??entry,candidate);}} onCancel={()=>{}}/></main>);
   const guide=document.querySelector<HTMLElement>('[data-option-value="Guide"]')!,trader=document.querySelector<HTMLElement>('[data-option-value="Trader"]')!;
   assert(getComputedStyle(guide).backgroundColor==='rgb(255, 255, 0)'&&getComputedStyle(guide).color==='rgb(0, 0, 0)'&&getComputedStyle(trader).color==='rgb(255, 255, 255)','Actual chip styles are not readable');assert([...document.querySelectorAll('output')].some(node=>node.textContent==='5'),'Actual card did not show its live calculated rank');
   await click(guide.querySelector('input')!);assert(guide.querySelector('input')!.checked,'Native pointer did not select the colored option');await native([{type:'keyDown',keyCode:'SPACE'},{type:'keyUp',keyCode:'SPACE'}]);assert(!guide.querySelector('input')!.checked,'Keyboard did not toggle the selected chip');
   await text(document.querySelector<HTMLInputElement>('[aria-label="Roles · Add option"]')!,'Scout');await native([{type:'keyDown',keyCode:'ENTER'},{type:'keyUp',keyCode:'ENTER'}]);assert(document.querySelector('[data-option-value="Scout"] input:checked'),'Enter did not add a custom selected value');
   trader.scrollIntoView({block:'center'});await pause();assert(document.documentElement.scrollWidth<=innerWidth+1,'Card form overflows the window');for(const chip of document.querySelectorAll('[data-option-value]')){const rect=chip.getBoundingClientRect();assert(rect.left>=0&&rect.right<=innerWidth,'Option chip overflow');}
   const cardShot=`option-card-${width}`;await act(async()=>{channel.__shot={name:cardShot};await wait(()=>channel.__shotDone===cardShot);});
   await click([...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.trim()==='Save Changes')!);await act(async()=>{await pause(150);});entry=(await db.codexEntries.get(made.id))!;assert(JSON.parse(entry.fields.roles).includes('Scout')&&JSON.parse(entry.fields.roles).includes('Legacy custom'),'Normal card save lost custom/legacy values');
   passed.push(`Actual CSS ${width}px: normal option editor saves colors; native pointer/keyboard select chips and add a custom value; normal card save preserves legacy selections`);
  }
  return passed;
 }finally{await act(async()=>root.unmount());await deleteProject(P);}
}
