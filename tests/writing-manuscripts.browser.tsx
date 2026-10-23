import {db} from '@/db';
import Dexie from 'dexie';
import type {Project,Writing} from '@/types';
import type {PublishingProfile} from '@/types/projectTools';
import {resolvePublishingWritings} from '@/services/projectTools';
import {READER_HANDLERS} from '@/services/aiBridge/tools/reader';
import {setManuscript,listManuscripts,undoManuscript} from '@/engines/writings/manuscriptStore';
import {createWriting,updateWritingAtVersion} from '@/engines/writings/operations';
import {readWorldDocument,saveEraDocument} from '@/services/worldEras/store';
import {saveBook,type BookBaseline} from '@/engines/writings/bookSave';
import {inspectManuscriptFile} from '@/engines/writings/manuscriptReview/inspect';
import {planManuscriptImport} from '@/engines/writings/manuscriptReview/plan';
import {applyManuscriptImport} from '@/engines/writings/manuscriptReview/persist';
import {publishEdition,restorePublishedEdition,getPublishedEdition} from '@/services/publishedEditions/store';
import {runBridgeTool} from '@/services/aiBridge/dispatch';

function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
export async function manuscriptFixture(id='manuscript-contract'){
 const project={id,title:'Shared harbour',description:'',mode:'custom',type:'standalone',color:'#d5b575',status:'draft',enabledEngines:['writings','codex','maps'],engineOrder:['writings'],createdAt:1,updatedAt:1,manuscriptCatalog:{revision:1,entries:[{id:'manuscript-a',title:'Story A',createdAt:1,updatedAt:1},{id:'manuscript-b',title:'Story B',createdAt:1,updatedAt:1}]}} as Project;
 const main:Writing={id:id+'-main',projectId:id,title:'Legacy chapter',content:'<p>LEGACY_MAIN_HARBOUR</p>',status:'draft',chapter:1,wordCount:1,tags:[],createdAt:1,updatedAt:1};
 const a={...main,id:id+'-a',manuscriptId:'manuscript-a',title:'Chapter A',content:'<p>ONLY_STORY_A</p>'} as Writing;
 const b={...main,id:id+'-b',manuscriptId:'manuscript-b',title:'Chapter B',content:'<p>ONLY_STORY_B</p>'} as Writing;
 await db.projects.put(project);await db.writings.bulkPut([main,a,b]);return{project,main,a,b};
}
export async function testManuscriptLegacyProfileScope(){
 const {project,main,a,b}=await manuscriptFixture();
 const profile:PublishingProfile={id:'legacy-profile',projectId:project.id,name:'Legacy all',format:'manuscript',selectionMode:'all',selectedWritingIds:[],writingOrder:[],includeTitlePage:true,includeSynopsis:false,includeBibliography:false,citationStyle:'apa',createdAt:1,updatedAt:1};
 const resolved=resolvePublishingWritings([main,a,b],profile);
 assert(resolved.writings.length===1&&resolved.writings[0].id===main.id,'legacy profile all must stay in implicit main after adding other stories');
 return['Legacy all profile excludes chapters owned by other manuscripts'];
}
export async function testManuscriptReaderScope(){
 const {project}=await manuscriptFixture('manuscript-reader-contract');
 const result=await READER_HANDLERS.wh_reader_export({projectId:project.id,locale:'en'}) as {html:string};
 assert(result.html.includes('LEGACY_MAIN_HARBOUR')&&!result.html.includes('ONLY_STORY_A')&&!result.html.includes('ONLY_STORY_B'),'default native Reader export must stay in main');
 return['Native Reader defaults to the principal manuscript'];
}
export async function testManuscriptCatalogAndOwner(){
 const {project,main,a}=await manuscriptFixture('manuscript-catalog');
 const before=await db.projects.get(project.id);await listManuscripts(project.id);assert(JSON.stringify(before)===JSON.stringify(await db.projects.get(project.id)),'catalogue read is pure');
 const created=await setManuscript(project.id,'manuscript-c','create',{title:'Story C'},1);
 await db.projects.update(project.id,{description:'World edit after story creation'});await undoManuscript(project.id,created.receipt);
 assert((await db.projects.get(project.id))?.description==='World edit after story creation','undo does not restore whole project');
 let refused=false;try{await setManuscript(project.id,'main','update',{title:'Stale'},1);}catch{refused=true;}assert(refused,'catalog CAS rejects stale revision');
 await db.projects.update(project.id,{worldEras:[{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1}]});
 const doc={root:{...a},children:{writingSnapshots:[]}};delete (doc.root as Partial<Writing>).manuscriptId;
 await saveEraDocument({projectId:project.id,eraId:'past'},'writings',doc, (await readWorldDocument({projectId:project.id,eraId:'past'},'writings',a.id))!.version);
 const read=await readWorldDocument({projectId:project.id,eraId:'past'},'writings',a.id);assert(read?.document.root.manuscriptId==='manuscript-a','legacy overlay inherits structural Base owner');
 refused=false;try{await updateWritingAtVersion(main.id,{manuscriptId:'manuscript-b'},main.updatedAt);}catch{refused=true;}assert(refused,'normal update cannot change owner');
 const owned={...main,id:project.id+'-created',manuscriptId:'manuscript-a'};await createWriting(owned);assert((await db.writings.get(owned.id))?.manuscriptId==='manuscript-a','normal create persists owner');
 return['Catalogue read/CAS/Undo preserve world edits; normal chapters and era overlays preserve structural owner'];
}
export async function testManuscriptBookAndImport(){
 const {project,main,a,b}=await manuscriptFixture('manuscript-book-import');
 const baseline:BookBaseline=new Map([[a.id,{title:a.title,html:a.content,persisted:a.content,version:a.updatedAt,chapter:1,wordCount:a.wordCount}]]);
 const result=await saveBook({projectId:project.id,manuscriptId:'manuscript-a',baseline,sections:[{writingId:a.id,clientId:null,title:a.title,html:a.content},{writingId:null,clientId:'new-a',title:'A second chapter',html:'<p>NEW_BOOK_A_HEADING</p>'}],confirmedDeletes:new Set(),firstChapter:1,untitledTitle:'Untitled'});
 assert(result.created.length===1&&result.conflicts.length===0,'book heading creates one new chapter');
 const created=await db.writings.get(result.created[0].writingId);assert(created?.manuscriptId==='manuscript-a'&&created.chapter===2,'book creates A2');
 assert(JSON.stringify(await db.writings.get(b.id))===JSON.stringify(b)&&JSON.stringify(await db.writings.get(main.id))===JSON.stringify(main),'book renumber never shifts B/main');
 const source=await inspectManuscriptFile(new File(['# Imported harbour\n\nOWN_B_IMPORT_PROSE'], 'harbour.md',{type:'text/markdown'})),split={mode:'heading' as const,headingLevel:1,separator:'***'},scope={projectId:project.id};
 const planA=await planManuscriptImport([source],split,scope,[],'manuscript-a'),planB=await planManuscriptImport([source],split,scope,[],'manuscript-b');assert(planA.digest!==planB.digest,'import digest identifies destination');
 let refused=false;try{await applyManuscriptImport(scope,[source],split,[],planA.digest,'manuscript-b');}catch{refused=true;}assert(refused,'plan for A cannot apply to B');
 const imported=await applyManuscriptImport(scope,[source],split,[],planB.digest,'manuscript-b'),row=await db.writings.get(imported.writingIds[0]);assert(row?.manuscriptId==='manuscript-b'&&row.chapter===2&&row.content.includes('OWN_B_IMPORT_PROSE'),'native importer persists B2');
 refused=false;try{await planManuscriptImport([source],split,scope,[{key:planB.chapters[0].key,title:'Wrong replacement',included:true,targetId:a.id,expectedUpdatedAt:a.updatedAt}],'manuscript-b');}catch{refused=true;}assert(refused,'import replacement cannot escape B');
 return['Book heading creation and numbering isolate A; normal manuscript import binds digest/target/replacements to B without shifting main'];
}
export async function testManuscriptPublicationAndBridge(){
 const {project,main,a,b}=await manuscriptFixture('manuscript-publish');
 const native=await runBridgeTool('wh_list_writings',{projectId:project.id});assert(native.ok&&(native.result as {writings:unknown[]}).writings.length===3,'legacy registered list stays world-wide');
 const selected=await runBridgeTool('wh_list_writings',{projectId:project.id,manuscriptId:'manuscript-a'});assert(selected.ok&&(selected.result as {writings:Writing[]}).writings.map(row=>row.id).join()===a.id,'registered optional list filter isolates A');
 const owned=await publishEdition({projectId:project.id,writingScope:{kind:'manuscript',id:'manuscript-a'},chapterIds:[a.id],title:'A edition',locale:'en',expectedRevision:0}).catch(error=>{throw Error('publish A: '+String(error));});
 assert(owned.edition.reader.html.includes('Story A')&&owned.edition.reader.html.includes('ONLY_STORY_A')&&!owned.edition.reader.html.includes('ONLY_STORY_B'),'captured Reader uses A title/content');
 const digest=owned.edition.reader.sha256;await setManuscript(project.id,'manuscript-a','archive',{},1);assert((await getPublishedEdition(project.id,owned.edition.id)).reader.sha256===digest,'archive does not regenerate delivered edition');
 const world=await publishEdition({projectId:project.id,writingScope:{kind:'world'},chapterIds:[main.id,a.id,b.id],title:'World edition',locale:'en',expectedRevision:1}).catch(error=>{throw Error('publish world: '+String(error));});
 const before=JSON.stringify(await db.writings.where('projectId').equals(project.id).toArray());let refused=false;try{await restorePublishedEdition({projectId:project.id,editionId:world.edition.id,expectedRevision:2});}catch{refused=true;}assert(refused&&JSON.stringify(await db.writings.where('projectId').equals(project.id).toArray())===before,'mixed world restore requires explicit destination without writes');
 const restored=await restorePublishedEdition({projectId:project.id,editionId:world.edition.id,targetManuscriptId:'manuscript-b',expectedRevision:2}).catch(error=>{throw Error('restore world into B: '+String(error));});assert(restored.writings.length===3&&restored.writings.every(row=>row.manuscriptId==='manuscript-b'&&! [main.id,a.id,b.id].includes(row.id)),'explicit mixed world restore creates new B drafts');
 const settings=await READER_HANDLERS.wh_reader_settings({projectId:project.id,manuscriptId:'manuscript-b'}) as {presentation:import('@/engines/writings/readerPresentationTypes').ReaderPresentation};
 const presentation={...settings.presentation,cover:{...settings.presentation.cover,color:'#123456',showAtStart:true}};
 await READER_HANDLERS.wh_reader_settings_save({projectId:project.id,manuscriptId:'manuscript-b',presentation,expectedRevision:settings.presentation.revision}).catch(error=>{throw Error('save B presentation: '+String(error));});
 const stored=await db.projects.get(project.id);assert(stored?.manuscriptCatalog?.entries.find(row=>row.id==='manuscript-b')?.reader?.cover.color==='#123456'&&stored.readerPresentation?.cover.color!=='#123456','B presentation does not overwrite principal cover');
 return['Registered world/list filters, captured A edition, explicit mixed-world restore, immutable artifact and B presentation all use normal native APIs'];
}
export async function testManuscriptTransactionalCreate(){
 const {project,main}=await manuscriptFixture('manuscript-tx-create');
 await db.transaction('rw',db.tables,async()=>{await createWriting({...main,id:project.id+'-one',manuscriptId:'manuscript-a'});await createWriting({...main,id:project.id+'-two',manuscriptId:'manuscript-b'});});
 assert(await db.writings.where('projectId').equals(project.id).count()===5,'normal nested creates committed together');
 return['Normal owned chapter creates compose in an existing native transaction'];
}
export async function testManuscriptCapturedTransactionalCreate(){
 const {capturePublicationSources,publicationReaderSource}=await import('@/services/publishedEditions/snapshot');const {project,main}=await manuscriptFixture('manuscript-captured-tx');
 await db.transaction('rw',db.tables,async tx=>{const snapshot=await capturePublicationSources(tx,{projectId:project.id});publicationReaderSource(snapshot);for(let i=0;i<3;i++)await createWriting({...main,id:project.id+'-'+i,manuscriptId:'manuscript-b'});});
 assert(await db.writings.where('projectId').equals(project.id).count()===6,'captured source followed by owned creates committed together');
 return['Owned chapter creation composes with a native captured source transaction'];
}
export async function testManuscriptLegacyEditionAffected(){
 const {testPublishedEditions}=await import('./published-editions.browser');try{return await testPublishedEditions();}catch(error){throw Error(`Legacy edition stage ${String((window as unknown as {__editionStage?:string}).__editionStage)}: ${String(error)}`);}
}

