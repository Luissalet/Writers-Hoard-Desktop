import {createRecordingLocalToolFocusMode,type LocalToolFocusMode} from './focusMode';
import {createLocalToolIcons,type LocalToolIconSvgResolver} from './icons';
import {createRecordingLocalToolContextMenu} from './contextMenus';
import {createRecordingLocalToolTutorial} from './tutorials';
import {createLocalToolLocaleSource} from './locales';
import type {LocalToolThemeSource} from './themes';
import {prepareAssetFile,assetFileInfo,type LocalAssetFile} from './assetFileFormat';
import {MAX_PROJECT_MEDIA_BYTES} from '../media/types';
import {createLocalAssetService,resolveAssetSource} from './assetSources';
import {readAssetInstallation,prepareAssetInstallation} from './assetState';
import {createLocalAudioEngine,silentLocalToolAudio,type LocalAudioBackend} from './audio';
export {createRecordingLocalToolAudio} from './audioTesting';
import {evaluateLocalToolIndex,queryLocalToolIndexRows,type LocalToolDocumentQuery} from './documentIndex';
import {validateSourceToolDocument,type SourceToolDocument} from './documents/types';
import {forkSourceToolConvergence} from './documents/portability';
import {createLocalToolStateActions,prepareLocalToolConvergenceBranch} from './stateRuntime';
import {localToolConvergenceContext} from './convergence/context';
import {convergenceCodecHash,convergenceHash,convergenceIdentityOf} from './convergence/format';
import {createLocalToolGenesis,forkLocalToolGenesis,inspectLocalToolConvergence,exportLocalToolConvergenceCheckpoint,prepareLocalToolActions,prepareLocalToolReceive,prepareLocalToolReplacement,prepareLocalToolReverse} from './convergence/replica';
import type {LocalToolConvergenceContract,LocalToolConvergencePreparation,LocalToolConvergenceReceipt,LocalToolConvergenceUpdate} from './convergence/types';
import {mergeLocalToolActions,type LocalToolStateAction} from './stateActions';
import {createLocalToolDefaults,readDefaultsState,prepareDefaultsSave} from './defaults';
import {createLocalToolReferences} from './references';
/** Author-facing memory host. Imports no DB, application registry, sockets or browser globals. */
import type {CodexEntry} from '@/types';
import type {CodexTemplate} from '@/engines/codex/templateTypes';
import {projectCodexEntry} from '@/engines/codex/properties';
import {eraDocumentKinds,type EraDocument,type EraDocumentKind,type WorldEraScope} from '@/services/worldEras/types';
import type {BridgeTool} from '@/services/aiBridge/schema';
import type {ContentSearchHit} from '@/services/projectSearchIndex';
import type {LocalMediaAsset} from '@/engines/media/types';
import {findRequiredMatch,foldSearchText,hasExcludedText,matchesFacets,parseSearchQuery,resolveEngineFilter,searchToday} from '@/services/searchQuery';
import {cloneLocalToolJson,validateLocalToolProjectStates,LocalToolStateError,type LocalToolJson} from './stateTypes';
import {projectLocalToolCodex,parseLocalToolState,readLocalToolState,prepareLocalToolSave,type LocalToolStateProject} from './clientContract';
import {runLocalToolOperation} from './execution';
import {localOperationInput} from './operationSchema';
import type {LocalToolClient,LocalToolDefinition,LocalToolWorldRead,LocalToolOpenDocumentOptions,LocalToolSnapshot} from './sdk';
export interface LocalToolFixtureProject extends LocalToolStateProject {codexTemplates?:CodexTemplate[];sourceToolDocuments?:SourceToolDocument[]}
export interface LocalToolDocumentFixture {projectId:string;eraId?:string;kind:EraDocumentKind;id:string;document?:EraDocument;hidden?:boolean;version?:string;revision?:number}
export interface LocalToolIndexFixture extends ContentSearchHit {eraId?:string;text?:string;tags?:string[];type?:string;status?:string;day?:string;hidden?:boolean}
export interface LocalToolMediaFixture {projectId:string;eraId?:string;asset:LocalMediaAsset}
export interface LocalToolReferencePathFixture extends WorldEraScope {kind:EraDocumentKind;id:string;path:string|null}
export interface LocalToolHostFixtures {referencePaths?:LocalToolReferencePathFixture[];projects:LocalToolFixtureProject[];documents?:LocalToolDocumentFixture[];index?:LocalToolIndexFixture[];media?:LocalToolMediaFixture[];assetFiles?:LocalAssetFile[];assetImages?:{projectId:string;id:string;title:string;blob:Blob}[]}
export interface LocalToolRecordedCommand {kind:'navigate'|'search'|'tool'|'media-import';scope:WorldEraScope;name?:string;args?:LocalToolJson;query?:string;documentKind?:EraDocumentKind;documentId?:string;placement?:'beside';filename?:string}
export interface LocalToolFakeTool<T extends LocalToolJson> {tool:BridgeTool;run:(args:Record<string,LocalToolJson>,client:LocalToolClient<T>)=>Promise<LocalToolJson>}
export interface LocalToolHostOverrides<T extends LocalToolJson> {
 focusMode?:LocalToolFocusMode;
 locale?:string;
 /** Explicit readonly host fixture; no application palette is loaded implicitly. */
 theme?:LocalToolThemeSource;
 /** Explicit SVG fixture/renderer port; never copied into JSON fixtures or loaded implicitly. */
 iconSvg?:LocalToolIconSvgResolver;
 audio?:LocalAudioBackend;
 tools?:readonly LocalToolFakeTool<T>[];
 /** Explicit app-path metadata only; resolving never records a navigation command. */
 referencePath?:(kind:EraDocumentKind,id:string,scope:WorldEraScope)=>Promise<string|null>;
 navigate?:(kind:EraDocumentKind,id:string,scope:WorldEraScope,options?:LocalToolOpenDocumentOptions)=>Promise<void>;
 search?:(query:string,limit:number,scope:WorldEraScope)=>Promise<ContentSearchHit[]>;
 importMedia?:(file:File,client:LocalToolClient<T>)=>Promise<LocalMediaAsset>;
}
let hostSequence=0;
interface Memory {projects:Map<string,LocalToolFixtureProject>;documents:Map<string,LocalToolDocumentFixture>;assetFiles:Map<string,LocalAssetFile>}
const key=(scope:WorldEraScope,kind:EraDocumentKind,id:string)=>JSON.stringify([scope.projectId,scope.eraId??null,kind,id]);
const sameScope=(a:WorldEraScope,b:WorldEraScope)=>a.projectId===b.projectId&&a.eraId===b.eraId;
/** Each fixture is an aggregate owned by one scope; versions are opaque fixture-only CAS tokens. */
export function createFakeLocalToolHost<T extends LocalToolJson>(definition:LocalToolDefinition<T>,fixtures:LocalToolHostFixtures,overrides:LocalToolHostOverrides<T>={}){
 let locale=overrides.locale??'en';const localeListeners=new Set<()=>void>();
 const localeSource=createLocalToolLocaleSource(definition.locales,()=>locale,changed=>{localeListeners.add(changed);return()=>{localeListeners.delete(changed);};});
 const audioEngine=overrides.audio?createLocalAudioEngine(overrides.audio):undefined;
 const hostIdentity=++hostSequence,hooks=new WeakMap<Memory,{commit:(()=>void)[];abort:(()=>void)[]}>();
 const listeners=new Set<{projectId:string;changed:()=>void}>();
 let version=0,memory:Memory={projects:new Map(),documents:new Map(),assetFiles:new Map((fixtures.assetFiles??[]).map(row=>[row.id,structuredClone(row)]))},queue:Promise<unknown>=Promise.resolve();
 const commands:LocalToolRecordedCommand[]=[],tools=overrides.tools??[],indexFixtures=structuredClone(fixtures.index??[]),mediaFixtures=structuredClone(fixtures.media??[]),referencePaths=structuredClone(fixtures.referencePaths??[]);
 for(const project of fixtures.projects){if(memory.projects.has(project.id))throw Error('fake_host_duplicate_project');validateLocalToolProjectStates(project);memory.projects.set(project.id,structuredClone(project));}
 const project=(scope:WorldEraScope,state:Memory)=>{const row=state.projects.get(scope.projectId);if(!row)throw new LocalToolStateError('missing-project');if(scope.eraId&&!row.worldEras?.some(era=>era.id===scope.eraId))throw Error('world_era_missing');return row;};
 const kind=(value:EraDocumentKind)=>{if(!eraDocumentKinds.includes(value))throw Error('world_document_kind_invalid');return value;};
 const validateDocument=(scope:WorldEraScope,id:string,document:EraDocument)=>{if(!document?.root||document.root.id!==id||!document.children||typeof document.children!=='object'||document.root.projectId!==undefined&&document.root.projectId!==scope.projectId||Object.values(document.children).some(rows=>!Array.isArray(rows)||rows.some(row=>!row||typeof row.id!=='string'||row.projectId!==undefined&&row.projectId!==scope.projectId)))throw Error('fake_host_invalid_document_fixture');};
 for(const fixture of fixtures.documents??[]){project(fixture,memory);kind(fixture.kind);if(!fixture.id||fixture.version!==undefined&&(typeof fixture.version!=='string'||!fixture.version)||fixture.revision!==undefined&&(!Number.isSafeInteger(fixture.revision)||fixture.revision<1))throw Error('fake_host_invalid_document_fixture');if(fixture.document)validateDocument(fixture,fixture.id,fixture.document);else if(!fixture.hidden||!fixture.eraId)throw Error('fake_host_invalid_document_fixture');const token=key(fixture,fixture.kind,fixture.id);if(memory.documents.has(token))throw Error('fake_host_duplicate_document');memory.documents.set(token,{...structuredClone(fixture),version:fixture.version??`fixture:${++version}`,...(fixture.eraId?{revision:fixture.revision??1}:{})});}
 for(const row of indexFixtures)project(row,memory);
 for(const row of mediaFixtures){project(row,memory);if(row.asset.projectId!==row.projectId)throw Error('fake_host_invalid_media_fixture');}
 const effective=(scope:WorldEraScope,documentKind:EraDocumentKind,state:Memory):LocalToolWorldRead[]=>{const owner=project(scope,state),rows=new Map<string,LocalToolDocumentFixture>();kind(documentKind);if(documentKind==='local-tool')for(const row of owner.sourceToolDocuments??[])rows.set(row.id,{projectId:scope.projectId,kind:documentKind,id:row.id,document:{root:row as unknown as EraDocument['root'],children:{}},version:`fixture-document:${row.revision}`});for(const row of state.documents.values())if(row.projectId===scope.projectId&&row.kind===documentKind&&!row.eraId)rows.set(row.id,row);if(scope.eraId)for(const row of state.documents.values())if(row.projectId===scope.projectId&&row.kind===documentKind&&row.eraId===scope.eraId)rows.set(row.id,row);return[...rows.values()].filter(row=>!row.hidden&&row.document).map(row=>{const document=structuredClone(row.document!),read:LocalToolWorldRead={document,version:row.version!,provenance:row.eraId?'variant':'base',variantRevision:row.eraId?row.revision??1:null};if(documentKind==='codex')read.projection={fields:projectCodexEntry(document.root as unknown as CodexEntry,owner.codexTemplates).fields};return read;});};
 const scopeSnapshot=(state:Memory,projectId:string)=>JSON.stringify([state.projects.get(projectId),[...state.documents.values()].filter(row=>row.projectId===projectId),[...state.assetFiles.values()].filter(row=>row.projectId===projectId).map(row=>assetFileInfo(row))]);
 const transaction=<R>(run:(draft:Memory)=>Promise<R>,projectId:string):Promise<R>=>{const task=queue.then(async()=>{const draft=structuredClone(memory),callbacks={commit:[] as (()=>void)[],abort:[] as (()=>void)[]};hooks.set(draft,callbacks);try{const result=await run(draft),changed=scopeSnapshot(memory,projectId)!==scopeSnapshot(draft,projectId);memory=draft;callbacks.commit.forEach(callback=>callback());hooks.delete(draft);if(changed)for(const listener of listeners)if(listener.projectId===projectId)queueMicrotask(()=>{if(listeners.has(listener))listener.changed();});return result;}catch(error){callbacks.abort.forEach(callback=>callback());hooks.delete(draft);throw error;}});queue=task.catch(()=>{});return task;};
 /** Document convergence uses the same pure engine and contract helper as the real host. */
 const documentRead=(scope:WorldEraScope,state:Memory,id:string)=>{
  const read=effective(scope,'local-tool',state).find(read=>read.document.root.id===id);
  if(!read||read.document.root.namespace!==definition.namespace)throw Error('source_tool_document_missing');
  const document=read.document.root as unknown as SourceToolDocument;validateSourceToolDocument(document);return{read,document};
 };
 const documentSnapshot=(scope:WorldEraScope,state:Memory,id:string,validate=true):LocalToolSnapshot<T>=>{
  const{read,document}=documentRead(scope,state,id),convergence=document.convergence;
  return{revision:document.revision,updatedAt:document.updatedAt,data:validate?parseLocalToolState(definition,document.data):cloneLocalToolJson(document.data) as T,provenance:read.provenance,document:{id:document.id,namespace:document.namespace,title:document.title,version:JSON.stringify([document.generation??document.createdAt,document.revision,document.updatedAt,read.version]),lineage:JSON.stringify([document.generation??document.createdAt,0])},...(convergence?{convergence:{...convergenceIdentityOf(convergence.checkpoint),...(convergence.conflict?{conflict:structuredClone(convergence.conflict)}:{})}}:{})};
 };
 const documentContract=(document:SourceToolDocument):LocalToolConvergenceContract<T>=>{
  const codec=definition.codec??document.codec,context=localToolConvergenceContext(definition,codec);if(!codec||!context)throw Error('local_tool_convergence_codec_required');
  return{namespace:definition.namespace,codec,...context,validateState:definition.validateState};
 };
 const documentContext=(scope:WorldEraScope,read:LocalToolWorldRead,original:SourceToolDocument)=>{
  if(!original.convergence)throw Error('local_tool_convergence_not_started');
  const contract=documentContract(original),stored=original.convergence.checkpoint,epochChanged=stored.validationId!==contract.validationId||stored.schemaEpoch!==contract.schemaEpoch||stored.codecHash!==convergenceCodecHash(contract.codec),inherited=!!scope.eraId&&read.provenance==='base';
  let document=original;
  if(epochChanged)document={...original,generation:crypto.randomUUID(),codec:structuredClone(contract.codec),convergence:{checkpoint:createLocalToolGenesis(original.data as T,contract)}};
  else if(inherited)document={...original,generation:crypto.randomUUID(),convergence:{checkpoint:forkLocalToolGenesis(original.data,contract)}};
  const checkpoint=document.convergence!.checkpoint,replicaOptions={authorId:JSON.stringify(['fixture',hostIdentity,scope.projectId,scope.eraId??null,document.id]),contract},view=inspectLocalToolConvergence(checkpoint,replicaOptions);
  if(convergenceHash(view.data)!==convergenceHash(document.data)||convergenceHash(view.conflict)!==convergenceHash(document.convergence!.conflict??null))throw Error('source_tool_convergence_projection_mismatch');
  return{document,checkpoint,replicaOptions,view,reset:epochChanged||inherited};
 };
 const saveDocument=(working:Memory,scope:WorldEraScope,id:string,next:SourceToolDocument,read:LocalToolWorldRead)=>{
  validateSourceToolDocument(next);
  if(scope.eraId)working.documents.set(key(scope,'local-tool',id),{...scope,kind:'local-tool',id,document:{root:next as unknown as EraDocument['root'],children:{}},version:`fixture:${++version}`,revision:(read.variantRevision??0)+1});
  else{const owner=project(scope,working);working.projects.set(scope.projectId,{...owner,sourceToolDocuments:[...(owner.sourceToolDocuments??[]).filter(row=>row.id!==id),next]});}
 };
 const touchDocument=(document:SourceToolDocument):SourceToolDocument=>({...document,revision:document.revision+1,updatedAt:Math.max(Date.now(),document.updatedAt+1)});
 const documentBaseline=(scope:WorldEraScope,working:Memory,id:string,baseline:LocalToolSnapshot<T>,strict:boolean)=>{
  const actual=documentSnapshot(scope,working,id);if(!baseline.document||baseline.document.id!==id||baseline.document.namespace!==definition.namespace||baseline.document.lineage!==actual.document!.lineage)throw Error('source_tool_document_lineage_conflict');
  if(baseline.revision===null||!Number.isSafeInteger(baseline.revision)||baseline.revision<0||baseline.revision>actual.revision!)throw Error('local_tool_actions_baseline_invalid');
  if(strict&&(baseline.revision!==actual.revision||baseline.document.version!==actual.document!.version))throw Error('conflict');return actual;
 };
 const memoryStart=(scope:WorldEraScope,working:Memory,id:string,baseline:LocalToolSnapshot<T>)=>{
  documentBaseline(scope,working,id,baseline,true);const{read,document}=documentRead(scope,working,id);
  if(document.convergence){const context=documentContext(scope,read,document);if(context.reset)saveDocument(working,scope,id,touchDocument(context.document),read);return{snapshot:documentSnapshot(scope,working,id),checkpoint:context.checkpoint,changed:context.reset};}
  const contract=documentContract(document),checkpoint=createLocalToolGenesis(document.data as T,contract);saveDocument(working,scope,id,{...touchDocument(document),generation:crypto.randomUUID(),codec:structuredClone(contract.codec),convergence:{checkpoint}},read);return{snapshot:documentSnapshot(scope,working,id),checkpoint,changed:true};
 };
 const memoryExport=(scope:WorldEraScope,state:Memory,id:string,options:{stateVectorBase64?:string}={})=>{
  const{document}=documentRead(scope,state,id),checkpoint=document.convergence?.checkpoint;if(!checkpoint)return{snapshot:documentSnapshot(scope,state,id,false),checkpoint:null,update:null};
  const exported=exportLocalToolConvergenceCheckpoint(checkpoint,options.stateVectorBase64);return{snapshot:documentSnapshot(scope,state,id,false),checkpoint,update:exported.update};
 };
 const memoryChange=(scope:WorldEraScope,working:Memory,id:string,operation:'apply'|'reverse'|'import',value:LocalToolSnapshot<T>|LocalToolConvergenceReceipt|LocalToolConvergenceUpdate,actions?:readonly LocalToolStateAction[])=>{
  const{read,document}=documentRead(scope,working,id),inherited=!!scope.eraId&&read.provenance==='base';
  if(operation==='apply'){
   documentBaseline(scope,working,id,value as LocalToolSnapshot<T>,false);
   mergeLocalToolActions(documentContract(document).codec,(value as LocalToolSnapshot<T>).data,document.data as T,actions!);
  }else if(inherited)throw Error(operation==='import'?'local_tool_convergence_era_start_required':'local_tool_convergence_receipt_unavailable');
  const context=documentContext(scope,read,document);if(operation==='reverse'&&context.reset)throw Error('local_tool_convergence_receipt_unavailable');
  const prepared:LocalToolConvergencePreparation<T>=operation==='apply'?prepareLocalToolActions(context.checkpoint,context.replicaOptions,actions!):operation==='reverse'?prepareLocalToolReverse(context.checkpoint,context.replicaOptions,value as LocalToolConvergenceReceipt):prepareLocalToolReceive(context.checkpoint,context.replicaOptions,value as LocalToolConvergenceUpdate);
  if(prepared.beforeFingerprint!==convergenceHash(context.checkpoint))throw Error('conflict');
  const convergence={checkpoint:prepared.checkpoint,...(prepared.conflict?{conflict:prepared.conflict}:{})};
  if(context.reset||prepared.changed||prepared.causalChanged||convergenceHash(context.document.convergence)!==convergenceHash(convergence))saveDocument(working,scope,id,{...touchDocument(context.document),data:prepared.data,convergence},read);
  return{snapshot:documentSnapshot(scope,working,id),changed:prepared.changed,causalChanged:context.reset||prepared.causalChanged,pending:prepared.pending,receipt:prepared.receipt};
 };
 const createClient=(scope:WorldEraScope,readOnly=false,draft?:Memory,documentId?:string):LocalToolClient<T>=>{
  const state=()=>draft??memory,writable=()=>{if(readOnly)throw Error('local_tool_query_is_read_only');},write=<R>(run:(working:Memory)=>Promise<R>)=>{writable();return draft?run(draft):transaction(run,scope.projectId);};
  const actionCodec=definition.codec;
  const actionIdentity=JSON.stringify(['fixture',hostIdentity,scope.projectId,scope.eraId??null,definition.namespace,actionCodec,documentId??null]);
  const base={locale:localeSource,...(overrides.theme?{theme:overrides.theme}:{}),projectId:scope.projectId,eraId:scope.eraId,documentId,namespace:definition.namespace,icons:createLocalToolIcons(overrides.iconSvg),
   subscribe:(changed:()=>void)=>{const listener={projectId:scope.projectId,changed};listeners.add(listener);return()=>{listeners.delete(listener);};},
   read:async()=>{if(documentId)return documentSnapshot(scope,state(),documentId);return readLocalToolState(project(scope,state()),definition,scope.eraId);},
   save:(data,expected,expectedDocumentVersion)=>write(async working=>{if(documentId){const read=effective(scope,'local-tool',working).find(read=>read.document.root.id===documentId),current=read?.document.root as unknown as SourceToolDocument|undefined;if(!current||current.namespace!==definition.namespace)throw Error('source_tool_document_missing');const observed=await createClient(scope,readOnly,working,documentId).read();if(current.revision!==expected||!expectedDocumentVersion||observed.document?.version!==expectedDocumentVersion)throw Error('conflict');if(current.convergence){
    const context=documentContext(scope,read!,current),prepared=prepareLocalToolReplacement(context.checkpoint,context.replicaOptions,data);
    if(prepared.beforeFingerprint!==convergenceHash(context.checkpoint))throw Error('conflict');
    const next={...touchDocument(context.document),data:prepared.data,convergence:{checkpoint:prepared.checkpoint,...(prepared.conflict?{conflict:prepared.conflict}:{})},codec:structuredClone(context.replicaOptions.contract.codec),...(definition.index?{index:structuredClone(definition.index)}:{})};if(!definition.index)delete next.index;saveDocument(working,scope,documentId,next,read!);
    if(context.reset||prepared.causalChanged){const callbacks=hooks.get(working);if(!callbacks)throw Error('fake_host_transaction_missing');prepareLocalToolConvergenceBranch(actionIdentity,observed,{receiptTransaction:callbacks,onCommit:callback=>callbacks.commit.push(callback),onAbort:callback=>callbacks.abort.push(callback)});}
    return documentSnapshot(scope,working,documentId);
   }const next={...current,data:parseLocalToolState(definition,data),revision:current.revision+1,updatedAt:Math.max(Date.now(),current.updatedAt+1),...(definition.codec?{codec:structuredClone(definition.codec)}:{}),...(definition.index?{index:structuredClone(definition.index)}:{})};if(!definition.index)delete next.index;validateSourceToolDocument(next);if(scope.eraId)working.documents.set(key(scope,'local-tool',documentId),{...scope,kind:'local-tool',id:documentId,document:{root:next as unknown as EraDocument['root'],children:{}},version:`fixture:${++version}`,revision:(read?.variantRevision??0)+1});else{const owner=project(scope,working);working.projects.set(scope.projectId,{...owner,sourceToolDocuments:[...(owner.sourceToolDocuments??[]).filter(row=>row.id!==documentId),next]});}return createClient(scope,readOnly,working,documentId).read();}const row=project(scope,working),prepared=prepareLocalToolSave(row,definition,data,expected,scope.eraId);working.projects.set(scope.projectId,prepared.project);return prepared.snapshot;}),
   ...(documentId?{convergence:Object.freeze({start:(baseline:LocalToolSnapshot<T>)=>write(async working=>memoryStart(scope,working,documentId,baseline)),export:async(options:{stateVectorBase64?:string}={})=>memoryExport(scope,state(),documentId,options),import:(update:LocalToolConvergenceUpdate)=>write(async working=>{const result=memoryChange(scope,working,documentId,'import',update);return{snapshot:result.snapshot,changed:result.changed,causalChanged:result.causalChanged,pending:result.pending};})})}:{}),
   queryCodex:async query=>projectLocalToolCodex(effective(scope,'codex',state()).map(row=>row.document.root as unknown as CodexEntry),project(scope,state()).codexTemplates,query),
   world:Object.freeze({list:async documentKind=>effective(scope,documentKind,state()),read:async(documentKind,id)=>effective(scope,documentKind,state()).find(row=>row.document.root.id===id),...(scope.eraId?{variants:Object.freeze({save:(documentKind:EraDocumentKind,document:EraDocument,expected:string|null)=>write(async working=>{project(scope,working);kind(documentKind);validateDocument(scope,document.root.id,document);const current=effective(scope,documentKind,working).find(row=>row.document.root.id===document.root.id);if((current?.version??null)!==expected)throw Error('world_era_conflict');let payload=document;
    if(documentKind==='local-tool'){
     const old=current?.document.root as unknown as SourceToolDocument|undefined,root=document.root as unknown as SourceToolDocument,convergence=root.convergence??old?.convergence;
     if(convergence){
      payload=structuredClone(document);const next=payload.root as unknown as SourceToolDocument;next.convergence=structuredClone(convergence);next.codec??=old?.codec;
      if(!old||current?.provenance==='base'||convergenceHash(next.data)!==convergenceHash(old.data)||convergenceHash(next.convergence)!==convergenceHash(old.convergence??null)||next.namespace!==old.namespace){next.convergence=forkSourceToolConvergence(next);next.generation=crypto.randomUUID();}
      validateSourceToolDocument(next);
     }
    }
    const fixture={...scope,kind:documentKind,id:document.root.id,document:structuredClone(payload),version:`fixture:${++version}`,revision:(working.documents.get(key(scope,documentKind,document.root.id))?.revision??0)+1};working.documents.set(key(scope,documentKind,fixture.id),fixture);return effective(scope,documentKind,working).find(row=>row.document.root.id===fixture.id)!;}),hide:(documentKind:EraDocumentKind,id:string,expected:string)=>write(async working=>{const current=effective(scope,documentKind,working).find(row=>row.document.root.id===id);if(!current||current.version!==expected)throw Error('world_era_conflict');working.documents.set(key(scope,documentKind,id),{...scope,kind:documentKind,id,hidden:true,version:`fixture:${++version}`,revision:(working.documents.get(key(scope,documentKind,id))?.revision??0)+1});})})}:{})}),
   queryDocuments:async(query:LocalToolDocumentQuery={})=>queryLocalToolIndexRows(effective(scope,'local-tool',state()).flatMap(read=>{const row=read.document.root as unknown as SourceToolDocument,index=row.namespace===definition.namespace?definition.index:row.index;return index?[{id:row.id,namespace:row.namespace,title:row.title,updatedAt:row.updatedAt,provenance:read.provenance,...evaluateLocalToolIndex(index,row.data)}]:[];}),query),
   tools:async()=>structuredClone(tools.map(item=>item.tool)),
   callTool:async(name,args={})=>{const handler=tools.find(item=>item.tool.name===name);if(!handler)throw Error('fake_host_tool_not_configured: '+name);if(handler.tool.writes)writable();const supplied={...args,projectId:scope.projectId,...(scope.eraId?{eraId:scope.eraId}:{})};delete supplied.eraId;if(scope.eraId)supplied.eraId=scope.eraId;const input=localOperationInput(handler.tool.schema,supplied);commands.push({kind:'tool',scope:{...scope},name,args:cloneLocalToolJson(input)});const run=async(working:Memory)=>cloneLocalToolJson(await handler.run(input,createClient(scope,readOnly,working,documentId)),Number.MAX_SAFE_INTEGER);return handler.tool.writes?write(run):run(state());},
   media:Object.freeze({list:async()=>{project(scope,state());const rows=new Map<string,LocalMediaAsset>();for(const fixture of mediaFixtures)if(fixture.projectId===scope.projectId&&!fixture.eraId)rows.set(fixture.asset.id,fixture.asset);if(scope.eraId)for(const fixture of mediaFixtures)if(sameScope(scope,fixture))rows.set(fixture.asset.id,fixture.asset);return structuredClone([...rows.values()]);},import:file=>write(async working=>{project(scope,working);commands.push({kind:'media-import',scope:{...scope},filename:file.name});if(!overrides.importMedia)throw Error('fake_host_media_import_not_configured');return overrides.importMedia(file,createClient(scope,false,working,documentId));})}),
   search:async(query,limit=20)=>{project(scope,state());commands.push({kind:'search',scope:{...scope},query});if(overrides.search)return overrides.search(query,limit,scope);if(typeof query!=='string'||!Number.isInteger(limit)||limit<1)throw Error('fake_host_invalid_search');const rows=new Map<string,LocalToolIndexFixture>();for(const row of indexFixtures)if(row.projectId===scope.projectId&&!row.eraId)rows.set(`${row.engineId}:${row.id}`,row);if(scope.eraId)for(const row of indexFixtures)if(sameScope(scope,row))rows.set(`${row.engineId}:${row.id}`,row);const parsed=parseSearchQuery(query),engines=resolveEngineFilter(parsed,[...new Set([...rows.values()].map(row=>row.engineId))].map(id=>({id,name:id})));return[...rows.values()].filter(row=>{const text=foldSearchText(`${row.title} ${row.text??row.snippet}`);return!row.hidden&&matchesFacets(parsed,{engineId:row.engineId,tags:(row.tags??[]).map(foldSearchText),type:foldSearchText(row.type??''),status:foldSearchText(row.status??''),day:row.day??''},engines,searchToday())&&!hasExcludedText(parsed,text)&&!!findRequiredMatch(parsed,text);}).slice(0,limit).map(({id,engineId,projectId,title,subtitle,snippet})=>({id,engineId,projectId,title,subtitle,snippet}));},
   openDocument:async(documentKind,id,options)=>{if(!effective(scope,documentKind,state()).some(row=>row.document.root.id===id))throw Error('world_document_missing');const beside=options?.placement==='beside';commands.push({kind:'navigate',scope:{...scope},documentKind,documentId:id,...(beside?{placement:'beside' as const}:{})});if(beside)await overrides.navigate?.(documentKind,id,scope,{placement:'beside'});else await overrides.navigate?.(documentKind,id,scope);},
  } satisfies Omit<LocalToolClient<T>,'refs'|'state'|'assets'>;
  const audio=audioEngine?.createOwner({current:()=>!draft||hooks.has(draft),resolve:async ref=>{if(ref.kind==='source'){const result=await assets.resolve(ref);return result?.kind==='audio'?{blob:result.blob,version:result.version}:null;}const asset=(await base.media.list()).find(row=>row.id===ref.id&&row.kind==='audio');return asset?{blob:asset.blob,version:JSON.stringify([asset.id,asset.updatedAt,asset.size])}:null;}})??silentLocalToolAudio();
  if(draft){const callbacks=hooks.get(draft);callbacks?.commit.push(()=>audio.dispose());callbacks?.abort.push(()=>audio.dispose());}
  const assets=createLocalAssetService({current:async()=>{project(scope,state());return definition;},source:ref=>resolveAssetSource(definition,undefined,ref),import:async(file,kind)=>{writable();const prepared=await prepareAssetFile(file,kind,scope.projectId);return write(async working=>{project(scope,working);const rows=[...working.assetFiles.values()].filter(row=>row.projectId===scope.projectId),old=rows.find(row=>row.kind===kind&&row.sha256===prepared.sha256&&row.mime===prepared.mime);if(old)return assetFileInfo(old);if(rows.reduce((sum,row)=>sum+row.size,0)+prepared.size>MAX_PROJECT_MEDIA_BYTES)throw Error('local_asset_capacity');working.assetFiles.set(prepared.id,prepared);return assetFileInfo(prepared);});},user:async ref=>{if(ref.kind==='file'){const row=state().assetFiles.get(ref.id);return row?.projectId===scope.projectId?{blob:row.blob,kind:row.kind,mime:row.mime,version:JSON.stringify([row.id,row.sha256]),ref,origin:'document',slot:''}:null;}if(ref.kind==='image'){const image=fixtures.assetImages?.find(image=>image.projectId===scope.projectId&&image.id===ref.id);return image?{blob:image.blob,kind:'image',mime:image.blob.type,version:image.id,ref,origin:'document',slot:''}:null;}const media=(await base.media.list()).find(row=>row.id===ref.id);return media?{blob:media.blob,kind:media.kind,mime:media.mime,version:JSON.stringify([media.id,media.updatedAt]),ref,origin:'document',slot:''}:null;},choices:async kind=>kind==='font'||kind==='data'?[...state().assetFiles.values()].filter(row=>row.projectId===scope.projectId&&row.kind===kind).map(row=>({ref:{kind:'file' as const,id:row.id},title:row.title})):kind==='image'?(fixtures.assetImages??[]).filter(row=>row.projectId===scope.projectId).map(row=>({ref:{kind:'image' as const,id:row.id},title:row.title})):(await base.media.list()).filter(row=>row.kind===kind).map(row=>({ref:{kind:'media' as const,id:row.id},title:row.title})),read:async()=>readAssetInstallation(project(scope,state()),definition.namespace,scope.eraId,undefined,definition.assets),save:(slot,ref,version)=>write(async working=>{const row=project(scope,working),prepared=prepareAssetInstallation(row,definition.namespace,slot,ref,version,scope.eraId,undefined,definition.assets?.[slot]?.aliases);working.projects.set(scope.projectId,prepared.project);return readAssetInstallation(prepared.project,definition.namespace,scope.eraId,undefined,definition.assets);})});
  const client:LocalToolClient<T>={...base,audio,assets,refs:createLocalToolReferences(base,async reference=>{const read=await base.world.read(reference.kind,reference.documentId),path=read?(overrides.referencePath?await overrides.referencePath(reference.kind,reference.documentId,{...scope}):referencePaths.find(row=>sameScope(scope,row)&&row.kind===reference.kind&&row.id===reference.documentId)?.path??null):null;return{read,path};}),...(actionCodec?{state:createLocalToolStateActions<T>(actionCodec,actionIdentity,run=>write(async working=>{const callbacks=hooks.get(working);if(!callbacks)throw Error('fake_host_transaction_missing');return run({receiptTransaction:callbacks,client:createClient(scope,readOnly,working,documentId),...(documentId?{convergence:{apply:async(baseline,actions)=>memoryChange(scope,working,documentId,'apply',baseline,actions),reverse:async receipt=>memoryChange(scope,working,documentId,'reverse',receipt)}}:{}),onCommit:callback=>callbacks.commit.push(callback),onAbort:callback=>callbacks.abort.push(callback)});}))}:{})};
  const defaultsCurrent=()=>{if(draft&&!hooks.has(draft))throw Error('local_tool_context_expired');};
  const defaults=createLocalToolDefaults(client,{receiptScope:JSON.stringify(['fixture',hostIdentity]),read:async()=>{defaultsCurrent();return readDefaultsState(project(scope,state()));},atomic:run=>{
   defaultsCurrent();return write(async working=>{
    const callbacks=hooks.get(working);if(!callbacks)throw Error('fake_host_transaction_missing');
    const current=()=>{if(!hooks.has(working))throw Error('local_tool_context_expired');};
    const result=await run({read:async()=>{current();return readDefaultsState(project(scope,working));},save:async(data,expectedRevision)=>{
     writable();current();const prepared=prepareDefaultsSave(project(scope,working),data,expectedRevision);working.projects.set(scope.projectId,prepared.project);return prepared.snapshot;
    },onCommit:callback=>callbacks.commit.push(callback),onAbort:callback=>callbacks.abort.push(callback)});
    current();return result;
   });
  }});
  return Object.freeze({...client,defaults});
 };
 const tutorial=createRecordingLocalToolTutorial(definition.tours),contextMenu=createRecordingLocalToolContextMenu(),focus=createRecordingLocalToolFocusMode();
 return Object.freeze({focusMode:overrides.focusMode??focus.port,focusModeCommands:focus.commands,contextMenu:contextMenu.port,contextMenuRequests:contextMenu.requests,tutorial:tutorial.port,tutorialCommands:tutorial.commands,commands,setLocale:(code:string)=>{if(locale===code)return;locale=code;for(const changed of localeListeners)changed();},createClient:(scope:WorldEraScope,readOnly=false,documentId?:string)=>{project(scope,memory);return createClient({...scope},readOnly,undefined,documentId);},inspect:()=>structuredClone({projects:[...memory.projects.values()],documents:[...memory.documents.values()],assetFiles:[...memory.assetFiles.values()]}),runOperation:(scope:WorldEraScope,operationId:string,input:unknown={},writes=false,documentId?:string)=>runLocalToolOperation(definition,operationId,input,writes,createClient(scope,!writes,undefined,documentId),run=>transaction(draft=>run(createClient(scope,false,draft,documentId)),scope.projectId))});
}
