import assert from 'node:assert/strict';
import {defineLocalTool,createLocalToolReplica,type LocalToolJson,type LocalToolReplica,type RichBlockDocument} from '../src/engines/local/sdk';
import {createFakeLocalToolHost} from '../src/engines/local/testing';
type Data=Record<string,LocalToolJson>;type Actor=LocalToolReplica<Data>;
const initial={note:'seed',body:{type:'block-doc',schema:'writers-blocks/1',blocks:[{id:'C',type:'paragraph',attrs:{},parentId:null,slot:'body',afterId:'P',content:[{type:'text',text:'control'}]},{id:'P',type:'paragraph',attrs:{},parentId:null,slot:'body',afterId:null,content:[{type:'text',text:'base'}]}]}} as unknown as Data;
const node=(a:Actor,id:string)=>(a.read().body as unknown as RichBlockDocument).blocks.find(b=>b.id===id),text=(a:Actor,id:string)=>node(a,id)!.content!.map(t=>t.text).join(''),units=(a:Actor,id:string)=>a.richRange('body',id,0,text(a,id).length).deleteIds;
type Ctx={actors:Actor[];checks:string[];eq:(n:string,a:unknown,b:unknown)=>void;observations:Record<string,unknown>};
async function setup(c:Ctx,name:string){
 const hooks:{policy?:(data:Data)=>boolean}={};const validate=(v:LocalToolJson):v is Data=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body&&(hooks.policy?.(v as Data)??true);
 const definition=defineLocalTool<Data>({namespace:'tests.block-support1932.'+name,name:{en:'Structural Undo support',es:'Soporte de Undo estructural'},description:{en:'Public causal controls',es:'Controles causales públicos'},initialState:initial,codec:{version:2,fields:{note:{kind:'scalar'},body:{kind:'rich',profile:'blocks-tree/1',schema:'writers-blocks/1'}}},validateState:validate,component:()=>null});
 const host=createFakeLocalToolHost(definition,{projects:[{id:name,updatedAt:1,sourceToolDocuments:[{id:'D',namespace:definition.namespace,title:name,generation:'G'+name,revision:1,createdAt:1,updatedAt:1,data:initial,codec:definition.codec}]}]}),client=host.createClient({projectId:name},false,'D'),started=await client.convergence!.start(await client.read()),G=started.checkpoint;
 c.eq('G normal and accepted',started.snapshot.data,initial);
 const make=(id:string,checkpoint=G)=>{const a=createLocalToolReplica<Data>(checkpoint,{authorId:id,contract:{namespace:definition.namespace,codec:definition.codec!,validationId:G.validationId,schemaEpoch:G.schemaEpoch,validateState:validate}});c.actors.push(a);return a;};return{A:make('A'),B:make('B'),make,hooks,G};
}
function edit(c:Ctx,label:string,r:ReturnType<Actor['apply']>){c.eq(label+' resolved',[r.pending,r.conflict],[false,null]);assert.ok(r.receiptId,label+' receipt');c.checks.push(label+' receipt');return r;}
function wrap(c:Ctx,a:Actor,kind:'blockquote'|'toggle'|'ordered-list'='blockquote',id='T',leaf='P'){
 return edit(c,'wrap '+id,a.apply(kind==='ordered-list'?[{type:'rich-block-wrap',field:'body',capture:a.richBlockCapture('body',{nodeIds:[leaf]}),wrapper:{id,type:kind,attrs:{start:1}},items:[{id:'Item',leafId:leaf}]}]:[{type:'rich-block-container',field:'body',capture:a.richBlockEditCapture('body',[leaf]),container:{id,type:kind,attrs:{}}}]));
}
const insert=(c:Ctx,a:Actor,parent='T',after:string|null='P')=>edit(c,'insert R',a.apply([{type:'rich-block-insert',field:'body',capture:a.richBlockEditCapture('body',[],{parentId:parent,slot:'body',afterId:after}),block:{id:'R',type:'paragraph',attrs:{}},text:'B你🙂',marks:['italic']}]));
function stable(c:Ctx,label:string,a:Actor,expected:Data){c.eq(label+' exact',a.read(),expected);c.eq(label+' conflict',a.inspect().conflict,null);}

