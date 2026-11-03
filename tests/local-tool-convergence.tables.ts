import * as Y from 'yjs';
import {convergenceBytes} from '@/engines/local/convergence/format';
import {createLocalToolGenesis,createLocalToolReplica,exportLocalToolConvergenceCheckpoint} from '@/engines/local/convergence/replica';
import {convergenceCanonical} from '@/engines/local/convergence/format';
import type {LocalToolConvergenceContract} from '@/engines/local/convergence/formatTypes';
import type {LocalToolJson} from '@/engines/local/stateTypes';
/** Public metadata/reader boundaries; structural and Undo suites are separate. */
export function testFixedTableFormat(){
 const checks:string[]=[],equal=(name:string,a:unknown,b:unknown)=>{if(convergenceCanonical(a)!==convergenceCanonical(b))throw Error(name);checks.push(name);};
 const contract:LocalToolConvergenceContract={namespace:'tests.fixed-tables',codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/3',schema:'writers-blocks/2'},legacy:{kind:'rich',profile:'blocks-tree/2',schema:'writers-blocks/1'},strict:{kind:'rich',profile:'paragraphs-inline/1'}}},validationId:'fixed-tables-1',schemaEpoch:'fixed-tables-1',validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.strict};
 const data:LocalToolJson={body:{type:'block-doc',schema:'writers-blocks/2',blocks:[]},legacy:{type:'block-doc',schema:'writers-blocks/1',blocks:[]},strict:{type:'doc',content:[{id:'S',type:'paragraph',content:[{type:'text',text:'strictΩ'}]}]}};
 try{
 const checkpoint=createLocalToolGenesis(data,contract);equal('new finite table grammar selects engine5',checkpoint.engine.version,'5');const sdk=createLocalToolReplica(checkpoint,{authorId:'format-A',contract});try{equal('mixed field read is exact',sdk.read(),data);equal('export without definition understands empty capable field',exportLocalToolConvergenceCheckpoint(sdk.checkpoint()).pending,false);}finally{sdk.destroy();}
 const absent=createLocalToolGenesis({strict:data.strict},contract);equal('capability persists when table field is absent',absent.engine.version,'5');equal('definition-free absent field export is complete',exportLocalToolConvergenceCheckpoint(absent).pending,false);
 const table={type:'block-doc',schema:'writers-blocks/2',blocks:[{id:'T',type:'table',attrs:{columns:['C']},parentId:null,slot:'body',afterId:null},{id:'R',type:'table-row',attrs:{},parentId:'T',slot:'body',afterId:null},{id:'X',type:'table-cell',attrs:{columnId:'C'},parentId:'R',slot:'body',afterId:null},{id:'P',type:'paragraph',attrs:{},parentId:'X',slot:'body',afterId:null,content:[]}]};
 table.blocks.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 const represented=createLocalToolGenesis({...data,body:table} as LocalToolJson,contract);const tableSdk=createLocalToolReplica(represented,{authorId:'table-seed',contract});try{equal('finite grid roundtrip retains IDs and empty leaf',tableSdk.read(),{...data,body:table});equal('definition-free grid export is complete',exportLocalToolConvergenceCheckpoint(represented).pending,false);}finally{tableSdk.destroy();}
 let rejected=false;try{createLocalToolGenesis({...data,legacy:table} as LocalToolJson,contract);}catch{rejected=true;}equal('legacy sibling rejects the new grammar under engine5',rejected,true);
 return{checks,checkpoint,absent,represented};
 }catch(error){throw Error(JSON.stringify(checks)+"; "+String(error));}
}

export function testFixedTableCreationUndo(){
 const checks:string[]=[],equal=(name:string,a:unknown,b:unknown)=>{if(convergenceCanonical(a)!==convergenceCanonical(b))throw Error(name+': '+JSON.stringify([a,b]));checks.push(name);};
 const contract:LocalToolConvergenceContract={namespace:'tests.fixed-table-undo',codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/3',schema:'writers-blocks/2'}}},validationId:'fixed-grid-1',schemaEpoch:'fixed-grid-1',validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body},data:LocalToolJson={body:{type:'block-doc',schema:'writers-blocks/2',blocks:[{id:'O',type:'paragraph',attrs:{},parentId:null,slot:'body',afterId:null,content:[{type:'text',text:'outsideΩ'}]}]}};
 const G=createLocalToolGenesis(data,contract),A=createLocalToolReplica(G,{authorId:'A',contract}),B=createLocalToolReplica(G,{authorId:'B',contract}),wire=new Y.Doc({gc:false});
 try{
  equal('health empty capable origin preserves outside paragraph',A.read(),data);
  const capture=A.richBlockEditCapture('body',[],{parentId:null,slot:'body',afterId:'O'}),table={id:'T',columns:['C1','C2'],rows:[1,2].map(row=>({id:'R'+row,cells:[1,2].map(col=>({id:'X'+row+col,columnId:'C'+col,paragraph:{id:'P'+row+col,text:row===2&&col===2?'AΩ':''}}))}))},insert=A.apply([{type:'rich-table-insert',field:'body',capture,table}]);
  equal('single atomic table insertion owns a receipt',typeof insert.receiptId,'string');B.receive(insert.update);equal('inserted fixed grid reaches B',B.read(),A.read());
  Y.applyUpdate(wire,convergenceBytes(B.checkpoint().checkpointBase64));const beforeRouting=[...wire.getMap('register-versions').values()].filter(v=>JSON.parse(String(v)).root==='rich3:'+JSON.stringify('body')+':routing').length;
  const b=B.apply([{type:'rich-text-splice',field:'body',nodeId:'P11',range:B.richRange('body','P11',0,0),text:'Bβ🙂'}]);Y.applyUpdate(wire,convergenceBytes(b.update.updateBase64));const afterRouting=[...wire.getMap('register-versions').values()].filter(v=>JSON.parse(String(v)).root==='rich3:'+JSON.stringify('body')+':routing').length;equal('B append creates no routingB',afterRouting,beforeRouting);A.receive(b.update);
  const inverse=A.undo(insert.receiptId!);B.receive(inverse.update);const view=A.read() as {body:{blocks:{id:string;type:string;content?:{text:string}[]}[]}};
  equal('UndoA preserves complete 2x2 scaffold',view.body.blocks.filter(n=>n.type==='table-cell').length,4);equal('UndoA keeps B in original leaf',view.body.blocks.find(n=>n.id==='P11')?.content?.map(t=>t.text).join('')??null,'Bβ🙂');equal('UndoA does not resurrect own text',view.body.blocks.find(n=>n.id==='P22')?.content??null,[]);equal('UndoA replicas agree',B.read(),A.read());
  const undone=B.undo(b.receiptId!);A.receive(undone.update);equal('last B Undo removes whole derived grid',A.read(),data);const redone=B.redo(undone.receiptId!);A.receive(redone.update);equal('B Redo restores same table IDs',((A.read() as {body:{blocks:{id:string}[]}}).body.blocks.map(n=>n.id)),view.body.blocks.map(n=>n.id));return{checks};
 }catch(error){throw Error(JSON.stringify(checks)+'; '+String(error));}finally{A.destroy();B.destroy();wire.destroy();}
}
