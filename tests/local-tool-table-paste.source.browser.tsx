import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {Extension,type Editor} from '@tiptap/core';
import {TextSelection} from '@tiptap/pm/state';
import {CellSelection} from '@tiptap/pm/tables';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import original from '@/engines/local/installed/examples.table-paste/module';
import {defineLocalTool,LocalToolCollaborativeRichEditor,type LocalToolJson,type LocalToolProps,type LocalToolSnapshot} from '@/engines/local/sdk';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import LocalToolDocumentHost from '@/engines/local/documents/LocalToolDocumentHost';
import {registerLocalToolModules} from '@/engines/local/registry';
import {createLocalToolClient} from '@/engines/local/storage';
import {convergenceCanonical} from '@/engines/local/convergence/format';
import type {RichBlockDocument} from '@/engines/local/convergence/blockFormat';
import type {RichBlockEditCapture} from '@/engines/local/convergence/blockEditingTypes';
import {tableAxesRows} from '@/engines/local/collaborativeRich/tableAxesLayout';
import {useLocaleStore} from '@/stores/localeStore';
import {createProjectZipArchive,importProjectZip} from '@/services/zipBackup';
import {runBridgeTool} from '@/services/aiBridge/dispatch';

export async function testSourceTablePaste(){
 const projectId='own-table-paste-'+crypto.randomUUID(),field='body',element=document.getElementById('root')!;
 const root=createRoot(element),checks:string[]=[],previousLocale=useLocaleStore.getState().locale;
 let editor:Editor|undefined,mounted=false;
 const equal=(label:string,actual:unknown,expected:unknown)=>{
  if(convergenceCanonical(actual)!==convergenceCanonical(expected))throw Error(label+': '+JSON.stringify([actual,expected]));
  checks.push(label);Reflect.set(window,'__testStage',label);
 };
 const button=(name:string)=>Array.from(element.querySelectorAll('button')).find(item=>item.textContent===name);
 const wait=async(predicate:()=>boolean,label:string)=>{
  for(let i=0;i<120;i++){if(predicate())return;await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});}
  throw Error(label);
 };
 const cell=(row:string,column:string)=>Array.from(editor!.view.dom.querySelectorAll('th,td')).find(node=>node.getAttribute('data-writer-cell-address')===JSON.stringify(['T',row,column]))!;
 const grid=()=>Array.from(editor!.view.dom.querySelectorAll('table tr'),row=>Array.from(row.children,cell=>[cell.tagName,cell.textContent]));
 const caret=async(row:string,column:string)=>{
  const view=editor!.view;
  await act(async()=>{view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,view.posAtDOM(cell(row,column).querySelector('p')!,0))));});
 };
 const select=async()=>{
  const view=editor!.view;
  await act(async()=>{view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc,view.posAtDOM(cell('R3','C3'),0)-1,view.posAtDOM(cell('R2','C1'),0)-1)));});
 };
 const paste=async(html:string)=>{
  const clipboardData=new DataTransfer();clipboardData.setData('text/html',html);
  await act(async()=>{editor!.view.dom.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData}));});
 };
 const click=async(name:string)=>{
  const target=button(name);if(!target||target.disabled)throw Error('Button unavailable '+name);
  await act(async()=>target.click());
 };
 try{
  useLocaleStore.setState({locale:'en'});
  const extensions=[Extension.create({name:'observeTablePaste2180',onCreate(){editor=this.editor;}})];
  function Fixture({client,context}:LocalToolProps<LocalToolJson>){
   return <LocalToolCollaborativeRichEditor client={client} context={context} field={field} extensions={extensions}/>;
  }
  const definition=defineLocalTool({...original,namespace:'tests.table-paste',component:Fixture});
  registerLocalToolModules({'./installed/tests.table-paste/module.tsx':{default:definition}});
  await db.projects.add({id:projectId,title:'Own table paste',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:['local-tool-'+definition.namespace],createdAt:1,updatedAt:1});
  const documentId=(await createSourceToolDocument({projectId},definition.namespace,'Own paste')).id;
  const client=createLocalToolClient(projectId,definition,{documentId}),convergence=client.convergence!;
  await convergence.start(await client.read());
  const place=await convergence.richBlockEditCapture(field,[],{parentId:null,slot:'body',afterId:'P'});
  await client.state!.apply(place.snapshot,[{type:'rich-table-create',field,capture:place.capture,table:{id:'T',rows:['R1','R2','R3'].map((id,i)=>({id,header:i===0})),columns:['C1','C2','C3'].map(id=>({id}))}}]);
  const initial=await convergence.export();
  await act(async()=>root.render(<MemoryRouter><LocalToolDocumentHost projectId={projectId} documentId={documentId} namespace={definition.namespace}/></MemoryRouter>));mounted=true;
  await wait(()=>!!editor?.isEditable,'The normal Source editor is not ready');
  const base=grid();
  await caret('R2','C1');
  await paste('<table><tr><th><p><strong>Mapa Ω</strong> β🙂</p></th><td><p>Sur</p></td><th><p></p></th></tr></table>');
  equal('HTML paste from a caret preserves mixed headers, Unicode and an empty header',[grid()[1],cell('R2','C1').querySelector('strong')?.textContent],[ [['TH','Mapa Ω β🙂'],['TD','Sur'],['TH','']], 'Mapa Ω' ]);
  equal('The pasted range is selected',editor!.state.selection instanceof CellSelection,true);
  await click('Undo');
  equal('One Undo restores the table before paste',grid(),base);
  await select();
  await paste('<table><tr><th><p>Alfa</p></th><td><p>Beta</p></td></tr></table>');
  const expected=[['TH','Alfa'],['TD','Beta'],['TH','Alfa']];
  equal('A reversed six-cell selection tiles the same pattern in both rows',grid().slice(1),[expected,expected]);
  const beforeInvalid=grid();
  await paste('<table><tr><td colspan="2"><p>Unmerged only</p></td></tr></table>');
  equal('An unsupported spanning cell does not partially write',grid(),beforeInvalid);
  equal('The pasted draft leaves the saved checkpoint exact until Save',(await convergence.export()).checkpoint,initial.checkpoint);
  await click('Save changes');
  await wait(()=>button('Save changes')?.disabled===true,'Paste was not saved');
  const saved=await convergence.export(),scope={projectId,namespace:definition.namespace,documentId};
  const reply=await runBridgeTool('wh_local_tool_rich_block_edit_capture',{...scope,field,nodeIds:['T']});
  if(!reply.ok)throw Error(JSON.stringify(reply));
  const witness=reply.result as {capture:RichBlockEditCapture;snapshot:LocalToolSnapshot<LocalToolJson>};
  equal('Bridge and SDK return the exact same table capture',witness,await convergence.richBlockEditCapture(field,['T']));
  await act(async()=>root.unmount());mounted=false;
  const sent=await runBridgeTool('wh_local_tool_state_apply',{...scope,baseline:witness.snapshot,actions:[{
   type:'rich-table-paste',field,capture:witness.capture,target:{rows:['R1','R2','R3'],columns:['C1','C2','C3'],anchor:['R3','C3']},
   matrix:[[true,false],[false,true]].map((row,y)=>row.map((header,x)=>({header,paragraphs:[[{type:'text',text:String(y*2+x)}]]}))),
  }]});
  if(!sent.ok||!sent.result.receiptId)throw Error(JSON.stringify(sent));
  const changed=await convergence.export(),data=(changed.snapshot.data as {body:RichBlockDocument}).body;
  const rows=tableAxesRows(data,'T');
  equal('The bridge grows both axes and retains the mixed cell types',[rows.map(row=>row.cells.length),rows.slice(2).map(row=>row.cells.slice(2).map(cell=>cell.header))],[[4,4,4,4],[[true,false],[false,true]]]);
  equal('The engine and genesis stay exact',[changed.checkpoint.engine.version,changed.checkpoint.genesisId],['14',initial.checkpoint.genesisId]);
  const zip=await createProjectZipArchive(projectId);
  await importProjectZip(new File([zip.blob],'table-paste.zip',{type:'application/zip'}),{replaceProjectIds:[projectId]});
  db.close();await db.open();
  equal('The project ZIP reopens the exact pasted state and history',(await convergence.export()).checkpoint,changed.checkpoint);
  equal('The saved UI paste and bridge paste produce separate checkpoints',[saved.checkpoint.checkpointBase64!==initial.checkpoint.checkpointBase64,changed.checkpoint.checkpointBase64!==saved.checkpoint.checkpointBase64],[true,true]);
  return checks;
 }finally{
  if(mounted)await act(async()=>root.unmount());
  if(await db.projects.get(projectId))await deleteProject(projectId);
  await db.settings.where('key').equals('writer.rich.saveMode').delete();
  useLocaleStore.setState({locale:previousLocale});
 }
}
