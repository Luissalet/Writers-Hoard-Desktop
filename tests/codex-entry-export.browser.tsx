import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import CodexEntryList from '@/components/codex/CodexEntryList';
import {db} from '@/db';
import {useLocaleStore} from '@/stores/localeStore';
import type {Project,CodexEntry} from '@/types';
import JSZip from 'jszip';
import Dexie from 'dexie';
import {prepareCodexEntryExport,codexEntryMarkdown,reserveCodexPrintView,captureCodexEntryImage} from '@/services/codexEntryExport';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {saveEraDocument,readWorldDocument,hideEraDocument} from '@/services/worldEras/store';
import {registerLocalToolModules} from '@/engines/local/registry';
import richDefinition from '@/engines/local/installed/examples.rich-prose/module';
import {createLocalToolBlockEnvelope} from '@/engines/local/blocks/definitions';
import {serializeLocalToolBlock} from '@/engines/local/blocks/types';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {deleteProject} from '@/db/operations';
import {downloadDocumentImage} from '@/services/documentImage';
import type {DocumentImageResult} from '@/services/documentImage/types';

function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const pause=(ms=80)=>new Promise(resolve=>setTimeout(resolve,ms));
const project:Project={id:'card-export-own',title:'Harbour world',description:'',type:'standalone',mode:'custom',color:'#777777',status:'draft',enabledEngines:['codex'],engineOrder:['codex'],createdAt:1,updatedAt:1};
const entry:CodexEntry={id:'card-export-one',projectId:project.id,title:'Harbour keeper',type:'location',content:'<h2>Harbour clues</h2><p>Saved card body.</p>',fields:{rank:'0'},tags:['port'],relations:[],createdAt:1,updatedAt:1};

export async function testCodexEntryExportAction(){
 const host=document.getElementById('root')!,root=createRoot(host);useLocaleStore.setState({locale:'en'});
 await db.projects.put(project);await db.codexEntries.put(entry);
 try{
  await act(async()=>{root.render(<MemoryRouter><CodexEntryList projectId={project.id} entries={[entry]} focusEntryId={entry.id} onAdd={async()=>{throw Error('Unexpected write');}} onEdit={async()=>{throw Error('Unexpected write');}} onDelete={()=>{throw Error('Unexpected delete');}}/></MemoryRouter>);await pause(250);});
  await act(async()=>{await pause(150);});
  assert(document.querySelector('[role="dialog"]')?.textContent?.includes(entry.title),'Positive control: saved card dialog did not open');
  assert([...document.querySelectorAll('button')].some(button=>button.textContent?.trim()==='Edit'),'Positive control: incumbent Edit action missing');
  assert(document.body.textContent?.includes('Saved card body.'),'Positive control: saved card prose absent');
  assert([...document.querySelectorAll('button')].some(button=>button.textContent?.trim()==='Export'),'Saved author card has no individual Export action');
  return ['Saved author card offers individual Export beside incumbent Edit, without saving or deleting'];
 }finally{await act(async()=>root.unmount());await db.codexEntries.delete(entry.id);await db.projects.delete(project.id);}
}

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6mWQAAAAASUVORK5CYII=';
async function fixture(){
 const id='card-export-'+crypto.randomUUID();
 registerLocalToolModules({'./installed/examples.rich-prose/module.tsx':{default:richDefinition}});
 const own={...project,id,worldEras:[{id:'past',name:'Old harbour',description:'',revision:1,createdAt:1,updatedAt:1}],codexTemplates:[{id:'keeper',name:'Keeper',category:'custom' as const,fields:{cost:'2',quantity:'3',total:''},content:'',revision:1,createdAt:1,updatedAt:1,referenceFieldDefinitions:[{key:'friend',label:'Entry links'}],propertyDefinitions:[{id:'p-cost',key:'cost',label:'Cost',kind:'number' as const},{id:'p-quantity',key:'quantity',label:'Quantity',kind:'number' as const},{id:'p-total',key:'total',label:'Total',kind:'number' as const,formula:'=@[Cost] * @[Quantity]'}]}]};
 await db.projects.put(own);const source=await createSourceToolDocument({projectId:id},richDefinition.namespace,'Source report');
 const row=(await db.projects.get(id))!;await db.projects.update(id,{sourceToolDocuments:row.sourceToolDocuments!.map(item=>item.id===source.id?{...item,data:{briefing:'<h2>Source saved briefing</h2><ul><li>Source item</li></ul>',caption:'Source'}}:item)});
 const envelope=createLocalToolBlockEnvelope(richDefinition.namespace,richDefinition.blocks![0],'owned-export');assert(envelope.scope==='host','Own fixture envelope wrong');envelope.data={briefing:'<h2>Owned saved briefing</h2><p>Owned portable prose.</p>',caption:'Owned'};
 const card={...entry,id:id+'-entry',projectId:id,templateId:'keeper',fields:{cost:'4',quantity:'3',zero:'0',false:'false'},referenceFields:{friend:[id+'-other']},relations:[{targetId:id+'-other',targetTitle:'STALE NAME',type:'knows',description:''}],content:'<h2>Saved harbour clues</h2><ul><li>Find lighthouse</li><li>Ask captain</li></ul><img src="'+png+'" alt="port">'+serializeLocalToolBlock(id,envelope)+`<figure data-wh-tool-block="true" data-project-id="${id}" data-tool-kind="local-tool" data-document-id="${source.id}" data-namespace="${richDefinition.namespace}" data-label="Source"></figure>`};
 await db.codexEntries.bulkPut([card,{...entry,id:id+'-other',projectId:id,title:'Current neighbour',content:'<p>DO_NOT_EXPORT_OTHER_CARD_BODY</p>'}]);return{id,card,source};
}
const rejects=async(action:()=>Promise<unknown>,message:string)=>{let failed=false;try{await action();}catch{failed=true;}assert(failed,message);};

