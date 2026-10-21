import '@/engines';
import {db} from '@/db';
import {deleteProject,exportProjectData,importProjectData} from '@/db/operations';
import {saveCodexTemplate} from '@/engines/codex/templates';
import {projectCodexEntry} from '@/engines/codex/properties';
import {saveCodexOptionList} from '@/engines/codex/optionLists';
import {createTypeTable,saveTableCalculation} from '@/engines/tables/calculations';
import {projectWorldTable} from '@/engines/tables/projection';
import {createAnnotation} from '@/engines/annotations/operations';
import {deleteAnnotationThread,mutateAnnotationThread,undoAnnotationThread} from '@/engines/annotations/threads';
import {listEraRows,readWorldDocument,saveEraDocument,saveWorldEra} from '@/services/worldEras/store';
import {applyTimelineBatch,timelineBatchTargets,undoTimelineBatch} from '@/engines/timeline/eventBatch';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {getDocumentHistory,listDocumentHistory} from '@/services/documentHistory/store';
import {capturePublicationSnapshot,publicationReaderSource} from '@/services/publishedEditions/snapshot';
import {buildReaderHtml} from '@/engines/writings/readerExport';
import {defaultReaderPresentation} from '@/engines/writings/readerPresentation';
import {saveDictionary} from '@/engines/dictionary/operations';
import type {CodexEntry,Project} from '@/types';
import type {WorldTable} from '@/engines/tables/types';

function check(value:unknown,message:string):asserts value {if(!value)throw Error(message);}
const project=(id:string):Project=>({id,title:id,description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['tables','codex','annotations','dictionary'],engineOrder:[],createdAt:1,updatedAt:1});
async function setupTable(id:string){
 await db.projects.put(project(id));
 const template=await saveCodexTemplate(id,{id:`${id}-type`,name:'Sample',category:'item',fields:{amount:''},content:'',revision:0,createdAt:1,updatedAt:1,propertyDefinitions:[{id:'amount-property',key:'amount',label:'Amount',kind:'number'}]},null);
 const entries:CodexEntry[]=['10','30'].map((amount,i)=>({id:`${id}-entry-${i}`,projectId:id,title:`Entry ${i}`,type:'item',templateId:template.id,fields:{amount},content:'',tags:[],relations:[],createdAt:1,updatedAt:1}));
 await db.codexEntries.bulkPut(entries);
 const scope={projectId:id},table=await createTypeTable(scope,'Concrete sample',template.id);
 const version=async()=>(await readWorldDocument(scope,'tables',table.id))!.version;
 return {scope,template,entries,table,version};
}

/** A row reference to a table-local aggregate must retain the aggregate dependency. */
export async function testClosureTableLocalDependency(){
 const P='review-closure-table-local';try{
  const {scope,table,version,template,entries}=await setupTable(P);
  const aggregate=await saveTableCalculation(scope,{tableId:table.id,name:'Grand total',formula:'=SUM(Amount)',resultType:'decimal',expectedVersion:await version()});
  check(!aggregate.promoted,'Control aggregate must remain table-local');
  const row=await saveTableCalculation(scope,{tableId:table.id,name:'Ratio',formula:'=@[Amount]/@[Grand total]',resultType:'percent',expectedVersion:await version(),expectedTemplateRevision:template.revision});
  const current=(await readWorldDocument(scope,'tables',table.id))!.document.root as unknown as WorldTable;
  const projection=projectWorldTable(current,entries,(await db.projects.get(P))!.codexTemplates);
  check(projection.rows[0].cells[row.column.id]==='0.25',`Local dependency is broken: promoted=${row.promoted}, actual=${projection.rows[0].cells[row.column.id]}, binding=${JSON.stringify((await db.projects.get(P))!.codexTemplates![0].propertyDefinitions?.find(p=>p.id===row.column.propertyId)?.formulaBindings)}`);
  check(!row.promoted,'A table-local dependency cannot be promoted to a shared property');
  return ['Concrete type row formula can depend on a local aggregate without creating a dangling shared property'];
 }finally{await deleteProject(P);}
}

