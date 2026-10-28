/** Proposed tests/local-tool-convergence.persistence.browser.ts; never run against a user profile. */
import '@/engines';
import {db} from '@/db';
import type {Project} from '@/types';
import {exportProjectData,importProjectData} from '@/db/operations';
import {createProjectZipArchive,importProjectZip} from '@/services/zipBackup';
import {duplicateProject,previewProjectDuplicate} from '@/services/projectDuplicate/service';
import {onDataChanged} from '@/engines/_shared/dataChanged';
import {pinLocalToolRelease} from '@/engines/local/releases';
import {readSourceToolState,saveSourceToolState,archiveSourceToolDocument} from '@/engines/local/documents/store';
import {startSourceToolConvergence,exportSourceToolConvergence,importSourceToolConvergence,applySourceToolConvergence,reverseSourceToolConvergence} from '@/engines/local/documents/convergence';
import {createLocalToolReplica} from '@/engines/local/convergence/replica';
import type {LocalToolConvergenceCheckpoint,LocalToolReplica} from '@/engines/local/convergence/types';
import type {SourceToolDocument} from '@/engines/local/documents/types';
import {saveWorldEra,readWorldDocument,saveEraDocument,resetEraDocument,restoreEraVersion} from '@/services/worldEras/store';
import type {WorldEraScope} from '@/services/worldEras/types';
import {saveDocumentHistory,readHistoryPresent,restoreDocumentHistory,getDocumentHistory} from '@/services/documentHistory/store';
import {assert,canonical,refused,fixtureDefinitions,seedProject,newDocument,row,ownSnapshot,cold,cleanup,contract,NS,V2,options1,options2,type PersistData} from './fixtures/local-tools/convergence-persistence';