export async function testCodexEntryExportArtifacts(){
 const f=await fixture();try{
  const before=JSON.stringify(await db.projects.get(f.id)),artifact=await prepareCodexEntryExport({projectId:f.id,entryId:f.card.id,locale:'en'});
  assert(artifact.prepared.html.includes('Owned saved briefing')&&artifact.prepared.html.includes('Source saved briefing'),'Captured Source/Owned rich projection missing');
  assert(artifact.prepared.html.includes('12')&&artifact.prepared.html.includes('Current neighbour'),'Derived property or effective relation missing');
  const md=await codexEntryMarkdown(artifact),text=await md.blob.text();
  assert(md.mime.startsWith('text/markdown')&&text.includes('total: "12"')&&text.includes('Find lighthouse')&&text.includes('Owned saved briefing'),'Markdown real bytes missing projected fields/rich body');
  assert(text.includes('Current neighbour')&&!text.includes('STALE NAME')&&!text.includes('[[Current neighbour]]')&&!text.includes('DO_NOT_EXPORT_OTHER_CARD_BODY'),'Outside-card reference copied or made fictitious file');
  const zipped=await codexEntryMarkdown(artifact,true),zip=await JSZip.loadAsync(zipped.blob),names=Object.keys(zip.files).filter(name=>!zip.files[name].dir);
  assert(names.filter(name=>name.endsWith('.md')).length===1&&names.some(name=>name.startsWith('media/'))&&!names.includes('world.json')&&!names.includes('index.md'),'Individual ZIP expanded to a vault or omitted image');
  const image=names.find(name=>name.endsWith('.png'))!;assert((await zip.file(image)!.async('uint8array')).length===atob(png.split(',')[1]).length,'ZIP raster bytes changed');
  await db.codexEntries.update(f.card.id,{content:'<p>NEW_LIVE_TEXT</p>',updatedAt:4});await db.projects.update(f.id,{updatedAt:9});
  assert(await (await codexEntryMarkdown(artifact)).blob.text()===text,'Prepared bytes changed after unrelated/live writes');
  assert(JSON.parse(before).sourceToolDocuments[0].revision===(await db.projects.get(f.id))!.sourceToolDocuments![0].revision,'Export wrote Source state');
  const scope={projectId:f.id,eraId:'past'},read=await readWorldDocument(scope,'codex',f.card.id);assert(read,'Era inherited card missing');
  await saveEraDocument(scope,'codex',{root:{...read.document.root,content:'<p>ERA_ONLY_CARD</p>'},children:{}},read.version);
  const era=await prepareCodexEntryExport({...scope,entryId:f.card.id,locale:'en'});assert(era.prepared.html.includes('ERA_ONLY_CARD')&&!era.prepared.html.includes('NEW_LIVE_TEXT'),'Era card fell back to Base');
  const saved=await readWorldDocument(scope,'codex',f.card.id);await hideEraDocument(scope,'codex',f.card.id,saved!.version);await rejects(()=>prepareCodexEntryExport({...scope,entryId:f.card.id}),'Hidden era fell back to Base');
  await rejects(()=>prepareCodexEntryExport({projectId:f.id,entryId:'foreign'}),'Foreign ID was resolved');
  return ['One saved author card: actual Markdown/ZIP bytes, formulas, Source/Owned rich content, local raster and readable outside references','Prepared artifacts stay fixed after live writes; effective era and hidden/missing scoped cards never fall back to Base'];
 }finally{await deleteProject(f.id);}
}

