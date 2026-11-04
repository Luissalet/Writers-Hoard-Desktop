import {requireLocalImageActions} from './assetSources';
import {convergenceClone,convergenceIdentity,convergenceIdentityOf} from './convergence/format';
import {createRuntimeLocalToolIcons} from './iconSvgRuntime';
import {appearanceFromProject} from '@/services/workspaceAppearance/store';
import {resolveWorkspaceTheme} from '@/services/workspaceAppearance/resolvedTheme';
import {useLocaleStore} from '@/stores/localeStore';
import {createLocalToolLocaleSource} from './locales';
import {createBrowserLocalToolAssets} from './assetBrowser';
import {createBrowserLocalToolAudio} from './audioBrowser';
import {queryLocalToolDocuments} from './queryDocuments';
import {createBrowserLocalToolOpenDocuments} from './queryOpenDocuments';
import {readSourceToolState,saveSourceToolState,readSourceToolDocument} from './documents/store';
import {startSourceToolConvergence,adoptSourceToolConvergence,exportSourceToolConvergence,importSourceToolConvergence,applySourceToolConvergence,reverseSourceToolConvergence,readSourceToolPlainRange,readSourceToolRichCapture,readSourceToolRichPoint} from './documents/convergence';
import {localToolConvergenceContext} from './convergence/context';
import type {LocalToolDocumentConvergence} from './convergence/clientTypes';
import {createLocalToolStateActions,prepareLocalToolConvergenceBranch,prepareLocalToolStateAdoption} from './stateRuntime';
import {createLocalToolDefaults,readDefaultsState,prepareDefaultsSave} from './defaults';
import {createLocalToolReferences,type LocalToolReferenceDestination} from './references';
import Dexie,{type Transaction} from 'dexie';
import {db} from '@/db';
import {notifyProjectsChanged} from '@/db/operations';
import {onDataChanged,notifyDataChanged} from '@/engines/_shared/dataChanged';
import {getEraProject,hideEraDocument,listEraRows,listWorldDocuments,readWorldDocument,saveEraDocument} from '@/services/worldEras/store';
import {eraDocumentKinds,type EraDocument,type EraDocumentRead,type EraDocumentKind} from '@/services/worldEras/types';
import {projectCodexEntry} from '@/engines/codex/properties';
import type {CodexEntry} from '@/types';
import {localToolNamespace,LocalToolStateError,type LocalToolJson} from './stateTypes';
import {readLocalToolState,prepareLocalToolSave,projectLocalToolCodex} from './clientContract';
import type {LocalToolClient,LocalToolCodexQuery,LocalToolDefinition,LocalToolOpenDocumentOptions} from './sdk';
export interface LocalToolClientOptions{/** Host-owned publication token captured before a normal Save. */capturePublishedFields?:()=>()=>void;/** Editable Owned host port only; world/media/query facilities remain readonly. */assetImportWritable?:()=>boolean;assetDefaultsWritable?:()=>boolean;/** Injectable silent backend coordinator for host contract tests. */audioEngine?:ReturnType<typeof import('./audio').createLocalAudioEngine>;documentId?:string;eraId?:string;navigate?:(path:string)=>void;openBeside?:(path:string)=>void;readOnly?:boolean;releaseHash?:string|null;requireSelectedRelease?:boolean;/** Optional live host lease; never persisted or used by headless/native clients. */isCurrent?:()=>boolean}
function announce(projectId:string){const emit=()=>Dexie.ignoreTransaction(()=>{notifyProjectsChanged();notifyDataChanged({source:'other',projectId});});let transaction=Dexie.currentTransaction;if(!transaction){emit();return;}while(transaction.parent)transaction=transaction.parent;transaction.on('complete',emit);}
export function createLocalToolClient<T extends LocalToolJson>(projectId:string,definition:LocalToolDefinition<T>,options:LocalToolClientOptions={}):LocalToolClient<T>{
 if(typeof projectId!=='string'||!projectId||projectId.length>500||Array.from(projectId).some(character=>character.charCodeAt(0)<32))throw new LocalToolStateError('missing-project');
 if(!localToolNamespace(definition.namespace))throw new LocalToolStateError('invalid-namespace');
 const namespace=definition.namespace,scope={projectId,eraId:options.eraId};
 const convergenceAuthorId='writer-session-'+crypto.randomUUID();
 const convergenceOptionsFor=async()=>{const codec=definition.codec??(options.documentId?(await readSourceToolDocument(scope,options.documentId,namespace))?.document.codec:undefined),context=localToolConvergenceContext(definition,codec);return context?{...context,authorId:convergenceAuthorId}:undefined;};
 const current=()=>{if(options.isCurrent&&!options.isCurrent())throw Error('local_tool_context_expired');};
 const writable=()=>{current();if(options.readOnly)throw new Error('local_tool_query_is_read_only');};
 const importWritable=()=>{current();if(options.readOnly&&!options.assetImportWritable?.())throw new Error('local_tool_query_is_read_only');};
 const kind=(value:EraDocumentKind)=>{if(!eraDocumentKinds.includes(value))throw new Error('world_document_kind_invalid');return value;};
 const project=async()=>{current();const row=await db.projects.get(projectId);current();if(!row)throw new LocalToolStateError('missing-project');if(scope.eraId&&!row.worldEras?.some(era=>era.id===scope.eraId))throw Error('world_era_missing');if(options.requireSelectedRelease&&(row.localToolInstallations?.[namespace]?.contentHash??null)!==(options.releaseHash??null))throw Error('local_tool_pin_conflict');return row;};
 const projected=async(documentKind:EraDocumentKind,read:EraDocumentRead)=>documentKind==='codex'?{...read,projection:{fields:projectCodexEntry(read.document.root as unknown as CodexEntry,(await getEraProject(scope)).codexTemplates).fields}}:read;
 const assets=createBrowserLocalToolAssets(scope,definition,project,()=>{current();if(options.readOnly&&!options.assetDefaultsWritable?.())throw Error('local_tool_query_is_read_only');},importWritable);
 const audio=createBrowserLocalToolAudio(scope,project,()=>{try{current();return true;}catch{return false;}},options.audioEngine,ref=>ref.kind==='source'&&!ref.releaseHash?assets.slot(ref.slot):assets.resolve(ref));
 const locale=createLocalToolLocaleSource(definition.locales,()=>useLocaleStore.getState().locale,changed=>useLocaleStore.subscribe((next,previous)=>{if(next.locale!==previous.locale)changed();}));
 // One destination resolver serves both opening and opt-in reference inspection.
 // Adapters receive only a synchronous local collector, never a navigation port.
 const destination=async(documentKind:EraDocumentKind,id:string,inspect=false):Promise<LocalToolReferenceDestination>=>{
  const check=()=>{if(inspect)current();};check();
  const read=await readWorldDocument(scope,kind(documentKind),id);check();
  if(!read)return{read:undefined,path:null};
  const {getAnchorAdapter}=await import('@/engines/_shared/anchoring');check();
  let path:string|null=null;
  const collect=(value:string)=>{if(scope.eraId){const [pathname,search='']=value.split('?'),query=new URLSearchParams(search);query.set('era',scope.eraId);value=pathname+'?'+query;}path=value;};
  if(documentKind==='local-tool'){
   const source=await readSourceToolDocument(scope,id);check();if(!source)throw Error('source_tool_document_missing');
   const query=new URLSearchParams({document:id});collect(`/project/${encodeURIComponent(projectId)}/local-tool-${source.document.namespace}?${query}`);
  }else if(documentKind==='worldgen'){
   const {resolveWorldgenRoute}=await import('@/engines/worldgen/navigation');check();const route=await resolveWorldgenRoute(projectId,id,scope.eraId);check();
   if(!route)throw new Error('world_document_missing');collect(route);
  }else{
   const adapter=getAnchorAdapter(documentKind);
   if(adapter)adapter.navigateToEntity(id,projectId,collect);
   else{const {toolDocumentPath,toolKind}=await import('@/components/editor/toolBlocks/model');check();const targetKind=toolKind(documentKind==='genealogy'?'relation-tree':documentKind);collect(targetKind?toolDocumentPath({projectId,kind:targetKind,documentId:id,label:''}):`/project/${encodeURIComponent(projectId)}/${documentKind}?entity=${encodeURIComponent(id)}`);}
  }
  check();return{read,path};
 };
 const base={projectId,namespace,eraId:scope.eraId,documentId:options.documentId,audio,assets,locale,icons:createRuntimeLocalToolIcons(),
  subscribe:(changed:()=>void)=>{
   let active=true,pending:ReturnType<typeof setTimeout>|undefined;
   const schedule=()=>{if(!active||pending!==undefined)return;pending=setTimeout(()=>{pending=undefined;if(active)changed();},0);};
   const stop=onDataChanged(detail=>{if(!detail.projectId||detail.projectId===projectId)schedule();});
   const committed=(parts:Record<string,unknown>)=>{if(Object.keys(parts).some(part=>part.startsWith(`idb://${db.name}/`)))schedule();};
   Dexie.on('storagemutated',committed);
   return()=>{active=false;stop();Dexie.on.storagemutated.unsubscribe(committed);if(pending!==undefined)clearTimeout(pending);};
  },
  async read(){const row=await project();return options.documentId?readSourceToolState(scope,options.documentId,definition):readLocalToolState(row,definition,scope.eraId);},
  async save(data:T,expectedRevision:number|null,expectedDocumentVersion?:string){
   writable();const retirePublication=options.capturePublishedFields?.();if(options.documentId)return db.transaction('rw',db.tables,async tx=>{
    const row=await project();writable();const convergenceOptions=await convergenceOptionsFor();let authorChanged=false;
    const saved=await saveSourceToolState(scope,options.documentId!,definition,data,expectedRevision,expectedDocumentVersion,convergenceOptions?{...convergenceOptions,onPrepared:changed=>{authorChanged=changed;}}:undefined);writable();
    if(saved.convergence&&authorChanged){let outer:Transaction=tx;while(outer.parent)outer=outer.parent;
     prepareLocalToolConvergenceBranch(JSON.stringify([projectId,scope.eraId??null,namespace,row.localToolInstallations?.[namespace]?.contentHash??null,definition.codec,options.documentId??null]),saved,{receiptTransaction:outer,onCommit:callback=>outer.on('complete',()=>Dexie.ignoreTransaction(callback)),onAbort:callback=>outer.on('abort',()=>Dexie.ignoreTransaction(callback))});
    }
    if(retirePublication){let outer:Transaction=tx;while(outer.parent)outer=outer.parent;outer.on('complete',()=>Dexie.ignoreTransaction(retirePublication));}
    return saved;
   });
   const snapshot=await db.transaction('rw',db.projects,async()=>{const row=await project(),prepared=prepareLocalToolSave(row,definition,data,expectedRevision,scope.eraId);writable();await db.projects.update(projectId,prepared.changes);writable();return prepared.snapshot;});announce(projectId);return snapshot;
  },
  async queryCodex(query:LocalToolCodexQuery={}){await project();const effective=await getEraProject(scope);return projectLocalToolCodex(await listEraRows<CodexEntry>(scope,'codexEntries'),effective.codexTemplates,query);},
  world:Object.freeze({list:async(documentKind:EraDocumentKind)=>Promise.all((await listWorldDocuments(scope,kind(documentKind))).map(read=>projected(documentKind,read))),read:async(documentKind:EraDocumentKind,id:string)=>{const read=await readWorldDocument(scope,kind(documentKind),id);return read?projected(documentKind,read):undefined;},...(scope.eraId?{variants:Object.freeze({save:(documentKind:EraDocumentKind,document:EraDocument,expectedVersion:string|null)=>{writable();return saveEraDocument(scope,kind(documentKind),document,expectedVersion);},hide:(documentKind:EraDocumentKind,id:string,expectedVersion:string)=>{writable();return hideEraDocument(scope,kind(documentKind),id,expectedVersion);}})}:{})}),
  media:Object.freeze({async list(){const {mediaRows}=await import('@/engines/media/scope');return mediaRows(projectId,scope.eraId);},async import(file:File){writable();const {importLocalMedia}=await import('@/engines/media/operations');writable();return importLocalMedia(projectId,file,scope.eraId);}}),
  async search(query:string,limit?:number){await project();const {searchProjectContent}=await import('@/services/projectSearchIndex');return searchProjectContent(query,projectId,limit,scope.eraId);},
  async queryDocuments(query:import('./documentIndex').LocalToolDocumentQuery={}){await project();const rows=await queryLocalToolDocuments(scope,query);current();return rows;},
  async tools(){const {BRIDGE_TOOLS}=await import('@/services/aiBridge/manifest');return structuredClone(BRIDGE_TOOLS);},
  async callTool(name:string,args:Record<string,LocalToolJson>={}){const {getBridgeTool}=await import('@/services/aiBridge/manifest'),tool=getBridgeTool(name);if(!tool)throw new Error('unknown_tool');current();if(tool.writes)writable();if(scope.eraId&&tool.writes&&!Object.hasOwn(tool.schema.properties,'eraId')&&!['wh_enable_engine','wh_local_tool_pin'].includes(name))throw new Error('tool_does_not_support_era');const {applyProjectScope,validateToolArgs}=await import('@/services/aiRuntime/toolPolicy');const validated=validateToolArgs(tool.schema,{...args,projectId,eraId:scope.eraId});if(!validated.ok)throw new Error(validated.error);const pinned=applyProjectScope(tool,validated.args,{origin:'copilot',projectId});if(!pinned.ok)throw new Error(pinned.error);const {runBridgeTool}=await import('@/services/aiBridge/dispatch');current();if(tool.writes)writable();const reply=await runBridgeTool(name,{...pinned.args,...(scope.eraId?{eraId:scope.eraId}:{})});if(!reply.ok)throw new Error(reply.error);return JSON.parse(JSON.stringify(reply.result)??'null')as LocalToolJson;},
  async openDocument(documentKind:EraDocumentKind,id:string,openOptions?:LocalToolOpenDocumentOptions){current();const resolved=await destination(documentKind,id);if(!resolved.read)throw new Error('world_document_missing');if(resolved.path!==null){current();const {navigateTo}=await import('@/engines/_shared/anchoring');current();(openOptions?.placement==='beside'&&options.openBeside?options.openBeside:options.navigate??navigateTo)(resolved.path);}},
 } satisfies Omit<LocalToolClient<T>,'refs'|'state'|'openDocuments'>;
 const openDocuments=createBrowserLocalToolOpenDocuments(scope,{validate:project,current,subscribe:base.subscribe});
 const theme=Object.freeze({get:async()=>{const row=await project(),appearance=appearanceFromProject(row,scope);current();return Object.freeze({...scope,...resolveWorkspaceTheme(appearance.effective)});},subscribe:base.subscribe});
 const richCapture=async(request:import('./convergence/richTypes').RichCaptureRequest)=>{await project();const convergenceOptions=await convergenceOptionsFor();if(!convergenceOptions)throw Error('local_tool_convergence_codec_required');const result=await readSourceToolRichCapture(scope,options.documentId!,definition,request,convergenceOptions);current();return result;};
 const convergence:LocalToolDocumentConvergence<T>|undefined=options.documentId?Object.freeze({
  richImageCapture:async(field:string,nodeId:string,channel:import('./convergence/imageFormat').RichImageChannel)=>{const r=await richCapture({kind:'image',field,nodeId,channel});return{snapshot:r.snapshot,capture:r.capture as import('./convergence/imageFormat').RichImageCapture};},
  richTableColumnWidthCapture:async(field:string,tableId:string,columnId:string)=>{const r=await richCapture({kind:'table-column-width',field,tableId,columnId});return{snapshot:r.snapshot,capture:r.capture as import('./convergence/tableAxesEditing').RichTableColumnWidthCapture};},
  richTableAxisCapture:async(field:string,tableId:string,axis:import('./convergence/tableAxesFormat').RichTableAxis,afterId:string|null)=>{const r=await richCapture({kind:'table-axis',field,tableId,axis,afterId});return{snapshot:r.snapshot,capture:r.capture as import('./convergence/tableAxesEditing').RichTableAxisCapture};},
  richTableCellCapture:async(field:string,tableId:string,rowId:string,columnId:string,afterId:string|null=null)=>{const r=await richCapture({kind:'table-cell',field,tableId,rowId,columnId,afterId});return{snapshot:r.snapshot,capture:r.capture as import('./convergence/tableAxesEditing').RichTableCellCapture};},
  richBlockEmptyItemCapture:async(field:string,nodeId:string)=>{const r=await richCapture({kind:'block-empty-item',field,nodeId});return{snapshot:r.snapshot,capture:r.capture as import('./convergence/blockExit').RichBlockEmptyItemCapture};},
  richBlockSplitCapture:async(field:string,nodeId:string,at:number)=>{const r=await richCapture({kind:'block-split',field,nodeId,at});return{snapshot:r.snapshot,capture:r.capture as import('./convergence/blockText').RichBlockSplitCapture};},
  richBlockJoinCapture:async(field:string,leftNodeId:string,rightNodeId:string)=>{const r=await richCapture({kind:'block-join',field,leftNodeId,rightNodeId});return{snapshot:r.snapshot,capture:r.capture as import('./convergence/blockText').RichBlockJoinCapture};},
  richBlockEditCapture:async(field:string,nodeIds:string[],destination?:import('./convergence/blockTypes').RichBlockPlacement)=>{const r=await richCapture({kind:'block-edit',field,nodeIds,...(destination?{destination}:{})});return{snapshot:r.snapshot,capture:r.capture as import('./convergence/blockEditingTypes').RichBlockEditCapture};},
  richBlockCapture:async(field:string,options:{nodeIds:string[]})=>{const r=await richCapture({kind:'blocks',field,nodeIds:options.nodeIds});return{snapshot:r.snapshot,capture:r.capture as import('./convergence/blockTypes').RichBlockCapture};},
  richBlockMoveCapture:async(field:string,nodeId:string,destination:import('./convergence/blockTypes').RichBlockPlacement)=>{const r=await richCapture({kind:'block-move',field,nodeId,destination});return{snapshot:r.snapshot,capture:r.capture as import('./convergence/blockTypes').RichBlockMoveCapture};},
  richRange:async(field:string,nodeId:string,from:number,to:number,options?:{affinity:'left'|'right'})=>{const r=await richCapture({kind:'range',field,nodeId,from,to,...options});return{snapshot:r.snapshot,range:r.capture as import('./convergence/richTypes').RichRange};},
  resolveRichPoint:async(point:import('./convergence/richTypes').RichRange)=>{await project();const opts=await convergenceOptionsFor();if(!opts)throw Error('local_tool_convergence_codec_required');const result=await readSourceToolRichPoint(scope,options.documentId!,definition,point,opts);current();return result;},
  richSplitCapture:async(field:string,nodeId:string,at:number,options?:{affinity:'left'|'right'})=>{const r=await richCapture({kind:'split',field,nodeId,at,...options});return{snapshot:r.snapshot,capture:r.capture as import('./convergence/richTypes').RichSplitCapture};},
  richJoinCapture:async(field:string,leftNodeId:string,rightNodeId:string)=>{const r=await richCapture({kind:'join',field,leftNodeId,rightNodeId});return{snapshot:r.snapshot,capture:r.capture as import('./convergence/richTypes').RichJoinCapture};},
  textRange:async(field:string,from:number,to:number)=>{await project();const convergenceOptions=await convergenceOptionsFor();if(!convergenceOptions)throw Error('local_tool_convergence_codec_required');const result=await readSourceToolPlainRange(scope,options.documentId!,definition,field,from,to,convergenceOptions);current();return result;},
  start:async (baseline:import('./sdk').LocalToolSnapshot<T>)=>{writable();return db.transaction('rw',db.tables,async()=>{await project();writable();const convergenceOptions=await convergenceOptionsFor();if(!convergenceOptions)throw Error('local_tool_convergence_codec_required');const result=await startSourceToolConvergence(scope,options.documentId!,definition,baseline,convergenceOptions);writable();if(!result.checkpoint)throw Error('local_tool_convergence_checkpoint_missing');return{snapshot:result.snapshot,checkpoint:result.checkpoint,changed:result.causalChanged};});},
  adopt:async (baseline:import('./sdk').LocalToolSnapshot<T>,full?:import('./convergence/types').LocalToolConvergenceUpdate)=>{writable();const capturedBaseline=convergenceClone(baseline),capturedFull=full===undefined?undefined:convergenceClone(full);return db.transaction('rw',db.tables,async tx=>{await project();writable();const convergenceOptions=await convergenceOptionsFor();if(!convergenceOptions)throw Error('local_tool_convergence_codec_required');const result=await adoptSourceToolConvergence(scope,options.documentId!,definition,capturedBaseline,convergenceOptions,capturedFull);writable();if(!result.checkpoint)throw Error('local_tool_convergence_checkpoint_missing');const receipts=continueReceipts(result.checkpoint,result.pending,tx);return{snapshot:result.snapshot,checkpoint:result.checkpoint,changed:result.causalChanged,pending:result.pending,...(receipts.length?{receipts}:{})};});},
  export:async (exportOptions?:{stateVectorBase64?:string})=>{await project();const result=await exportSourceToolConvergence(scope,options.documentId!,definition,exportOptions);current();return{snapshot:result.snapshot,checkpoint:result.checkpoint,update:result.update,pending:result.pending};},
  import:async (update:import('./convergence/types').LocalToolConvergenceUpdate,guard?:import('./convergence/clientTypes').LocalToolConvergenceImportOptions)=>{writable();const captured=convergenceClone(update),expectedLineage=guard?.expectedLineage,capturedGuard=expectedLineage===undefined?undefined:{expectedLineage};return db.transaction('rw',db.tables,async tx=>{await project();writable();const convergenceOptions=await convergenceOptionsFor();if(!convergenceOptions)throw Error('local_tool_convergence_codec_required');const result=await importSourceToolConvergence(scope,options.documentId!,definition,captured,convergenceOptions,capturedGuard);writable();const receipts=continueReceipts(result.checkpoint,result.pending,tx);return{snapshot:result.snapshot,changed:result.changed,causalChanged:result.causalChanged,pending:result.pending,...(receipts.length?{receipts}:{})};});},
 }):undefined;
 const continueReceipts=(checkpoint:import('./convergence/types').LocalToolConvergenceCheckpoint|null,pending:boolean,tx:Transaction)=>{
  if(!checkpoint||checkpoint.engine.version!=='4'||pending||!definition.richAdoption)return[];let outer:Transaction=tx;while(outer.parent)outer=outer.parent;
  return prepareLocalToolStateAdoption(client.state,convergenceIdentity(definition.richAdoption.from,checkpoint.genesisId),convergenceIdentityOf(checkpoint),{receiptTransaction:outer,onCommit:callback=>outer.on('complete',()=>Dexie.ignoreTransaction(callback)),onAbort:callback=>outer.on('abort',()=>Dexie.ignoreTransaction(callback))},()=>{try{writable();return true;}catch{return false;}});
 };
 const client:LocalToolClient<T>={...base,openDocuments,...(convergence?{convergence}:{}),theme,refs:createLocalToolReferences(base,reference=>destination(reference.kind,reference.documentId,true)),...(definition.codec?{state:createLocalToolStateActions<T>(definition.codec,JSON.stringify([projectId,scope.eraId??null,namespace,options.releaseHash??null,definition.codec,options.documentId??null]),run=>{writable();return db.transaction('rw',options.documentId?db.tables:[db.projects],async tx=>{const row=await project();let outer:Transaction=tx;while(outer.parent)outer=outer.parent;writable();const convergenceOptions=options.documentId?await convergenceOptionsFor():undefined;const result=await run({client,receiptTransaction:outer,identity:JSON.stringify([projectId,scope.eraId??null,namespace,row.localToolInstallations?.[namespace]?.contentHash??null,definition.codec,options.documentId??null]),...(options.documentId&&convergenceOptions?{convergence:{
 apply:async(baseline,actions)=>{const bytes=requireLocalImageActions(assets,actions,definition.codec);if(bytes)await bytes;writable();return applySourceToolConvergence(scope,options.documentId!,definition,baseline,actions,convergenceOptions);},
 reverse:recipe=>reverseSourceToolConvergence(scope,options.documentId!,definition,recipe,convergenceOptions),
 }}:{}),onCommit:callback=>outer.on('complete',()=>Dexie.ignoreTransaction(callback)),onAbort:callback=>outer.on('abort',()=>Dexie.ignoreTransaction(callback))});writable();return result;});})}:{})};
 const defaults=createLocalToolDefaults(client,{receiptScope:'writer-runtime',read:async()=>readDefaultsState(await project()),atomic:run=>{
  writable();return db.transaction('rw',db.projects,async tx=>{
   let outer:Transaction=tx;while(outer.parent)outer=outer.parent;
   const result=await run({read:async()=>readDefaultsState(await project()),save:async(data,expectedRevision)=>{
    writable();const row=await project();writable();const prepared=prepareDefaultsSave(row,data,expectedRevision);
    await db.projects.update(projectId,prepared.changes);writable();announce(projectId);return prepared.snapshot;
   },onCommit:callback=>outer.on('complete',()=>Dexie.ignoreTransaction(callback)),onAbort:callback=>outer.on('abort',()=>Dexie.ignoreTransaction(callback))});
   writable();return result;
  });
 }});
 return Object.freeze({...client,defaults});
}
