import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {Extension,type Editor} from '@tiptap/core';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {defineLocalTool,LocalToolCollaborativeRichEditor,createLocalToolReplica,type LocalToolJson,type LocalToolProps,type LocalToolReplica} from '@/engines/local/sdk';
import {createLocalToolClient} from '@/engines/local/storage';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {registerLocalToolModules} from '@/engines/local/registry';
import {localToolConvergenceContext} from '@/engines/local/convergence/context';
import LocalToolDocumentHost from '@/engines/local/documents/LocalToolDocumentHost';
import {liveDocumentHosts} from '@/engines/local/liveContent/host';
import {useLocaleStore} from '@/stores/localeStore';

/** Original mounted SourceHost/client. Draft carrier is controlled QA, not SSE/Brave. */
export async function testRichAdoptionMounted(){
 const element=document.getElementById('root')!,root=createRoot(element),checks:string[]=[],actors:LocalToolReplica[]=[],P='own-adoption-mounted-'+crypto.randomUUID(),prior=useLocaleStore.getState().locale;let editor:Editor|undefined;
 const eq=(name:string,a:unknown,b:unknown)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(name+': '+JSON.stringify([a,b]));checks.push(name);},tick=()=>act(async()=>{await new Promise(r=>setTimeout(r,30));}),wait=async(fn:()=>boolean,label:string)=>{for(let i=0;i<150;i++){if(fn())return;await tick();}throw Error(label+': '+element.textContent);};
 try{
  eq('health89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);useLocaleStore.setState({locale:'en'});await db.projects.add({id:P,title:P,description:'Own mounted adoption',mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:[],createdAt:1,updatedAt:1});
  for(const saved of[false,true]){
   editor=undefined;const namespace='tests.adoption-mounted.'+(saved?'saved':'draft'),extensions=[Extension.create({name:'observeAdoption1958',onCreate(){editor=this.editor;}})],data={body:{type:'doc',content:[{id:'P',type:'paragraph',content:[{type:'text',text:'base'}]}]}} as LocalToolJson;
   function Fixture({client,context}:LocalToolProps<LocalToolJson>){return <LocalToolCollaborativeRichEditor client={client} context={context} field="body" extensions={extensions}/>;}
   const common={namespace,name:{en:'Adoption mounted',es:'Adopción montada'},description:{en:'Own adoption mounted',es:'Adopción propia montada'},document:{defaultTitle:{en:'Mounted',es:'Montado'}},initialState:data,validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body,component:Fixture};
   const old=defineLocalTool({...common,codec:{version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/1'}}}}),install=(definition:typeof old)=>registerLocalToolModules({['./installed/'+namespace+'/module.tsx']:{default:definition}});install(old);await db.projects.update(P,{enabledEngines:['local-tool-'+namespace]});
   const D=(await createSourceToolDocument({projectId:P},namespace,'Mounted')).id,oldClient=createLocalToolClient(P,old,{documentId:D}),start=await oldClient.convergence!.start(await oldClient.read()),G=start.checkpoint,from={namespace,codec:old.codec!,validationId:G.validationId,schemaEpoch:G.schemaEpoch};
   const target=defineLocalTool({...common,stateSchemaVersion:'2',richAdoption:{transition:'rich-links-3-to-4/1',from},codec:{version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/2'}}}});install(target);const client=createLocalToolClient(P,target,{documentId:D}),B=createLocalToolReplica(G,{authorId:'B',contract:{namespace,codec:target.codec!,...localToolConvergenceContext(target)!,validateState:target.validateState,richAdoption:target.richAdoption}});actors.push(B);const ids=B.richRange('body','P',0,4).deleteIds;
   await act(async()=>root.render(<MemoryRouter><LocalToolDocumentHost projectId={P} documentId={D} namespace={namespace}/></MemoryRouter>));await wait(()=>!!editor?.isEditable,'old-format editor mounted');eq('mounted remains old schema '+saved,!!editor!.schema.marks.link,false);
   await act(async()=>{editor!.commands.setTextSelection({from:3,to:5});editor!.chain().focus().toggleMark('bold').run();});
   B.adopt({namespace,codec:target.codec!,...localToolConvergenceContext(target)!,validateState:target.validateState,richAdoption:target.richAdoption});B.apply([{type:'rich-link',field:'body',nodeId:'P',range:B.richRange('body','P',0,2),href:'example.org/remote'}]);const full=B.export(),raw=JSON.stringify(await db.projects.get(P));
   const host=[...liveDocumentHosts].find(host=>host.client.documentId===D)!;
   if(saved)await act(async()=>{await client.convergence!.import(full);});
   else{await act(async()=>{await host.start({identity:G,send:async()=>{},leave:async()=>{}});host.receive(full);});}
   await wait(()=>!!editor?.schema.marks.link&&editor.getHTML().includes('https://example.org/remote'),'new schema with remote href');
   eq('no recovery/error '+saved,host.snapshot().error??'','');eq('text exact '+saved,editor!.state.doc.textContent,'base');eq('remote href visible '+saved,editor!.getHTML().includes('href="https://example.org/remote"'),true);eq('old local mark retained '+saved,editor!.getHTML().includes('<strong>se</strong>'),true);eq('selection retained '+saved,[editor!.state.selection.anchor,editor!.state.selection.head],[3,5]);
   if(!saved){eq('Manual Source3 exact after draft4 receive',JSON.stringify(await db.projects.get(P)),raw);eq('Manual durable remains3',(await client.convergence!.export()).checkpoint!.engine.version,'3');}
   await act(async()=>{const undo=[...element.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Undo')!;undo.click();});eq('owner Undo keeps remote href '+saved,editor!.getHTML().includes('https://example.org/remote'),true);eq('owner Undo removes own bold '+saved,editor!.getHTML().includes('<strong>'),false);
   await act(async()=>root.render(null));await tick();eq('original IDs fixture baseline '+saved,B.richRange('body','P',0,4).deleteIds,ids);
  }
 }finally{await act(async()=>root.unmount());for(const actor of actors)actor.destroy();if(await db.projects.get(P))await deleteProject(P);useLocaleStore.setState({locale:prior});eq('cleanup89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);}
 return checks;
}

/** A collapsed tree is local owner presentation and survives a capability-only schema remount. */
export async function testRichAdoptionMountedCollapse(){
 const element=document.getElementById('root')!,root=createRoot(element),checks:string[]=[],P='own-adoption-collapse-'+crypto.randomUUID(),namespace='tests.adoption-collapse',prior=useLocaleStore.getState().locale;let editor:Editor|undefined,remote:LocalToolReplica|undefined;
 Reflect.set(window,'__linksProgress',checks);const eq=(name:string,a:unknown,b:unknown)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(name+': '+JSON.stringify([a,b]));checks.push(name);},tick=()=>act(async()=>{await new Promise(r=>setTimeout(r,30));}),wait=async(fn:()=>boolean)=>{for(let i=0;i<150;i++){if(fn())return;await tick();}throw Error('mounted collapse deadline: '+element.textContent);};
 try{
  eq('health89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);useLocaleStore.setState({locale:'en'});await db.projects.add({id:P,title:P,description:'Own mounted collapse',mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:['local-tool-'+namespace],createdAt:1,updatedAt:1});
  const data={body:{type:'block-doc',schema:'writers-blocks/1',blocks:[{id:'A-toggle',type:'toggle',attrs:{},parentId:null,slot:'body',afterId:null},{id:'B-summary',type:'paragraph',attrs:{},parentId:'A-toggle',slot:'summary',afterId:null,content:[{type:'text',text:'Summary'}]},{id:'C-body',type:'paragraph',attrs:{},parentId:'A-toggle',slot:'body',afterId:null,content:[{type:'text',text:'Hidden body'}]}]}} as LocalToolJson,extensions=[Extension.create({name:'observeCollapse1958',onCreate(){editor=this.editor;}})];
  function Fixture({client,context}:LocalToolProps<LocalToolJson>){return <LocalToolCollaborativeRichEditor client={client} context={context} field="body" extensions={extensions}/>;}
  const common={namespace,name:{en:'Collapse adoption',es:'Adopción plegada'},description:{en:'Own mounted tree',es:'Árbol propio montado'},document:{defaultTitle:{en:'Tree',es:'Árbol'}},initialState:data,validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body,component:Fixture},old=defineLocalTool({...common,codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/1',schema:'writers-blocks/1'}}}}),install=(definition:typeof old)=>registerLocalToolModules({['./installed/'+namespace+'/module.tsx']:{default:definition}});install(old);
  const D=(await createSourceToolDocument({projectId:P},namespace,'Tree')).id,original=createLocalToolClient(P,old,{documentId:D}),started=await original.convergence!.start(await original.read()),G=started.checkpoint,target=defineLocalTool({...common,stateSchemaVersion:'2',richAdoption:{transition:'rich-links-3-to-4/1',from:{namespace,codec:old.codec!,validationId:G.validationId,schemaEpoch:G.schemaEpoch}},codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/2',schema:'writers-blocks/1'}}}});install(target);const client=createLocalToolClient(P,target,{documentId:D}),contract={namespace,codec:target.codec!,...localToolConvergenceContext(target)!,validateState:target.validateState,richAdoption:target.richAdoption};remote=createLocalToolReplica(G,{authorId:'remote-collapse',contract});
  await act(async()=>root.render(<MemoryRouter><LocalToolDocumentHost projectId={P} documentId={D} namespace={namespace}/></MemoryRouter>));await wait(()=>!!editor?.isEditable&&!!element.querySelector('details'));eq('old tree schema has no links',!!editor!.schema.marks.link,false);eq('toggle initially open',element.querySelector('details')!.open,true);await act(async()=>{element.querySelector<HTMLElement>('summary')!.click();});await wait(()=>!element.querySelector('details')!.open);eq('user collapsed toggle',element.querySelector('details')!.open,false);
  remote.adopt(contract);remote.apply([{type:'rich-link',field:'body',nodeId:'C-body',range:remote.richRange('body','C-body',0,6),href:'example.org/hidden'}]);const raw=JSON.stringify(await db.projects.get(P)),host=[...liveDocumentHosts].find(h=>h.client.documentId===D)!;await act(async()=>{await host.start({identity:G,send:async()=>{},leave:async()=>{}});host.receive(remote!.export());});await wait(()=>!!editor?.schema.marks.link&&editor.getHTML().includes('https://example.org/hidden'));
  eq('same owner keeps collapsed toggle after format change',element.querySelector('details')!.open,false);eq('tree content remains exact',editor!.state.doc.textContent,'SummaryHidden body');eq('hidden content link admitted',editor!.getHTML().includes('href="https://example.org/hidden"'),true);eq('Manual Source unchanged by fold and receive',JSON.stringify(await db.projects.get(P)),raw);eq('host has no recovery error',host.snapshot().error??'','');
 }finally{await act(async()=>root.unmount());remote?.destroy();if(await db.projects.get(P))await deleteProject(P);useLocaleStore.setState({locale:prior});eq('cleanup89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);}
 return checks;
}