export async function testCodexEntryExportMcp(){
 const f=await fixture();try{
  const before=JSON.stringify(await db.projects.get(f.id)),out=await runBridgeTool('wh_world_markdown_export',{projectId:f.id,entryId:f.card.id,locale:'en'});assert(out.ok,JSON.stringify(out));const value=out.result as {base64:string;mime:string;bytes:number};const bytes=Uint8Array.from(atob(value.base64),char=>char.charCodeAt(0));assert(value.mime.startsWith('text/markdown')&&bytes.length===value.bytes&&new TextDecoder().decode(bytes).includes('Owned saved briefing'),'Registered Markdown dispatcher artifact invalid');
  const html=await runBridgeTool('wh_build_world_bible',{projectId:f.id,presentation:'card',entryIds:[f.card.id],sections:['codex'],locale:'en'});assert(html.ok&&(html.result as{html:string}).html.includes('Source saved briefing'),'Registered card Bible not projected');
  for(const args of [{entryIds:[f.card.id,f.card.id]},{entryIds:[f.card.id],sections:[]},{entryIds:[f.card.id],timelineIds:['other']},{entryIds:[f.card.id],sections:['maps']}]){const bad=await runBridgeTool('wh_build_world_bible',{projectId:f.id,presentation:'card',...args});assert(!bad.ok,'Conflicting card selection admitted '+JSON.stringify(args));}
  for(const args of [{eraId:'past'},{entryId:''},{entryId:f.card.id,eraId:false}])assert(!(await runBridgeTool('wh_world_markdown_export',{projectId:f.id,...args})).ok,'Invalid Markdown args admitted');
  assert(!(await runBridgeTool('wh_build_world_bible',{projectId:f.id,eraId:'past'})).ok,'Era silently used legacy Bible');
  assert(before===JSON.stringify(await db.projects.get(f.id)),'Readonly MCP export wrote project');
  return ['Registered MCP Markdown and card Bible branches preserve real artifact bytes and reject conflicting singleton/era selections without writes'];
 }finally{await deleteProject(f.id);}
}