export async function testManuscriptSourceReadScope(){
 const {project,a,b}=await manuscriptFixture('manuscript-source-read');
 const source=(id:string,writingId:string)=>({id,projectId:project.id,name:id+'.txt',format:'txt',sha256:'a'.repeat(64),original:new Blob(['Own source '+id],{type:'text/plain'}),revision:1,receipts:[{id:id+'-receipt',writingIds:[writingId],planDigest:'b'.repeat(64),createdAt:1}],createdAt:1});
 await db.manuscriptSources.bulkPut([source('source-a',a.id),source('source-b',b.id)]);
 const all=await runBridgeTool('wh_manuscript_sources',{projectId:project.id}),onlyA=await runBridgeTool('wh_manuscript_sources',{projectId:project.id,manuscriptId:'manuscript-a'});
 assert(all.ok&&(all.result as unknown[]).length===2,'legacy source reads retain world scope');
 assert(onlyA.ok&&(onlyA.result as {id:string}[]).map(row=>row.id).join()==='source-a','optional source read filter isolates provenance of selected manuscript');
 const foreign=await runBridgeTool('wh_manuscript_source_export',{projectId:project.id,manuscriptId:'manuscript-b',sourceId:'source-a'});assert(!foreign.ok,'explicit B source export cannot silently export source owned only by A');
 const original=await runBridgeTool('wh_manuscript_source_export',{projectId:project.id,manuscriptId:'manuscript-a',sourceId:'source-a'});assert(original.ok&&typeof(original.result as {dataBase64:string}).dataBase64==='string','normal native source export still returns original bytes');
 return['Registered source reads retain legacy world default and optional manuscript provenance filter; source export honours the same context'];
}

