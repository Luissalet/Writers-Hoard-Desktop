import assert from 'node:assert/strict';
import {defineLocalTool,createLocalToolReplica,type LocalToolJson,type LocalToolReplica,type LocalToolReplicaEdit,type RichDocument} from '@/engines/local/sdk';
import {createFakeLocalToolHost} from '@/engines/local/testing';
type Data=Record<string,LocalToolJson>;
const initial:Data={body:{type:'doc',content:[{id:'P',type:'paragraph',content:[{type:'text',text:'A🙂Z'}]},{id:'Q',type:'paragraph',content:[]}]},opaque:'\u0000\ud800 untouched'};
/** Public SDK controls: legitimate opaque IDs, canonical captures and cold replicas. */
export async function runRichPointSyntaxFocals(){
 const checks:string[]=[],actors:LocalToolReplica<Data>[]=[],descriptor=Object.getOwnPropertyDescriptor(crypto,'randomUUID');let destroyed=0;
 const equal=(name:string,actual:unknown,expected:unknown)=>{assert.deepEqual(actual,expected,name);checks.push(name);};
 const namespace='tests.rich1917.syntax',projectId='own-rich1917-syntax',documentId=projectId+'-doc',definition=defineLocalTool<Data>({namespace,name:{en:'Point syntax',es:'Sintaxis de puntos'},description:{en:'Owned public point controls',es:'Controles públicos propios'},initialState:initial,codec:{version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/1'}}},validateState:(v:LocalToolJson):v is Data=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body&&typeof v.opaque==='string',component:()=>null});
 const host=createFakeLocalToolHost(definition,{projects:[{id:projectId,updatedAt:1,sourceToolDocuments:[{id:documentId,namespace,title:'Own syntax',generation:'own-syntax-genesis',revision:1,createdAt:1,updatedAt:1,data:initial,codec:definition.codec}]}]}),client=host.createClient({projectId},false,documentId),started=await client.convergence!.start(await client.read());
 const make=(name:string,checkpoint=started.checkpoint)=>{const p=createLocalToolReplica<Data>(checkpoint,{authorId:name,contract:{namespace,codec:definition.codec!,validationId:checkpoint.validationId,schemaEpoch:checkpoint.schemaEpoch,validateState:definition.validateState}});actors.push(p);return p;};
 const rows=(p:LocalToolReplica<Data>)=>(p.read().body as unknown as RichDocument).content.map(n=>[n.id,n.content.map(t=>t.text).join('')]);
 try{
  const A=make('syntax-A'),B=make('syntax-B');equal('actual genesis health',A.read(),initial);let serial=0;const prefix='own,[]"\\\u0000李明🙂:';Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=>prefix+String(++serial)});
  const receive=(name:string,edit:LocalToolReplicaEdit<Data>)=>{equal(name,B.receive(edit.update).data,edit.data);equal(name+' source',B.read(),A.read());};
  const ids=A.richRange('body','P',0,4).deleteIds;
  receive('opaque inserted run',A.apply([{type:'rich-text-splice',field:'body',nodeId:'P',range:A.richRange('body','P',4,4),text:'Ω'}]));
  receive('opaque split records',A.apply([{type:'rich-split',field:'body',capture:A.richSplitCapture('body','P',3),newNodeId:'R'}]));
  receive('suffix append',A.apply([{type:'rich-text-splice',field:'body',nodeId:'R',range:A.richRange('body','R',2,2),text:'ß'}]));
  receive('opaque join records',A.apply([{type:'rich-join',field:'body',capture:A.richJoinCapture('body','P','R')}]));
  const node='N,[]"\\李明';receive('opaque buffer and run',A.apply([{type:'rich-insert-paragraph',field:'body',id:node,afterId:'Q',text:'K'}]));
  const point=A.richRange('body',node,1,1);equal('known opaque point resolves',A.resolveRichPoint(point),{nodeId:node,offset:1,detached:false});
  receive('opaque buffer append',A.apply([{type:'rich-text-splice',field:'body',nodeId:node,range:point,text:'🙂'}]));
  equal('ordered Unicode data',rows(A),[['P','A🙂ZΩß'],['Q',''],[node,'K🙂']]);equal('original IDs retained',A.richRange('body','P',0,4).deleteIds,ids);
  const opaqueIds=A.richRange('body',node,0,3).deleteIds,decoded=opaqueIds.map(id=>JSON.parse(id));assert(decoded.some(p=>p[0].includes(prefix)&&p[1].includes(prefix)));checks.push('both buffer and run preserve escaped UTF16 IDs');
  const marked=A.apply([{type:'rich-mark',field:'body',nodeId:'P',range:A.richRange('body','P',0,6),mark:'bold',enabled:true}]);receive('mark opaque syntax',marked);const undone=A.undo(marked.receiptId!);receive('undo actual mark',undone);const redone=A.redo(undone.receiptId!);receive('redo actual mark',redone);
  const good=A.richRange('body',node,0,1),actual=good.deleteIds[0],tuple=JSON.parse(actual),invalid=[actual.replace(/,/g,', '),JSON.stringify([tuple[0],tuple[1],-1]),JSON.stringify([tuple[0],tuple[1],Number.MAX_SAFE_INTEGER]),JSON.stringify([tuple[0],'',tuple[2]]),'not-json'];
  for(const value of invalid){const bad=structuredClone(good);bad.deleteIds[0]=value;const before=A.checkpoint();assert.throws(()=>A.apply([{type:'rich-mark',field:'body',nodeId:node,range:bad,mark:'italic',enabled:true}]));equal('invalid captured ID leaves checkpoint '+checks.length,A.checkpoint(),before);}
  const snapshot=A.checkpoint(),cold=make('syntax-cold',snapshot);equal('cold data exact',cold.read(),A.read());equal('cold opaque unit IDs exact',cold.richRange('body',node,0,3).deleteIds,opaqueIds);equal('cold point authority',cold.resolveRichPoint(point),{nodeId:node,offset:1,detached:false});equal('opaque sibling untouched',cold.read().opaque,initial.opaque);
  const borrowed=cold.richRange('body',node,0,3);borrowed.deleteIds.fill('caller-owned');equal('capture arrays remain detached',cold.richRange('body',node,0,3).deleteIds,opaqueIds);
 }finally{if(descriptor)Object.defineProperty(crypto,'randomUUID',descriptor);else delete (crypto as unknown as Record<string,unknown>).randomUUID;for(const p of actors){p.destroy();destroyed++;}}
 return{ok:true,checks,cleanup:{created:actors.length,destroyed}};
}
