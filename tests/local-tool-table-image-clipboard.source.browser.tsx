import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {Extension,type Editor} from '@tiptap/core';
import {TextSelection} from '@tiptap/pm/state';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import original from '@/engines/local/installed/examples.table-paste/module';
import {defineLocalTool,LocalToolCollaborativeRichEditor,type LocalToolJson,type LocalToolProps} from '@/engines/local/sdk';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import LocalToolDocumentHost from '@/engines/local/documents/LocalToolDocumentHost';
import {registerLocalToolModules} from '@/engines/local/registry';
import {createLocalToolClient} from '@/engines/local/storage';
import {convergenceCanonical} from '@/engines/local/convergence/format';
import type {RichBlockDocument} from '@/engines/local/convergence/blockFormat';
import {useLocaleStore} from '@/stores/localeStore';
import {createProjectZipArchive,importProjectZip} from '@/services/zipBackup';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {rasterFixtures} from './local-tool-image-formats.fixture';

export async function testSourceTableImageClipboard(){
 const projectId='own-image-clipboard-'+crypto.randomUUID(),field='body',element=document.getElementById('root')!;
 const root=createRoot(element),checks:string[]=[],locale=useLocaleStore.getState().locale;
 let editor:Editor|undefined,mounted=false;
 const equal=(label:string,actual:unknown,expected:unknown)=>{
  if(convergenceCanonical(actual)!==convergenceCanonical(expected))throw Error(label+': '+JSON.stringify([actual,expected]));
  checks.push(label);Reflect.set(window,'__testStage',label);
 };
 const button=(name:string)=>Array.from(element.querySelectorAll('button')).find(item=>item.textContent===name);
 const wait=async(predicate:()=>boolean,label:string)=>{
  for(let i=0;i<150;i++){if(predicate())return;await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});}
  throw Error(label);
 };
 const click=async(name:string)=>{
  const target=button(name);if(!target||target.disabled)throw Error('Button unavailable '+name);
  await act(async()=>target.click());
 };
 const cells=()=>Array.from(editor!.view.dom.querySelectorAll('table td,table th'));
 const selectFirst=async()=>{const view=editor!.view;await act(async()=>view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,view.posAtDOM(cells()[0].querySelector('p')!,0)))));};
 const paste=async(html:string)=>{
  const clipboardData=new DataTransfer();clipboardData.setData('text/html',html);
  await act(async()=>editor!.view.dom.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData})));
 };
 const fileFor=(fixture:typeof rasterFixtures[number])=>new File([Uint8Array.from(atob(fixture.base64),c=>c.charCodeAt(0))],fixture.name,{type:fixture.mime});
 try{
  useLocaleStore.setState({locale:'en'});
  const extensions=[Extension.create({name:'observeImageClipboard2183',onCreate(){editor=this.editor;}})];
  function Fixture({client,context}:LocalToolProps<LocalToolJson>){
   return <LocalToolCollaborativeRichEditor client={client} context={context} field={field} extensions={extensions}/>;
  }
  const definition=defineLocalTool({...original,namespace:'tests.table-image-clipboard',component:Fixture});
  registerLocalToolModules({'./installed/tests.table-image-clipboard/module.tsx':{default:definition}});
  await db.projects.add({id:projectId,title:'Own image clipboard',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:['local-tool-'+definition.namespace],createdAt:1,updatedAt:1});
  const documentId=(await createSourceToolDocument({projectId},definition.namespace,'Own image clipboard')).id;
  const client=createLocalToolClient(projectId,definition,{documentId}),convergence=client.convergence!,scope={projectId,namespace:definition.namespace,documentId};
  await convergence.start(await client.read());
  const place=await convergence.richBlockEditCapture(field,[],{parentId:null,slot:'body',afterId:'P'});
  await client.state!.apply(place.snapshot,[{type:'rich-table-create',field,capture:place.capture,table:{id:'T',rows:[{id:'R',header:false}],columns:[{id:'C1'},{id:'C2'}]}}]);
  const initial=await convergence.export(),fixture=rasterFixtures[1],bytes=Uint8Array.from(atob(fixture.base64),c=>c.charCodeAt(0));
  let rejected=false;
  try{await client.assets.importImages!([fileFor(fixture),new File(['invalid'],'invalid.png',{type:'image/png'})]);}
  catch{rejected=true;}
  equal('The batch rejects an invalid raster without storing a partial import',[rejected,await db.localToolAssetFiles.where('projectId').equals(projectId).count()],[true,0]);
  await act(async()=>root.render(<MemoryRouter><LocalToolDocumentHost projectId={projectId} documentId={documentId} namespace={definition.namespace}/></MemoryRouter>));mounted=true;
  await wait(()=>!!editor?.isEditable,'The normal Source editor is not ready');
  await selectFirst();
  await paste('<table><tr><th><p>Antes</p><img src="data:'+fixture.mime+';base64,'+fixture.base64+'" data-image-size="small" data-image-alignment="right"><p>Después Ω</p></th><td><p></p></td></tr></table>');
  await wait(()=>!!cells()[0]?.querySelector('img')?.naturalWidth,'The pasted image did not decode');
  const image=()=>cells()[0].querySelector('figure')!;
  const pastedId=image().getAttribute('data-writer-image');
  equal('HTML paste keeps the header, text, image order and presentation',[cells()[0].tagName,Array.from(cells()[0].children,n=>n.tagName==='P'?n.textContent:'image'),image().dataset.imageSize,image().dataset.imageAlignment],['TH',['Antes','image','Después Ω'],'small','right']);
  equal('The document remains an unsaved draft',(await convergence.export()).checkpoint,initial.checkpoint);
  const stored=(await db.localToolAssetFiles.where('projectId').equals(projectId).toArray())[0];
  equal('The local blob has the same MIME and bytes',[stored.mime,Array.from(new Uint8Array(await stored.blob.arrayBuffer()))],[fixture.mime,Array.from(bytes)]);
  await click('Undo');
  equal('One Undo restores both original cells',[...cells().map(cell=>cell.tagName),!!cells()[0].querySelector('img')],['TD','TD',false]);
  await click('Redo');
  equal('One Redo restores the same image identity',image().getAttribute('data-writer-image'),pastedId);
  await click('Save changes');
  await wait(()=>button('Save changes')?.disabled===true,'The pasted image was not saved');
  const saved=await convergence.export(),witness=await convergence.richBlockEditCapture(field,['T']);
  await act(async()=>root.unmount());mounted=false;
  const action=(asset:{sha256:string;mime:string;size:number})=>({
   type:'rich-table-paste',field,capture:witness.capture,target:{rows:['R'],columns:['C1','C2'],anchor:['R','C2']},
   matrix:[[{header:false,paragraphs:[],images:[{asset,afterParagraph:-1,displaySize:'medium',alignment:'left'}]}]],
  });
  const unavailable=await runBridgeTool('wh_local_tool_state_apply',{...scope,baseline:witness.snapshot,actions:[action({sha256:'0'.repeat(64),mime:stored.mime,size:stored.size})]});
  equal('The bridge rejects missing asset bytes and keeps the saved checkpoint',[unavailable.ok,(await convergence.export()).checkpoint],[false,saved.checkpoint]);
  const valid=await runBridgeTool('wh_local_tool_state_apply',{...scope,baseline:witness.snapshot,actions:[action({sha256:stored.sha256,mime:stored.mime,size:stored.size})]});
  if(!valid.ok||!valid.result.receiptId)throw Error(JSON.stringify(valid));
  const changed=await convergence.export(),body=(changed.snapshot.data as {body:RichBlockDocument}).body;
  equal('The bridge authors a second image using the same stored bytes',body.blocks.filter(block=>block.type==='image').map(block=>(block.attrs.asset as {sha256:string}).sha256),[stored.sha256,stored.sha256]);
  equal('The local asset store deduplicates the shared file',await db.localToolAssetFiles.where('projectId').equals(projectId).count(),1);
  const zip=await createProjectZipArchive(projectId);
  await importProjectZip(new File([zip.blob],'image-clipboard.zip',{type:'application/zip'}),{replaceProjectIds:[projectId]});
  db.close();await db.open();
  const restored=(await db.localToolAssetFiles.where('projectId').equals(projectId).toArray())[0];
  equal('The ZIP preserves both image references, history and the exact file',[(await convergence.export()).checkpoint,Array.from(new Uint8Array(await restored.blob.arrayBuffer()))],[changed.checkpoint,Array.from(bytes)]);
  return checks;
 }finally{
  if(mounted)await act(async()=>root.unmount());
  if(await db.projects.get(projectId))await deleteProject(projectId);
  await db.settings.where('key').equals('writer.rich.saveMode').delete();
  useLocaleStore.setState({locale});
 }
}