export async function testManuscriptEraEditionRestore(){
 const {prepareEditionFixture}=await import('./published-editions.browser'),{project,writing,second}=await prepareEditionFixture('manuscript-era-edition-restore');
 const wrap=async<T,>(step:string,work:()=>Promise<T>)=>{try{return await work();}catch(error){throw Error(step+': '+String(error)+' '+(error instanceof Error?error.stack:''));}};
 const original=await wrap('publish original',()=>publishEdition({projectId:project.id,chapterIds:[second.id,writing.id],title:'Original edition',locale:'en',expectedRevision:0}));
 const inherited=await wrap('read inherited',()=>readWorldDocument({projectId:project.id,eraId:'past'},'writings',writing.id));
 await wrap('save past',()=>saveEraDocument({projectId:project.id,eraId:'past'},'writings',{root:{...writing,content:'<p>Past edition content</p>'},children:{writingSnapshots:[]}},inherited!.version));
 const edition=await wrap('publish past',()=>publishEdition({projectId:project.id,eraId:'past',chapterIds:[second.id,writing.id],title:'Past edition',locale:'en',expectedRevision:1}));
 const restored=await wrap('restore past',()=>restorePublishedEdition({projectId:project.id,editionId:original.edition.id,targetEraId:'past',expectedRevision:2}));
 assert(restored.writings.length===2&&edition.revision===2,'era restore creates two new drafts');
 await db.writings.bulkDelete([writing.id,second.id]);const {deleteLocalMedia}=await import('@/engines/media/operations');for(const media of await db.localMediaAssets.where('projectId').equals(project.id).toArray())await deleteLocalMedia(project.id,media.id);
 await wrap('restore Base after source removal',()=>restorePublishedEdition({projectId:project.id,editionId:original.edition.id,expectedRevision:2}));
 return['Native named-era publication and restore create new editable drafts and preserve Base'];
}

