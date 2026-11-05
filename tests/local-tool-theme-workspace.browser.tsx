// DIAGNOSTIC ONLY: deliberately drives the existing stage preview, and must not ship in the product suite.
// One real fixture, one pass, DOM-only controls, two screenshots; no handlers or clients are replaced.
import {act} from 'react';

type Receipt={prepared?:boolean;ok?:boolean;cleaned?:boolean;at?:string;error?:string;projectId?:string;sourceA?:string;sourceB?:string;ownProjects?:number;ownTabsRemoved?:boolean;totalProjects?:number;initialProjects?:number;tablesCompared?:number;zeroBusinessWrites?:boolean;controlExact?:boolean;pendingExact?:boolean;records?:RecordView[]};
type RecordView={documentId:string;eraId:string|null;draft:string;saved:unknown;theme:{mode:string;tokens:Record<string,string>};canvas:{ink:string;pixel:number[];sameNodeSincePrior:boolean|null};sameDraftNodeSincePrior:boolean|null};
const qa=window as unknown as {__testStage?:string;__want?:{w:number;h:number;n:number}|null;__sizeAck?:number;__shot?:{name:string}|null;__shotDone?:string;__themeWorkspaceDiagnostic?:unknown};
const pause=()=>new Promise<void>(resolve=>setTimeout(resolve,25));
function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
function stage(name:string,detail?:unknown){qa.__testStage='THEME_WORKSPACE '+name;console.log('THEME_WORKSPACE '+name+(detail===undefined?'':' '+JSON.stringify(detail)));}
async function until(predicate:()=>unknown,message:string){const limit=Date.now()+20000;while(Date.now()<limit){if(predicate())return;await act(async()=>{await pause();});}throw Error(message);}
function receipt():Receipt{const node=document.querySelector('[data-testid="theme-preview-receipt"]');check(node,'Preview receipt DOM absent');return JSON.parse(node.textContent||'{}') as Receipt;}
function button(parent:ParentNode,name:string){const node=Array.from(parent.querySelectorAll<HTMLButtonElement>('button')).find(node=>node.textContent?.trim()===name);check(node,'Missing real button: '+name);return node;}
async function click(node:HTMLElement){check(!(node instanceof HTMLButtonElement)||!node.disabled,'Real button is disabled: '+node.textContent);await act(async()=>{node.click();await pause();});}
async function input(node:HTMLInputElement|HTMLTextAreaElement,value:string){await act(async()=>{const prototype=node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));await pause();});}
function source(id:string){const host=document.querySelector<HTMLElement>(`[data-source-document-host="${id}"]`);check(host,'Real Source host absent: '+id);return host;}
function notes(host:HTMLElement){const node=host.querySelector<HTMLTextAreaElement>('textarea');check(node&&!node.disabled,'Real notes not ready');return node;}
function canvas(host:HTMLElement){const node=host.querySelector<HTMLCanvasElement>('canvas');check(node,'Real selected icon Canvas absent');return node;}
function ready(host:HTMLElement){const node=host.querySelector<HTMLCanvasElement>('canvas'),textarea=host.querySelector<HTMLTextAreaElement>('textarea');if(!node||!textarea||textarea.disabled)return false;const context=node.getContext('2d');if(!context||!node.width||!node.height)return false;const pixels=context.getImageData(0,0,node.width,node.height).data;return pixels.some((value,index)=>index%4===3&&value>240);}
async function query(label:string,previousAt?:string){
 stage(label+' before click');await click(button(document,'Consultar SDK / MCP / CSS'));stage(label+' click returned');
 await until(()=>{const value=receipt();if(value.ok===false)throw Error('Preview query rejected: '+JSON.stringify(value));return value.ok===true&&value.at!==previousAt;},label+' did not publish a fresh successful receipt');
 const value=receipt();check(value.records?.length===2,'Preview did not report both real Sources');check(value.tablesCompared===88&&value.zeroBusinessWrites&&value.controlExact&&value.pendingExact,'Preview did not preserve tables/control/ledger');stage(label+' receipt',value);return value;
}
function record(value:Receipt,id:string){const found=value.records?.find(item=>item.documentId===id);check(found,'Receipt omitted Source '+id);return found;}
function preserved(value:Receipt,baseline:Receipt,ids:string[],drafts:string[]){for(let index=0;index<ids.length;index++){const current=record(value,ids[index]),original=record(baseline,ids[index]);check(JSON.stringify(current.saved)===JSON.stringify(original.saved),'Saved Source changed during appearance UI');check(current.draft===drafts[index],'Draft changed during appearance UI');check(current.canvas.sameNodeSincePrior===true&&current.sameDraftNodeSincePrior===true,'Preview reported a replaced Canvas/textarea');}}
async function appearance(id:string,mode:'light'|'dark'){
 const host=source(id),pane=host.closest<HTMLElement>('.workspace-appearance-pane');check(pane,'Real Workspace appearance ancestor absent');const form=pane.querySelector<HTMLDetailsElement>('[data-testid="workspace-appearance"]');check(form,'Real Appearance form absent');
 stage('appearance '+id+' '+mode+' before controls');if(!form.open){const summary=form.querySelector('summary');check(summary,'Appearance disclosure absent');await click(summary);}
 const select=form.querySelector<HTMLSelectElement>('[aria-label="Tema del espacio"],[aria-label="Workspace theme"]');check(select,'Real workspace theme select absent');
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')!.set!.call(select,mode);select.dispatchEvent(new Event('change',{bubbles:true}));await pause();});
 const save=Array.from(form.querySelectorAll<HTMLButtonElement>('button')).find(node=>['Guardar apariencia','Save appearance'].includes(node.textContent?.trim()??''));check(save,'Real Save appearance button absent');await click(save);
 await until(()=>/Apariencia guardada\.|Appearance saved\./.test(form.textContent??'')&&getComputedStyle(host).colorScheme===mode,'Real Appearance save did not commit '+mode);
 const summary=form.querySelector('summary');check(summary,'Appearance disclosure disappeared');if(form.open)await click(summary);stage('appearance '+id+' '+mode+' saved');
}
async function screenshot(name:string){
 check(innerWidth===1280,'Visual viewport must remain exactly 1280');check(document.documentElement.scrollWidth<=innerWidth+1,'Workspace overflows the visual viewport');
 for(const host of document.querySelectorAll<HTMLElement>('[data-source-document-host]')){host.closest<HTMLElement>('.overflow-y-auto')?.scrollTo({top:0,behavior:'instant'});const bounds=canvas(host).getBoundingClientRect();check(bounds.top>=0&&bounds.bottom<=innerHeight,'Selected icon is outside the screenshot');}
 stage('capture '+name);qa.__shot={name};await until(()=>qa.__shotDone===name,'Screenshot handshake absent: '+name);
}