export async function testCodexEntryExportPrintOwnership(){
 const original=window.open,frame=document.createElement('iframe');document.body.append(frame);const tab=frame.contentWindow!;let closed=false;
 const proxy={get document(){return tab.document;},get location(){return tab.location;},get closed(){return closed;},opener:null,close(){closed=true;}};
 try{
  window.open=(()=>proxy as unknown as Window) as typeof window.open;
  const reserved=reserveCodexPrintView();assert(reserved,'Print reservation failed');
  frame.srcdoc='<p>NAVIGATED_DESTINATION</p>';await new Promise(resolve=>{frame.onload=resolve;});
  assert(!reserved.show('<h1>SHOULD_NOT_WRITE</h1>')&&tab.document.body.textContent?.includes('NAVIGATED_DESTINATION'),'Late print overwrote a different document');reserved.cancel();assert(!closed,'Cancellation closed navigated destination');
  window.open=(()=>null) as typeof window.open;assert(reserveCodexPrintView()===null,'Popup-blocked result fabricated tab');
  return ['Print-view owner checks actual Document identity after navigation; cancel never closes adopted destination and blocked popup is explicit'];
 }finally{window.open=original;frame.remove();}
}

export async function testCodexEntryExportNative(){
 const f=await fixture();const native=window as unknown as{cardExportQa:{execute:(payload:{tool:string;args:object})=>Promise<{ok:boolean;result:unknown;error?:unknown}>};__codexEntryExportNative:unknown};
 assert(native.cardExportQa,'Run with own Native wrapper');
 await db.codexEntries.update(f.card.id,{fields:{...f.card.fields,aliases:'["Torre QA1496"]',notableFeatures:'F1_NATIVE_WALL'},content:f.card.content+Array.from({length:95},(_,index)=>`<p>Long saved card paragraph ${index}. Native complete-flow export.</p>`).join('')});
 const call=async(tool:string,args:object)=>{const result=await native.cardExportQa.execute({tool,args});assert(result.ok,JSON.stringify(result));return result;};
 const request={projectId:f.id,kind:'codex',entityId:f.card.id,width:640,pageHeight:640,pixelRatio:1,locale:'en'};
 const html=await call('wh_build_world_bible',{projectId:f.id,presentation:'card',entryIds:[f.card.id],locale:'en'});
 const pdfResult=await call('wh_export_world_bible',{projectId:f.id,presentation:'card',entryIds:[f.card.id],format:'pdf',locale:'en'});
 await db.codexEntries.update(f.card.id,{title:'cancel-'+f.card.title});const cancelResult=await native.cardExportQa.execute({tool:'wh_export_world_bible',args:{projectId:f.id,presentation:'card',entryIds:[f.card.id],format:'pdf',locale:'en'}});assert(!cancelResult.ok&&(cancelResult as{code?:string}).code==='canceled','Native cancellation must be explicit and unsuccessful '+JSON.stringify(cancelResult));
 await db.codexEntries.update(f.card.id,{title:f.card.title});const pngResult=await call('wh_export_document_image',request);
 const captured=await prepareCodexEntryExport({projectId:f.id,entryId:f.card.id,locale:'en'});assert(captured.prepared.html.includes('Current neighbour'),'Captured PNG lacks Entry links');assert(captured.prepared.html.includes('Notable Features')&&captured.prepared.html.includes('Torre QA1496')&&!captured.prepared.html.includes('[&quot;Torre QA1496'),'Captured PNG lost readable builtin presentation');const capturedPngResult=await captureCodexEntryImage(captured);
 native.__codexEntryExportNative={html:(html.result as{html:string}).html,request,pdfResult,cancelResult,pngResult,capturedPngResult,expectedText:['Harbour keeper','Saved harbour clues','Owned saved briefing','Source saved briefing','Entry links','Current neighbour','Notable Features','Torre QA1496','F1_NATIVE_WALL'],excludedText:['DO_NOT_EXPORT_OTHER_CARD_BODY','["Torre QA1496"]']};
 return ['Native executor→registered card build/export and document-image handler→actual PDF/PNG IPC, success and canceled destination'];
}