/** The normal heading-token action exposes Name as a row reference as well. */
export async function testClosureTableTitleDependency(){
 const P='review-closure-table-title';try{
  const {scope,table,version,template,entries}=await setupTable(P);
  const calculation=await saveTableCalculation(scope,{tableId:table.id,name:'Caption',formula:'=UPPER(@[Name])',resultType:'text',expectedVersion:await version(),expectedTemplateRevision:template.revision});
  const current=(await readWorldDocument(scope,'tables',table.id))!.document.root as unknown as WorldTable;
  const templates=(await db.projects.get(P))!.codexTemplates!;
  const projection=projectWorldTable(current,entries,templates);
  check(projection.rows[0].cells[calculation.column.id]==='ENTRY 0',`Name heading token fails: promoted=${calculation.promoted}, table=${projection.rows[0].cells[calculation.column.id]}, card=${projectCodexEntry(entries[0],templates).fields[calculation.column.field!]}`);
  return ['Concrete type Name heading reference evaluates its row title'];
 }finally{await deleteProject(P);}
}

export async function testClosureThreadDeleteReplay(){
 const P='review-closure-thread-replay';try{
  await db.projects.put(project(P));
  await db.codexEntries.put({id:`${P}-card`,projectId:P,title:'Source',type:'custom',fields:{},content:'Source prose',relations:[],tags:[],createdAt:1,updatedAt:1});
  const scope={projectId:P},id=`${P}-comment`;
  await createAnnotation({id,projectId:P,sourceEngineId:'codex',sourceEntityId:`${P}-card`,anchor:{type:'entity'},noteType:'text',noteBody:'Original comment',isOrphaned:false,position:0,createdAt:1,updatedAt:1});
  const firstDelete=await deleteAnnotationThread(scope,id,0);
  const restored=await undoAnnotationThread(firstDelete.undo);
  const revised=await mutateAnnotationThread(scope,id,restored.revision!,{kind:'reply',body:'Newer reply that must survive recovery'});
  const secondDelete=await deleteAnnotationThread(scope,id,revised.annotation.revision!);
  let rejected=false;try{await undoAnnotationThread(firstDelete.undo);}catch{rejected=true;}
  const staleResult=await db.annotations.get(id);
  check(rejected&&!staleResult,`Consumed delete receipt resurrected obsolete comment: ${JSON.stringify(staleResult)}`);
  const latest=await undoAnnotationThread(secondDelete.undo);
  check(latest.replies?.[0].body==='Newer reply that must survive recovery','Latest deletion receipt lost the later reply');
  return ['Consumed deletion receipt cannot resurrect an obsolete comment after a later edit/delete'];
 }finally{await deleteProject(P);}
}

export async function testClosureConcurrencyAndDictionary(){
 const P='review-closure-concurrency';try{
  await db.projects.put(project(P));const scope={projectId:P};
  const list=await saveCodexOptionList(scope,{name:'Original',options:['A']},null);
  const winners=await Promise.allSettled(['First','Second'].map(name=>saveCodexOptionList(scope,{...list,name,options:[name]},list.revision)));
  check(winners.filter(r=>r.status==='fulfilled').length===1,'Two concurrent list updates with the same revision both won');
  const persisted=(await db.projects.get(P))!.codexOptionLists![0];
  check(persisted.revision===list.revision+1&&persisted.options[0]===persisted.name,'Concurrent list update mixed fields/revisions');
  const create=await runBridgeTool('wh_dictionary_create',{projectId:P,name:'Concurrent language'});check(create.ok,JSON.stringify(create));
  const result=create.result as {dictionary:{id:string};version:string};
  const wordWrites=await Promise.all(['First','Second'].map(word=>runBridgeTool('wh_dictionary_save_word',{projectId:P,dictionaryId:result.dictionary.id,expectedVersion:result.version,word:{word,meaning:'A real concurrent word'}})));
  check(wordWrites.filter(r=>r.ok).length===1,'Two dictionary CAS writes using the same version both won');
  await saveWorldEra(P,{id:'other-era',name:'Other era',description:'',revision:0,createdAt:1,updatedAt:1},null);
  const get=await runBridgeTool('wh_dictionary_get',{projectId:P,dictionaryId:result.dictionary.id});check(get.ok,JSON.stringify(get));
  const current=get.result as {dictionary:{words:unknown[]};version:string};
  check(current.dictionary.words.length===1,'Dictionary concurrent conflict changed winner');
  const invalid=await runBridgeTool('wh_dictionary_save_word',{projectId:P,dictionaryId:result.dictionary.id,expectedVersion:current.version,word:{word:'Foreign link',meaning:'Must reject',linkedEntryId:'missing-entry'}});
  check(!invalid.ok,'Missing Codex link was accepted');
  const after=await runBridgeTool('wh_dictionary_get',{projectId:P,dictionaryId:result.dictionary.id});check(after.ok&&(after.result as {version:string}).version===current.version,'Rejected dictionary link partially mutated the document');
  return ['Independent simultaneous option-list and dictionary CAS writes retain exactly one coherent winner; missing dictionary links reject atomically'];
 }finally{await deleteProject(P);}
}

