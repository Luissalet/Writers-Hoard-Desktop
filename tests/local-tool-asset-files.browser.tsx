import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {assetFixture,assertAsset} from './local-tool-assets.browser';
import {createLocalToolClient} from '@/engines/local/storage';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {testFontBase64} from './dictionary-test-font';
import Dexie from 'dexie';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {LOCAL_ASSET_HANDLERS} from '@/engines/local/assetBridge';
import {createLocalAudioEngine,type LocalAudioRef} from '@/engines/local/audio';
import {createRecordingLocalToolAudio} from '@/engines/local/audioTesting';
import {act,StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {useLocalToolFontFace} from '@/engines/local/useLocalToolFontFace';
import AssetPad from '@/engines/local/examples/AssetPad';
import {useLocaleStore} from '@/stores/localeStore';
import type {LocalAssetResolved} from '@/engines/local/assets';
const pause=()=>new Promise(resolve=>setTimeout(resolve,20));
const until=async(check:()=>boolean,message:string)=>{for(let i=0;i<150;i++){if(check())return;await act(async()=>{await pause();});}throw Error(message);};

export async function testLocalToolAssetFiles(){
 const P='asset-files-native',{client,source}=await assetFixture(P),passed:string[]=[];
 try{
  const file=new File(['{"clue":"Harbour"}'],'rules.json',{type:'application/json'});
  assertAsset(typeof client.assets.import==='function','Native assets.import is missing');
  const imported=await client.assets.import(file,'data'),again=await client.assets.import(file,'data');
  assertAsset(imported.id===again.id&&imported.ref.kind==='file','Immutable imports did not dedupe');
  assertAsset((await client.assets.choices('data')).some(row=>row.ref.kind==='file'&&row.ref.id===imported.id),'Imported file absent from choices');
  await client.assets.installation.set('data',imported.ref,(await client.assets.installation.read()).version);
  assertAsset(await (await client.assets.slot('data'))?.blob.text()==='{"clue":"Harbour"}','Actual file selection lost bytes');
  const font=await client.assets.import(new File([Uint8Array.from(atob(testFontBase64),c=>c.charCodeAt(0))],'glyph.ttf',{type:'font/ttf'}),'font');
  const resolved=await client.assets.resolve(font.ref);assertAsset(resolved?.mime==='font/ttf','Real font did not decode/resolve');
  await new FontFace('qa-imported-resource',await resolved.blob.arrayBuffer()).load();
  passed.push('Native Blob inventory dedupes, lists, selects real JSON bytes and decodes a procedural font');
  const readonly=createLocalToolClient(P,source,{readOnly:true,assetDefaultsWritable:()=>true}),before=await db.localToolAssetFiles.count();
  let denied=false;try{await readonly.assets.import(new File(['no'],'no.txt'),'data');}catch{denied=true;}
  assertAsset(denied&&await db.localToolAssetFiles.count()===before,'Installation exception permitted readonly import');
  const foreign=await assetFixture(P+'-foreign');assertAsset(await foreign.client.assets.resolve(imported.ref)===null,'File crossed projects');
  passed.push('Readonly import stays denied even with installation exception; foreign file refs stay unavailable');
  const version=(await client.assets.installation.read()).version,reply=await runBridgeTool('wh_local_asset_override',{projectId:P,namespace:source.namespace,slot:'data',level:'installation',expectedVersion:version,file:{name:'mcp.json',kind:'data',mime:'application/json',base64:btoa('{"clue":"MCP"}')}});
  assertAsset(reply.ok,JSON.stringify(reply));
  const content=await runBridgeTool('wh_local_asset_resolve',{projectId:P,namespace:source.namespace,slot:'data',includeContent:true});
  assertAsset(content.ok&&content.result.content?.base64===btoa('{"clue":"MCP"}'),'Native dispatcher lost opt-in bytes');
  const prior=await db.localToolAssetFiles.count(),stale=await runBridgeTool('wh_local_asset_override',{projectId:P,namespace:source.namespace,slot:'data',level:'installation',expectedVersion:version,file:{name:'stale.txt',kind:'data',mime:'text/plain',base64:btoa('stale')}});
  assertAsset(!stale.ok&&await db.localToolAssetFiles.count()===prior,'Stale composite import left inventory');
  passed.push('Registered dispatcher atomically imports/selects and returns opt-in content; stale CAS leaves no file');
  return passed;
 }finally{await deleteProject(P);await deleteProject(P+'-foreign');}
}

export async function testLocalToolAssetFileTransactions(){const P='asset-file-transactions',{source,client}=await assetFixture(P),passed:string[]=[];try{
 const document=await createSourceToolDocument({projectId:P},source.namespace,'Resource document'),scoped=createLocalToolClient(P,source,{documentId:document.id}),args={projectId:P,namespace:source.namespace,documentId:document.id,level:'document',slot:'data',expectedVersion:(await scoped.read()).document!.version,file:{name:'transaction.txt',kind:'data',mime:'text/plain',base64:btoa('transaction-data')}};
 const changed=await runBridgeTool('wh_local_asset_override',args);assertAsset(changed.ok&&changed.result.receiptId,'Composite document save lost receipt');
 const count=await db.localToolAssetFiles.where('projectId').equals(P).count(),undo=await runBridgeTool('wh_local_tool_state_undo',{projectId:P,namespace:source.namespace,documentId:document.id,receiptId:changed.result.receiptId});assertAsset(undo.ok&&!undo.result.snapshot.data.assetOverrides.data&&await db.localToolAssetFiles.where('projectId').equals(P).count()===count,'Undo removed immutable bytes or retained override');
 const redo=await runBridgeTool('wh_local_tool_state_redo',{projectId:P,namespace:source.namespace,documentId:document.id,receiptId:undo.result.receiptId});assertAsset(redo.ok&&redo.result.snapshot.data.assetOverrides.data.kind==='file','Redo lost ref');
 passed.push('Native document import/selection yields committed Undo/Redo receipts; Undo retains immutable files');
 const preparedFile={name:'aborted.txt',kind:'data',mime:'text/plain',base64:btoa('aborted-data')};let abortedReceipt='';
 try{await db.transaction('rw',db.tables,async()=>{const result=await LOCAL_ASSET_HANDLERS.wh_local_asset_override({...args,file:preparedFile,expectedVersion:(await scoped.read()).document!.version});abortedReceipt=(result as {receiptId:string}).receiptId;throw Error('outer-abort');});}catch{/* Deliberate outer abort. */}
 assertAsset(await db.localToolAssetFiles.where('projectId').equals(P).count()===count,'Outer abort left imported bytes');
 assertAsset(abortedReceipt,'Composite import did not reach a provisional receipt before deliberate outer abort');
 if(abortedReceipt){const invalid=await runBridgeTool('wh_local_tool_state_undo',{projectId:P,namespace:source.namespace,documentId:document.id,receiptId:abortedReceipt});assertAsset(!invalid.ok,'Aborted receipt was consumable');}
 const baseline=await scoped.read(),importOnly=await runBridgeTool('wh_local_asset_override',{...args,file:preparedFile,expectedVersion:baseline.document!.version,importOnly:true});assertAsset(importOnly.ok&&importOnly.result.applied===false&&!importOnly.result.receiptId&&JSON.stringify((await scoped.read()).data)===JSON.stringify(baseline.data),'Import-only changed document or created receipt');
 passed.push('Outer abort rolls back inventory/selection and publishes no consumable receipt; importOnly preserves document state');
 const past=createLocalToolClient(P,source,{eraId:'past'}),file=await client.assets.import(new File(['era-data'],'era.txt',{type:'text/plain'}),'data');await past.assets.installation.set('data',file.ref,(await past.assets.installation.read()).version);assertAsset((await client.assets.slot('data'))?.origin==='default'&&(await past.assets.slot('data'))?.ref.kind==='file','Era selection leaked to Base');await past.assets.installation.set('data',null,(await past.assets.installation.read()).version);assertAsset((await past.assets.slot('data'))?.origin==='default','Era Revert failed');
 let live=true;const leased=createLocalToolClient(P,source,{isCurrent:()=>live}),delayed=new File(['expired'],'expired.txt',{type:'text/plain'}),original=delayed.arrayBuffer.bind(delayed);delayed.arrayBuffer=async()=>{const bytes=await original();live=false;return bytes;};const prior=await db.localToolAssetFiles.count();let expired=false;try{await leased.assets.import(delayed,'data');}catch{expired=true;}assertAsset(expired&&await db.localToolAssetFiles.count()===prior,'Revoked import lease wrote');
 const recording=createRecordingLocalToolAudio();let resolved=false;const owner=createLocalAudioEngine(recording.backend).createOwner({resolve:async()=>{resolved=true;return null;}});let refused=false;try{await owner.play(file.ref as unknown as LocalAudioRef);}catch{refused=true;}owner.dispose();assertAsset(refused&&!resolved&&!recording.commands.length,'File ref reached audio resolution/backend');
 passed.push('Era differences/Revert and revoked import leases preserve scope; audio explicitly rejects file refs before resolve/prepare');
 return passed;
 }finally{await deleteProject(P);}}

export async function testLocalToolAssetFileMigration(){
 await db.open();const stores=Object.fromEntries(db.tables.filter(table=>table.name!=='localToolAssetFiles').map(table=>[table.name,[table.schema.primKey.src,...table.schema.indexes.map(index=>index.src)].join(',')])),name=db.name;await db.delete();
 const old=new Dexie(name);old.version(44).stores(stores);await old.open();await old.table('settings').put({id:'font-file-migration-sentinel',key:'font-file-migration-sentinel',value:'preserved'});old.close();
 await db.open();assertAsset(db.verno===45&&await db.localToolAssetFiles.count()===0&&(await db.settings.get('font-file-migration-sentinel'))?.value==='preserved','Additive 44→45 lost old data or backfilled files');await db.settings.delete('font-file-migration-sentinel');return ['Real IndexedDB44 upgrades additively to45 with prior rows intact and no file backfill'];
}

export async function testLocalToolAssetFileUi(){const P='asset-file-ui',{source,client}=await assetFixture(P),root=createRoot(document.getElementById('root')!);useLocaleStore.setState({locale:'en',loaded:true});try{
 const doc=await createSourceToolDocument({projectId:P},source.namespace,'Asset files'),scoped=createLocalToolClient(P,source,{documentId:doc.id});await act(async()=>{root.render(<StrictMode><AssetPad client={scoped} projectId={P}/></StrictMode>);await pause();});await until(()=>!!document.querySelector('input[aria-label="data · Import"]'),'Normal import control absent');
 const input=document.querySelector<HTMLInputElement>('input[aria-label="data · Import"]')!,transfer=new DataTransfer();transfer.items.add(new File(['{"labels":["UI_CLUE"]}'],'ui-clues.json',{type:'application/json'}));await act(async()=>{input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));await pause();});await until(()=>!!document.querySelector('select[aria-label="data · Document"] option')?.parentElement?.textContent?.includes('ui-clues.json'),'Imported filename missing from normal choices');
 assertAsset(!(await scoped.read()).data.assetOverrides?.data,'Import silently selected a file');const row=(await client.assets.choices('data')).find(row=>row.title==='ui-clues.json')!;const choose=async(label:string)=>{await until(()=>!document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)?.disabled,'Picker pending');await act(async()=>{const select=document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;select.value=JSON.stringify(row.ref);select.dispatchEvent(new Event('change',{bubbles:true}));await pause();});};await choose('data · Document');await until(()=>document.querySelector('[data-local-data]')?.textContent==='UI_CLUE','Data selection did not render parsed JSON');assertAsset((await scoped.read()).data.assetOverrides?.data?.kind==='file','Normal document picker did not persist');
 await choose('data · Installation');await until(()=>!!document.querySelector<HTMLSelectElement>('select[aria-label="data · Installation"]')?.value,'Installation not selected');assertAsset((await client.assets.installation.read()).own.data?.kind==='file','Installation selection lost');
 await act(async()=>{root.unmount();await pause();});const reopened=createRoot(document.getElementById('root')!);try{await act(async()=>{reopened.render(<AssetPad client={createLocalToolClient(P,source,{documentId:doc.id})} projectId={P}/>);await pause();});await until(()=>document.querySelector('[data-local-data]')?.textContent==='UI_CLUE','Reopen lost JSON');}finally{await act(async()=>reopened.unmount());}
 return['Real AssetPad import keeps filename/status, requires explicit choice, saves both layers and reopens parsed JSON'];
 }finally{await act(async()=>root.unmount());await deleteProject(P);}}