export async function testLocalToolThemeWorkspacePreviewDiagnostic(){
 let lastReceipt:Receipt|undefined;let prepared=false;
 try{
  stage('import preview');const root=document.getElementById('root');check(root,'Runner root absent');root.style.height='100vh';document.body.style.margin='0';
  // Dynamic import keeps the real preview's createRoot/render inside act. No preview API is exposed.
  await act(async()=>{await import('../_stage/sdk-theme-world-next/preview/preview');await pause();});
  await until(()=>Array.from(document.querySelectorAll('button')).some(node=>node.textContent?.trim()==='Preparar'),'Preview did not mount');
  stage('prepare before click');await click(button(document,'Preparar'));
  await until(()=>{const value=receipt();if(value.ok===false)throw Error('Prepare rejected: '+JSON.stringify(value));return value.prepared===true;},'Prepare did not complete');
  const fixture=receipt();check(fixture.sourceA&&fixture.sourceB&&fixture.projectId,'Prepare receipt lacks own Source IDs');prepared=true;stage('prepared',fixture);
  await click(button(document,'Abrir Sources'));stage('Sources open clicked');
  await until(()=>!!document.querySelector(`[data-source-document-host="${fixture.sourceA}"]`)&&!!document.querySelector(`[data-source-document-host="${fixture.sourceB}"]`),'Both real Sources did not mount');
  const ids=[fixture.sourceA,fixture.sourceB],drafts=['Borrador A · integración real Tema1532','Borrador B · integración real Tema1532'];
  await until(()=>ids.every(id=>ready(source(id))),'Both notes/selected Canvases did not become ready');
  for(let index=0;index<ids.length;index++){
   const host=source(ids[index]),search=host.querySelector<HTMLInputElement>('input[type="search"]');check(search,'Real symbol search absent');await input(search,'BookOpen');
   await until(()=>{const list=host.querySelector('ul[aria-label="Símbolos disponibles"],ul[aria-label="Available symbols"]');return list&&list.querySelectorAll('li').length>0&&list.querySelectorAll('li').length<=10;},'BookOpen search did not produce a bounded real catalogue page');
   await input(notes(host),drafts[index]);check(notes(host).value===drafts[index],'Actual notes input did not retain its draft');
  }
  stage('both drafts ready');lastReceipt=await query('initial query');const baseline=lastReceipt;
  for(let index=0;index<ids.length;index++){const initial=record(baseline,ids[index]);check(initial.draft===drafts[index]&&initial.theme.mode==='dark','Initial real Source/dark baseline mismatch');}
  // Reach this only after the same query that stalled in Brave has completed successfully.
  qa.__want={w:1280,h:1200,n:1532};await until(()=>qa.__sizeAck===1532&&innerWidth===1280,'1280 visual resize handshake absent');await screenshot('theme-workspace-before-1280');
  await appearance(ids[0],'light');lastReceipt=await query('Base light query',lastReceipt.at);preserved(lastReceipt,baseline,ids,drafts);
  check(ids.every(id=>record(lastReceipt!,id).theme.mode==='light'),'Inherited era did not follow the Base light appearance');
  await appearance(ids[1],'dark');lastReceipt=await query('era dark query',lastReceipt.at);preserved(lastReceipt,baseline,ids,drafts);
  check(record(lastReceipt,ids[0]).theme.mode==='light'&&record(lastReceipt,ids[1]).theme.mode==='dark','Two real panels lost independent Base/era modes');
  check(record(lastReceipt,ids[0]).canvas.ink!==record(baseline,ids[0]).canvas.ink,'Base icon ink did not change from the original dark appearance');
  await screenshot('theme-workspace-after-1280');
  stage('cleanup before click');await click(button(document,'Limpiar'));await until(()=>receipt().cleaned===true,'Normal preview cleanup did not finish');const cleanup=receipt();check(cleanup.ownProjects===0&&cleanup.ownTabsRemoved&&cleanup.totalProjects===cleanup.initialProjects,'Normal cleanup left own projects/tabs');check(!document.querySelector('[data-testid="project-workspace"]'),'Cleanup did not unmount Workspace');
  qa.__themeWorkspaceDiagnostic={ok:true,fixture,baseline,final:lastReceipt,cleanup,screenshots:['theme-workspace-before-1280','theme-workspace-after-1280']};stage('complete',qa.__themeWorkspaceDiagnostic);
  return['DIAGNOSTIC stage preview: actual ProjectWorkspace and two Source hosts; DOM Prepare/Open/search/drafts/query; real Base light/era dark Appearance saves; stable nodes/drafts/notes and readonly SDK/MCP/CSS/Canvas receipts; two 1280 screenshots and normal cleanup'];
 }catch(error){
  // Retain the first failing fixture and exact DOM receipt. No cleanup, retries, alternate assertions or product changes.
  let current:unknown;try{current=receipt();}catch(readError){current={receiptReadError:String(readError)};}
  qa.__themeWorkspaceDiagnostic={ok:false,stage:qa.__testStage,prepared,lastReceipt,current,error:error instanceof Error?error.stack:String(error),fixtureRetained:prepared};console.error('THEME_WORKSPACE_FIRST_FAILURE '+JSON.stringify(qa.__themeWorkspaceDiagnostic));throw error;
 }
}