async function late(c:Ctx){
 const{A,B,make}=await setup(c,'late'),H=wrap(c,A);B.receive(H.update);const R=insert(c,B),ids=units(B,'R'),U=edit(c,'Undo before receive B',A.undo(H.receiptId!));c.eq('no B returns G',A.read(),initial);
 edit(c,'late B result',{...A.receive(R.update),update:R.update,receiptId:R.receiptId});c.eq('late B visible',!!node(A,'R'),true);c.eq('late B same parent',node(A,'R')!.parentId,'T');c.eq('late B P root',node(A,'P')!.parentId,null);c.eq('late B units',units(A,'R'),ids);
 B.receive(U.update);stable(c,'late A/B',B,A.read());const forward=make('forward'),inverse=make('inverse');for(const [a,packets]of [[forward,[H.update,R.update,U.update]],[inverse,[U.update,R.update,H.update]]] as const){for(const p of packets)a.receive(p);for(const p of packets)a.receive(p);stable(c,'delivery',a,A.read());c.eq('delivery units',units(a,'R'),ids);}stable(c,'cold',make('cold',A.checkpoint()),A.read());
 const redo=edit(c,'Redo H',A.redo(U.receiptId!));c.eq('Redo P inside',node(A,'P')!.parentId,'T');const undone=edit(c,'Undo H again',A.undo(redo.receiptId!));B.receive(redo.update);B.receive(undone.update);stable(c,'repeat RedoUndo',B,A.read());
}
async function required(c:Ctx,kind:'toggle'|'ordered-list'){
 const{A,B,make}=await setup(c,'required-'+kind),H=wrap(c,A,kind);B.receive(H.update);const R=insert(c,B,kind==='toggle'?'T':'Item',kind==='toggle'?null:'P'),ids=units(B,'R');A.receive(R.update);const U=edit(c,'required Undo',A.undo(H.receiptId!));
 c.eq('required R visible',!!node(A,'R'),true);c.eq('required R units',units(A,'R'),ids);c.eq('required same R parent',node(A,'R')!.parentId,kind==='toggle'?'T':'Item');c.eq('required T kind',node(A,'T')!.type,kind);c.eq('required P placement',node(A,'P')!.parentId,kind==='toggle'?'T':null);if(kind==='toggle')c.eq('unique historical summary',node(A,'P')!.slot,'summary');
 B.receive(U.update);stable(c,'required peer',B,A.read());stable(c,'required cold',make('cold',A.checkpoint()),A.read());const own=edit(c,'B own Undo R',B.undo(R.receiptId!));A.receive(own.update);c.eq('support disappears without R',A.read(),initial);const redone=edit(c,'B Redo R',B.redo(own.receiptId!));A.receive(redone.update);c.eq('Redo R same units',units(A,'R'),ids);
}
async function independentAttrs(c:Ctx){
 const{A,B,make}=await setup(c,'independent-attrs'),H=wrap(c,A,'ordered-list');B.receive(H.update);const C=make('C',A.checkpoint());
 const J=edit(c,'J start7',C.apply([{type:'rich-block-transform',field:'body',capture:C.richBlockEditCapture('body',['T']),kind:'ordered-list',attrs:{start:7}}]));A.receive(J.update);B.receive(J.update);const R=insert(c,B,'Item');c.eq('B observed7',node(B,'T')!.attrs.start,7);const JU=edit(c,'J Undo',C.undo(J.receiptId!));A.receive(JU.update);A.receive(R.update);c.eq('before H Undo current1',node(A,'T')!.attrs.start,1);const U=edit(c,'H Undo after J Undo',A.undo(H.receiptId!));
 c.eq('R retained after independent attrs Undo',!!node(A,'R'),true);c.eq('independent Undo not reversed by witness',node(A,'T')!.attrs.start,1);B.receive(JU.update);B.receive(U.update);stable(c,'attrs peer',B,A.read());stable(c,'attrs cold',make('cold',A.checkpoint()),A.read());
}
async function currentAttrs(c:Ctx){
 const{A,B}=await setup(c,'current-attrs'),H=wrap(c,A,'ordered-list');B.receive(H.update);const R=insert(c,B,'Item');A.receive(R.update);const attrs=edit(c,'B start9',B.apply([{type:'rich-block-transform',field:'body',capture:B.richBlockEditCapture('body',['T']),kind:'ordered-list',attrs:{start:9}}]));A.receive(attrs.update);edit(c,'Undo with current attrs',A.undo(H.receiptId!));c.eq('current B attrs win',node(A,'T')!.attrs.start,9);c.eq('current B R retained',!!node(A,'R'),true);
}
async function moved(c:Ctx){
 const{A,B}=await setup(c,'moved'),H=wrap(c,A);B.receive(H.update);const R=insert(c,B),ids=units(B,'R'),M=edit(c,'B moves R out',B.apply([{type:'rich-block-move',field:'body',capture:B.richBlockMoveCapture('body','R',{parentId:null,slot:'body',afterId:'C'})}]));A.receive(R.update);A.receive(M.update);edit(c,'Undo after R moved',A.undo(H.receiptId!));c.eq('R retains new placement',node(A,'R')!.parentId,null);c.eq('R moved units',units(A,'R'),ids);c.eq('no unnecessary support T',!!node(A,'T'),false);
}
async function nested(c:Ctx){
 const{A,B,make}=await setup(c,'nested'),H=wrap(c,A),K=wrap(c,A,'blockquote','U');B.receive(H.update);B.receive(K.update);const R=insert(c,B,'U');A.receive(R.update);const KU=edit(c,'Undo inner',A.undo(K.receiptId!)),HU=edit(c,'Undo outer',A.undo(H.receiptId!));c.eq('nested P root',node(A,'P')!.parentId,null);c.eq('nested R U',node(A,'R')!.parentId,'U');c.eq('nested U T',node(A,'U')!.parentId,'T');B.receive(HU.update);B.receive(KU.update);stable(c,'nested peer',B,A.read());stable(c,'nested cold',make('cold',A.checkpoint()),A.read());
}
async function policy(c:Ctx){
 const{A,B,hooks}=await setup(c,'policy'),H=wrap(c,A);B.receive(H.update);const R=insert(c,B);A.receive(R.update);const before={read:A.read(),checkpoint:A.checkpoint()};hooks.policy=d=>(d.body as unknown as RichBlockDocument).blocks.find(b=>b.id==='P')?.parentId!==null;
 assert.throws(()=>A.undo(H.receiptId!),undefined,'policy rejects structural Undo before mutation');c.checks.push('policy rejection');hooks.policy=undefined;c.eq('policy exact checkpoint',A.checkpoint(),before.checkpoint);c.eq('policy exact read',A.read(),before.read);edit(c,'receipt remains usable after veto',A.undo(H.receiptId!));c.eq('after retry R visible',!!node(A,'R'),true);
}
async function reentry(c:Ctx){
 const{A,B,hooks}=await setup(c,'reentry'),H=wrap(c,A);B.receive(H.update);const R=insert(c,B);A.receive(R.update);const remote=edit(c,'remote note',B.apply([{type:'set',field:'note',value:'remote'}]));let armed=true,received:ReturnType<Actor['checkpoint']>|undefined;
 hooks.policy=d=>{if(armed&&(d.body as unknown as RichBlockDocument).blocks.find(b=>b.id==='P')?.parentId===null){armed=false;A.receive(remote.update);received=A.checkpoint();}return true;};
 assert.throws(()=>A.undo(H.receiptId!),undefined,'reentrant mutation invalidates prepared Undo');c.checks.push('reentrant rejection');hooks.policy=undefined;c.eq('reentrant callback reached',armed,false);c.eq('only exact nested update committed',A.checkpoint(),received);c.eq('original H not partially undone',node(A,'P')!.parentId,'T');c.eq('nested note retained',A.read().note,'remote');edit(c,'old receipt remains valid after reentry',A.undo(H.receiptId!));c.eq('retry retains R',!!node(A,'R'),true);
}
async function cycles(c:Ctx){
 const{A,B,make}=await setup(c,'cycles'),H=wrap(c,A),K=wrap(c,A,'blockquote','U','C');B.receive(H.update);B.receive(K.update);
 const x=edit(c,'A move T in U',A.apply([{type:'rich-block-move',field:'body',capture:A.richBlockMoveCapture('body','T',{parentId:'U',slot:'body',afterId:null})}])),y=edit(c,'B move U in T',B.apply([{type:'rich-block-move',field:'body',capture:B.richBlockMoveCapture('body','U',{parentId:'T',slot:'body',afterId:null})}]));A.receive(y.update);B.receive(x.update);assert.ok(A.inspect().conflict,'cycle conflict explicit');c.checks.push('cycle conflict explicit');c.eq('cycle peers conflict same',A.inspect(),B.inspect());c.eq('cycle cold honest',make('cold',A.checkpoint()).inspect(),A.inspect());
}
async function lateIndependentAttrs(c:Ctx){
 const{A,B,make}=await setup(c,'late-independent-attrs'),H=wrap(c,A,'ordered-list');B.receive(H.update);const C=make('C',A.checkpoint());
 const J=edit(c,'late J start7',C.apply([{type:'rich-block-transform',field:'body',capture:C.richBlockEditCapture('body',['T']),kind:'ordered-list',attrs:{start:7}}]));A.receive(J.update);B.receive(J.update);const R=insert(c,B,'Item');A.receive(R.update);const U=edit(c,'H Undo before independent J Undo',A.undo(H.receiptId!));c.eq('before late J Undo support7',node(A,'T')!.attrs.start,7);
 const JU=edit(c,'late J Undo',C.undo(J.receiptId!));A.receive(JU.update);c.eq('late independent Undo stays resolved',A.inspect().conflict,null);c.eq('late independent Undo retains R',!!node(A,'R'),true);c.eq('late independent Undo must restore1',node(A,'T')!.attrs.start,1);
 B.receive(U.update);B.receive(JU.update);stable(c,'late attrs peer',B,A.read());const inverse=make('inverse');for(const p of [JU.update,U.update,R.update,J.update,H.update])inverse.receive(p);stable(c,'late attrs inverse',inverse,A.read());stable(c,'late attrs cold',make('cold',A.checkpoint()),A.read());
}
async function incompatibleSummary(c:Ctx){
 const{A,B,make}=await setup(c,'incompatible-summary'),H=wrap(c,A,'toggle');B.receive(H.update);const R=insert(c,B,'T',null),U=edit(c,'summary H Undo without B',A.undo(H.receiptId!));const C=make('mover',A.checkpoint());
 const M=edit(c,'new summary placement after Undo',C.apply([{type:'rich-block-move',field:'body',capture:C.richBlockMoveCapture('body','P',{parentId:null,slot:'body',afterId:'C'})}]));A.receive(M.update);const result=A.receive(R.update);assert.ok(result.conflict,'incompatible summary must expose conflict');c.checks.push('incompatible summary honest conflict');
 const raw=result.conflict!.raw as Data,blocks=(raw.body as unknown as RichBlockDocument).blocks;c.eq('raw retains R contribution',blocks.some(b=>b.id==='R'),true);c.eq('new P placement not overwritten',blocks.find(b=>b.id==='P')!.afterId,'C');c.eq('summary cold same conflict',make('cold',A.checkpoint()).inspect(),A.inspect());
 B.receive(U.update);B.receive(M.update);c.eq('summary peer conflict same',B.inspect(),A.inspect());
}
async function explicitHide(c:Ctx){
 const{A,B,make}=await setup(c,'explicit-hide'),H=wrap(c,A);B.receive(H.update);const R=insert(c,B),hidden=edit(c,'explicit hide T',B.apply([{type:'rich-block-hide',field:'body',capture:B.richBlockEditCapture('body',['T'])}]));A.receive(R.update);edit(c,'A Undo H before hide receipt',A.undo(H.receiptId!));A.receive(hidden.update);c.eq('explicit hide resolved',A.inspect().conflict,null);c.eq('explicit hide does not revive R',!!node(A,'R'),false);c.eq('explicit hide no support T',!!node(A,'T'),false);stable(c,'explicit hide cold',make('cold',A.checkpoint()),A.read());
}

