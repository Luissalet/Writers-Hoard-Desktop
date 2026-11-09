import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {defineLocalTool,LocalToolCollaborativeRichEditor,createLocalToolReplica,type LocalToolJson,type LocalToolProps,type RichDocument} from '@/engines/local/sdk';
import type {LocalToolStateCodec} from '@/engines/local/stateCodec';
import {validateLocalToolCodecState} from '@/engines/local/stateCodec';
import {registerLocalToolModules} from '@/engines/local/registry';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {createLocalToolClient} from '@/engines/local/storage';

type State={body:RichDocument};
const text='Ωriel abrió la puerta del norte. Nadie la vio.';
const selected='la puerta del norte';
const initialState:State={body:{type:'doc',content:[{id:'opening',type:'paragraph',content:[{type:'text',text}]}]}};
const legacyCodec:LocalToolStateCodec={version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/2'}}};
// This is the proposed public author contract, deliberately unsupported before Source GO.
// There are no casts, type-error suppressions, replacement schemas or mocked clients.
const annotationCodec:LocalToolStateCodec={version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/3',annotation:{id:'story.clue',version:1,attributes:{clueKey:{type:'string'},state:{type:'string',enum:['hint','revealed']}}}}}};
const annotationPresentation={label:'Pista narrativa',attributes:{clueKey:'Clave',state:'Estado'},values:{state:{hint:'Insinuada',revealed:'Revelada'}}};
function ClueNotebook({client,context}:LocalToolProps<State>){return <LocalToolCollaborativeRichEditor client={client} context={context} field="body" label="Escena" annotationPresentation={annotationPresentation}/>;}
function LegacyNotebook({client,context}:LocalToolProps<State>){return <LocalToolCollaborativeRichEditor client={client} context={context} field="body" label="Control legado"/>;}
function guard(codec:LocalToolStateCodec){return(value:LocalToolJson):value is State=>{try{validateLocalToolCodecState(value,codec);return true;}catch{return false;}};}
function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const equal=(a:unknown,b:unknown,message:string)=>check(JSON.stringify(a)===JSON.stringify(b),message);

/** Intentional RED: normal Source declaration/create, then public range/action/snapshot APIs. */
export async function testInlineAnnotationNormalSourceRed():Promise<string[]>{
 const projectId='qa-inline-red-'+crypto.randomUUID(),checks:string[]=[];let stage='private project',failure:unknown,remaining=0;
 try{
  await db.projects.add({id:projectId,title:'Own annotation RED',description:'Synthetic isolated Source contract',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['local-tool-qa.inline-legacy-red','local-tool-qa.inline-annotation-red'],createdAt:1,updatedAt:1});
  stage='legacy normal declaration/create';
  const legacy=defineLocalTool<State>({namespace:'qa.inline-legacy-red',name:{en:'Legacy creator control',es:'Control creador legado'},description:{en:'Own normal creator control',es:'Control propio del creador normal'},document:{defaultTitle:{en:'Own legacy',es:'Legado propio'}},codec:legacyCodec,initialState,validateState:guard(legacyCodec),component:LegacyNotebook});
  registerLocalToolModules({'./installed/qa.inline-legacy-red/module.tsx':{default:legacy}});
  const previous=await createSourceToolDocument({projectId},legacy.namespace,'Legacy control');
  const legacyClient=createLocalToolClient(projectId,legacy,{documentId:previous.id});equal((await legacyClient.read()).data,initialState,'Legacy normal creator changed content');
  checks.push('Legacy /2 declared, registered and created by normal Source writer');
  stage='annotation normal codec declaration';
  const definition=defineLocalTool<State>({namespace:'qa.inline-annotation-red',name:{en:'Narrative clue notebook',es:'Cuaderno de pistas'},description:{en:'Own semantic clues in normal shared prose',es:'Pistas semánticas propias en la prosa compartida normal'},stateSchemaVersion:'annotation-1',document:{defaultTitle:{en:'Own clues',es:'Pistas propias'}},codec:annotationCodec,initialState,validateState:guard(annotationCodec),component:ClueNotebook});
  stage='annotation normal registration/create';
  registerLocalToolModules({'./installed/qa.inline-annotation-red/module.tsx':{default:definition}});
  const created=await createSourceToolDocument({projectId},definition.namespace,'Own first clue');
  const client=createLocalToolClient(projectId,definition,{documentId:created.id});check(client.convergence&&client.state,'Normal Source APIs absent');
  const before=await client.read();equal(before.data,initialState,'New document starts annotated or changed');
  stage='normal history/range';await client.convergence.start(before);
  const from=text.indexOf(selected),to=from+selected.length;check(from>=0,'Own selection absent');
  const captured=await client.convergence.richRange('body','opening',from,to);
  stage='semantic annotation action';
  const applied=await client.state.apply(captured.snapshot,[{type:'rich-annotation',field:'body',nodeId:'opening',range:captured.range,attrs:{clueKey:'north-door',state:'hint'}}]);
  const expected={body:{type:'doc',content:[{id:'opening',type:'paragraph',content:[{type:'text',text:text.slice(0,from)},{type:'text',text:selected,marks:[{type:'annotation',attrs:{clueKey:'north-door',state:'hint'}}]},{type:'text',text:text.slice(to)}]}]}};
  equal((await client.read()).data,expected,'Attribute semantics not persisted on the selected words');checks.push('Normal captured-range action persists semantic clue attributes');
  stage='normal snapshot and independent SDK reader';
  const saved=await client.convergence.export();check(saved.checkpoint,'Normal export lacks checkpoint');
  const reader=createLocalToolReplica(saved.checkpoint,{authorId:'independent-reader',contract:{namespace:definition.namespace,codec:annotationCodec,validationId:saved.checkpoint.validationId,schemaEpoch:saved.checkpoint.schemaEpoch,validateState:definition.validateState}});
  try{equal(reader.read(),expected,'Snapshot reader lost annotation descriptor or attributes');}finally{reader.destroy();}
  checks.push('Checkpoint restores exact clue semantics in an independent real SDK replica');
  stage='normal scoped Undo/Redo';check(applied.receiptId,'Annotation action did not create an author receipt');
  const undone=await client.state.undo(applied.receiptId);equal((await client.read()).data,initialState,'Undo did not restore the initial prose');check(undone.receiptId,'Undo lacks opposite receipt');
  await client.state.redo(undone.receiptId);equal((await client.read()).data,expected,'Redo lost semantic clue attributes');checks.push('Existing scoped action Undo/Redo preserves annotation semantics');
 }catch(error){failure=error;}finally{if(await db.projects.get(projectId))await deleteProject(projectId);remaining=await db.projects.where('id').equals(projectId).count();}
 if(failure)throw Error('RED phase='+stage+'; completed='+JSON.stringify(checks)+'; remainingOwnProjects='+remaining+'; original='+String(failure instanceof Error?failure.stack:failure));
 check(remaining===0,'Own project cleanup incomplete');return checks;
}
