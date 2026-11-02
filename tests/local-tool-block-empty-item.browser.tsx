import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {Extension,type Editor} from '@tiptap/core';
import assert from './local-tool-collaborative-rich.assert';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {defineLocalTool,LocalToolCollaborativeRichEditor,type LocalToolJson,type LocalToolProps,type RichBlockDocument} from '@/engines/local/sdk';
import {createLocalToolClient} from '@/engines/local/storage';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {registerLocalToolModules} from '@/engines/local/registry';
import LocalToolDocumentHost from '@/engines/local/documents/LocalToolDocumentHost';
import {blockPMLeaves} from '@/engines/local/collaborativeRich/blockProsemirror';
import {getPendingWritesSnapshot} from '@/services/pendingWrites';
import {useLocaleStore} from '@/stores/localeStore';

/** Normal Source host, public facade and real existing Save writer; synthetic keyboard. */
export async function testEmptyItemEnter(){
 const P='own1895-'+crypto.randomUUID(),NS='tests.empty-item1895.source',element=document.getElementById('root')!,checks:string[]=[],locale=useLocaleStore.getState().locale,ledger=getPendingWritesSnapshot();let root=createRoot(element),editor:Editor|undefined;
 const eq=(name:string,a:unknown,b:unknown)=>{assert.deepStrictEqual(a,b,name);checks.push(name);},tick=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,25));}),wait=async(fn:()=>boolean,label:string)=>{for(let i=0;i<160;i++){if(fn())return;await tick();}throw Error(label+' timeout '+element.textContent);};
 const extensions=[Extension.create({name:'observeEmptyItem1895',onCreate(){editor=this.editor;}})];
 function Fixture({client,context}:LocalToolProps<LocalToolJson>){return <LocalToolCollaborativeRichEditor client={client} context={context} field="body" extensions={extensions}/>;}
 const data={body:{type:'block-doc',schema:'writers-blocks/1',blocks:[{id:'P',type:'paragraph',attrs:{},parentId:null,slot:'body',afterId:null,content:[{type:'text',text:'item'}]}]}} as LocalToolJson;
 const definition=defineLocalTool({namespace:NS,name:{en:'Empty item',es:'Item vacío'},description:{en:'Normal Source Enter regression',es:'Regresión Enter en Source normal'},document:{defaultTitle:{en:'List',es:'Lista'}},initialState:data,codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/1',schema:'writers-blocks/1'}}},validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body,component:Fixture});
 const button=(name:string)=>[...element.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===name)!,click=async(name:string)=>{await act(async()=>button(name).click());await tick();};
 const enter=async()=>{const event=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});await act(async()=>{editor!.view.dom.dispatchEvent(event);});await tick();eq('Enter handled',event.defaultPrevented,true);};
 try{
  eq('health private89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0)&&db.tables.length===89,true);useLocaleStore.setState({locale:'en'});registerLocalToolModules({['./installed/'+NS+'/module.tsx']:{default:definition}});
  await db.projects.add({id:P,title:P,description:P,mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:['local-tool-'+NS],createdAt:1,updatedAt:1});const D=(await createSourceToolDocument({projectId:P},NS,'List')).id,client=createLocalToolClient(P,definition,{documentId:D});
  const mount=async()=>{await act(async()=>root.render(<MemoryRouter><LocalToolDocumentHost projectId={P} documentId={D} namespace={NS}/></MemoryRouter>));};
  await mount();await wait(()=>!!button('Activate shared editing'),'normal passive Source');await click('Activate shared editing');await wait(()=>!!editor?.isEditable,'normal Source editor');eq('health initial text',editor!.state.doc.textContent,'item');const original=(await client.convergence!.richRange('body','P',0,4)).range.deleteIds;
  await click('Bullet list');const first=blockPMLeaves(editor!.state.doc).find(n=>n.id==='P')!;await act(async()=>{editor!.commands.setTextSelection(first.pos+5);});await enter();const q=blockPMLeaves(editor!.state.doc).find(n=>n.id!=='P')!;eq('health first Enter creates empty item',element.querySelectorAll('.tiptap ul>li').length,2);eq('health new leaf empty',q.node.textContent,'');eq('health first caret',editor!.state.selection.from,q.pos+1);console.error('EMPTY1895_HEALTH '+JSON.stringify({html:editor!.getHTML(),emptyLeafId:q.id}));
  await enter();eq('second Enter exits list',element.querySelectorAll('.tiptap ul>li').length,1);eq('empty leaf ID reused outside',element.querySelector('.tiptap > p')?.getAttribute('data-writer-block'),q.id);const outside=blockPMLeaves(editor!.state.doc).find(n=>n.id===q.id)!;eq('caret follows same leaf',editor!.state.selection.from,outside.pos+1);eq('no new leaf or text',blockPMLeaves(editor!.state.doc).map(n=>n.id).sort(),['P',q.id].sort());eq('no recovery alert',element.querySelector('[role="alert"]'),null);
  await click('Undo');eq('one Undo restores empty item',element.querySelectorAll('.tiptap ul>li').length,2);await click('Redo');eq('Redo exits same leaf',element.querySelector('.tiptap > p')?.getAttribute('data-writer-block'),q.id);
  await click('Save changes');await wait(()=>button('Save changes').disabled,'normal Source Save');const saved=(await client.read()).data,body=(saved as Record<string,LocalToolJson>).body as unknown as RichBlockDocument;eq('saved Q at root',body.blocks.find(n=>n.id===q.id)!.parentId,null);eq('saved P units unchanged',(await client.convergence!.richRange('body','P',0,4)).range.deleteIds,original);
  await act(async()=>root.unmount());editor=undefined;root=createRoot(element);await mount();await wait(()=>!!editor?.isEditable,'Source reopen');eq('reopen saved structure',(await client.read()).data,saved);eq('reopen empty leaf ID',element.querySelector('.tiptap > p')?.getAttribute('data-writer-block'),q.id);
 }finally{await act(async()=>root.unmount());if(await db.projects.get(P))await deleteProject(P);eq('cleanup89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);const end=getPendingWritesSnapshot();eq('cleanup ledger',[end.dirty,end.pending,end.failed],[ledger.dirty,ledger.pending,ledger.failed]);useLocaleStore.setState({locale});console.error('EMPTY1895_CLEANUP '+JSON.stringify({zero:true,checks:checks.length}));}
 return checks;
}