export async function testClosureHistoryCandidateAmbiguity(){
 const P='review-closure-history-candidates';try{
  await db.projects.put(project(P));
  const id=`${P}-map`;
  await db.worldMaps.put({id,projectId:P,title:'roundtrip',createdAt:1,updatedAt:1} as never);
  await db.mapPins.put({id:`${P}-pin`,projectId:P,mapId:id,label:'Portable',x:1,y:1} as never);
  await db.worldMaps.update(id,{title:'Edited portable'});
  const rows=(await listDocumentHistory(P,'maps',id)).filter(row=>row.title==='roundtrip');
  const versions=await Promise.all(rows.map(row=>getDocumentHistory(P,'maps',id,row.id)));
  const counts=versions.map(row=>row.document.children.mapPins.length).sort();
  check(versions.length===2&&counts.join(',')==='0,1',`Expected valid childless/child-bearing preimages sharing title, saw ${JSON.stringify(counts)}`);
  return ['Two legitimate roundtrip preimages share the same title: before child insert (0 pins), before title edit (1 pin); title-only find is ambiguous'];
 }finally{await deleteProject(P);}
}

export async function testClosureTimelineEraConnectionIdentity(){
 const P='review-closure-timeline-era-connection';try{
  await db.projects.put(project(P));
  await saveWorldEra(P,{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1},null);
  const scope={projectId:P,eraId:'past'},a=`${P}-a`,b=`${P}-b`;
  await db.timelines.bulkPut([a,b].map(id=>({id,projectId:P,title:id,color:'#123456',createdAt:1,updatedAt:1})));
  const event=(id:string,timelineId:string)=>({id,projectId:P,timelineId,title:id,description:'',date:'2026-01-01',dateMode:'calendar' as const,realDate:'2026-01-01',order:0,createdAt:1,updatedAt:1});
  await db.timelineEvents.bulkPut([event('event-a',a),event('event-a2',a),event('event-b',b),event('event-b2',b)]);
  const linkId=`${P}-link`;
  await db.timelineConnections.put({id:linkId,projectId:P,timelineId:a,sourceEventId:'event-a',targetEventId:'event-a2',label:'Original connection',style:'solid',color:'#123456',createdAt:1});
  const removed=await applyTimelineBatch(scope,['event-a'],{kind:'remove'},await timelineBatchTargets(scope));
  const other=(await readWorldDocument(scope,'timeline',b))!;
  const occupied=structuredClone(other.document);occupied.children.timelineConnections=[{id:linkId,projectId:P,timelineId:b,sourceEventId:'event-b',targetEventId:'event-b2',label:'Newer occupied identity',style:'solid',color:'#123456',createdAt:2}];
  await saveEraDocument(scope,'timeline',occupied,other.version);
  let rejected=false;try{await undoTimelineBatch(scope,removed.receiptId);}catch{rejected=true;}
  const all=await listEraRows<{id:string;timelineId:string;label?:string}>(scope,'timelineConnections');
  check(rejected&&all.filter(row=>row.id===linkId).length===1&&all.find(row=>row.id===linkId)?.label==='Newer occupied identity',`Era Undo restored an occupied connection identity: rejected=${rejected}, rows=${JSON.stringify(all)}`);
  check(!(await listEraRows<{id:string}>(scope,'timelineEvents')).some(row=>row.id==='event-a'),'Rejected undo partially restored selected event');
  return ['Named-era Undo refuses a removed connection identity occupied later by another timeline, atomically'];
 }finally{await deleteProject(P);}
}

