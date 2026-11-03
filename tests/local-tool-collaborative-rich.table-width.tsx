import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {Extension,type Editor} from '@tiptap/core';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {defineLocalTool,LocalToolCollaborativeRichEditor,type LocalToolJson,type LocalToolProps} from '@/engines/local/sdk';
import original from '@/engines/local/installed/examples.shared-table-width/module';
import {createLocalToolClient} from '@/engines/local/storage';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {registerLocalToolModules} from '@/engines/local/registry';
import LocalToolDocumentHost from '@/engines/local/documents/LocalToolDocumentHost';
import {getPendingWritesSnapshot} from '@/services/pendingWrites';
import {useLocaleStore} from '@/stores/localeStore';
import type {RichBlockDocument} from '@/engines/local/convergence/blockFormat';

export async function testMountedTableWidths(){
 const checks:string[]=[],projectId='own-width-ui-'+crypto.randomUUID(),element=document.getElementById('root')!;
 const locale=useLocaleStore.getState().locale,ledger=getPendingWritesSnapshot();
 let root=createRoot(element),editor:Editor|undefined,readOnly=false,created=0;
 const equal=(label:string,a:unknown,b:unknown)=>{
  if(JSON.stringify(a)!==JSON.stringify(b))throw Error(label+': '+JSON.stringify([a,b]));
  checks.push(label);Reflect.set(window,'__testStage',label);
 };
 const button=(name:string)=>[...element.querySelectorAll<HTMLButtonElement>('button')].find(value=>value.textContent===name);
 const tick=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,25));});
 const wait=async(test:()=>boolean,label:string)=>{for(let n=0;n<120;n++){if(test())return;await tick();}throw Error(label+': '+element.textContent);};
 const click=async(name:string)=>{const target=button(name);if(!target||target.disabled)throw Error('Button unavailable: '+name);await act(async()=>target.click());await tick();};
 const editorTable=()=>editor!.view.dom.querySelector<HTMLTableElement>('table')!;
 const cells=()=>[...editorTable().rows[0].cells];
 const geometry=(cell:HTMLTableCellElement)=>Math.round(cell.getBoundingClientRect().width);
 const column=(index=0)=>editorTable().querySelectorAll<HTMLTableColElement>('colgroup col')[index];
 const pointer=(type:string,target:EventTarget,x:number,y:number)=>target.dispatchEvent(new PointerEvent(type,{pointerId:37,isPrimary:true,pointerType:'mouse',button:0,clientX:x,clientY:y,bubbles:true,cancelable:true}));
 const begin=async(index=0)=>{
  const cell=cells()[index],rect=cell.getBoundingClientRect(),x=rect.right-3,y=rect.top+4;
  await act(async()=>{pointer('pointerdown',cell,x,y);pointer('pointermove',window,x+48,y);});
  return{x,y,finish:()=>act(async()=>{pointer('pointerup',window,x+48,y);})};
 };
 try{
  equal('private library starts empty',(await Promise.all(db.tables.map(table=>table.count()))).every(count=>count===0),true);
  useLocaleStore.setState({locale:'en'});
  const extensions=[Extension.create({name:'observeTableWidths2082',onCreate(){editor=this.editor;created++;}})];
  function Fixture({client,context}:LocalToolProps<LocalToolJson>){return <LocalToolCollaborativeRichEditor client={client} context={context} field="body" editable={!readOnly} extensions={extensions}/>;}
  const definition=defineLocalTool({...original,namespace:'tests.table-width-ui',component:Fixture});
  registerLocalToolModules({'./installed/tests.table-width-ui/module.tsx':{default:definition}});
  await db.projects.add({id:projectId,title:projectId,description:projectId,mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:['local-tool-'+definition.namespace],createdAt:1,updatedAt:1});
  const documentId=(await createSourceToolDocument({projectId},definition.namespace,'Own widths')).id;
  const client=createLocalToolClient(projectId,definition,{documentId});
  const host=()=> <MemoryRouter><LocalToolDocumentHost projectId={projectId} documentId={documentId} namespace={definition.namespace}/></MemoryRouter>;
  const saved=async()=>{await click('Save changes');await wait(()=>!!button('Save changes')?.disabled,'Save ACK');return client.convergence!.export();};
  const raw=(value:Awaited<ReturnType<typeof saved>>,id:string)=>(value.snapshot.data as unknown as {body:RichBlockDocument}).body.blocks.find(block=>block.id===id)?.attrs.widthPx??null;
  await act(async()=>root.render(host()));
  await wait(()=>!!button('Activate shared editing'),'normal activation');await click('Activate shared editing');
  await wait(()=>!!editor?.isEditable&&!!button('Insert table'),'mounted editable Source');
  await click('Insert table');
  await act(async()=>{editor!.commands.insertContent('Ω🙂');});await tick();
  const baseline=await saved(),first=cells()[0],initialWidth=geometry(first),initialHTML=editor!.getHTML();
  equal('engine7 normal editor and real table',[baseline.checkpoint?.engine.version,cells().length],['7',3]);
  equal('baseline text visible before resize',first.textContent,'Ω🙂');
  const id=column()?.getAttribute('data-writer-column')!;
  equal('Auto colgroup keyed by real column ID',!!id,true);
  equal('baseline width has no CSS or saved override',[column().style.width,raw(baseline,id)],['',null]);
  const cancelled=await begin();
  equal('drag preview changes measured width',Math.abs(geometry(cells()[0])-initialWidth-48)<=1,true);
  equal('preview does not change Source checkpoint',(await client.convergence!.export()).checkpoint,baseline.checkpoint);
  await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
  await cancelled.finish();
  equal('Escape removes preview and publishes nothing',[geometry(cells()[0]),editor!.getHTML(),button('Save changes')?.disabled],[initialWidth,initialHTML,true]);
  const gesture=await begin();
  await gesture.finish();await tick();
  equal('pointer release commits one width to mounted DOM',[column().style.width,geometry(cells()[0])],[String(initialWidth+48)+'px',initialWidth+48]);
  const explicit=await saved();
  equal('saved source keeps width at original ID',raw(explicit,id),initialWidth+48);
  await click('Undo');
  equal('same mounted editor immediately restores Auto and original geometry',[column().style.width,geometry(cells()[0]),editor!.getHTML()],['',initialWidth,initialHTML]);
  const undone=await saved();
  equal('Undo saved projection has no authored width',raw(undone,id),null);
  await click('Redo');
  equal('same mounted editor immediately reapplies geometry',geometry(cells()[0]),initialWidth+48);
  await click('Automatic width');
  equal('keyboard accessible Auto clears geometry immediately',[column().style.width,geometry(cells()[0])],['',initialWidth]);
  const last=await begin(2);await last.finish();await tick();
  const final=await saved(),lastId=column(2).getAttribute('data-writer-column')!,lastWidth=raw(final,lastId);
  equal('last column resize persisted independently',typeof lastWidth,'number');
  equal('first column remains Auto',raw(final,id),null);
  const entry=element.querySelector<HTMLInputElement>('input[type="number"]')!;
  await act(async()=>{
   entry.focus();
   entry.value='220';
  });
  await click('Apply width');
  equal('keyboard control sets the selected column ID',[column().style.width,geometry(cells()[0])],['220px',220]);
  equal('applying the width retains keyboard focus',document.activeElement===entry,true);
  const widthBefore=element.style.width;
  try{
   element.style.width='320px';
   const pane=editor!.view.dom;
   equal('narrow editor scrolls instead of shrinking explicit columns',[pane.scrollWidth>pane.clientWidth,geometry(cells()[0]),geometry(cells()[2])],[true,220,lastWidth]);
  }finally{element.style.width=widthBefore;}
  await click('Automatic width');
  const forCold=await saved();
  equal('keyboard Auto clears only the selected width',[raw(forCold,id),raw(forCold,lastId)],[null,lastWidth]);
  await act(async()=>root.unmount());editor=undefined;readOnly=true;db.close();await db.open();root=createRoot(element);
  await act(async()=>root.render(host()));
  await wait(()=>element.querySelectorAll('[data-sdk-rich-baseline] col').length===3,'cold passive colgroup');
  const cols=[...element.querySelectorAll<HTMLTableColElement>('[data-sdk-rich-baseline] col')];
  equal('cold passive keeps original IDs, Auto and explicit width',[cols[0].dataset.writerColumn,cols[0].style.width,cols[2].dataset.writerColumn,cols[2].style.width],[id,'',lastId,lastWidth+'px']);
  equal('cold passive keeps exact saved checkpoint',(await client.convergence!.export()).checkpoint,forCold.checkpoint);
  equal('cold passive did not create editor or editable DOM',[created,element.querySelectorAll('[contenteditable="true"]').length],[1,0]);
 }finally{
  await act(async()=>root.unmount());
  if(await db.projects.get(projectId))await deleteProject(projectId);
  await db.settings.where('key').equals('writer.rich.saveMode').delete();
  equal('cleanup 89 zero',(await Promise.all(db.tables.map(table=>table.count()))).every(count=>count===0),true);
  const after=getPendingWritesSnapshot();equal('cleanup ledger basal',[after.dirty,after.pending,after.failed],[ledger.dirty,ledger.pending,ledger.failed]);
  useLocaleStore.setState({locale});
 }
 return checks;
}