export async function testManuscriptEditionRollback(){
 const {project,a,b}=await manuscriptFixture('manuscript-edition-rollback');
 await db.projects.update(project.id,{worldEras:[{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1}]});
 const edition=await publishEdition({projectId:project.id,writingScope:{kind:'world'},chapterIds:[a.id,b.id],title:'Mixed source',locale:'en',expectedRevision:0});
 const state=async()=>JSON.stringify({project:await db.projects.get(project.id),rows:await db.writings.where('projectId').equals(project.id).toArray(),variants:await db.worldEraVariants.where('projectId').equals(project.id).toArray()});
 for(const eraId of [undefined,'past']){
  const before=await state(),table=eraId?db.worldEraVariants:db.writings;let count=0;
  const fail=()=>{if(++count===2)throw Error('Late edition restore failure');};
  table.hook('creating',fail);let rejected=false;try{await restorePublishedEdition({projectId:project.id,editionId:edition.edition.id,targetManuscriptId:'manuscript-b',targetEraId:eraId,expectedRevision:1});}catch{rejected=true;}finally{table.hook('creating').unsubscribe(fail);}
  assert(rejected&&count===2&&await state()===before,'late '+(eraId??'Base')+' failure rolls back every restored chapter and presentation');
 }
 return['Native Base and named-era edition restores roll back all drafts and presentation when the second create fails'];
}

