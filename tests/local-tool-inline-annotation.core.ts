import {collectRoomImageAssets} from '@/engines/local/convergence/imageRefs';
import * as Y from 'yjs';
import {convergenceBase64,convergenceBytes} from '@/engines/local/convergence/json';
import {createLocalToolGenesis,createLocalToolReplica,exportLocalToolConvergenceCheckpoint} from '@/engines/local/convergence/replica';
import {annotationCanonical,annotationSpec,validateAnnotationAttrs,validateAnnotationSpec,type RichAnnotationAttrs} from '@/engines/local/convergence/annotationFormat';
import {validateLocalToolCodecState,type LocalToolStateCodec} from '@/engines/local/stateCodec';
import type {LocalToolConvergenceCheckpoint,LocalToolConvergenceContract,LocalToolReplica,LocalToolJson,RichDocument} from '@/engines/local/sdk';

type State={body:RichDocument;aside:RichDocument};
const spec={id:'story.clue',version:1 as const,attributes:{clueKey:{type:'string' as const},state:{type:'string' as const,enum:['hint','revealed']},weight:{type:'number' as const},confirmed:{type:'boolean' as const},empty:{type:'null' as const}}};
const codec:LocalToolStateCodec={version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/3',annotation:spec},aside:{kind:'rich',profile:'paragraphs-inline/2'}}};
const initial:State={body:{type:'doc',content:[{id:'P',type:'paragraph',content:[{type:'text',text:'aΩ🙂bc',marks:[{type:'bold'},{type:'link',attrs:{href:'https://example.org/own'}}]}]},{id:'Q',type:'paragraph',content:[{type:'text',text:'second'}]}]},aside:{type:'doc',content:[{id:'S',type:'paragraph',content:[{type:'text',text:'legacy'}]}]}};
const attrs=(clueKey:string,state='hint'):RichAnnotationAttrs=>({clueKey,state,weight:2.5,confirmed:false,empty:null});
const contract:LocalToolConvergenceContract<State>={namespace:'qa.inline.core',codec,validationId:'inline-core-1',schemaEpoch:'inline-core-1',validateState:(value:LocalToolJson):value is State=>{try{validateLocalToolCodecState(value,codec);return true;}catch{return false;}}};
export async function testInlineAnnotationCore(){
 const checks:string[]=[],actors:LocalToolReplica<State>[]=[];
 const eq=(name:string,a:unknown,b:unknown)=>{if(annotationCanonical(a)!==annotationCanonical(b))throw Error(name+' '+JSON.stringify([a,b]));checks.push(name);};
 const rejects=(name:string,fn:()=>unknown)=>{let rejected=false;try{fn();}catch{rejected=true;}eq(name,rejected,true);};
 const G=createLocalToolGenesis(initial,contract),make=(id:string,checkpoint:LocalToolConvergenceCheckpoint=G)=>{const actor=createLocalToolReplica(checkpoint,{authorId:id,contract});actors.push(actor);return actor;};
 const mark=(actor:LocalToolReplica<State>,node='P')=>actor.read().body.content.find(p=>p.id===node)!.content.flatMap(run=>Array.from({length:run.text.length},()=>run.marks?.find(m=>m.type==='annotation')?.attrs??null));
 const annotate=(actor:LocalToolReplica<State>,value:RichAnnotationAttrs|null,node='P',from=0,to=node==='P'?6:6)=>actor.apply([{type:'rich-annotation',field:'body',nodeId:node,range:actor.richRange('body',node,from,to),attrs:value}]);
 try{
  for(const id of ['constructor','prototype','__proto__','toString']){validateAnnotationSpec({...spec,id});eq('opaque semantic ID preserved '+id,annotationSpec({kind:'rich',profile:'paragraphs-inline/3',annotation:{...spec,id}})?.id,id);}
  eq('same writer version16',G.engine,{id:'writers-hoard-yjs-registers',version:'16',updateFormat:'yjs-v1',libraryVersion:'13.6.33'});
  for(const invalid of [{...spec,other:true},{...spec,version:2},{...spec,attributes:{x:{type:'object'}}},{...spec,attributes:{x:{type:'number',enum:[1,1]}}},{...spec,attributes:{x:{type:'string',enum:[1]}}}])rejects('invalid descriptor rejects',()=>validateAnnotationSpec(invalid));
  for(const invalid of [{}, {...attrs('x'),extra:1},{...attrs('x'),weight:Infinity},{...attrs('x'),confirmed:0},{...attrs('x'),state:'missing'},{...attrs('x'),empty:'null'}])rejects('exact scalar attrs reject',()=>validateAnnotationAttrs(invalid,spec));
  const policy=annotationSpec(codec.fields.body)!;eq('policy detached',policy!==spec,true);eq('policy frozen',Object.isFrozen(policy)&&Object.isFrozen(policy.attributes)&&Object.isFrozen(policy.attributes.state.enum),true);
  const A=make('A'),B=make('B'),beforeIds=A.richRange('body','P',0,6).deleteIds;
  const left=annotate(A,attrs('left')),right=annotate(B,attrs('right','revealed'));
  A.receive(right.update);B.receive(left.update);eq('concurrent whole attrs converge',A.read(),B.read());
  eq('winner is a complete record',mark(A).every(value=>annotationCanonical(value)===annotationCanonical(attrs('left'))||annotationCanonical(value)===annotationCanonical(attrs('right','revealed'))),true);
  const O1=make('order-forward'),O2=make('order-reverse');O1.receive(left.update);O1.receive(right.update);O2.receive(right.update);O2.receive(left.update);eq('inverted delivery exact',O1.read(),O2.read());
  const duplicate=A.checkpoint();eq('duplicate no novelty',A.receive(right.update).causalChanged,false);eq('duplicate bytes exact',A.checkpoint(),duplicate);
  const undo=A.undo(left.receiptId!);B.receive(undo.update);eq('Undo preserves foreign complete attrs',mark(A),Array(6).fill(attrs('right','revealed')));eq('Undo converges',A.read(),B.read());
  const redo=A.redo(undo.receiptId!);B.receive(redo.update);eq('Redo converges',A.read(),B.read());eq('annotation keeps unit identities',A.richRange('body','P',0,6).deleteIds,beforeIds);
  eq('stock bold and link remain',A.read().body.content[0].content.every(run=>run.marks?.some(m=>m.type==='bold')&&run.marks.some(m=>m.type==='link')),true);
  const insertion=B.apply([{type:'rich-text-splice',field:'body',nodeId:'P',range:B.richRange('body','P',2,2),text:'X'}]);A.receive(insertion.update);
  const own=A.apply([{type:'rich-annotation',field:'body',nodeId:'P',range:A.richRange('body','P',0,7),attrs:attrs('later')}]);B.receive(own.update);const undone=A.undo(own.receiptId!);B.receive(undone.update);eq('Undo preserves inserted foreign text',A.read().body.content[0].content.map(r=>r.text).join(''),'aΩX🙂bc');
  const cold=make('cold',A.checkpoint());eq('cold snapshot exact attrs',cold.read(),A.read());const raw=exportLocalToolConvergenceCheckpoint(A.checkpoint());eq('raw checkpoint export not pending',raw.pending,false);eq('annotation-only room has no media',collectRoomImageAssets(raw.update),[]);const Raw=make('raw-export');Raw.receive(raw.update);eq('raw checkpoint DTO export exact',Raw.read(),A.read());
  const Late=make('late');Late.receive(undone.update);Late.receive(insertion.update);Late.receive(own.update);Late.receive(redo.update);Late.receive(undo.update);Late.receive(right.update);Late.receive(left.update);eq('late causality recovers exact',Late.read(),A.read());
  const C=make('batch'),rangeP=C.richRange('body','P',1,4),rangeQ=C.richRange('body','Q',0,6);const batch=C.apply([{type:'rich-annotation',field:'body',nodeId:'P',range:rangeP,attrs:attrs('multi')},{type:'rich-annotation',field:'body',nodeId:'Q',range:rangeQ,attrs:attrs('multi')}]);eq('multiparagraph range atomic one receipt',typeof batch.receiptId,'string');eq('Unicode selected by UTF16 units',mark(C),[null,...Array(3).fill(attrs('multi')),null,null]);eq('second paragraph annotation exact',mark(C,'Q'),Array(6).fill(attrs('multi')));C.undo(batch.receiptId!);eq('batch Undo exact initial',C.read(),initial);
  const before=C.checkpoint();rejects('mixed batch legacy field rejects',()=>C.apply([{type:'rich-annotation',field:'body',nodeId:'P',range:C.richRange('body','P',0,1),attrs:attrs('ok')},{type:'rich-annotation',field:'aside',nodeId:'S',range:C.richRange('aside','S',0,1),attrs:attrs('bad')}]));eq('mixed batch checkpoint exact',C.checkpoint(),before);
  for(const bad of [{},null,false,{...attrs('x'),extra:true}]){rejects('invalid optional empty insertion rejects',()=>C.apply([Object.assign({type:'rich-insert-paragraph' as const,field:'body',id:'BAD',afterId:'P',text:''},{annotation:bad})]));eq('invalid insertion no causal write',C.checkpoint(),before);}
  const inserted=C.apply([{type:'rich-insert-paragraph',field:'body',id:'NEW',afterId:'P',text:'fresh',annotation:attrs('new')},{type:'rich-text-splice',field:'body',nodeId:'Q',range:C.richRange('body','Q',6,6),text:'!',annotation:attrs('typed')}]);eq('typed annotation exact',mark(C,'Q').at(-1),attrs('typed'));eq('insert paragraph annotation exact',mark(C,'NEW'),Array(5).fill(attrs('new')));C.undo(inserted.receiptId!);eq('insertions Undo exact',C.read(),initial);
  const wrongCodec:LocalToolStateCodec={version:2,fields:{...codec.fields,body:{kind:'rich',profile:'paragraphs-inline/3',annotation:{...spec,id:'other.clue'}}}};rejects('descriptor mismatch checkpoint refuses',()=>createLocalToolReplica(G,{authorId:'wrong',contract:{...contract,codec:wrongCodec}}));
  eq('legacy aside remains exact',A.read().aside,initial.aside);
  const causal=make('explicit-equal'),firstEqual=annotate(causal,attrs('same')),equalBefore=causal.checkpoint(),secondEqual=annotate(causal,attrs('same'));eq('explicit equal API intent retains causal receipt',typeof secondEqual.receiptId,'string');eq('explicit equal API intent has same data',secondEqual.changed,false);eq('explicit equal API intent has causal novelty',secondEqual.causalChanged,true);eq('equal intent bytes differ',causal.checkpoint().checkpointBase64!==equalBefore.checkpointBase64,true);causal.undo(secondEqual.receiptId!);eq('Undo equal intent reveals prior equal value',mark(causal),Array(6).fill(attrs('same')));causal.undo(firstEqual.receiptId!);eq('Undo first intent clears annotation',mark(causal),Array(6).fill(null));
  const tamper=(modify:(doc:Y.Doc)=>void)=>{const doc=new Y.Doc({gc:false});try{Y.applyUpdate(doc,convergenceBytes(raw.update.updateBase64));modify(doc);return{...raw.update,updateBase64:convergenceBase64(Y.encodeStateAsUpdate(doc))};}finally{doc.destroy();}};
  for(const[label,modify]of[
   ['width root present without value',(doc:Y.Doc)=>doc.getMap('table-width-fields').set('other','[]')],
   ['width root malformed value',(doc:Y.Doc)=>doc.getMap('table-width-fields').set('value','{}')],
   ['undeclared image capability',(doc:Y.Doc)=>doc.getMap('image-fields').set('value','["body"]')],
   ['descriptor extra authority',(doc:Y.Doc)=>doc.getMap('rich-annotation-codec').set('other','{}')],
   ['descriptor wrong hash',(doc:Y.Doc)=>doc.getMap('rich-annotation-codec').set('value',JSON.stringify(wrongCodec))],
   ['descriptor deleted value',(doc:Y.Doc)=>doc.getMap('rich-annotation-codec').delete('value')],
   ['descriptor same value rewritten',(doc:Y.Doc)=>{const root=doc.getMap('rich-annotation-codec');root.set('value',root.get('value'));}],
  ] as const){const bad=tamper(modify),beforeBad=A.checkpoint();rejects(label+' rejects media inspection',()=>collectRoomImageAssets(bad));rejects(label+' rejects real replica receive',()=>A.receive(bad));eq(label+' receive remains atomic',A.checkpoint(),beforeBad);}
  rejects('epoch mismatch rejects independent reader',()=>createLocalToolReplica(G,{authorId:'wrong-epoch',contract:{...contract,schemaEpoch:'other'}}));
  rejects('validation identity mismatch rejects independent reader',()=>createLocalToolReplica(G,{authorId:'wrong-validator',contract:{...contract,validationId:'other'}}));
 }finally{for(const actor of actors)actor.destroy();checks.push('Destroyed all '+actors.length+' real replicas');}
 return checks;
}
