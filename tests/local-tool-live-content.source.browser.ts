import '@/engines';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {defineLocalTool,type LocalToolClient,type LocalToolJson,type RichDocument,type RichBlockCapture} from '@/engines/local/sdk';
import {registerLocalToolModules} from '@/engines/local/registry';
import {createLocalToolClient} from '@/engines/local/storage';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {RichEditorSession} from '@/engines/local/collaborativeRich/session';
import {LocalDocumentContentHost} from '@/engines/local/liveContent/host';
import {createLocalToolReplica} from '@/engines/local/convergence/replica';
import {convergenceCanonical} from '@/engines/local/convergence/format';
import type {LocalToolStateAction} from '@/engines/local/stateActions';

type Data=Record<string,LocalToolJson>;
const doc=(id:string,text:string):RichDocument=>({type:'doc',content:[{id,type:'paragraph',content:[{type:'text',text}]}]});
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
export async function testLiveDocumentContentSource(){
 const checks:string[]=[],projects:string[]=[],sessions:RichEditorSession[]=[],hosts:LocalDocumentContentHost[]=[],peers:ReturnType<typeof createLocalToolReplica>[]=[];let step=0;
 const equal=(name:string,a:unknown,b:unknown)=>{assert(convergenceCanonical(a)===convergenceCanonical(b),name);checks.push(name);};
 const rejected=async(name:string,work:()=>unknown|Promise<unknown>)=>{let failed=false;try{await work();}catch{failed=true;}equal(name,failed,true);};
 const setup=async(blocks=false)=>{
  const namespace='tests.live-content.n'+crypto.randomUUID(),projectId='own-live1913-'+crypto.randomUUID();projects.push(projectId);
  const rich=blocks?{kind:'rich' as const,profile:'blocks-tree/1' as const,schema:'writers-blocks/1' as const}:{kind:'rich' as const,profile:'paragraphs-inline/1' as const},initial=(id:string,text:string):LocalToolJson=>blocks?{type:'block-doc',schema:'writers-blocks/1',blocks:[{id,type:'paragraph',attrs:{},parentId:null,slot:'body',afterId:null,content:[{type:'text',text}]}]}:doc(id,text) as unknown as LocalToolJson;
  const definition=defineLocalTool<Data>({namespace,name:{en:'Live Source controls',es:'Controles Source vivo'},description:{en:'Disposable test data',es:'Datos de prueba'},document:{defaultTitle:{en:'Live Source',es:'Source vivo'},embed:'interactive'},initialState:{body:initial('P','base'),other:initial('Q','other'),score:7},codec:{version:2,fields:{body:rich,other:rich,score:{kind:'scalar'}}},validateState:(v:LocalToolJson):v is Data=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body&&!!v.other&&typeof v.score==='number',component:()=>null});
  registerLocalToolModules({['./installed/'+namespace+'/module.tsx']:{default:definition}});await db.projects.add({id:projectId,title:'Own live1913',description:'own-live1913-controls',mode:'custom',type:'standalone',status:'draft',color:'#557799',enabledEngines:['local-tool-'+namespace],engineOrder:[],createdAt:1,updatedAt:1});
  const document=await createSourceToolDocument({projectId},namespace,'Live controls'),client=createLocalToolClient(projectId,definition,{documentId:document.id}),start=await client.convergence!.start(await client.read()),contract={namespace,codec:definition.codec!,validationId:start.checkpoint.validationId,schemaEpoch:start.checkpoint.schemaEpoch,validateState:definition.validateState};
  const open=async(field:string,c=client)=>{const s=new RichEditorSession(c,start.checkpoint,start.snapshot,contract,field,()=>{},()=>++step);sessions.push(s);s.rebind(c,false);await s.refresh();assert(s.editable,'healthy Source session');return s;};
  const host=(id:string)=>{const h=new LocalDocumentContentHost(id,()=>true,client);hosts.push(h);return h;};
  return{client,start,contract,open,host};
 };
 const text=(s:RichEditorSession,field=s.field)=>((s.replica.read() as Data)[field] as unknown as RichDocument).content.map(p=>p.content.map(t=>t.text).join('')).join('\n');
 const append=(s:RichEditorSession,value:string,field=s.field)=>{const d=(s.replica.read() as Data)[field] as unknown as RichDocument,p=d.content.at(-1)!,at=p.content.reduce((n,t)=>n+t.text.length,0);return{type:'rich-text-splice',field,nodeId:p.id,range:s.replica.richRange(field,p.id,at,at),text:value} as LocalToolStateAction;};
 let release:()=>void=()=>{};
 try{
  await db.open();equal('private library has89 tables',db.tables.length,89);
  const f=await setup(),a=await f.open('body'),a2=await f.open('other'),b=await f.open('body'),b2=await f.open('other'),A=f.host('A'),B=f.host('B');let frames=0;
  A.register(a,()=>{});A.register(a2,()=>{});B.register(b,()=>{});B.register(b2,()=>{});
  const before=a.replica.checkpoint(),undo=a.undoStep;
  await rejected('fieldA cannot submit fieldB',()=>A.port.apply('body',[append(a2,'foreign')]));
  await rejected('fieldA cannot submit scalar',()=>A.port.apply('body',[{type:'set',field:'score',value:9} as unknown as LocalToolStateAction]));
  equal('field mismatch preserves checkpoint',a.replica.checkpoint(),before);equal('field mismatch creates no Undo',a.undoStep??null,undo??null);
  await rejected('invalid second action rejects atomic batch',()=>A.port.apply('body',[append(a,'first'),{type:'invalid-action',field:'body'} as unknown as LocalToolStateAction]));
  equal('invalid batch checkpoint unchanged',a.replica.checkpoint(),before);equal('invalid batch no frame',frames,0);equal('invalid batch no receipt',a.undoStep??null,null);
  equal('own body edit',await A.port.apply('body',[append(a,' AΩ')] ),true);equal('other field edit',await A.port.apply('other',[append(a2,' B李')] ),true);
  await A.start({send:async update=>{frames++;B.receive(update);},leave:async()=>{}});
  await B.start({send:async update=>{frames++;A.receive(update);},leave:async()=>{}},A.seed());
  equal('document seed includes fieldA',text(b),text(a));equal('document seed includes fieldB',text(b2),text(a2));
  equal('same full document in every field replica',a.replica.read(),a2.replica.read());equal('same full document in remote field',a.replica.read(),b2.replica.read());
  equal('remote-only contribution is dirty',b.dirty,true);equal('remote-only author has no Undo',b.undoStep??null,null);
  const originalIds=b.replica.richRange('body','P',0,4).deleteIds;
  await B.port.apply('body',[append(b,' Rin🙂')]);await new Promise(r=>setTimeout(r,0));
  equal('author Undo succeeds',await A.port.control('undo','body'),true);await new Promise(r=>setTimeout(r,0));
  equal('Undo preserves remote contribution',text(a).includes('Rin🙂'),true);equal('Undo removes only author text',text(a).includes('AΩ'),false);equal('Undo preserves original IDs',a.replica.richRange('body','P',0,4).deleteIds,originalIds);
  equal('save whole document from one field',await B.port.control('save','body'),true);await a.refresh();await a2.refresh();await b2.refresh();
  equal('actual Source contains second field',(await f.client.read()).data.other,(a2.replica.read() as Data).other);equal('Source ACK clears remote-only pending',a2.dirty,false);equal('other pane Source Save confirms author contribution',a.dirty,false);

  // Source J resolves after the final Save export captured H, before finally.
  const g=await setup(),s=await g.open('body'),real=g.client.convergence!;let imports=0,inject=false;
  const delayed={...g.client,convergence:{...real,import:async(...args:Parameters<typeof real.import>)=>{imports++;return real.import(...args);},export:async(...args:Parameters<typeof real.export>)=>{const captured=await real.export(...args);if(inject){inject=false;const p=createLocalToolReplica(captured.checkpoint!,{authorId:'external-J',contract:g.contract});peers.push(p);const action=append(s,' J','other'),edit=p.apply([action]);await real.import(edit.update);await s.refresh();}return captured;}}} as LocalToolClient<LocalToolJson>;
  s.rebind(delayed,false);await s.refresh();s.applyBatch([append(s,' H')]);inject=true;equal('Save H completes',await s.save(),true);
  equal('deferred Source J is not lost',text(s,'other').endsWith(' J'),true);equal('Source J was durable',(await g.client.read()).data.other,(s.replica.read() as Data).other);equal('Source J does not invent dirty',s.dirty,false);equal('one own Source import',imports,1);

  // Exit retires network now, waits only the existing H import, keeps X/B in peer.
  const e=await setup(),ea=await e.open('body'),eb=await e.open('body'),EA=e.host('exit-A'),EB=e.host('exit-B');let reload=0,retired=false,leaves=0,exitImports=0;
  EA.register(ea,()=>{reload++;});EB.register(eb,()=>{});
  await EA.start({send:async update=>EB.receive(update),retire:()=>{retired=true;},leave:async()=>{leaves++;}});await EB.start({send:async update=>EA.receive(update),leave:async()=>{}},EA.seed());
  const gate=new Promise<void>(resolve=>{release=resolve;}),er=e.client.convergence!,ec={...e.client,convergence:{...er,import:async(...args:Parameters<typeof er.import>)=>{exitImports++;await gate;return er.import(...args);}}} as LocalToolClient<LocalToolJson>;
  ea.rebind(ec,false);await ea.refresh();await EA.port.apply('body',[append(ea,' H')]);const saving=ea.save();await Promise.resolve();ea.reverse();await EA.port.apply('body',[append(ea,' X')]);await EB.port.apply('body',[append(eb,' B')]);await new Promise(r=>setTimeout(r,0));const peerBefore=text(eb),leaving=EA.leave();
  equal('network retired before Save resolves',retired,true);equal('no reload before Source ACK',reload,0);equal('exit stops new local gestures',ea.editable,false);release();equal('already-started Save still acknowledged',await saving,true);await leaving;
  equal('exit starts no additional import',exitImports,1);equal('exit reloads once after ACK',reload,1);equal('membership removed once',leaves,1);equal('peer retains shared X/B',text(eb),peerBefore);equal('actual Source contains only H cut',((await e.client.read()).data.body as unknown as RichDocument).content[0].content.map(t=>t.text).join(''),'base H');
  const r=await setup(),ra=await r.open('body'),rb=await r.open('other'),R=r.host('recovery');R.register(ra,()=>{});R.register(rb,()=>{});await R.start({send:async()=>{},leave:async()=>{}});const savedBefore=await r.client.read();
  equal('sibling begins composition',rb.beginComposition(),true);await rejected('Save refuses composing sibling',()=>R.port.control('save','body'));rb.endComposition();equal('composition Save rejection preserves Source',await r.client.read(),savedBefore);
  equal('partial failed gesture retained',ra.gesture(()=>{ra.apply(append(ra,' partial') as Parameters<typeof ra.apply>[0]);throw Error('test-veto');}),false);
  await rejected('recovery cannot seed another healthy field',()=>R.seed());
  await rejected('Save from healthy field refuses recovery in sibling',()=>R.port.control('save','other'));
  await rejected('recovery export denied',()=>ra.exportDraft());equal('recovery never changed Source',await r.client.read(),savedBefore);
  const l=await setup(),ls=await l.open('body');let current=true;const lateClient={...l.client,read:async()=>{const value=await l.client.read();current=false;return value;}} as LocalToolClient<LocalToolJson>,L=new LocalDocumentContentHost('late-lease',()=>current,lateClient);hosts.push(L);L.register(ls,()=>{});const leaseBefore=ls.replica.checkpoint();
  await rejected('last-await retired lease rejects apply',()=>L.port.apply('body',[append(ls,' late')]));equal('retired lease leaves checkpoint literal',ls.replica.checkpoint(),leaseBefore);await rejected('retired lease query cannot revive host',()=>L.port.query());
  const detached=R.port.getSnapshot(),originalIdentity=ra.convergenceIdentity.codecHash;if(detached.identity)detached.identity.codecHash='caller-mutation';equal('snapshot metadata cannot mutate identity',ra.convergenceIdentity.codecHash,originalIdentity);
  const d=await setup(),ds=await d.open('body'),dp=createLocalToolReplica(d.start.checkpoint,{authorId:'reordered',contract:d.contract});peers.push(dp);const first=dp.apply([{type:'rich-text-splice',field:'body',nodeId:'P',range:dp.richRange('body','P',4,4),text:' H'}]),second=dp.apply([{type:'rich-text-splice',field:'body',nodeId:'P',range:dp.richRange('body','P',6,6),text:' I'}]);
  ds.receiveDraft(second.update);equal('late dependency does not create permanent recovery',ds.error,'');ds.receiveDraft(first.update);equal('reverse delivery converges',ds.replica.read(),dp.read());equal('complete catchup is shareable',ds.shareable,true);
  const w=await setup(true),ws=await w.open('body'),W=w.host('wrap');W.register(ws,()=>{});const wrapBefore=ws.replica.checkpoint(),wrapIds=ws.replica.richRange('body','P',0,4).deleteIds,capture=await W.port.capture('body',{kind:'block-wrap',nodeIds:['P']});
  equal('wrap capture is readonly',ws.replica.checkpoint(),wrapBefore);equal('public captured wrap applies',await W.port.apply('body',[{type:'rich-block-wrap',field:'body',capture:capture as unknown as RichBlockCapture,wrapper:{id:'L',type:'bullet-list',attrs:{}},items:[{id:'I',leafId:'P'}]}]),true);equal('wrap retains leaf in captured item',ws.blockDocument().blocks.find(p=>p.id==='P')!.parentId,'I');equal('wrapped author Undo',await W.port.control('undo','body'),true);equal('wrap Undo keeps leaf IDs',ws.replica.richRange('body','P',0,4).deleteIds,wrapIds);
  return{ok:true,checks:checks.length,names:checks};
 }finally{
  release();for(const h of hosts)h.dispose();for(const s of sessions)s.destroy();for(const p of peers)p.destroy();
  for(const id of projects){const project=await db.projects.get(id);assert(!project||project.description==='own-live1913-controls','foreign project cleanup');if(project)await deleteProject(id);}
  const counts=await Promise.all(db.tables.map(t=>t.count()));assert(counts.every(n=>n===0),'private cleanup89zero');
 }
}
