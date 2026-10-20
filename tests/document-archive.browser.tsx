import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import Dexie from 'dexie';
import JSZip from 'jszip';
import { db } from '@/db';
import '@/engines/archive';
import '@/engines/codex';
import '@/engines/maps';
import '@/engines/board';
import '@/engines/timeline';
import '@/engines/writings';
import { deleteCodexEntry, deleteProject } from '@/db/operations';
import { deleteWorldMap } from '@/engines/maps/hooks';
import { deleteBoard } from '@/engines/board/operations';
import { deleteTimeline } from '@/engines/timeline/operations';
import { deleteWritingRestorable, restoreDeletedWriting } from '@/engines/writings/operations';
import { ArchiveRestoreConflict, archiveValuesEqual, restoreArchivedDocument, validateArchive } from '@/services/documentArchive/store';
import ArchiveEngine from '@/engines/archive/ArchiveEngine';
import { t } from '@/i18n/useTranslation';
import type { DocumentArchive } from '@/services/documentArchive/types';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import { removeDictionary } from '@/engines/dictionary/operations';
import { deleteTable } from '@/engines/tables/operations';
import { deleteRelationTree } from '@/engines/genealogy/relationTreeStore';
import { deleteSheet } from '@/engines/character-sheets/operations';
import { createSheet } from '@/engines/character-sheets/types';
import { assetFromFile, removeModelAsset } from '@/engines/model-viewer/model';
import { modelViewerFixture } from './model-viewer-fixture';
import { createRadarChart } from '@/engines/radar/model';
import { saveRadarChart, deleteRadarChart } from '@/engines/radar/operations';