export async function testLocalToolFontFaceLifecycle(){const P='font-face-lifecycle',{client}=await assetFixture(P),root=createRoot(document.getElementById('root')!),before=new Set(document.fonts);try{
 const row=await client.assets.import(new File([Uint8Array.from(atob(testFontBase64),c=>c.charCodeAt(0))],'face.ttf'),'font'),asset=(await client.assets.resolve(row.ref))!;
 function Faces({asset,second=true}:{asset:LocalAssetResolved|null;second?:boolean}){const first=useLocalToolFontFace(asset),other=useLocalToolFontFace(second?asset:null);return <><output data-font-first>{first.family??(first.loading?'loading':'empty')}</output><output data-font-second>{other.family??'empty'}</output></>;}
 await act(async()=>{root.render(<StrictMode><Faces asset={asset}/></StrictMode>);await pause();});await until(()=>document.querySelector('[data-font-first]')?.textContent?.startsWith('wh-resource-')===true&&document.querySelector('[data-font-second]')?.textContent?.startsWith('wh-resource-')===true,'Real hook did not load both callers');const first=document.querySelector('[data-font-first]')!.textContent!,second=document.querySelector('[data-font-second]')!.textContent!;assertAsset(first!==second&&[...document.fonts].filter(face=>!before.has(face)).length===2,'Font callers shared ownership or StrictMode leaked faces');
 await act(async()=>root.render(<StrictMode><Faces asset={asset} second={false}/></StrictMode>));assertAsset([...document.fonts].filter(face=>!before.has(face)).length===1&&document.querySelector('[data-font-first]')!.textContent===first,'One caller deleted another caller font');
 await act(async()=>root.render(<StrictMode><Faces asset={null}/></StrictMode>));assertAsset(document.querySelector('[data-font-first]')!.textContent==='empty'&&[...document.fonts].every(face=>before.has(face)),'Retarget kept a stale family or font face');
 return['Real FontFace hook supports independent callers, StrictMode cleanup and retarget without stale families or foreign-face deletion'];
 }finally{await act(async()=>root.unmount());assertAsset([...document.fonts].every(face=>before.has(face)),'Unmount leaked a font');await deleteProject(P);}}

