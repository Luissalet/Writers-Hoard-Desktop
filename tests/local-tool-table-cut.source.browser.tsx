import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {Extension,type Editor} from '@tiptap/core';
import {CellSelection} from '@tiptap/pm/tables';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import original from '@/engines/local/installed/examples.table-images/module';
import {defineLocalTool,LocalToolCollaborativeRichEditor,type LocalToolJson,type LocalToolProps} from '@/engines/local/sdk';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import LocalToolDocumentHost from '@/engines/local/documents/LocalToolDocumentHost';
import {registerLocalToolModules} from '@/engines/local/registry';
import {createLocalToolClient} from '@/engines/local/storage';
import {convergenceCanonical} from '@/engines/local/convergence/format';
import {createLocalToolReplica} from '@/engines/local/convergence/replica';
import {useLocaleStore} from '@/stores/localeStore';
import {rasterFixtures} from './local-tool-image-formats.fixture';

export async function testSourceTableCut(){
 const projectId='own-table-cut-'+crypto.randomUUID(),field='body',element=document.getElementById('root')!;
 const root=createRoot(element),checks:string[]=[],previousLocale=useLocaleStore.getState().locale;
 let editor:Editor|undefined,peer:ReturnType<typeof createLocalToolReplica>|undefined;
 const equal=(label:string,actual:unknown,expected:unknown)=>{
  if(convergenceCanonical(actual)!==convergenceCanonical(expected))throw Error(label+': '+JSON.stringify([actual,expected]));
  checks.push(label);Reflect.set(window,'__testStage',label);
 };
 const button=(name:string)=>Array.from(element.querySelectorAll('button')).find(item=>item.textContent===name);
 const wait=async(predicate:()=>boolean,label:string)=>{
  for(let i=0;i<100;i++){if(predicate())return;await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});}
  throw Error(label);
 };
 const cell=(row:string,column:string)=>Array.from(editor!.view.dom.querySelectorAll('th,td')).find(node=>node.getAttribute('data-writer-cell-address')===JSON.stringify(['T',row,column]))!;
 const contents=()=>Array.from(editor!.view.dom.querySelectorAll('th,td'),node=>[
  node.tagName,Array.from(node.querySelectorAll('p'),p=>p.textContent).join('\n'),node.querySelector('[data-writer-image]')?.getAttribute('data-writer-image')??null,
 ]);
 const select=async(row:string,column:string)=>{
  const view=editor!.view;
  await act(async()=>{view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc,view.posAtDOM(cell('R1','C1'),0)-1,view.posAtDOM(cell(row,column),0)-1)));});
 };
 const cut=async(clipboardData?:DataTransfer)=>{
  await act(async()=>{editor!.view.dom.dispatchEvent(new ClipboardEvent('cut',{bubbles:true,cancelable:true,clipboardData}));});
 };
 const click=async(name:string)=>{
  const target=button(name);
  if(!target||target.disabled)throw Error('Button unavailable '+name);
  await act(async()=>target.click());
 };
 try{
  useLocaleStore.setState({locale:'en'});
  const extensions=[Extension.create({name:'observeTableCut2179',onCreate(){editor=this.editor;}})];
  function Fixture({client,context}:LocalToolProps<LocalToolJson>){
   return <LocalToolCollaborativeRichEditor client={client} context={context} field={field} extensions={extensions}/>;
  }
  const definition=defineLocalTool({...original,namespace:'tests.table-cut',component:Fixture});
  registerLocalToolModules({'./installed/tests.table-cut/module.tsx':{default:definition}});
  await db.projects.add({id:projectId,title:'Own table cut',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:['local-tool-'+definition.namespace],createdAt:1,updatedAt:1});
  const documentId=(await createSourceToolDocument({projectId},definition.namespace,'Own cut')).id;
  const client=createLocalToolClient(projectId,definition,{documentId}),convergence=client.convergence!;
  await convergence.start(await client.read());
  const place=await convergence.richBlockEditCapture(field,[],{parentId:null,slot:'body',afterId:'P'});
  await client.state!.apply(place.snapshot,[{type:'rich-table-create',field,capture:place.capture,table:{id:'T',rows:[{id:'R1',header:true},{id:'R2',header:false}],columns:[{id:'C1'},{id:'C2'}]}}]);
  for(const [row,column,id,text]of [['R1','C1','A','Mapa Ω'],['R1','C2','B','Celda β🙂'],['R2','C1','C','Fuera']] as const){
   const witness=await convergence.richTableCellCapture(field,'T',row,column);
   await client.state!.apply(witness.snapshot,[{type:'rich-table-cell-insert',field,capture:witness.capture,fragment:{id:'F'+id,paragraph:{id,text,...(id==='A'?{marks:['bold' as const]}:{})}}}]);
  }
  const {name,mime,base64}=rasterFixtures[1],bytes=Uint8Array.from(atob(base64),char=>char.charCodeAt(0));
  const local=await client.assets.import(new File([bytes],name,{type:mime}),'image');
  const imageCell=await convergence.richTableCellCapture(field,'T','R2','C2');
  await client.state!.apply(imageCell.snapshot,[{type:'rich-table-cell-image-insert',field,capture:imageCell.capture,fragmentId:'FI',id:'I',asset:{sha256:local.sha256,mime,size:local.size}}]);
  const before=await convergence.export(),contract={namespace:definition.namespace,codec:definition.codec!,validationId:before.checkpoint.validationId,schemaEpoch:before.checkpoint.schemaEpoch,validateState:definition.validateState};
  peer=createLocalToolReplica(before.checkpoint,{authorId:'peer-cut-2179',contract});
  await act(async()=>root.render(<MemoryRouter><LocalToolDocumentHost projectId={projectId} documentId={documentId} namespace={definition.namespace}/></MemoryRouter>));
  await wait(()=>!!editor?.isEditable,'The normal Source editor is not ready');
  const originalCells=contents();

  await select('R2','C2');
  const imageClipboard=new DataTransfer();
  await cut(imageClipboard);
  equal('A rectangle with an image leaves all content and clipboard intact',[contents(),Array.from(imageClipboard.types),button('Undo')?.disabled],[originalCells,[],true]);
  await select('R1','C2');
  await cut();
  const unwritable=new DataTransfer();
  Object.defineProperty(unwritable,'setData',{value:()=>{}});
  await cut(unwritable);
  equal('A missing or unwritable clipboard leaves the selection and document intact',[contents(),editor!.state.selection instanceof CellSelection,button('Undo')?.disabled],[originalCells,true,true]);

  const clipboard=new DataTransfer();
  await cut(clipboard);
  const html=new DOMParser().parseFromString(clipboard.getData('text/html'),'text/html');
  equal('Cut puts marked Unicode text and the header rectangle on the clipboard',[html.querySelector('strong')?.textContent,html.querySelectorAll('th').length,clipboard.getData('text/plain').trim()],['Mapa Ω',2,'Mapa Ω\n\nCelda β🙂']);
  equal('Cut clears only the captured cells and returns to a caret',[contents(),editor!.state.selection instanceof CellSelection],[originalCells.map((cell,i)=>i<2?[cell[0],'',cell[2]]:cell),false]);
  equal('Cut leaves the saved checkpoint exact until Save',(await convergence.export()).checkpoint,before.checkpoint);

  const insert=peer.apply([{type:'rich-text-splice',field,nodeId:'A',range:peer.richRange(field,'A',6,6),text:'B'}]);
  await act(async()=>{await convergence.import(insert.update);});
  await wait(()=>cell('R1','C1').textContent==='B','Concurrent cell text is not visible');
  await click('Undo');
  equal('One Undo restores both selected texts and preserves the concurrent insertion',[cell('R1','C1').textContent,cell('R1','C2').textContent,cell('R1','C1').querySelector('strong')?.textContent],['Mapa ΩB','Celda β🙂','Mapa Ω']);
  await click('Redo');
  equal('One Redo removes only the original units',[cell('R1','C1').textContent,cell('R1','C2').textContent,cell('R2','C1').textContent],['B','','Fuera']);
  await click('Save changes');
  await wait(()=>button('Save changes')?.disabled===true,'Cut was not saved');
  const saved=await convergence.export();
  equal('Saving preserves the profile and genesis',[saved.checkpoint.engine,saved.checkpoint.genesisId],[before.checkpoint.engine,before.checkpoint.genesisId]);
  return checks;
 }finally{
  peer?.destroy();await act(async()=>root.unmount());
  if(await db.projects.get(projectId))await deleteProject(projectId);
  await db.settings.where('key').equals('writer.rich.saveMode').delete();
  useLocaleStore.setState({locale:previousLocale});
 }
}
