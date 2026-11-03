import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {Extension,type Editor} from '@tiptap/core';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {defineLocalTool,LocalToolCollaborativeRichEditor,type LocalToolJson,type LocalToolProps} from '@/engines/local/sdk';
import original from '@/engines/local/installed/examples.shared-table-axes/module';
import {createLocalToolClient} from '@/engines/local/storage';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {registerLocalToolModules} from '@/engines/local/registry';
import LocalToolDocumentHost from '@/engines/local/documents/LocalToolDocumentHost';
import {getPendingWritesSnapshot} from '@/services/pendingWrites';
import {useLocaleStore} from '@/stores/localeStore';
import {convergenceCanonical} from '@/engines/local/convergence/format';
import type {RichBlockDocument} from '@/engines/local/convergence/blockFormat';

/** Normal Source host, editor and passive renderer. No external room or provider. */
export async function testMountedTableAxes(){
 const checks:string[]=[],P='own-axes-ui-'+crypto.randomUUID(),element=document.getElementById('root')!,ledger=getPendingWritesSnapshot(),locale=useLocaleStore.getState().locale;
 let root=createRoot(element),editor:Editor|undefined,readonly=false,creates=0;
 const eq=(name:string,a:unknown,b:unknown)=>{if(convergenceCanonical(a)!==convergenceCanonical(b))throw Error(name+': '+JSON.stringify([a,b]));checks.push(name);Reflect.set(window,'__testStage',name);};
 const tick=()=>act(async()=>{await new Promise(r=>setTimeout(r,25));}),button=(name:string)=>[...element.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===name);
 const wait=async(f:()=>boolean,label:string)=>{for(let i=0;i<160;i++){if(f())return;await tick();}throw Error(label+': '+element.textContent);};
 const click=async(name:string)=>{const b=button(name);if(!b||b.disabled)throw Error('Button unavailable '+name);await act(async()=>b.click());await tick();};
 const cells=()=>editor!.view.dom.querySelectorAll('[data-writer-cell-address]'),leaves=()=>{const list:{id:string|null;pos:number;address:string|null;text:string}[]=[];editor!.state.doc.descendants((node,pos)=>{if(node.isTextblock)list.push({id:node.attrs.id,pos,address:node.attrs.cellAddress??null,text:node.textContent});});return list;};
 try{
  eq('health89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);useLocaleStore.setState({locale:'en'});
  const extensions=[Extension.create({name:'observeTableAxes2047',onCreate(){editor=this.editor;creates++;}})];
  function Fixture({client,context}:LocalToolProps<LocalToolJson>){return <LocalToolCollaborativeRichEditor client={client} context={context} field="body" editable={!readonly} extensions={extensions}/>;}
  const definition=defineLocalTool({...original,namespace:'tests.table-axes-ui',component:Fixture});registerLocalToolModules({'./installed/tests.table-axes-ui/module.tsx':{default:definition}});
  await db.projects.add({id:P,title:P,description:P,mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:['local-tool-'+definition.namespace],createdAt:1,updatedAt:1});
  const D=(await createSourceToolDocument({projectId:P},definition.namespace,'Own axes')).id,client=createLocalToolClient(P,definition,{documentId:D}),host=()=> <MemoryRouter><LocalToolDocumentHost projectId={P} documentId={D} namespace={definition.namespace}/></MemoryRouter>;
  await act(async()=>root.render(host()));await wait(()=>!!button('Activate shared editing'),'normal explicit activation');await click('Activate shared editing');await wait(()=>!!editor?.isEditable&&!!button('Insert table'),'normal editable host');
  const initial=await client.read();eq('Source initialized engine6',initial.convergence?.engine.version,'6');
  await click('Insert table');eq('3x3 empty logical cells render',cells().length,9);eq('all placeholders have no authored leaf ID',leaves().filter(n=>n.address!==null).every(n=>n.id===null),true);eq('cursor alone enables row and column controls',[button('Insert row after')?.disabled,button('Insert column before')?.disabled],[false,false]);
  const emptyAddress=editor!.state.selection.$from.parent.attrs.cellAddress;await click('Insert row after');eq('axis edit from empty cell keeps logical selection',editor!.state.selection.$from.parent.attrs.cellAddress,emptyAddress);eq('empty-row gesture creates no leaves',leaves().filter(n=>n.address!==null&&n.id!==null).length,0);await click('Undo');eq('empty-row Undo returns original grid',cells().length,9);
  const beforeText=editor!.getHTML(),first=leaves().find(n=>n.address)!;
  await act(async()=>{editor!.commands.setTextSelection(first.pos+1);editor!.commands.insertContent('Ω🙂');});await tick();
  const authored=leaves().find(n=>n.text==='Ω🙂')!;eq('first text creates one real leaf',typeof authored?.id,'string');eq('remaining placeholders retain no leaf IDs',leaves().filter(n=>n.address!==null).length,8);eq('draft first input does not write Source',(await client.read()).data,initial.data);
  await click('Undo');eq('one Undo restores exact empty HTML',editor!.getHTML(),beforeText);await click('Redo');eq('one Redo restores exact first leaf ID',leaves().find(n=>n.text==='Ω🙂')?.id,authored.id);
  await act(async()=>editor!.commands.setTextSelection(leaves().find(n=>n.id===authored.id)!.pos+1));await click('Insert row after');eq('add row shows 4x3',cells().length,12);
  await act(async()=>editor!.commands.setTextSelection(leaves().find(n=>n.id===authored.id)!.pos+1));await click('Insert column before');eq('add column shows 4x4',cells().length,16);eq('axis edits preserve original leaf text',leaves().find(n=>n.id===authored.id)?.text,'Ω🙂');
  const expanded=editor!.getHTML();await click('Undo');eq('undo column returns 4x3',cells().length,12);await click('Redo');eq('redo exact 4x4 HTML',editor!.getHTML(),expanded);
  await act(async()=>{editor!.commands.setTextSelection(leaves().find(n=>n.id===authored.id)!.pos+1);editor!.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));});eq('Tab changes no axes',cells().length,16);
  await click('Save changes');await wait(()=>!!button('Save changes')?.disabled,'normal Save ACK');
  const saved=await client.read(),data=(saved.data as {body:RichBlockDocument}).body,order=data.axisOrder![0];eq('saved ordered axes survive',order.rows.length*order.columns.length,16);eq('only actual text authored in grid',data.blocks.filter(b=>b.type==='table-cell').length,1);eq('saved Unicode exact',data.blocks.find(b=>b.id===authored.id)?.content,[{type:'text',text:'Ω🙂'}]);
  const rowsBefore=await db.projects.get(P),capture=await client.convergence!.richTableCellCapture('body',order.tableId,order.rows[0],order.columns[0]);eq('readonly Source cell capture returns same saved snapshot',capture.snapshot.data,saved.data);eq('capture writes no rows',await db.projects.get(P),rowsBefore);
  for(let r=0;r<4;r++){const cell=cells()[0],pos=editor!.view.posAtDOM(cell.querySelector('p')!,0);await act(async()=>editor!.commands.setTextSelection(pos));await click('Remove row');}
  eq('last row removes visible table',cells().length,0);eq('invisible table axis controls disabled',button('Remove row')?.disabled,true);eq('last row reanchors outside without a synthetic leaf',editor!.state.selection.$from.parent.attrs.id,'P');eq('last row removal is a draft only',await db.projects.get(P),rowsBefore);
  for(let r=0;r<4;r++)await click('Undo');eq('four row Undos restore exact saved HTML',editor!.getHTML(),expanded);
  await act(async()=>root.unmount());editor=undefined;readonly=true;db.close();await db.open();root=createRoot(element);await act(async()=>root.render(host()));await wait(()=>element.querySelectorAll('[data-sdk-rich-baseline] [data-writer-cell-address]').length===16,'cold passive grid');
  eq('cold passive creates no Editor',creates,1);eq('cold passive has no editable DOM',element.querySelectorAll('[contenteditable="true"]').length,0);eq('cold passive preserves real leaf text',element.querySelector('[data-writer-block="'+authored.id+'"]')?.textContent,'Ω🙂');eq('cold passive writes no Source',await db.projects.get(P),rowsBefore);
 }finally{await act(async()=>root.unmount());if(await db.projects.get(P))await deleteProject(P);await db.settings.where('key').equals('writer.rich.saveMode').delete();eq('cleanup89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);const after=getPendingWritesSnapshot();eq('cleanup ledger',[after.dirty,after.pending,after.failed],[ledger.dirty,ledger.pending,ledger.failed]);useLocaleStore.setState({locale});}
 return checks;
}