function assert(value:unknown,message:string):asserts value {if(!value)throw new Error(message);}
const pause=(ms=30)=>new Promise(resolve=>setTimeout(resolve,ms));
export async function testDocumentArchive():Promise<string[]> {
  const now=Date.now(),pid=`archive-${now}`,other=`${pid}-other`,passed:string[]=[];
  const project=(id:string)=>({id,title:'Archive fixture',mode:'novelist' as const,type:'standalone' as const,description:'',color:'#000',status:'draft' as const,enabledEngines:['archive','codex','maps','board','timeline','writings'],engineOrder:['archive','codex','maps','board','timeline','writings'],createdAt:now,updatedAt:now});
  if(!db.isOpen()) {
    const legacy=new Dexie('WritersHoardDB');
    const schema=Object.fromEntries(db.tables.filter(table=>table.name!=='documentArchives').map(table=>[table.name,[table.schema.primKey.src,...table.schema.indexes.map(index=>index.src)].join(',')]));
    legacy.version(39).stores(schema);
    const migrationId=`${pid}-v39`;
    await legacy.table('projects').add(project(migrationId));
    await legacy.table('localMediaAssets').add({id:`${migrationId}-media`,projectId:migrationId,title:'Legacy sound',kind:'audio',mime:'audio/wav',blob:new Blob(['legacy bytes']),size:12,notes:'',tags:[],linkedEntryIds:[],createdAt:now,updatedAt:now});
    legacy.close();await db.open();
    assert((await db.localMediaAssets.get(`${migrationId}-media`))?.blob.size===12&&(await db.projects.get(migrationId))?.title==='Archive fixture'&&await db.documentArchives.count()===0,'v39→v40 migration lost existing project/media data');
    await deleteProject(migrationId);
    passed.push('real v39→v40 IndexedDB upgrade adds archive while preserving existing project and media Blob bytes');
  }
  await db.projects.bulkAdd([project(pid),project(other)]);
  const entry=(id:string,title:string,projectId=pid)=>({id,projectId,type:'character' as const,title,fields:{},content:'<p>Complete authored content</p>',relations:[],tags:[],createdAt:now,updatedAt:now});
  const a=entry(`${pid}-a`,'Mara'),b=entry(`${pid}-b`,'Ivo');await db.codexEntries.bulkAdd([a,b]);
  const map={id:`${pid}-map`,projectId:pid,title:'The salt marsh',backgroundImage:'',createdAt:now,updatedAt:now};await db.worldMaps.add(map);
  const pin={id:`${pid}-pin`,projectId:pid,mapId:map.id,title:'Causeway',description:'Keep this note',x:0.3,y:0.5,color:'#c4973b',linkedEntryId:a.id,createdAt:now,updatedAt:now};await db.mapPins.add(pin);
  const lane={id:`${pid}-lane`,projectId:pid,title:'The northern dynasty',color:'#c4973b',createdAt:now,updatedAt:now};await db.timelines.add(lane);
  const event={id:`${pid}-event`,projectId:pid,timelineId:lane.id,title:'Lantern signal',description:'Keep description',date:'Before dawn',dateMode:'text' as const,eventType:'point' as const,order:0,lane:'Main',color:'#c4973b',linkedEntryId:a.id,linkedEntryIds:[a.id,b.id],createdAt:now,updatedAt:now};await db.timelineEvents.add(event);
  const relation={id:`${pid}-relationship`,projectId:pid,entityAId:a.id,entityBId:b.id,entityAName:'Mara',entityBName:'Ivo',type:'Trust',state:'current',intensity:3,description:'They share a secret',createdAt:now,updatedAt:now};await db.relationships.add(relation as never);
  await db.localMediaAssets.add({id:`${pid}-media`,projectId:pid,title:'Ambient',kind:'audio',mime:'audio/wav',blob:new Blob(['unchanged binary bytes'],{type:'audio/wav'}),size:22,notes:'Keep clip',tags:[],linkedEntryIds:[a.id,b.id],createdAt:now,updatedAt:now});
  const archiveFor=async(sourceId:string)=>{const rows=await db.documentArchives.where('sourceId').equals(sourceId).toArray();assert(rows.length===1,`Expected one archive for ${sourceId}`);return rows[0];};
  const host=document.getElementById('root')!;let root:Root|null=null;
  const unmount=async()=>{await act(async()=>{root?.unmount();root=null;await pause();});};
  const wait=async(what:string,predicate:()=>boolean|Promise<boolean>)=>{const end=Date.now()+10000;while(Date.now()<end){if(await predicate())return;await act(async()=>{await pause(50);});}throw new Error(`Timed out: ${what}`);};
  const button=(label:string,scope:ParentNode=document)=>[...scope.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.trim()===label);
  try {
    const rejectArchive=()=>{throw new Error('Injected archive write failure');};db.documentArchives.hook('creating',rejectArchive);
    let rejected=false;try{await deleteCodexEntry(a.id);}catch{rejected=true;}finally{db.documentArchives.hook('creating').unsubscribe(rejectArchive);}
    assert(rejected&&await db.codexEntries.get(a.id)&&await db.relationships.get(relation.id)&&(await db.timelineEvents.get(event.id))?.linkedEntryIds?.length===2,'Archive failure partially deleted or unlinked data');
    await deleteCodexEntry(a.id);let archive=await archiveFor(a.id);
    assert(!await db.codexEntries.get(a.id)&&!await db.relationships.get(relation.id)&&(await db.timelineEvents.get(event.id))!.linkedEntryIds!.length===1,'Existing deletion cascade changed');
    const mediaPatch=archive.mutations.find(patch=>patch.table==='localMediaAssets')!;
    assert(mediaPatch.fields?.includes('linkedEntryIds')&&!mediaPatch.fields.includes('blob')&&!mediaPatch.beforeRow,'Archive duplicated unchanged media bytes');
    const rejectConsume=()=>{throw new Error('Injected archive consume failure');};db.documentArchives.hook('deleting',rejectConsume);
    rejected=false;try{await restoreArchivedDocument(pid,archive.id);}catch{rejected=true;}finally{db.documentArchives.hook('deleting').unsubscribe(rejectConsume);}
    assert(rejected&&!await db.codexEntries.get(a.id)&&!await db.relationships.get(relation.id)&&await db.documentArchives.get(archive.id),'Failed final archive consume partially restored data');
    await db.mapPins.update(pin.id,{description:'A new unrelated note',updatedAt:now+10});
    await restoreArchivedDocument(pid,archive.id);
    assert(archiveValuesEqual(await db.codexEntries.get(a.id),a)&&await db.relationships.get(relation.id)&&(await db.timelineEvents.get(event.id))!.linkedEntryIds!.length===2,'Restore lost root/cascade/secondary links');
    assert((await db.mapPins.get(pin.id))!.description==='A new unrelated note'&&(await db.mapPins.get(pin.id))!.linkedEntryId===a.id,'Restore overwrote unrelated later edit');
    assert((await db.localMediaAssets.get(`${pid}-media`))!.blob.size===22&&!await db.documentArchives.get(archive.id),'Restore lost bytes or failed to consume archive');
    passed.push('atomic archive: injected archive failure rolls back cascades; exact core/link restoration preserves unrelated edits and media bytes');

    await deleteCodexEntry(a.id);archive=await archiveFor(a.id);
    await db.mapPins.update(pin.id,{linkedEntryId:b.id});
    rejected=false;try{await restoreArchivedDocument(pid,archive.id);}catch(error){rejected=error instanceof ArchiveRestoreConflict;}
    assert(rejected&&!await db.codexEntries.get(a.id)&&!await db.relationships.get(relation.id)&&await db.documentArchives.get(archive.id),'Edited link caused partial restore');
    await db.mapPins.update(pin.id,{linkedEntryId:undefined});
    await db.codexEntries.add(entry(a.id,'Occupied by newer document',other));
    rejected=false;try{await restoreArchivedDocument(pid,archive.id);}catch{rejected=true;}
    assert(rejected&&(await db.codexEntries.get(a.id))!.projectId===other,'Restore overwrote foreign ID collision');
    await db.codexEntries.delete(a.id);
    await db.codexEntries.delete(b.id);rejected=false;
    try{await restoreArchivedDocument(pid,archive.id);}catch(error){rejected=error instanceof ArchiveRestoreConflict;}
    assert(rejected&&!await db.codexEntries.get(a.id)&&await db.documentArchives.get(archive.id),'Missing related document allowed a dangling partial restore');
    await db.codexEntries.add(b);await restoreArchivedDocument(pid,archive.id);
    passed.push('restore CAS: changed link fields and foreign primary-key collisions block the whole transaction and retain archive');

    await deleteWorldMap(map.id);archive=await archiveFor(map.id);
    assert(!await db.mapPins.get(pin.id),'Map cascade did not delete marker');await restoreArchivedDocument(pid,archive.id);
    assert(await db.worldMaps.get(map.id)&&await db.mapPins.get(pin.id),'Map restore missed pins');
    const board={id:`${pid}-board`,projectId:pid,title:'The investigation',surface:'slate' as const,createdAt:now,updatedAt:now};await db.boards.add(board);
    const node={id:`${pid}-node`,boardId:board.id,projectId:pid,kind:'text',title:'Evidence',content:'Keep board prose',x:10,y:20,width:200,height:100,createdAt:now,updatedAt:now};await db.boardNodes.add(node as never);
    await deleteBoard(board.id);archive=await archiveFor(board.id);await restoreArchivedDocument(pid,archive.id);assert(await db.boardNodes.get(node.id),'Board restore missed graph');
    await db.timelineConnections.add({id:`${pid}-connection`,projectId:pid,timelineId:lane.id,sourceEventId:event.id,targetEventId:event.id,color:'#c4973b',style:'solid',createdAt:now});
    await deleteTimeline(lane.id);archive=await archiveFor(lane.id);await restoreArchivedDocument(pid,archive.id);assert(await db.timelineEvents.get(event.id)&&await db.timelineConnections.get(`${pid}-connection`),'Timeline restore missed connections');
    const writing={id:`${pid}-writing`,projectId:pid,title:'The causeway',status:'draft' as const,content:'<p>The lost chapter.</p>',wordCount:3,tags:[],createdAt:now,updatedAt:now};await db.writings.add(writing);
    await db.writingSnapshots.add({id:`${pid}-draft`,projectId:pid,writingId:writing.id,title:writing.title,content:'<p>Parallel version.</p>',wordCount:2,reason:'manual',kind:'parallel-draft',draftName:'A quieter arrival',createdAt:now,updatedAt:now});
    const bundle=await deleteWritingRestorable(writing.id);assert(bundle,'Writing undo bundle unavailable');archive=await archiveFor(writing.id);await restoreDeletedWriting(bundle);
    assert(await db.writings.get(writing.id)&&await db.writingSnapshots.get(`${pid}-draft`)&&!await db.documentArchives.get(archive.id),'Legacy Undo failed to consume durable archive or lost parallel versions');
    await restoreDeletedWriting(bundle);
    passed.push('five canonical deletes: maps/pins, boards/graph, timeline/events/connections and chapter/parallel versions restore; writing Undo consumes archive once');

    await deleteCodexEntry(a.id);archive=await archiveFor(a.id);
    const original=structuredClone(archive);
    const malicious={...archive,id:`${pid}-malicious`,mutations:[...archive.mutations,{table:'settings',key:'secret',beforeRow:{id:'secret'}}]} as DocumentArchive;
    rejected=false;try{validateArchive(malicious,pid);}catch{rejected=true;}assert(rejected,'Archive accepted arbitrary table writes');
    await db.documentArchives.update(archive.id,{mutations:archive.mutations.map(patch=>patch.table==='codexEntries'?{...patch,beforeRow:{...patch.beforeRow,projectId:other}}:patch)});
    rejected=false;try{await restoreArchivedDocument(pid,archive.id);}catch{rejected=true;}assert(rejected&&!await db.codexEntries.get(a.id),'Forged payload crossed project scope');
    await db.documentArchives.put(original);
    const zip=await createProjectZipArchive(pid);
    const poisoned=await JSZip.loadAsync(zip.blob);const archivePath=Object.keys(poisoned.files).find(path=>path.endsWith('/archive/documents.json'))!;
    poisoned.file(archivePath,JSON.stringify([malicious]));
    rejected=false;try{await importProjectZip(new File([await poisoned.generateAsync({type:'blob'})],'poisoned-archive.zip'),{replaceProjectIds:[pid]});}catch{rejected=true;}
    assert(rejected&&await db.documentArchives.get(original.id)&&await db.codexEntries.get(b.id),'Malicious nested archive import changed existing data before rejection');
    await db.documentArchives.delete(archive.id);await importProjectZip(new File([zip.blob],'document-archive.zip'),{replaceProjectIds:[pid]});
    archive=await archiveFor(a.id);assert(archive.mutations.length===original.mutations.length,'ZIP lost archive recovery payload');await restoreArchivedDocument(pid,archive.id);
    passed.push('portable archive: malicious tables/foreign payload refused; real project ZIP preserves recovery payload and restores after import');

    const dictionary={id:`${pid}-dictionary`,name:'Marsh speech',description:'A local language',scriptMapping:'',detectInManuscript:true,words:[{id:'word-a',word:'aur',meaning:'dawn',nativeForm:'',pronunciation:'',partOfSpeech:'',examples:'',phrases:'',derivatives:'',origin:'',linkedEntryId:a.id}]};
    const table={id:`${pid}-table`,title:'Voyages',mode:'table' as const,columns:[{id:'name',name:'Name',kind:'reference' as const}],rows:[{id:'record-a',cells:{name:a.id}}]};
    const tree={id:`${pid}-tree`,title:'The northern house',nodes:[{id:'tree-a',label:'Mara',codexEntryId:a.id,position:{x:0,y:0}}],edges:[],revision:0,createdAt:now,updatedAt:now};
    const sheet=createSheet('custom','Mara’s journal');sheet.linkedEntryId=a.id;
    const model=await assetFromFile(new File([await modelViewerFixture()],'The watchtower.glb',{type:'model/gltf-binary'}));
    await db.projects.update(pid,{dictionaries:[dictionary],dataTables:[table],relationTrees:[tree],characterSheets:[sheet],modelAssets:[model]});
    db.documentArchives.hook('creating',rejectArchive);rejected=false;
    try{await removeDictionary(pid,dictionary.id);}catch{rejected=true;}finally{db.documentArchives.hook('creating').unsubscribe(rejectArchive);}
    assert(rejected&&(await db.projects.get(pid))!.dictionaries?.[0].id===dictionary.id,'Metadata archive failure removed live item');
    await removeDictionary(pid,dictionary.id);let metadataArchive=await archiveFor(dictionary.id);
    assert(metadataArchive.metadata?.field==='dictionaries'&&!metadataArchive.mutations.length,'Metadata archive stored an entire Project patch');
    const laterDictionary={...dictionary,id:`${pid}-new-dictionary`,name:'Trade speech'};
    await db.projects.update(pid,{description:'Changed after archiving',dictionaries:[laterDictionary]});
    await restoreArchivedDocument(pid,metadataArchive.id);
    assert((await db.projects.get(pid))!.description==='Changed after archiving'&&(await db.projects.get(pid))!.dictionaries!.length===2,'Metadata restore clobbered later project fields or sibling documents');
    await deleteTable(pid,table.id);metadataArchive=await archiveFor(table.id);await restoreArchivedDocument(pid,metadataArchive.id);
    const formula={...table,id:`${pid}-formula`,title:'The harbour economy',mode:'sheet' as const,columns:[{id:'amount',name:'Amount',kind:'number' as const}],rows:[{id:'amount-row',cells:{amount:'=1+2'}}]};
    await db.projects.update(pid,{dataTables:[table,formula]});await deleteTable(pid,formula.id);metadataArchive=await archiveFor(formula.id);await restoreArchivedDocument(pid,metadataArchive.id);
    assert((await db.projects.get(pid))!.dataTables?.find(item=>item.id===formula.id)?.rows[0].cells.amount==='=1+2','Formula sheet lost expressions on restore');
    await deleteRelationTree(pid,tree.id,0);metadataArchive=await archiveFor(tree.id);await restoreArchivedDocument(pid,metadataArchive.id);
    await deleteSheet(pid,sheet.id,0);metadataArchive=await archiveFor(sheet.id);await restoreArchivedDocument(pid,metadataArchive.id);
    await removeModelAsset(pid,model.id);metadataArchive=await archiveFor(model.id);await restoreArchivedDocument(pid,metadataArchive.id);
    const restoredProject=(await db.projects.get(pid))!;
    assert(restoredProject.dataTables?.[0].rows[0].cells.name===a.id&&restoredProject.relationTrees?.[0].nodes[0].codexEntryId===a.id&&restoredProject.characterSheets?.[0].linkedEntryId===a.id&&restoredProject.modelAssets?.[0].dataUrl===model.dataUrl,'Metadata restore lost typed data/links/binary bytes');
    await deleteSheet(pid,sheet.id,0);metadataArchive=await archiveFor(sheet.id);await db.codexEntries.delete(a.id);
    rejected=false;try{await restoreArchivedDocument(pid,metadataArchive.id);}catch{rejected=true;}
    assert(rejected&&!(await db.projects.get(pid))!.characterSheets?.length,'Metadata restore allowed missing Codex dependency');
    await db.codexEntries.add(a);await restoreArchivedDocument(pid,metadataArchive.id);
    passed.push('five metadata document kinds: own-item restore preserves later Project/sibling edits, all typed content/links/GLB bytes, and refuses missing Codex dependencies');
    const radar=createRadarChart('A balance of powers');radar.series[0].linkedEntryId=a.id;
    const savedRadar=await saveRadarChart(pid,radar,null);await deleteRadarChart(pid,savedRadar.id,savedRadar.revision);
    metadataArchive=await archiveFor(savedRadar.id);
    await db.projects.update(pid,{radarCharts:[{...savedRadar,title:'A newer chart owns this ID'}]});
    rejected=false;try{await restoreArchivedDocument(pid,metadataArchive.id);}catch(error){rejected=error instanceof ArchiveRestoreConflict;}
    assert(rejected&&(await db.projects.get(pid))!.radarCharts?.[0].title==='A newer chart owns this ID','Metadata restore overwrote an occupied chart ID');
    await db.projects.update(pid,{radarCharts:[]});await restoreArchivedDocument(pid,metadataArchive.id);
    assert((await db.projects.get(pid))!.radarCharts?.[0].series[0].linkedEntryId===a.id,'Radar archive lost its Codex link');
    passed.push('radar metadata: revision-checked delete, occupied ID conflict and exact series/link restoration');

    await act(async()=>{root=createRoot(host);root.render(<StrictMode><MemoryRouter><ArchiveEngine projectId={pid}/></MemoryRouter></StrictMode>);await pause(80);});
    await wait('archive UI',()=>!!document.querySelector('[data-testid="document-archive"]'));
    const activeButton=[...document.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.includes(t('archive.active')))!;
    await act(async()=>{activeButton.click();await pause(50);});
    const maraRow=()=>document.querySelector(`[data-testid="archive-row-${a.id}"]`)!;
    await wait('active Mara',()=>!!maraRow());await act(async()=>{button(t('archive.archive'),maraRow())!.click();await pause();});
    await act(async()=>{button(t('archive.archive'),document.querySelector('[role="dialog"]')!)!.click();await pause(70);});
    await wait('Mara archived through UI',async()=>!await db.codexEntries.get(a.id));
    await act(async()=>{[...document.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.includes(t('archive.deleted')))! .click();await pause(60);});
    await wait('archived result',()=>!!button(t('archive.restore')));await act(async()=>{button(t('archive.restore'))!.click();await pause(60);});
    await wait('restored through actual UI',async()=>!!await db.codexEntries.get(a.id));
    assert(!document.body.textContent?.includes('Occupied by newer document'),'Archive UI exposed another project');
    await act(async()=>{await deleteCodexEntry(a.id);await pause(70);});
    await wait('forever delete control',()=>!!button(t('archive.forget')));
    await act(async()=>{button(t('archive.forget'))!.click();await pause();});
    assert(await db.documentArchives.where('sourceId').equals(a.id).count(),'Permanent delete ran before confirmation');
    await act(async()=>{button(t('archive.forget'),document.querySelector('[role="dialog"]')!)!.click();await pause(70);});
    await wait('confirmed archive forgotten',async()=>!await db.documentArchives.where('sourceId').equals(a.id).count());
    assert(!await db.codexEntries.get(a.id),'Forgetting copy resurrected document');
    await unmount();
    await deleteCodexEntry(b.id);assert(await db.documentArchives.where('projectId').equals(pid).count(),'Missing project cleanup fixture');await deleteProject(pid);
    assert(!await db.documentArchives.where('projectId').equals(pid).count(),'Project deletion left archive data');
    passed.push('actual archive UI: active document confirmation, restore, project scoping; whole-project deletion clears archive without creating another');
    return passed;
  } finally {await unmount();await deleteProject(pid);await deleteProject(other);}
}