export async function testClosureDetachedReaderSources(){
 const P='review-closure-detached-reader';let closed=false;try{
  const {scope,table,version}=await setupTable(P);
  await saveTableCalculation(scope,{tableId:table.id,name:'Frozen ratio',formula:'=@[Amount]/SUM(Amount)',resultType:'percent',expectedVersion:await version()});
  await saveDictionary(P,{id:`${P}-dictionary`,name:'Frozen language',description:'Frozen dictionary source',scriptMapping:'',detectInManuscript:false,words:[{id:'frozen-word',word:'shal',nativeForm:'',pronunciation:'',partOfSpeech:'',meaning:'Meaning retained offline',examples:'',phrases:'',derivatives:'',origin:''}]});
  const lane=`${P}-timeline`;
  await db.timelines.put({id:lane,projectId:P,title:'Frozen timeline',createdAt:1,updatedAt:1});
  await db.timelineEvents.put({id:`${P}-event`,projectId:P,timelineId:lane,title:'Frozen arrival',description:'Frozen event description',date:'2026-10-20',dateMode:'calendar',realDate:'2026-10-20',order:0,createdAt:1,updatedAt:1});
  const board=`${P}-board`;
  await db.boards.put({id:board,projectId:P,title:'Frozen board',createdAt:1,updatedAt:1} as never);
  await db.boardNodes.put({id:`${P}-node`,projectId:P,boardId:board,kind:'text',title:'Frozen board card',content:'Frozen board prose',position:{x:0,y:0},size:{width:200,height:100},zIndex:0} as never);
  const block=(kind:string,id:string)=>`<figure data-wh-tool-block="true" data-project-id="${P}" data-tool-kind="${kind}" data-document-id="${id}"></figure>`;
  await db.writings.put({id:`${P}-writing`,projectId:P,title:'Detached source chapter',content: '<p>Frozen paragraph.</p>'+block('tables',table.id)+block('dictionary',`${P}-dictionary`)+block('timeline',lane)+block('board',board),status:'draft',tags:[],wordCount:2,createdAt:1,updatedAt:1});
  const source=publicationReaderSource(await capturePublicationSnapshot(scope));
  await deleteProject(P);db.close();closed=true;
  const rendered=await buildReaderHtml(source.project,source.writings,defaultReaderPresentation(),'en',scope,source);
  for(const literal of ['Frozen paragraph.','25%','75%','Meaning retained offline','Frozen arrival','Frozen event description','Frozen board card','Frozen board prose'])check(rendered.html.includes(literal),`Detached Reader lost captured semantic source: ${literal}`);
  check(!db.isOpen(),'Rendering re-opened the DB after capture');
  return ['Captured Reader renders concrete computed table, dictionary, timeline events and board cards after deleting the source project and closing IndexedDB, with no live fallback'];
 }finally{if(closed)await db.open();await deleteProject(P);}
}

/** Supported legacy imports intentionally retain unavailable sources as orphan comments. */
export async function testClosureOrphanCommentDeleteUndo(){
 const P='review-closure-orphan-comment';let clone:string|undefined;try{
  await db.projects.put(project(P));
  const portable=await exportProjectData(P);
  portable.annotations=[{id:`${P}-legacy`,projectId:P,sourceEngineId:'outline',sourceEntityId:'unavailable-legacy-source',anchor:{type:'entity'},noteType:'text',noteBody:'Legacy research that must stay recoverable',isOrphaned:true,position:0,createdAt:1,updatedAt:1,replies:[{id:'retained-reply',body:'Retained reply',createdAt:1,updatedAt:1}]}];
  clone=await importProjectData(portable);
  const orphan=(await db.annotations.where('projectId').equals(clone).toArray())[0];check(orphan?.isOrphaned,'Valid legacy import did not retain its orphan comment');
  const receipt=await deleteAnnotationThread({projectId:clone},orphan.id,orphan.revision??0);
  const restored=await undoAnnotationThread(receipt.undo);
  check(restored.isOrphaned&&restored.noteBody===orphan.noteBody&&restored.replies?.[0].body==='Retained reply','Deleting and undoing a valid imported orphan lost recoverable discussion');
  return ['Imported legacy orphan comments remain recoverable through the normal delete/Undo action'];
 }finally{if(clone)await deleteProject(clone);await deleteProject(P);}
}