export async function testCodexEntryExports(){return [...await testCodexEntryExportAction(),...await testCodexEntryExportArtifacts(),...await testCodexEntryExportMcp(),...await testCodexEntryExportPrintOwnership(),...await testCodexEntryExportPngAdmission(),...await testCodexEntryExportReadability(),...await testCodexEntryExportUiLifetime(),...await testCodexEntryExportMedia(),...await testCodexEntryExportNarrow(),...await testCodexEntryExportBuiltinPresentation()];}

export async function testCodexEntryExportPngAdmission(){
 const oldFetch=window.fetch,oldClick=HTMLAnchorElement.prototype.click;let release!:(value:Response)=>void,started!:()=>void,valid=true,downloads=0;
 const ready=new Promise<void>(resolve=>started=resolve),held=new Promise<Response>(resolve=>release=resolve);
 window.fetch=(async()=>{started();return held;}) as typeof fetch;HTMLAnchorElement.prototype.click=function(){downloads++;};
 const result:DocumentImageResult={projectId:'admission',eraId:null,kind:'codex',entityId:'card',title:'Card',filename:'card.png',sourceVersion:'captured',dependencies:{},pixelRatio:1,framing:{mode:'complete-flow'},width:1,height:1,pages:[{index:1,x:0,y:0,width:1,height:1,pixelWidth:1,pixelHeight:1,dataUrl:png}]};
 try{const pending=Reflect.apply(downloadDocumentImage,null,[result,()=>valid]);await ready;valid=false;release(new Response(new Blob(['native page bytes'])));await pending;assert(downloads===0,'PNG downloaded after owner revoked during asynchronous blob preparation');return ['PNG download revalidates owner after blob preparation before emitting the file'];}
 finally{window.fetch=oldFetch;HTMLAnchorElement.prototype.click=oldClick;}
}

export async function testCodexEntryExportReadability(){
 const f=await fixture();try{
  const p=(await db.projects.get(f.id))!,template=p.codexTemplates![0];
  await db.projects.update(f.id,{codexTemplates:[{...template,referenceFieldDefinitions:[{key:'friend',label:'Entry links'}],propertyDefinitions:[...template.propertyDefinitions!,{id:'zero-id',key:'zero',label:'Repeated label',kind:'number'},{id:'false-id',key:'false',label:'Repeated label',kind:'text'}]}]});
  await db.codexEntries.update(f.card.id,{relations:[],referenceFields:{friend:[f.id+'-other','missing-target']}});
  const artifact=await prepareCodexEntryExport({projectId:f.id,entryId:f.card.id,locale:'en'}),text=await (await codexEntryMarkdown(artifact)).blob.text(),body=text.slice(text.indexOf('\n---\n')+5),errors:string[]=[];
  if(!artifact.prepared.html.includes('Entry links')||!artifact.prepared.html.includes('Current neighbour')||!artifact.prepared.html.includes('missing-target'))errors.push('HTML/PDF/PNG omitted labelled Entry links or target identity');
  if(!body.includes('| Repeated label | 0 |')||!body.includes('| Repeated label | false |'))errors.push('Markdown body concatenated property labels/values instead of readable distinct rows');
  assert(!errors.length,errors.join('; '));return ['Captured HTML includes labelled reference fields; Markdown keeps readable duplicate-label rows with zero/false and canonical YAML keys'];
 }finally{await deleteProject(f.id);}
}

async function until(check:()=>boolean|Promise<boolean>,message:string){const end=Date.now()+15000;while(Date.now()<end){if(await check())return;await act(async()=>{await pause(45);});}throw Error(message+' '+document.body.textContent?.slice(-600));}
const button=(text:string,host:ParentNode=document)=>[...host.querySelectorAll('button')].find(row=>row.textContent?.trim()===text);
const view=window as unknown as{__want:unknown;__sizeAck?:number;__shot:unknown;__shotDone?:string};
async function resize(width:number,n:number){view.__want={w:width,h:800,n};await until(()=>view.__sizeAck===n,'Resize ack missing');}