export async function testWritingManuscripts(){
 const out:string[]=[];for(const run of [testManuscriptLegacyProfileScope,testManuscriptReaderScope,testManuscriptCatalogAndOwner,testManuscriptBookAndImport,testManuscriptPublicationAndBridge,testManuscriptTransactionalCreate,testManuscriptSourceReadScope,testManuscriptEraEditionRestore,testManuscriptEditionRollback,testManuscriptCreateUndoRace,testManuscriptCapturedOtherEraOwner,testManuscriptEraPresentation,testManuscriptWorkflowAtomicPromotion])out.push(...await run());return out;
}

export async function testManuscriptCreateUndoRace(){
 const {createWriting:genericCreate}=await import('@/db/operations');
 for(const {create,label} of [{create:createWriting,label:'engine'},{create:genericCreate,label:'generic'}]){
  const {project,main}=await manuscriptFixture('manuscript-create-undo-race-'+label),created=await setManuscript(project.id,'manuscript-race','create',{title:'Concurrent story'},1);
  let armed=true,undo:Promise<unknown>|undefined;
  const reading=(row:Project)=>{if(armed&&row.id===project.id){armed=false;queueMicrotask(()=>{undo=Dexie.ignoreTransaction(()=>undoManuscript(project.id,created.receipt)).catch(error=>error);});}return row;};
  db.projects.hook('reading').subscribe(reading);let failure:unknown;try{await create({...main,id:project.id+'-raced',manuscriptId:'manuscript-race'});}catch(error){failure=error;}finally{db.projects.hook('reading').unsubscribe(reading);}
  await undo;const stored=await db.writings.get(project.id+'-raced'),entry=(await db.projects.get(project.id))!.manuscriptCatalog!.entries.find(row=>row.id==='manuscript-race');
  assert(!stored||entry,'concurrent UndoCreate must never leave a chapter owned by a removed catalogue entry');
  assert(stored||failure,'a rejected create reports its failure');
 }
 return['Native engine and generic owned chapter creation serialize concurrent catalogue UndoCreate without orphaned membership'];
}

export async function testManuscriptCapturedOtherEraOwner(){
 const {project,a}=await manuscriptFixture('manuscript-captured-other-era');
 await db.writings.delete(a.id);await db.projects.update(project.id,{worldEras:['past','future'].map(id=>({id,name:id,description:'',revision:0,createdAt:1,updatedAt:1}))});
 const unset={...a};delete unset.manuscriptId;
 const variant=(eraId:string,root:Writing)=>({id:project.id+'-'+eraId,projectId:project.id,eraId,kind:'writings' as const,entityId:a.id,revision:1,updatedAt:1,document:{root:root as unknown as import('@/services/worldEras/types').EraRow,children:{writingSnapshots:[]}},history:[]});
 await db.worldEraVariants.bulkPut([variant('past',unset),variant('future',a)]);
 const {capturePublicationSnapshot,publicationReaderSource}=await import('@/services/publishedEditions/snapshot'),{preparePublishedEdition,commitPublishedEdition}=await import('@/services/publishedEditions/store');
 const scope={projectId:project.id,eraId:'past'},snapshot=await capturePublicationSnapshot(scope);
 db.close();try{assert(publicationReaderSource(snapshot).writings.find(row=>row.id===a.id)?.manuscriptId==='manuscript-a','captured owner from another era remains available without DB');}finally{await db.open();}
 const prepared=await preparePublishedEdition({...scope,writingScope:{kind:'manuscript',id:'manuscript-a'},chapterIds:[a.id],title:'Past A',locale:'en',expectedRevision:0});
 await db.worldEraVariants.put(variant('future',{...a,manuscriptId:'manuscript-b'}));
 let rejected=false;try{await commitPublishedEdition(prepared,0);}catch{rejected=true;}assert(rejected&&!(await db.projects.get(project.id))!.publishedEditions?.length,'captured owner context is rechecked atomically before publication');
 return['Captured owner resolves every era, remains usable with DB closed and participates in native publication source recheck'];
}

