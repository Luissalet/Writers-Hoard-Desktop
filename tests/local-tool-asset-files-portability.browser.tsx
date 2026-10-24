import JSZip from 'jszip';
import {authorCard} from './fixtures/local-tools/author-data';
import '@/engines';
import {db} from '@/db';
import {deleteProject,exportProjectData,importProjectData,exportFullDatabase,importFullDatabase} from '@/db/operations';
import {assetFixture,assertAsset} from './local-tool-assets.browser';
import {testFontBase64} from './dictionary-test-font';
import {createLocalToolBlockEnvelope} from '@/engines/local/blocks/definitions';
import {serializeLocalToolBlock} from '@/engines/local/blocks/types';
import {capturePublicationSnapshot,publicationReaderSource,publicationSourceFingerprint} from '@/services/publishedEditions/snapshot';
import {buildReaderHtml} from '@/engines/writings/readerExport';
import {safeReaderPresentation} from '@/engines/writings/readerPresentation';
import {loadWorldWikiData,buildWorldWiki} from '@/services/worldWikiExport';
import {createProjectZipArchive,importProjectZip} from '@/services/zipBackup';
import {duplicateSchemaCoverage,readProjectDuplicate} from '@/services/projectDuplicate/capture';
import {remapDuplicateSnapshot} from '@/services/projectDuplicate/remap';
import type {Writing} from '@/types';
export async function testLocalToolAssetFilePortability(){
 const P='asset-file-portable',{client,source,block}=await assetFixture(P),passed:string[]=[],cleanup=[P];
 try{
  const font=await client.assets.import(new File([Uint8Array.from(atob(testFontBase64),c=>c.charCodeAt(0))],'sample.ttf'),'font'),data=await client.assets.import(new File(['{"labels":["PORTABLE_CLUE"],"sample":"AA AA"}'],'clues.json',{type:'application/json'}),'data');
  await client.assets.installation.set('font',font.ref,(await client.assets.installation.read()).version);
  await client.assets.installation.set('data',data.ref,(await client.assets.installation.read()).version);
  block.preview={version:1,fields:[],assets:[{namespace:source.namespace,slot:'font',overridesField:'assetOverrides'},{namespace:source.namespace,slot:'data',overridesField:'assetOverrides'}]};
  const envelope=createLocalToolBlockEnvelope(source.namespace,block,'portable-assets'),content=serializeLocalToolBlock(P,envelope),writing:Writing={id:P+'-chapter',projectId:P,title:'AA AA',content,wordCount:0,status:'draft',tags:[],createdAt:1,updatedAt:1};await db.writings.put(writing);await db.codexEntries.put({...authorCard(P,'Font/data'),id:P+'-card',content,revealed:true});
  const exported=await exportProjectData(P);assertAsset(exported.localToolAssetFiles.length===2&&exported.localToolAssetFiles.every(row=>row.base64&&!('blob'in row)),'JSON serialized Blob as an empty object');
  const cloned=await importProjectData(exported);cleanup.push(cloned);const cloneRows=await db.localToolAssetFiles.where('projectId').equals(cloned).toArray(),clonedProject=(await db.projects.get(cloned))!;assertAsset(cloneRows.length===2&&JSON.stringify(clonedProject.localToolStates).includes(cloneRows[0].id)&&cloneRows.every(row=>row.id!==font.id&&row.id!==data.id),'JSON clone lost immutable files or ref remapping');
  const zip=await createProjectZipArchive(P);await db.localToolAssetFiles.where('projectId').equals(P).delete();await importProjectZip(new File([zip.blob],'files.zip'),{replaceProjectIds:[P]});assertAsset(await db.localToolAssetFiles.where('projectId').equals(P).count()===2,'ZIP did not restore actual bytes');
  const damaged=await JSZip.loadAsync(await zip.blob.arrayBuffer()),binaryPath=Object.keys(damaged.files).find(path=>path.endsWith(encodeURIComponent(font.id)+'.bin'))!;assertAsset(binaryPath,'ZIP font entry missing');damaged.file(binaryPath,new Uint8Array([1,2]));const beforeDamage=JSON.stringify(await db.projects.get(P));let rejected=false;try{await importProjectZip(new File([await damaged.generateAsync({type:'blob'})],'damaged.zip'),{replaceProjectIds:[P]});}catch{rejected=true;}assertAsset(rejected&&await db.localToolAssetFiles.where('projectId').equals(P).count()===2&&JSON.stringify(await db.projects.get(P))===beforeDamage,'Corrupt ZIP mutated project before preflight failure');
  passed.push('JSON clone and real ZIP retain bytes/hash and remap file refs without importing package code');
  const snapshot=await capturePublicationSnapshot({projectId:P}),captured=publicationReaderSource(snapshot),fingerprint=await publicationSourceFingerprint(snapshot);
  assertAsset(snapshot.tables.localToolAssetFiles.length===2&&fingerprint.length===64,'Publication did not capture referenced files');
  const altered=structuredClone(snapshot);altered.tables.localToolAssetFiles[0].blob=new Blob(['changed'],{type:'font/ttf'});assertAsset(await publicationSourceFingerprint(altered)!==fingerprint,'Snapshot fingerprint ignored Blob bytes');
  const sourceWithImages={...captured,images:captured.capturedImages!()};
  db.close();
  try{
   const reader=await buildReaderHtml(captured.project,captured.writings,safeReaderPresentation(), 'en',{projectId:P},captured);
   assertAsset(reader.html.includes('PORTABLE_CLUE')&&reader.html.includes('@font-face')&&reader.html.includes('font-src data:'),'Closed DB Reader omitted actual font/data');
   // Use standalone writing selection; no live fallback is possible with the DB closed.
   const options={locale:'en' as const,includeImages:true},wikiData=await loadWorldWikiData(P,options,sourceWithImages),wiki=buildWorldWiki(wikiData,options);
   assertAsset(wiki.html.includes('PORTABLE_CLUE')&&wiki.html.includes('@font-face'),'Closed DB wiki omitted font/data');
   const noImages=buildWorldWiki(await loadWorldWikiData(P,{...options,includeImages:false},sourceWithImages),{...options,includeImages:false});assertAsset(noImages.html.includes('PORTABLE_CLUE')&&noImages.html.includes('@font-face'),'Image policy wrongly suppressed font/data');
   const unavailable=buildWorldWiki(await loadWorldWikiData(P,options,{...sourceWithImages,capturedAssetFiles:()=>[]}),options);assertAsset(!unavailable.html.includes('PORTABLE_CLUE')&&!unavailable.html.includes('@font-face'),'Missing captured files fell back to live/default data');
   const without=await loadWorldWikiData(P,{...options,includeMedia:false},sourceWithImages),omitted=buildWorldWiki(without,{...options,includeMedia:false});assertAsset(!omitted.html.includes('PORTABLE_CLUE')&&!omitted.html.includes('@font-face'),'includeMedia false leaked resources');
   const frame=document.createElement('iframe');frame.hidden=true;document.body.append(frame);frame.srcdoc=reader.html;
   try{await new Promise<void>(resolve=>frame.onload=()=>resolve());await frame.contentDocument!.fonts.ready;const fontSection=frame.contentDocument!.querySelector<HTMLElement>('[data-wh-asset-font]');assertAsset(fontSection,'Export lost generated font token');const family=frame.contentWindow!.getComputedStyle(fontSection).fontFamily.split(',')[0];const loaded=await frame.contentDocument!.fonts.load(`20px ${family}`,'AA');assertAsset(loaded.length>0&&frame.contentDocument!.fonts.check(`20px ${family}`,'AA'),'Real embedded font did not load under export CSP: '+family);const canvas=frame.contentDocument!.createElement('canvas'),context=canvas.getContext('2d')!;context.font=`20px ${family}`;const actual=context.measureText('AA').width;context.font='20px monospace';assertAsset(actual!==context.measureText('AA').width,'Font proof measured a system fallback');}finally{frame.remove();}
   passed.push('Captured Reader/wiki work with DB closed, preserve real font CSS under CSP and omit font/data when media are excluded');
  }finally{await db.open();}
  return passed;
 }finally{if(!db.isOpen())await db.open();for(const id of cleanup)await deleteProject(id);}
}
export async function testLocalToolAssetFileDuplicate(){const P='asset-file-duplicate',{client,png}=await assetFixture(P);let cloneId:string|undefined;try{
 const imported=await client.assets.import(new File(['copy'],'copy.txt',{type:'text/plain'}),'data'),original=(await db.localToolAssetFiles.get(imported.id))!,id='shared-resource-id';await db.localToolAssetFiles.delete(imported.id);await db.localToolAssetFiles.add({...original,id});await db.inspirationImages.put({id,projectId:P,name:'Shared ID image',imageData:png,notes:'',tags:[],createdAt:1});await db.localMediaAssets.put({id,projectId:P,title:'Shared ID audio',kind:'audio',mime:'audio/wav',blob:new Blob(['audio'],{type:'audio/wav'}),size:5,notes:'',tags:[],linkedEntryIds:[],createdAt:1,updatedAt:1});
 for(const [slot,kind]of [['data','file'],['portrait','image'],['tick','media']]as const)await client.assets.installation.set(slot,{kind,id},(await client.assets.installation.read()).version);
 const snapshot=await readProjectDuplicate(P);assertAsset(snapshot.tables.localToolAssetFiles?.length===1,'Native duplicate capture omitted file inventory');const copy=await remapDuplicateSnapshot(snapshot,P+'-copy','Copied'),file=copy.tables.localToolAssetFiles[0],image=copy.tables.inspirationImages.find(row=>row.name==='Shared ID image')!,media=copy.tables.localMediaAssets.find(row=>row.title==='Shared ID audio')!;
 assertAsset(file&&JSON.stringify(copy.project.localToolStates).includes(String(file.id))&&JSON.stringify(copy.project.localToolStates).includes(String(image.id))&&JSON.stringify(copy.project.localToolStates).includes(String(media.id))&&new Set([file.id,image.id,media.id]).size===3,'Native duplicate refs/inventory collide across asset domains');assertAsset(await (file.blob as Blob).text()==='copy','Duplicate lost Blob bytes');const coverage=duplicateSchemaCoverage();assertAsset(!coverage.missing.length&&!coverage.obsolete.length,'Duplicate schema coverage missed file inventory');
 cloneId=await importProjectData(await exportProjectData(P));const project=(await db.projects.get(cloneId))!,rows=await db.localToolAssetFiles.where('projectId').equals(cloneId).toArray(),imageCopy=(await db.inspirationImages.where('projectId').equals(cloneId).toArray()).find(row=>row.name==='Shared ID image')!,mediaCopy=(await db.localMediaAssets.where('projectId').equals(cloneId).toArray()).find(row=>row.title==='Shared ID audio')!;assertAsset(rows.length===1&&new Set([rows[0].id,imageCopy.id,mediaCopy.id]).size===3&&[rows[0].id,imageCopy.id,mediaCopy.id].every(id=>JSON.stringify(project.localToolStates).includes(id)),'JSON clone conflated file/image/media identities');
 return['Native duplicate inventory/Blob/remaps and JSON clone preserve colliding file/image/media IDs as three distinct exact resources; schema coverage is complete'];
 }finally{if(cloneId)await deleteProject(cloneId);await deleteProject(P);}}