export async function testCodexEntryExportNarrow(){
 const f=await fixture(),root=createRoot(document.getElementById('root')!);useLocaleStore.setState({locale:'en'});try{
  await act(async()=>{root.render(<MemoryRouter><CodexEntryList projectId={f.id} entries={[f.card]} focusEntryId={f.card.id} onAdd={async()=>{}} onEdit={async()=>{}} onDelete={()=>{}}/></MemoryRouter>);});await until(()=>!!button('Export'),'Export action absent');await resize(390,1);
  const footer=button('Export')!.parentElement!,bounds=footer.getBoundingClientRect();assert([...footer.children].every(child=>child.getBoundingClientRect().right<=bounds.right+1),'Saved-card action footer overflows at390 with Export');
  return ['Saved-card four-action footer fits at390 with the normal CSS'];
 }finally{await act(async()=>root.unmount());await deleteProject(f.id);}
}

export async function testCodexEntryExportUiLifetime(){
 const f=await fixture(),root=createRoot(document.getElementById('root')!),oldClick=HTMLAnchorElement.prototype.click;let downloads=0,release:(()=>void)|undefined;HTMLAnchorElement.prototype.click=function(){downloads++;};
 useLocaleStore.setState({locale:'en'});
 try{
  const render=async(projectId=f.id)=>act(async()=>root.render(<MemoryRouter><CodexEntryList projectId={projectId} entries={[{...f.card,id:projectId+'-entry',projectId}]} focusEntryId={projectId+'-entry'} onAdd={async()=>{throw Error('Unexpected parent save');}} onEdit={async()=>{throw Error('Unexpected parent save');}} onDelete={()=>{throw Error('Unexpected delete');}}/></MemoryRouter>));
  const before=JSON.stringify(await db.projects.get(f.id));await render();await until(()=>!!button('Export'),'Saved modal absent');
  await act(async()=>button('Export')!.click());await until(()=>!!document.querySelector('[data-codex-entry-export]'),'Export panel absent');
  let entered!:()=>void;const ready=new Promise<void>(resolve=>entered=resolve),held=new Promise<void>(resolve=>release=resolve),blocked=db.transaction('rw',db.projects,async()=>{await db.projects.get(f.id);entered();await Dexie.waitFor(held);});await ready;
  await act(async()=>button('Markdown',document.querySelector('[data-codex-entry-export]')!)!.click());await act(async()=>button('Close',document.querySelector('[data-codex-entry-export]')!)!.click());release!();await blocked;await act(async()=>{await pause(500);});assert(downloads===0,'Closed export emitted late Markdown file');
  assert(before===JSON.stringify(await db.projects.get(f.id)),'Opening/canceling export saved parent or source');
  await act(async()=>button('Export')!.click());await until(()=>!!document.querySelector('[data-codex-entry-export]'),'Reopen failed');await act(async()=>button('Markdown',document.querySelector('[data-codex-entry-export]')!)!.click());await until(()=>downloads===1,'Normal Markdown control did not emit file');
  assert(before===JSON.stringify(await db.projects.get(f.id)),'Successful export wrote own data');
  await act(async()=>button('Close',document.querySelector('[data-codex-entry-export]')!)!.click());
  const hold=async()=>{let enter!:()=>void;const ready=new Promise<void>(resolve=>enter=resolve),gate=new Promise<void>(resolve=>release=resolve),tx=db.transaction('rw',db.projects,async()=>{await db.projects.get(f.id);enter();await Dexie.waitFor(gate);});await ready;return{tx};};
  await act(async()=>button('Export')!.click());let blocking=await hold();await act(async()=>button('Markdown',document.querySelector('[data-codex-entry-export]')!)!.click());await render('card-other-owner');await render();release!();await blocking.tx;await act(async()=>{await pause(450);});assert(downloads===1,'A→B→A revived old pending export');
  await until(()=>!!document.querySelector('[data-codex-entry-export]'),'Return owner panel absent');blocking=await hold();await act(async()=>button('Markdown',document.querySelector('[data-codex-entry-export]')!)!.click());await act(async()=>(document.querySelector('[data-testid="codex-player-view"]') as HTMLElement).click());release!();await blocking.tx;await act(async()=>{await pause(450);});assert(downloads===1&&!document.querySelector('[data-codex-entry-export]'),'Player-mode retarget emitted retained author export');
  return ['Real saved-card modal close/reopen and normal Markdown, with no parent/source writes','React owner A→B→A and player-mode retarget revoke pending author export irrevocably'];
 }finally{release?.();HTMLAnchorElement.prototype.click=oldClick;await act(async()=>root.unmount());await deleteProject(f.id);}
}