export async function testManuscriptLegacyBookAffected(){
 const tests=await import('./bookMode');await tests.testBookSaveAgainstDexie();await tests.testBookSaveShiftsChaptersOutsideTheRange();await tests.testBookUndoMergeKeepsOneRow();return['Existing Book save/shift/undo restore oracles pass with implicit main ownership'];
}

export async function testManuscriptLegacyEraAffected(){const {testWorldEras}=await import('./world-eras.browser');try{return await testWorldEras();}catch(error){throw Error('Legacy era stage '+String(Reflect.get(window,'__testStage'))+': '+String(error));}}
export async function testManuscriptLegacySharedAffected(){await import('@/engines');const {testSharedUniverse}=await import('./shared-universe');return[await testSharedUniverse()];}

export async function testManuscriptEraPresentation(){
 const {project}=await manuscriptFixture('manuscript-era-presentation');await db.projects.update(project.id,{worldEras:[{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1}]});
 const args={projectId:project.id,eraId:'past',manuscriptId:'manuscript-a'};
 const settings=await READER_HANDLERS.wh_reader_settings(args) as {presentation:import('@/engines/writings/readerPresentationTypes').ReaderPresentation};
 await READER_HANDLERS.wh_reader_settings_save({...args,presentation:{...settings.presentation,cover:{...settings.presentation.cover,color:'#345678'}},expectedRevision:settings.presentation.revision});
 const stored=(await db.projects.get(project.id))!,a=stored.manuscriptCatalog!.entries.find(row=>row.id==='manuscript-a')!;
 assert(a.eraCovers?.past?.color==='#345678'&&a.reader?.cover.color!=='#345678'&&stored.readerPresentation?.cover.color!=='#345678','native era cover edit isolates A/past from A/Base and principal');
 return['Native Reader settings save in named era retains separate manuscript era cover without changing Base or principal'];
}

export async function testManuscriptWorkflowAtomicPromotion(){
 const {project}=await manuscriptFixture('manuscript-workflow-atomic');await db.projects.update(project.id,{enabledEngines:['codex'],engineOrder:['codex']});
 const {createWritingWorkflow,saveWritingWorkflow,promoteWorkflowStep}=await import('@/services/writingWorkflows');
 const workflow=await createWritingWorkflow(project.id,'narrative','Atomic workflow','en');workflow.steps[0].output='Native workflow output';const saved=await saveWritingWorkflow(project.id,workflow);
 const state=async()=>JSON.stringify({project:await db.projects.get(project.id),rows:await db.writings.where('projectId').equals(project.id).toArray(),variants:await db.worldEraVariants.where('projectId').equals(project.id).toArray(),archives:await db.documentArchives.where('projectId').equals(project.id).toArray()}),before=await state();
 let injected=false;const fail=(changes:Record<string,unknown>,key:unknown)=>{if(key===project.id&&Object.keys(changes).some(key=>key.startsWith('writingWorkflows'))&&JSON.stringify(changes).includes('writingId')){injected=true;throw Error('Late workflow receipt failure');}};
 db.projects.hook('updating',fail);let rejected=false;try{await promoteWorkflowStep(project.id,saved.id,saved.steps[0].id);}catch{rejected=true;}finally{db.projects.hook('updating').unsubscribe(fail);}
 assert(rejected&&injected&&await state()===before,'late workflow export failure rolls back created writing, reachability flags, catalogue and workflow together');
 const ids=await Promise.all([promoteWorkflowStep(project.id,saved.id,saved.steps[0].id),promoteWorkflowStep(project.id,saved.id,saved.steps[0].id)]),row=await db.writings.get(ids[0]),stored=(await db.projects.get(project.id))!;
 assert(ids[0]===ids[1]&&await db.writings.where('projectId').equals(project.id).count()===4&&row?.manuscriptId===undefined,'concurrent normal workflow promotion creates exactly one main writing');
 assert(stored.enabledEngines.includes('writings')&&stored.engineOrder.includes('writings')&&stored.writingWorkflows![0].exports.length===1,'successful promotion commits reachable writing and one matching receipt');
 assert(JSON.stringify(stored.manuscriptCatalog)===JSON.stringify(project.manuscriptCatalog),'workflow promotion leaves independent catalogue owners unchanged');
 return['Native workflow promotion composes with owner validation: late export failure rolls back every write, concurrent retries create one reachable principal chapter and receipt'];
}