export async function testLocalToolAssetFileFullBackup(){const P='asset-file-full',{client}=await assetFixture(P);try{const row=await client.assets.import(new File(['full-backup'],'full.txt',{type:'text/plain'}),'data');await client.assets.installation.set('data',row.ref,(await client.assets.installation.read()).version);const payload=await exportFullDatabase(),original=JSON.stringify(await db.projects.get(P));let rejected=false;try{await importFullDatabase({...payload,localToolAssetFiles:payload.localToolAssetFiles.map(file=>({...file,sha256:'f'.repeat(64)}))});}catch{rejected=true;}assertAsset(rejected&&JSON.stringify(await db.projects.get(P))===original&&await db.localToolAssetFiles.get(row.id),'Corrupt full backup cleared live rows');await db.localToolAssetFiles.clear();await importFullDatabase(payload);assertAsset(await (await db.localToolAssetFiles.get(row.id))?.blob.text()==='full-backup','Full backup lost Blob bytes');const legacy={...payload};delete (legacy as Partial<typeof payload>).localToolAssetFiles;await importFullDatabase(legacy);assertAsset(await db.localToolAssetFiles.get(row.id),'Legacy full backup cleared omitted inventory');return['Full JSON restores bytes, rejects bad SHA before destructive writes and retains inventory when the historical payload omits its table'];}finally{await deleteProject(P);}}