export async function previewDocumentArchive() {
  const now=Date.now(),pid='archive-preview';
  await db.projects.put({id:pid,title:'The Cartographer’s Debt',mode:'novelist',type:'standalone',description:'',status:'draft',color:'#c4973b',enabledEngines:['archive'],engineOrder:['archive'],createdAt:now,updatedAt:now});
  await db.codexEntries.put({id:'archive-preview-mara',projectId:pid,title:'Mara, the cartographer',type:'character',content:'<p>She knew the signal.</p>',fields:{},relations:[],tags:[],createdAt:now,updatedAt:now});
  await db.worldMaps.put({id:'archive-preview-map',projectId:pid,title:'The salt marsh',backgroundImage:'',createdAt:now,updatedAt:now});
  await db.writings.put({id:'archive-preview-writing',projectId:pid,title:'Across the salt marsh',status:'draft',content:'<p>The tide had erased the road before Mara reached the causeway.</p>',wordCount:12,tags:[],createdAt:now,updatedAt:now});
  await deleteCodexEntry('archive-preview-mara');await deleteWorldMap('archive-preview-map');await deleteWritingRestorable('archive-preview-writing');
  const host=document.getElementById('root')!;host.style.padding='24px';createRoot(host).render(<MemoryRouter><ArchiveEngine projectId={pid}/></MemoryRouter>);await pause(350);
}