export async function testCodexEntryExportVisual(){
 const f=await fixture(),root=createRoot(document.getElementById('root')!);let n=30;const previous=useLocaleStore.getState().locale;
 try{
  const visibleEntries=await db.codexEntries.where('projectId').equals(f.id).toArray();await act(async()=>root.render(<MemoryRouter><CodexEntryList projectId={f.id} entries={visibleEntries} focusEntryId={f.card.id} onAdd={async()=>{}} onEdit={async()=>{}} onDelete={()=>{}}/></MemoryRouter>));
  for(const locale of ['en','es']as const){await act(async()=>useLocaleStore.getState().setLocale(locale));for(const width of [1280,390]){
   await resize(width,++n);const action=locale==='en'?'Export':'Exportar';await until(()=>!!button(action),'Export translated action missing');
   for(const panel of ['card','export']){
    if(panel==='export'){await act(async()=>button(action)!.click());await until(()=>!!document.querySelector('[data-codex-entry-export]'),'Panel absent');}
    const active=[...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!;await act(async()=>{await pause(350);});if(panel==='card'){const scrolling=active.querySelector<HTMLElement>('.overflow-y-auto');if(scrolling)scrolling.scrollTop=scrolling.scrollHeight;}assert(active.getBoundingClientRect().right<=innerWidth+1&&active.scrollWidth<=active.clientWidth+1,'Dialog overflow');
    const name=`card-export-${panel}-${locale}-${width}-settled`;view.__shot={name,forcePaint:true};await until(()=>view.__shotDone===name,'Capture ack missing');
    if(panel==='export')await act(async()=>button(locale==='en'?'Close':'Cerrar',document.querySelector('[data-codex-entry-export]')!)!.click());
   }
  }}return ['Normal CSS saved-card and Export dialogs, EN/ES1280/390 in one visual batch, no horizontal overflow'];
 }finally{await act(async()=>root.unmount());await useLocaleStore.getState().setLocale(previous);await deleteProject(f.id);}
}

export async function testCodexEntryExportMedia(){
 const f=await fixture();try{
  const bytes=new Uint8Array(44+800*2),data=new DataView(bytes.buffer),ascii=(at:number,text:string)=>{for(let i=0;i<text.length;i++)bytes[at+i]=text.charCodeAt(i);};ascii(0,'RIFF');data.setUint32(4,bytes.length-8,true);ascii(8,'WAVEfmt ');data.setUint32(16,16,true);data.setUint16(20,1,true);data.setUint16(22,1,true);data.setUint32(24,8000,true);data.setUint32(28,16000,true);data.setUint16(32,2,true);data.setUint16(34,16,true);ascii(36,'data');data.setUint32(40,1600,true);for(let i=0;i<800;i++)data.setInt16(44+i*2,Math.round(1200*Math.sin(i*.25)),true);
  const id=f.id+'-audio';await db.localMediaAssets.put({id,projectId:f.id,title:'Harbour bell',kind:'audio',mime:'audio/wav',blob:new Blob([bytes],{type:'audio/wav'}),size:bytes.length,notes:'Saved sound',tags:[],linkedEntryIds:[],createdAt:1,updatedAt:1});
  await db.codexEntries.update(f.card.id,{content:f.card.content+`<figure data-wh-media-block="true" data-project-id="${f.id}" data-asset-id="${id}"><figcaption>Harbour bell</figcaption></figure>`});
  const artifact=await prepareCodexEntryExport({projectId:f.id,entryId:f.card.id,locale:'en'});assert(artifact.prepared.html.includes('complete waveform'),'Captured media did not use native static waveform');
  await db.localMediaAssets.delete(id);const zip=await JSZip.loadAsync((await codexEntryMarkdown(artifact,true)).blob),file=Object.keys(zip.files).find(name=>name.endsWith('.wav'));assert(file,'ZIP omitted consumed local audio');const saved=await zip.file(file)!.async('uint8array');assert(saved.length===bytes.length&&saved.every((value,index)=>value===bytes[index]),'Captured WAV attachment bytes changed or read live');
  const plain=await (await codexEntryMarkdown(artifact,false)).blob.text();assert(plain.includes('Harbour bell')&&plain.includes('attachment not included'),'Media-off lost useful text');return ['Captured local WAV decodes to static waveform without playback; individual ZIP keeps exact consumed audio bytes after live asset deletion, media-off keeps text'];
 }finally{await deleteProject(f.id);}
}

export async function testCodexEntryExportBuiltinPresentation(){
 const f=await fixture();try{
  const stored={...f.card,templateId:undefined,propertyDefinitions:undefined,fields:{aliases:'["Torre QA1496","El puerto"]',notableFeatures:'Harbour walls',population:'0',flag:'false',customCamelKey:'Own value'}};
  await db.codexEntries.put(stored);const errors:string[]=[];
  for(const locale of ['en','es']as const){
   const artifact=await prepareCodexEntryExport({projectId:f.id,entryId:f.card.id,locale}),doc=new DOMParser().parseFromString(artifact.prepared.html,'text/html'),text=await(await codexEntryMarkdown(artifact)).blob.text(),body=text.slice(text.indexOf('\n---\n')+5),label=locale==='en'?'Notable Features':'Características Notables';
   const row=[...doc.querySelectorAll('dt')].find(dt=>dt.textContent===label);
   if(row?.nextElementSibling?.textContent!=='Harbour walls')errors.push(locale+': builtin field label is not human/localized');
   if(!doc.body.textContent?.includes('Torre QA1496 · El puerto')||doc.body.textContent?.includes('["Torre QA1496"'))errors.push(locale+': aliases expose JSON storage');
   if(!body.includes(`| ${label} | Harbour walls |`)||!body.includes('Torre QA1496 · El puerto')||body.includes('["Torre QA1496"'))errors.push(locale+': Markdown body does not use readable captured labels/aliases');
   assert(text.includes('notableFeatures: Harbour walls')&&text.includes('population: "0"')&&text.includes('flag: "false"'),'F1 oracle: canonical YAML or zero/false changed');
  }
  await db.codexEntries.put({...stored,propertyDefinitions:[{id:'explicit-feature',key:'notableFeatures',label:'Keep EXACT notableFeatures',kind:'text'},{id:'explicit-alias',key:'aliases',label:'Alias label AS-WRITTEN',kind:'text'}]});
  for(const locale of ['en','es']as const){const artifact=await prepareCodexEntryExport({projectId:f.id,entryId:f.card.id,locale}),doc=new DOMParser().parseFromString(artifact.prepared.html,'text/html');assert([...doc.querySelectorAll('dt')].some(row=>row.textContent==='Keep EXACT notableFeatures')&&[...doc.querySelectorAll('dt')].some(row=>row.textContent==='Alias label AS-WRITTEN'),'Explicit property labels were altered');}
  assert(!errors.length,errors.join('; '));return ['F1 normal builtin card EN/ES and Markdown body show readable aliases/localized labels, preserve explicit labels and canonical YAML zero/false'];
 }finally{await deleteProject(f.id);}
}