export async function runBlockSupportCausals(){
 const reports:unknown[]=[];let created=0,destroyed=0;
 for(const[name,fn]of [['lateB',late],['required-toggle',(c:Ctx)=>required(c,'toggle')],['required-list',(c:Ctx)=>required(c,'ordered-list')],['independent-attrs',independentAttrs],['current-attrs',currentAttrs],['moved-out',moved],['nested',nested],['policy-atomic',policy],['reentry-atomic',reentry],['cycle-conflict',cycles],['late-independent-attrs',lateIndependentAttrs],['incompatible-summary',incompatibleSummary],['explicit-hide',explicitHide]] as const){
  const c:Ctx={actors:[],checks:[],observations:{},eq:(n,a,b)=>{assert.deepStrictEqual(a,b,n);c.checks.push(n);}};let failure:unknown=null;const cleanupErrors:string[]=[];
  try{await fn(c);}catch(e){failure={message:String(e),stack:(e as Error).stack};}finally{created+=c.actors.length;for(const a of c.actors)try{a.destroy();destroyed++;}catch(e){cleanupErrors.push(String(e));}}
  reports.push({name,ok:!failure&&!cleanupErrors.length,checks:c.checks,failure,observations:c.observations,cleanup:{created:c.actors.length,destroyed:c.actors.length-cleanupErrors.length},cleanupErrors});
 }
 return{ok:reports.every((r:any)=>r.ok),reports,cleanup:{created,destroyed},scope:'Public RAM SDK causals, no Source/MCP/Brave/performance acceptance'};
}
