import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {Extension,type Editor} from '@tiptap/core';
import assert from './local-tool-collaborative-rich.assert';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {defineLocalTool,LocalToolCollaborativeRichEditor,type LocalToolJson,type LocalToolProps,type RichBlock,type RichBlockDocument} from '@/engines/local/sdk';
import {createLocalToolClient} from '@/engines/local/storage';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {registerLocalToolModules} from '@/engines/local/registry';
import LocalToolDocumentHost from '@/engines/local/documents/LocalToolDocumentHost';
import {blockPMLeaves} from '@/engines/local/collaborativeRich/blockProsemirror';
import {getPendingWritesSnapshot} from '@/services/pendingWrites';
import {useLocaleStore} from '@/stores/localeStore';
export async function testEmptyItemPositions(){
 const P='own1895-positions-'+crypto.randomUUID(),element=document.getElementById('root')!,checks:string[]=[],locale=useLocaleStore.getState().locale,ledger=getPendingWritesSnapshot(),root=createRoot(element);let editor:Editor|undefined;
 const eq=(n:string,a:unknown,b:unknown)=>{assert.deepStrictEqual(a,b,n);checks.push(n);},tick=()=>act(async()=>{await new Promise(r=>setTimeout(r,25));}),wait=async(fn:()=>boolean)=>{for(let i=0;i<160;i++){if(fn())return;await tick();}throw Error('positions timeout '+element.textContent);};
 const extensions=[Extension.create({name:'captureEmptyItemPositions',onCreate(){editor=this.editor;}})],p=(id:string,parentId:string,text:string,afterId:string|null=null):RichBlock=>({id,type:'paragraph',attrs:{},parentId,slot:'body',afterId,content:text?[{type:'text',text}]:[]});
 function Fixture({client,context}:LocalToolProps<LocalToolJson>){return <LocalToolCollaborativeRichEditor client={client} context={context} field="body" extensions={extensions}/>;}
 try{
  eq('private health89zero',db.tables.length===89&&(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);useLocaleStore.setState({locale:'en'});await db.projects.add({id:P,title:P,description:P,mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:[],createdAt:1,updatedAt:1});
  for(const nested of [false,true]){
   const label=nested?'nested':'ordered',NS='tests.empty-item1895.positions-'+label,blocks:RichBlock[]=[{id:'L',type:nested?'bullet-list':'ordered-list',attrs:nested?{}:{start:2},parentId:nested?'Owner':null,slot:'body',afterId:nested?'U':null},{id:'Iz',type:'list-item',attrs:{},parentId:'L',slot:'body',afterId:null},{id:'Iq',type:'list-item',attrs:{},parentId:'L',slot:'body',afterId:'Iz'},{id:'Ia',type:'list-item',attrs:{},parentId:'L',slot:'body',afterId:'Iq'},p('P','Iz','ab'),p('Q','Iq',''),p('R','Ia','cd')];
   if(nested)blocks.push({id:'W',type:'bullet-list',attrs:{},parentId:null,slot:'body',afterId:null},{id:'Owner',type:'list-item',attrs:{},parentId:'W',slot:'body',afterId:null},p('U','Owner','before'),p('S','Owner','after','L'));
   blocks.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);const definition=defineLocalTool({namespace:NS,name:{en:'List positions',es:'Posiciones de lista'},description:{en:'Normal Source middle exits',es:'Salida intermedia Source normal'},document:{defaultTitle:{en:'List',es:'Lista'}},initialState:{body:{type:'block-doc',schema:'writers-blocks/1',blocks}} as unknown as LocalToolJson,codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/1',schema:'writers-blocks/1'}}},validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body,component:Fixture});
   registerLocalToolModules({['./installed/'+NS+'/module.tsx']:{default:definition}});const enabled=(await db.projects.get(P))!.enabledEngines;await db.projects.update(P,{enabledEngines:[...enabled,'local-tool-'+NS]});const D=(await createSourceToolDocument({projectId:P},NS,label)).id,client=createLocalToolClient(P,definition,{documentId:D});await client.convergence!.start(await client.read());editor=undefined;await act(async()=>root.render(<MemoryRouter><LocalToolDocumentHost projectId={P} documentId={D} namespace={NS}/></MemoryRouter>));await wait(()=>!!editor?.isEditable);
   if(!nested){await act(async()=>{await client.state!.apply(await client.read(),[{type:'rich-block-transform',field:'body',capture:(await client.convergence!.richBlockEditCapture('body',['L'])).capture,kind:'ordered-list',attrs:{start:10}}]);});await wait(()=>element.querySelector('ol[data-writer-block="L"]')?.getAttribute('start')==='10');eq('remote current start visible',element.querySelector('ol[data-writer-block="L"]')?.getAttribute('start'),'10');}
   const before=(await client.read()).data,range=(await client.convergence!.richRange('body','Q',0,0)).range,pIds=(await client.convergence!.richRange('body','P',0,2)).range.deleteIds,leaf=blockPMLeaves(editor!.state.doc).find(n=>n.id==='Q')!;await act(async()=>editor!.commands.setTextSelection(leaf.pos+1));const event=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});await act(async()=>editor!.view.dom.dispatchEvent(event));await tick();eq(label+' key handled',event.defaultPrevented,true);eq(label+' reading order',blockPMLeaves(editor!.state.doc).map(n=>n.id),nested?['U','P','Q','R','S']:['P','Q','R']);const q=blockPMLeaves(editor!.state.doc).find(n=>n.id==='Q')!;eq(label+' caret same Q',editor!.state.selection.from,q.pos+1);eq(label+' no recovery',element.querySelector('[role="alert"]'),null);
   if(nested)eq('nested item lifted one level',element.querySelector('li[data-writer-block="Iq"]')?.parentElement?.getAttribute('data-writer-block'),'W');else eq('root Q outside list',element.querySelector('p[data-writer-block="Q"]')?.parentElement,editor!.view.dom);
   const button=(name:string)=>[...element.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===name)!,click=async(name:string)=>{await act(async()=>button(name).click());await tick();};await click('Undo');eq(label+' Undo exact DOM order',blockPMLeaves(editor!.state.doc).map(n=>n.id),nested?['U','P','Q','R','S']:['P','Q','R']);await click('Redo');await click('Save changes');await wait(()=>button('Save changes').disabled);const saved=(await client.read()).data,body=(saved as Record<string,LocalToolJson>).body as unknown as RichBlockDocument;eq(label+' saved P units',(await client.convergence!.richRange('body','P',0,2)).range.deleteIds,pIds);eq(label+' empty buffer edge unchanged',(await client.convergence!.richRange('body','Q',0,0)).range.edge,range.edge);
   if(!nested){eq('prefix keeps B start10',body.blocks.find(n=>n.id==='L')!.attrs,{start:10});const tail=body.blocks.find(n=>n.type==='ordered-list'&&n.id!=='L')!;eq('continuation uses B ordinal12',tail.attrs,{start:12});}
   else eq('owner suffix saved under lifted item',body.blocks.find(n=>n.id==='S')!.parentId,'Iq');
   eq(label+' actually saved new structure',JSON.stringify(saved)!==JSON.stringify(before),true);await act(async()=>root.render(null));
  }
 }finally{await act(async()=>root.unmount());if(await db.projects.get(P))await deleteProject(P);eq('cleanup89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);const end=getPendingWritesSnapshot();eq('cleanup ledger',[end.dirty,end.pending,end.failed],[ledger.dirty,ledger.pending,ledger.failed]);useLocaleStore.setState({locale});}
 return checks;
}