export async function testLocalToolFontFaceLate(){const P='font-face-late',{client}=await assetFixture(P),root=createRoot(document.getElementById('root')!),before=new Set(document.fonts),Original=globalThis.FontFace;let release=()=>{},started=0;const gate=new Promise<void>(resolve=>{release=resolve;});try{
 const row=await client.assets.import(new File([Uint8Array.from(atob(testFontBase64),c=>c.charCodeAt(0))],'late.ttf'),'font'),asset=(await client.assets.resolve(row.ref))!;
 globalThis.FontFace=new Proxy(Original,{construct(target,args){const face=Reflect.construct(target,args) as FontFace,load=face.load.bind(face);face.load=async()=>{started++;await gate;return load();};return face;}});
 function Hook({asset}:{asset:LocalAssetResolved|null}){const value=useLocalToolFontFace(asset);return <output>{value.family??(value.loading?'loading':value.error?'error':'empty')}</output>;}
 await act(async()=>{root.render(<StrictMode><Hook asset={asset}/></StrictMode>);await pause();});await until(()=>started>0,'Delayed hook load never started');await act(async()=>root.render(<StrictMode><Hook asset={null}/></StrictMode>));assertAsset(document.querySelector('output')!.textContent==='empty','Retarget exposed former family');await act(async()=>{release();await pause();});assertAsset([...document.fonts].every(face=>before.has(face))&&document.querySelector('output')!.textContent==='empty','Late real font load added an orphan face');
 const bad={...asset,blob:new Blob(['not a font'],{type:'font/ttf'}),version:'bad'};globalThis.FontFace=Original;await act(async()=>{root.render(<StrictMode><Hook asset={bad}/></StrictMode>);await pause();});await until(()=>document.querySelector('output')?.textContent==='error','Actual FontFace rejection did not report error');assertAsset([...document.fonts].every(face=>before.has(face)),'Rejected face entered FontFaceSet');
 return['Delayed real font decoding after retarget cannot add an orphan; actual invalid font rejection never publishes a family'];
 }finally{release();globalThis.FontFace=Original;await act(async()=>root.unmount());await deleteProject(P);}}