export async function testLocalToolConvergencePersistence(){
 const P='convergence-persist-'+crypto.randomUUID(),Q='convergence-sibling-'+crypto.randomUUID(),scope={projectId:P},owned=new Set([P,Q]),operationKeys=new Set<string>(),passed:string[]=[];
 const definitions=fixtureDefinitions(),one=definitions.one,two=definitions.two,replicas:LocalToolReplica<PersistData>[]=[];
 const replica=(checkpoint:LocalToolConvergenceCheckpoint,authorId:string)=>{const result=createLocalToolReplica(checkpoint,{authorId,contract:contract(one,checkpoint.validationId)});replicas.push(result);return result;};
 const read=(id:string,target:WorldEraScope=scope)=>readSourceToolState(target,id,one);
 const started=async(id:string,target:WorldEraScope=scope)=>startSourceToolConvergence(target,id,one,await read(id,target),options1);
 try{
  await seedProject(P);await seedProject(Q);
  const doc=await newDocument(scope,'Concurrent source'),legacy=await newDocument(scope,'Legacy untouched'),eraDoc=await newDocument(scope,'Era source'),foreign=await ownSnapshot(Q),legacyBytes=canonical(await row(scope,legacy.id));
  const legacyBaseline=await read(legacy.id),beforeLegacy=await ownSnapshot(P),legacyExport=await exportSourceToolConvergence(scope,legacy.id,one);
  assert(legacyExport.checkpoint===null&&legacyExport.update===null&&!legacyExport.pending&&await ownSnapshot(P)===beforeLegacy,'Legacy export initialized or wrote');
  assert(canonical(await read(legacy.id))===canonical(legacyBaseline),'Legacy export changed snapshot');
  const stale=await read(doc.id),start=await started(doc.id);assert(start.checkpoint&&start.causalChanged&&!start.changed,'Start did not create a checkpoint');
  const beforeNoop=await ownSnapshot(P),again=await startSourceToolConvergence(scope,doc.id,one,await read(doc.id),options1);
  assert(!again.changed&&!again.causalChanged&&await ownSnapshot(P)===beforeNoop,'Repeated own start wrote');
  await refused(()=>startSourceToolConvergence(scope,doc.id,one,stale,options1));assert(await ownSnapshot(P)===beforeNoop,'Stale start changed root/history');
  const descriptor=(again.snapshot as typeof again.snapshot&{convergence?:Record<string,unknown>}).convergence;
  assert(descriptor?.genesisId===start.checkpoint.genesisId&&!Object.hasOwn(descriptor,'checkpointBase64')&&!Object.hasOwn(descriptor,'stateVectorBase64'),'Snapshot descriptor missing or leaked bytes');
  passed.push('Legacy export is readonly; real Source start uses CAS, repeated own start no-ops and read exposes identity without causal bytes');

  const present=(await readHistoryPresent(P,'local-tool',doc.id))!;
  const genesisHistory=await saveDocumentHistory(P,'local-tool',doc.id,present.version),genesis=start.checkpoint!;
  const left=replica(genesis,'concurrent-left'),right=replica(genesis,'concurrent-right');
  const leftUpdate=left.apply([{type:'set',field:'value',value:11},{type:'map-set',field:'labels',key:'left',value:'L'},{type:'list-insert',field:'items',item:{id:'left-item',text:'Left Élodie'},afterId:null}]).update;
  const rightUpdate=right.apply([{type:'set',field:'value',value:22},{type:'map-set',field:'labels',key:'right',value:'R'},{type:'list-insert',field:'items',item:{id:'right-item',text:'Right 漢字'},afterId:null}]).update;
  await importSourceToolConvergence(scope,doc.id,one,leftUpdate,options1);await importSourceToolConvergence(scope,doc.id,one,rightUpdate,options1);
  const ab=await exportSourceToolConvergence(scope,doc.id,one),merged=ab.snapshot.data;
  assert(merged.labels.left==='L'&&merged.labels.right==='R'&&merged.items.length===2&&new Set(merged.items.map(item=>item.id)).size===2&&[11,22].includes(merged.value),'Concurrent authored contributions lost');
  const beforeReplay=await ownSnapshot(P),replay=await importSourceToolConvergence(scope,doc.id,one,leftUpdate,options1);
  assert(!replay.changed&&!replay.causalChanged&&await ownSnapshot(P)===beforeReplay,'Duplicate import created revision/history');
  await restoreDocumentHistory(P,'local-tool',doc.id,genesisHistory.id,(await readHistoryPresent(P,'local-tool',doc.id))!.version);
  assert((await row(scope,doc.id)).convergence!.checkpoint.checkpointBase64===genesis.checkpointBase64,'Same-ID history restore changed causal bytes');
  await importSourceToolConvergence(scope,doc.id,one,rightUpdate,options1);await importSourceToolConvergence(scope,doc.id,one,leftUpdate,options1);
  const ba=await exportSourceToolConvergence(scope,doc.id,one);
  assert(canonical(ba.snapshot.data)===canonical(ab.snapshot.data)&&canonical(ba.checkpoint)===canonical(ab.checkpoint),'Identical concurrent inputs diverged by delivery order');
  await cold();assert(canonical((await exportSourceToolConvergence(scope,doc.id,one)).checkpoint)===canonical(ba.checkpoint),'Cold reopened a different checkpoint');
  passed.push('Identical scalar/map/list concurrent packets converge in AB/BA, replay is a durable no-op and same-ID history/cold preserve checkpoint bytes');

  const chain=replica(ba.checkpoint!,'pending-author'),first=chain.apply([{type:'map-set',field:'labels',key:'dependency',value:'first'}]).update,second=chain.apply([{type:'map-set',field:'labels',key:'dependent',value:'second'}]).update;
  const beforePending=await row(scope,doc.id),pending=await importSourceToolConvergence(scope,doc.id,one,second,options1);
  assert(pending.causalChanged&&pending.pending&&canonical(pending.snapshot.data)===canonical(beforePending.data)&&(await row(scope,doc.id)).revision>beforePending.revision,'Out-of-order dependency was not persisted');
  const pendingBytes=canonical(pending.checkpoint);await cold();const coldPending=await exportSourceToolConvergence(scope,doc.id,one);
  assert(coldPending.pending&&canonical(coldPending.checkpoint)===pendingBytes,'Cold lost pending causal input');
  const ready=await importSourceToolConvergence(scope,doc.id,one,first,options1);
  assert(!ready.pending&&ready.snapshot.data.labels.dependency==='first'&&ready.snapshot.data.labels.dependent==='second','Missing dependency did not integrate after cold');
  const savedBefore=await read(doc.id),replacement={...savedBefore.data,notes:'Replacement сохраняет Élodie 漢字 🐚',opaque:{literal:'Opaque source '+doc.id},link:{kind:'local-tool',documentId:eraDoc.id}};
  const saved=await saveSourceToolState(scope,doc.id,one,replacement,savedBefore.revision,savedBefore.document!.version,options1),savedExport=await exportSourceToolConvergence(scope,doc.id,one);
  assert(canonical(saved.data)===canonical(replacement)&&canonical(replica(savedExport.checkpoint!,'verify-replacement').read())===canonical(replacement),'Full save left stale causal projection or lost opaque JSON');
  const saveNoopFlags:boolean[]=[];await saveSourceToolState(scope,doc.id,one,saved.data,saved.revision,saved.document!.version,{...options1,onPrepared:changed=>saveNoopFlags.push(changed)});
  assert(canonical(saveNoopFlags)==='[false]','Host Save preparation did not report its own no-op flag');
  passed.push('Pending input survives cold and later dependency; full Save replaces through the same core and returns its own prepared causal flag');

  const rollbackDoc=await newDocument(scope,'Rollback source');
  const rollback=async(label:string,run:()=>Promise<unknown>)=>{
   const before=await ownSnapshot(P),beforeQ=await ownSnapshot(Q);let announced=0;const stop=onDataChanged(detail=>{if(detail.projectId===P)announced++;});
   try{await refused(()=>db.transaction('rw',db.tables,async()=>{await run();assert(announced===0,label+' announced before root commit');throw Error('OWNED_OUTER_ABORT_'+label);}), 'OWNED_OUTER_ABORT_'+label);}finally{stop();}
   assert(await ownSnapshot(P)===before&&await ownSnapshot(Q)===beforeQ&&announced===0,label+' escaped outer rollback');
  };
  await rollback('start',()=>started(rollbackDoc.id));assert(!(await row(scope,rollbackDoc.id)).convergence,'Aborted start remained initialized');
  const rollbackStart=await started(rollbackDoc.id),remote=replica(rollbackStart.checkpoint!,'rollback-remote'),remoteUpdate=remote.apply([{type:'map-set',field:'labels',key:'aborted',value:'input'}]).update;
  await rollback('import',()=>importSourceToolConvergence(scope,rollbackDoc.id,one,remoteUpdate,options1));
  await rollback('apply',async()=>applySourceToolConvergence(scope,rollbackDoc.id,one,await read(rollbackDoc.id),[{type:'set',field:'value',value:3}],options1));
  const author=await applySourceToolConvergence(scope,rollbackDoc.id,one,await read(rollbackDoc.id),[{type:'set',field:'value',value:4}],options1);assert(author.receipt,'Core action did not return opaque recipe');
  await rollback('reverse',()=>reverseSourceToolConvergence(scope,rollbackDoc.id,one,author.receipt!,options1));
  const undone=await reverseSourceToolConvergence(scope,rollbackDoc.id,one,author.receipt!,options1);assert(undone.snapshot.data.value===0,'Aborted reverse consumed or corrupted its prepared recipe');
  passed.push('Awaited start/import/apply/reverse finish inside an outer RW; abort restores own indexed rows/history/dates and emits no notification');

  await saveWorldEra(P,{id:'past',name:'Past',description:'Owned era',revision:0,createdAt:1,updatedAt:1},null);const past={projectId:P,eraId:'past'};
  const baseStart=await started(eraDoc.id),baseBefore=await row(scope,eraDoc.id),inherited=await read(eraDoc.id,past),beforeInherited=await ownSnapshot(P);
  await read(eraDoc.id,past);await exportSourceToolConvergence(past,eraDoc.id,one);assert(await ownSnapshot(P)===beforeInherited,'Inherited getter created an era root');
  const branch=await applySourceToolConvergence(past,eraDoc.id,one,inherited,[{type:'set',field:'notes',value:'Past own Élodie'}],options1);
  assert(branch.checkpoint!.genesisId!==baseStart.checkpoint!.genesisId&&canonical(await row(scope,eraDoc.id))===canonical(baseBefore),'Inherited write reused Base identity or changed Base');
  let variant=(await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([P,'past','local-tool',eraDoc.id]).first())!;
  const retained=variant.history!.find(item=>item.document&&canonical(item.document.root)===canonical(baseBefore));assert(retained,'First inherited write did not retain the complete Base source');
  await applySourceToolConvergence(scope,eraDoc.id,one,await read(eraDoc.id),[{type:'set',field:'notes',value:'Base edited after fork'}],options1);
  assert((await read(eraDoc.id,past)).data.notes==='Past own Élodie','Later Base edit changed own era');
  await restoreEraVersion(past,'local-tool',eraDoc.id,variant.revision,retained.revision);
  assert(canonical((await row(past,eraDoc.id)).convergence)===canonical(baseBefore.convergence)&&(await read(eraDoc.id,past)).data.notes===(baseBefore.data as PersistData).notes,'Retained inherited root was not recoverable after Base changed');
  await refused(()=>reverseSourceToolConvergence(past,eraDoc.id,one,branch.receipt!,options1));
  variant=(await db.worldEraVariants.get(variant.id))!;await resetEraDocument(past,'local-tool',eraDoc.id,variant.revision);
  const reinherited=await read(eraDoc.id,past),latestBase=await row(scope,eraDoc.id);assert(reinherited.provenance==='base'&&reinherited.document!.lineage!==inherited.document!.lineage,'Reset did not invalidate inherited lineage');
  const refork=await applySourceToolConvergence(past,eraDoc.id,one,reinherited,[{type:'map-set',field:'labels',key:'refork',value:true}],options1);
  assert(refork.checkpoint!.genesisId!==branch.checkpoint!.genesisId&&refork.checkpoint!.genesisId!==latestBase.convergence!.checkpoint.genesisId,'Reinherit reused an archived or Base genesis');
  variant=(await db.worldEraVariants.get(variant.id))!;
  assert(variant.history!.some(item=>item.document&&canonical(item.document.root)===canonical(latestBase))&&new Set(variant.history!.map(item=>item.revision)).size===variant.history!.length,'Reinherit snapshot is absent or history revisions are ambiguous');
  const beforeGeneric=await row(past,eraDoc.id),genericRead=(await readWorldDocument(past,'local-tool',eraDoc.id))!,genericDoc=structuredClone(genericRead.document);
  (genericDoc.root as unknown as SourceToolDocument).data={...beforeGeneric.data as PersistData,notes:'Generic variant save'};
  definitions.forbid(true);try{await saveEraDocument(past,'local-tool',genericDoc,genericRead.version,{checkpoint:true});}finally{definitions.forbid(false);}
  const afterGeneric=await row(past,eraDoc.id),genericVariant=(await db.worldEraVariants.get(variant.id))!;
  assert(afterGeneric.convergence!.checkpoint.genesisId!==beforeGeneric.convergence!.checkpoint.genesisId&&afterGeneric.generation!==beforeGeneric.generation,'Generic data save retained stale checkpoint identity');
  assert(canonical(replica(afterGeneric.convergence!.checkpoint,'generic-check').read())===canonical(afterGeneric.data)&&genericVariant.history!.some(item=>item.document&&canonical(item.document.root)===canonical(beforeGeneric)),'Generic checkpoint save lost projection or displaced causal state');
  assert(canonical(await row(scope,eraDoc.id))===canonical(latestBase),'Generic era save changed Base');
  const eraOnly=await newDocument(past,'Era-only source');await started(eraOnly.id,past);assert(!(await db.projects.get(P))!.sourceToolDocuments!.some(item=>item.id===eraOnly.id),'Era-only start inserted Base root');
  await cold();assert(canonical((await row(past,eraDoc.id)).convergence)===canonical(afterGeneric.convergence),'Cold changed own era checkpoint');
  passed.push('Inherited era writes retain complete Base for restore after Base edit; reinherit reforks with unique history revisions, generic saves remain coherent and era-only stays out of Base');

  const archived=await newDocument(scope,'Archived causal source');await started(archived.id);
  const archiveBefore=await read(archived.id);await archiveSourceToolDocument(scope,archived.id,NS,archiveBefore.revision!,archiveBefore.document!.version);
  assert(!(await db.projects.get(P))!.sourceToolDocuments!.some(item=>item.id===archived.id),'Archive still exposes its root in Base');
  const beforeEpoch=await row(scope,doc.id),pin=(await db.projects.get(P))!.localToolInstallations![NS];await pinLocalToolRelease(P,NS,V2,pin.revision);
  assert(canonical(await row(scope,doc.id))===canonical(beforeEpoch),'Compatible pin migrated checkpoint during selection');
  const noValidationCalls=definitions.calls(),beforeOldExport=await ownSnapshot(P);definitions.forbid(true);let oldExport;
  try{oldExport=await exportSourceToolConvergence(scope,doc.id,two);}finally{definitions.forbid(false);}
  assert(definitions.calls()===noValidationCalls&&canonical(oldExport.checkpoint)===canonical(beforeEpoch.convergence!.checkpoint)&&await ownSnapshot(P)===beforeOldExport,'Old epoch readonly export called current validator or wrote');
  const abortEpochBaseline=await readSourceToolState(scope,doc.id,two);
  await rollback('epoch-save',()=>saveSourceToolState(scope,doc.id,two,{...abortEpochBaseline.data,notes:'Aborted epoch intent'},abortEpochBaseline.revision,abortEpochBaseline.document!.version,options2));
  const epochBaseline=await readSourceToolState(scope,doc.id,two),historyIds=new Set((await db.documentHistory.where('projectId').equals(P).toArray()).map(item=>item.id)),observedBefore:SourceToolDocument[]=[];
  const observe=(_mods:Record<string,unknown>,key:unknown,project:Project)=>{if(key===P){const source=project.sourceToolDocuments?.find(item=>item.id===doc.id);if(source)observedBefore.push(structuredClone(source));}};
  db.projects.hook('updating',observe);
  let epochSaved;
  try{epochSaved=await saveSourceToolState(scope,doc.id,two,{...epochBaseline.data,notes:'New release intent in same write'},epochBaseline.revision,epochBaseline.document!.version,options2);}finally{db.projects.hook('updating').unsubscribe(observe);}
  const newEpoch=await row(scope,doc.id),captured=(await db.documentHistory.where('projectId').equals(P).toArray()).filter(item=>!historyIds.has(item.id)&&item.entityId===doc.id);
  assert(observedBefore.some(item=>JSON.stringify(item)===JSON.stringify(beforeEpoch)),'BEFORE Project.update hook did not observe the full displaced root');
  assert(newEpoch.generation!==beforeEpoch.generation&&newEpoch.convergence!.checkpoint.genesisId!==beforeEpoch.convergence!.checkpoint.genesisId&&newEpoch.convergence!.checkpoint.validationId===V2&&epochSaved.data.notes==='New release intent in same write','First accepted write did not migrate epoch and apply its intention atomically');
  const oldHistory=await Promise.all(captured.map(item=>getDocumentHistory(P,'local-tool',doc.id,item.id))),oldEntry=oldHistory.find(item=>JSON.stringify(item.document.root)===JSON.stringify(beforeEpoch));assert(oldEntry,'Normal history lost UTF-8/root/checkpoint bytes at epoch change');
  const beforeOldPacket=await ownSnapshot(P);await refused(()=>importSourceToolConvergence(scope,doc.id,two,leftUpdate,options2),'identity_mismatch');assert(await ownSnapshot(P)===beforeOldPacket,'Old epoch input partially wrote a prepared fork');
  await restoreDocumentHistory(P,'local-tool',doc.id,oldEntry.id,(await readHistoryPresent(P,'local-tool',doc.id))!.version);
  assert(canonical((await row(scope,doc.id)).convergence)===canonical(beforeEpoch.convergence)&&(await row(scope,doc.id)).generation!==beforeEpoch.generation,'History restore did not preserve old checkpoint with new lineage');
  passed.push('Compatible pin leaves old epoch untouched; export bypasses new validator, first accepted write captures the complete old root and old packets reject atomically; history restore preserves checkpoint');

  const conflictDoc=await newDocument(scope,'Conflicted portable source'),conflictStart=await startSourceToolConvergence(scope,conflictDoc.id,two,await readSourceToolState(scope,conflictDoc.id,two),options2);
  const rangeA=replica(conflictStart.checkpoint!,'range-min'),rangeB=replica(conflictStart.checkpoint!,'range-max');
  await importSourceToolConvergence(scope,conflictDoc.id,two,rangeA.apply([{type:'set',field:'min',value:8}]).update,options2);
  const conflicted=await importSourceToolConvergence(scope,conflictDoc.id,two,rangeB.apply([{type:'set',field:'max',value:5}]).update,options2),conflictRow=await row(scope,conflictDoc.id);
  assert(conflictRow.convergence!.conflict?.kind==='validation'&&one.validateState(conflicted.snapshot.data)&&!one.validateState(conflictRow.convergence!.conflict.raw),'Combined invalid range did not retain raw plus admitted view');
  const pendingDoc=await newDocument(scope,'Pending portable source'),portableStart=await startSourceToolConvergence(scope,pendingDoc.id,two,await readSourceToolState(scope,pendingDoc.id,two),options2),portableAuthor=replica(portableStart.checkpoint!,'portable-pending');
  const dependency=portableAuthor.apply([{type:'map-set',field:'labels',key:'parent',value:1}]).update,dependent=portableAuthor.apply([{type:'map-set',field:'labels',key:'child',value:2}]).update;
  assert((await importSourceToolConvergence(scope,pendingDoc.id,two,dependent,options2)).pending,'Portable fixture did not contain a real pending update');
  const payload=async()=>canonical({documents:(await db.projects.get(P))!.sourceToolDocuments,pins:(await db.projects.get(P))!.localToolInstallations,variants:(await db.worldEraVariants.where('projectId').equals(P).toArray()).sort((a,b)=>a.id<b.id?-1:1),history:(await db.documentHistory.where('projectId').equals(P).toArray()).sort((a,b)=>a.id<b.id?-1:1),archives:(await db.documentArchives.where('projectId').equals(P).toArray()).sort((a,b)=>a.id<b.id?-1:1)});
  const zip=await createProjectZipArchive(P),originalPayload=await payload(),originalData=await exportProjectData(P),beforeZip=await readSourceToolState(scope,doc.id,two);
  await saveSourceToolState(scope,doc.id,two,{...beforeZip.data,notes:'Discarded by same-ID ZIP restore'},beforeZip.revision,beforeZip.document!.version,options2);
  const callCount=definitions.calls();definitions.forbid(true);
  try{await importProjectZip(new File([zip.blob],'convergence-owned.zip',{type:'application/zip'}),{replaceProjectIds:[P]});}finally{definitions.forbid(false);}
  assert(definitions.calls()===callCount&&await payload()===originalPayload,'Same-ID ZIP changed causal roots/history/Archive/pins or called a package validator');
  assert((await exportSourceToolConvergence(scope,pendingDoc.id,two)).pending&&canonical((await row(scope,conflictDoc.id)).convergence)===canonical(conflictRow.convergence),'Same-ID ZIP lost conflict or pending metadata');
  const verifyClone=async(projectId:string)=>{
   const copy=(await db.projects.get(projectId))!,sourceRows=copy.sourceToolDocuments!,originalRows=(await db.projects.get(P))!.sourceToolDocuments!;
   assert(copy.id!==P&&copy.localToolInstallations![NS].contentHash===V2,'Copy lost identity or pin');
   for(const original of originalRows){const matching=sourceRows.filter(item=>item.title===original.title);assert(matching.length===1,'Fixture title did not map uniquely');const target=matching[0];assert(target.id!==original.id,'Copy retained old Source ID');if(original.convergence){assert(target.convergence&&target.convergence.checkpoint.genesisId!==original.convergence.checkpoint.genesisId,'New ID retained old causal identity');assert(!target.convergence.conflict,'New genesis copied old raw conflict instead of its admitted view');}else assert(!target.convergence,'Clone auto-started a legacy Source');}
   const target=sourceRows.find(item=>item.title===doc.title)!,targetEra=sourceRows.find(item=>item.title===eraDoc.title)!;
   assert((target.data as PersistData).link!==null&&((target.data as PersistData).link as {documentId:string}).documentId===targetEra.id&&canonical((target.data as PersistData).opaque)===canonical(((await row(scope,doc.id)).data as PersistData).opaque),'Semantic ref did not remap or opaque string was rewritten');
   assert(!sourceRows.some(item=>item.title===archived.title),'Archive was inserted in copied Base');
   const archives=await db.documentArchives.where('projectId').equals(projectId).toArray(),archivedCopy=archives.find(item=>item.kind==='local-tool'&&(item.metadata?.item as {title?:string}|undefined)?.title===archived.title)!;
   assert(archivedCopy&&archivedCopy.metadata?.item.id===archivedCopy.sourceId&&archivedCopy.sourceId!==archived.id,'Copy Archive identity/item/sourceId mismatch');
   const variants=await db.worldEraVariants.where('projectId').equals(projectId).toArray();
   assert(variants.some(item=>item.kind==='local-tool'&&item.entityId!==eraOnly.id&&item.document?.root.title===eraOnly.title)&&variants.some(item=>item.kind==='local-tool'&&item.history?.some(state=>!!state.document?.root.convergence)),'Copy lost era-only or retained causal history');
   await refused(()=>importSourceToolConvergence({projectId},target.id,two,leftUpdate,options2),'identity_mismatch');
  };
  const callsBeforeClones=definitions.calls();definitions.forbid(true);let jsonCopy='',duplicateCopy='';
  try{
   jsonCopy=await importProjectData(originalData);owned.add(jsonCopy);
   const preview=await previewProjectDuplicate({projectId:P}),operationId=crypto.randomUUID();operationKeys.add('projectDuplicate.operation.'+operationId);const result=await duplicateProject({projectId:P,title:'Durable convergence duplicate',operationId,expectedSourceVersion:preview.sourceVersion});duplicateCopy=result.projectId;owned.add(duplicateCopy);assert(result.complete,'Normal duplicate did not complete');
  }finally{definitions.forbid(false);}
  assert(definitions.calls()===callsBeforeClones,'New-ID portable remap executed package validator');
  await verifyClone(jsonCopy);await verifyClone(duplicateCopy);
  const finishPending=await importSourceToolConvergence(scope,pendingDoc.id,two,dependency,options2);assert(!finishPending.pending&&finishPending.snapshot.data.labels.parent===1&&finishPending.snapshot.data.labels.child===2,'Restored pending update could not integrate its original dependency');
  passed.push('Same-ID ZIP preserves conflict/pending/history/Archive bytes; real JSON import and Duplicate remap references then fork new genesis without package callbacks or Archive reinjection');

  assert(await ownSnapshot(Q)===foreign&&canonical(await row(scope,legacy.id))===legacyBytes,'Foreign project or untouched legacy Source changed');
  return passed;
 }finally{definitions.forbid(false);for(const instance of replicas)instance.destroy();await cleanup(owned);for(const key of operationKeys)await db.settings.delete(key);}
}
