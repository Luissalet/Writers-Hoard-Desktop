import {validateManuscriptContents,writingSelection} from '@/engines/writings/manuscripts';
import type { Project, WorldMap, MapPin, Writing } from '@/types';
import { PROJECT_SETTING_PREFIXES } from '@/db/operations';
import { projectToolIds, remapWorldMetadata, remapWorldRichContent, remapProjectDuplicateExtras } from '@/services/worldMetadata';
import { eraAdapters } from '@/services/worldEras/registry';
import { eraDocumentVersion } from '@/services/worldEras/adapters';
import type { EraDocument, EraDocumentKind, WorldEraAsset } from '@/services/worldEras/types';
import { decodeHistoryAssets } from '@/services/documentHistory/assets';
import { cloneManuscriptSource, cloneManuscriptWritingSource } from '@/engines/writings/manuscriptReview/sourceMetadata';
import type { ManuscriptSourceRow } from '@/engines/writings/manuscriptReview/sourceTypes';
import { remapImportedWorldMap, remapImportedMapPin } from '@/engines/maps/mapPortability';
import { canonicalJson, sha256Hex, recipeHash, type Recipe } from '@/services/aiRuntime/recipe';
import { fingerprintConversionTarget } from '@/services/projectTools';
import { genealogyLinkKey } from '@/engines/genealogy/genealogyStore';
import { remapToolDockLayout } from '@/engines/writings/toolDock/types';
import type { DuplicateRow as Row, ProjectDuplicateSnapshot } from './types';

const prefixes: Record<string,string> = {
  projects:'proj',codexEntries:'codex',writings:'wr',manuscriptSources:'msource',timelines:'tl',timelineEvents:'evt',timelineConnections:'tconn',
  boards:'board',boardNodes:'bnode',boardEdges:'bedge',boardLayers:'blayer',boardViews:'bview',worldMaps:'map',mapPins:'pin',
  imageCollections:'col',inspirationImages:'img',scenes:'scene',sceneCasts:'cast',dialogBlocks:'block',writingSnapshots:'wsnap',notes:'note',
  generatedWorlds:'world',worldWaypoints:'waypoint',localMediaAssets:'media',localToolAssetFiles:'asset-file',annotations:'ann',annotationReferences:'annref',
  worldEraAssets:'era-asset',worldEraVariants:'era-variant',documentHistory:'history',documentArchives:'archive',
  snapshots:'snap',outlines:'outline',outlineBeats:'beat',seeds:'seed',payoffs:'payoff',characterArcs:'arc',arcBeats:'arcbeat',
  biographies:'bio',biographyFacts:'fact',storyboards:'storyboard',storyboardPanels:'panel',storyboardConnectors:'connector',
};
const engineTables:Record<string,string>={codex:'codexEntries','codex-entry':'codexEntries','local-tool':'source-tool',writings:'writings',maps:'worldMaps',board:'boards',timeline:'timelines',worldgen:'generatedWorlds',notes:'notes',media:'localMediaAssets',
  'dialog-scene':'scenes',outline:'outlines',seeds:'seeds',biography:'biographies','character-arc':'characterArcs',gallery:'inspirationImages',scrapper:'snapshots',links:'snapshots',
  diary:'diaryEntries',storyboard:'storyboards',relationships:'relationships','video-planner':'videoPlans','real-atlas':'atlasPlaces',inquiry:'inquiryCases',
  dictionary:'language',tables:'table',genealogy:'tree','relation-tree':'tree','character-sheets':'sheet',radar:'radar','model-viewer':'model',
  'board-node':'boardNodes','outline-beat':'outlineBeats','timeline-event':'timelineEvents','timeline-connection':'timelineConnections'};
const refs:Record<string,Record<string,string>>={
  codexEntries:{templateId:'template','referenceFields.*.*':'codexEntries','relations.*.targetId':'codexEntries'},
  timelineEvents:{timelineId:'timelines','bannerPreset.ownerTimelineId':'timelines',linkedEntryId:'codexEntries','linkedEntryIds.*':'codexEntries'},
  timelineConnections:{timelineId:'timelines',sourceEventId:'timelineEvents',targetEventId:'timelineEvents'},
  boardNodes:{boardId:'boards',layerId:'boardLayers','memberNodeIds.*':'boardNodes'},boardLayers:{boardId:'boards'},
  boardEdges:{boardId:'boards',layerId:'boardLayers'},boardViews:{boardId:'boards','layerIds.*':'boardLayers'},
  atlasPlaces:{parentId:'atlasPlaces'},atlasDivergences:{placeId:'atlasPlaces'},
  inspirationImages:{collectionId:'imageCollections',linkedEntryId:'codexEntries','linkedEntryIds.*':'codexEntries','generation.initImageId':'inspirationImages','generation.maskImageId':'inspirationImages','generation.controlImageId':'inspirationImages','generation.refImageIds.*':'inspirationImages'},
  storyboardPanels:{storyboardId:'storyboards',imageRef:'inspirationImages',linkedSceneId:'scenes'},storyboardConnectors:{storyboardId:'storyboards',sourceId:'storyboardPanels',targetId:'storyboardPanels'},
  dialogBlocks:{sceneId:'scenes',characterId:'codexEntries',dualGroupId:'dual-group'},sceneCasts:{sceneId:'scenes',characterId:'codexEntries'},videoSegments:{videoPlanId:'videoPlans'},
  biographies:{subjectId:'codexEntries'},biographyFacts:{biographyId:'biographies','sources.*.entityId':'snapshots'},
  outlines:{linkedWritingId:'writings'},
  outlineBeats:{outlineId:'outlines',parentId:'outlineBeats',linkedWritingId:'writings',linkedSceneId:'scenes'},characterArcs:{characterId:'codexEntries'},arcBeats:{arcId:'characterArcs',linkedBeatId:'outlineBeats',linkedSceneId:'scenes'},
  seeds:{linkedBeatId:'outlineBeats',linkedSceneId:'scenes',linkedWritingId:'writings'},payoffs:{seedId:'seeds',linkedBeatId:'outlineBeats',linkedSceneId:'scenes',linkedWritingId:'writings'},
  writingSnapshots:{writingId:'writings',sourceDraftId:'writingSnapshots'},generatedWorlds:{originWorldId:'generatedWorlds'},worldWaypoints:{worldId:'generatedWorlds'},
  citations:{snapshotId:'snapshots','writingIds.*':'writings'},publishingProfiles:{'selectedWritingIds.*':'writings','writingOrder.*':'writings'},
  aiMessages:{threadId:'aiThreads'},visualRefs:{codexEntryId:'codexEntries','referenceImageIds.*':'inspirationImages',canonicalImageId:'inspirationImages','sheetImageIds.*':'inspirationImages','controlImageIds.*':'inspirationImages','lora.trainedFromImageIds.*':'inspirationImages'},
  imageRecipes:{imageId:'inspirationImages','inputs.initImage.imageId':'inspirationImages','inputs.maskImage.imageId':'inspirationImages','inputs.controlImage.imageId':'inspirationImages','inputs.refImages.*.imageId':'inspirationImages'},
  judgeRuns:{writingId:'writings','targetVersions.*.writingId':'writings','context.selectedWritingIds.*':'writings'},judgeFindings:{runId:'judgeRuns',writingId:'writings'},
  creativeBranchDeltas:{branchId:'creativeBranches'},branchPromotionReceipts:{branchId:'creativeBranches','changes.*.deltaId':'creativeBranchDeltas'},
  storyClaims:{fromMomentId:'narrativeMoments',untilMomentId:'narrativeMoments',acquiredAtMomentId:'narrativeMoments',revealedAtMomentId:'narrativeMoments',codexEntryId:'codexEntries'},
  inquiryClaims:{'placeIds.*':'atlasPlaces','supports.*.citationId':'citations','supports.*.evidenceId':'evidence'},inquiryRatings:{hypothesisId:'inquiryHypotheses',claimId:'inquiryClaims'},
  enrichmentRuns:{entryId:'codexEntries',citationId:'citations','createdCitationIds.*':'citations'},betaResponses:{packageId:'betaPackages'},betaComments:{responseId:'betaResponses',packageId:'betaPackages',writingId:'writings'},
  localMediaAssets:{'linkedEntryIds.*':'codexEntries'},genealogyLinks:{from:'codexEntries',to:'codexEntries',linkId:'genealogy-link'},
};
const richFields:Record<string,string[]>={codexEntries:['content'],writings:['content'],writingSnapshots:['content'],boardNodes:['richContent'],diaryEntries:['content'],biographyFacts:['content'],snapshots:['htmlContent']};
const object=(value:unknown):value is Row=>!!value&&typeof value==='object'&&!Array.isArray(value)&&!(value instanceof Blob);
/** Walk only declared schema paths. In particular, a data.id or arbitrary string is never a reference. */
function at(value:unknown,path:string[],transform:(value:unknown)=>unknown):void {
  if(!value||typeof value!=='object')return;
  const [head,...tail]=path,record=value as Row;
  for(const key of head==='*'?Object.keys(record):[head])if(Object.hasOwn(record,key)) {
    if(tail.length)at(record[key],tail,transform);else record[key]=transform(record[key]);
  }
}
export function createDuplicateRemapper(snapshot:ProjectDuplicateSnapshot,targetProjectId:string,pathMap:Record<string,string>={}) {
  const sourceProject=snapshot.project, map=new Map<string,string>();
  const prefix=(kind:string)=>prefixes[kind]??kind;
  const remap=(id:string,kind:string):string=>{const key=`${prefix(kind)}\0${id}`;if(!map.has(key))map.set(key,`${prefix(kind)}_${crypto.randomUUID()}`);return map.get(key)!;};
  map.set(`proj\0${sourceProject.id}`,targetProjectId);
  const entity=(engine:string,id:string):string=>{
    if(id===`book:${sourceProject.id}`)return `book:${targetProjectId}`;
    if(id.startsWith(`book:${sourceProject.id}:manuscript:`))return `book:${targetProjectId}:manuscript:${remap(id.slice(`book:${sourceProject.id}:manuscript:`.length),'manuscript')}`;
    const split=id.indexOf('::');if(split>=0)return `${entity(engine,id.slice(0,split))}::${id.slice(split+2).split('::').map(part=>snapshot.tables.writingSnapshots?.some(row=>row.id===part)?remap(part,'wsnap'):sourceProject.worldEras?.some(era=>era.id===part)?remap(part,'era'):part).join('::')}`;
    const children:Record<string,string[]>={board:['boards','boardNodes','boardEdges'],timeline:['timelines','timelineEvents'],biography:['biographies','biographyFacts'],outline:['outlines','outlineBeats'],'character-arc':['characterArcs','arcBeats'],gallery:['inspirationImages','imageCollections'],storyboard:['storyboards','storyboardPanels']};
    const table=children[engine]?.find(table=>snapshot.tables[table]?.some(row=>row.id===id));
    return remap(id,table??(engine.startsWith('local-tool-')?'source-tool':engineTables[engine]??engine));
  };
  for(const[table,rows]of Object.entries(snapshot.tables))for(const row of rows)if(typeof row.id==='string')remap(row.id,table);
  const roots=(kind:EraDocumentKind):Row[]=>[
    ...(eraAdapters[kind].table?snapshot.tables[eraAdapters[kind].table!]??[]:sourceProject[eraAdapters[kind].metadata!] as unknown as Row[]??[]),
    ...[...snapshot.tables.worldEraVariants??[],...snapshot.tables.documentHistory??[]].filter(row=>row.kind===kind).flatMap(row=>[row,...row.history as Row[]??[]]).flatMap(row=>object(row.document)&&object(row.document.root)?[row.document.root]:[]),
  ];
  const codexIds=new Set(roots('codex').map(row=>String(row.id))),mediaIds=new Set(roots('media').map(row=>String(row.id))),writingIds=new Set(roots('writings').map(row=>String(row.id))),eventIds=new Set([...(snapshot.tables.timelineEvents??[]),
    // Events that exist only in a world era live inside its documents (and their history).
    ...[...snapshot.tables.worldEraVariants??[],...snapshot.tables.documentHistory??[]].flatMap(row=>[row,...row.history as Row[]??[]]).flatMap(row=>object(row.document)&&object(row.document.children)&&Array.isArray(row.document.children.timelineEvents)?row.document.children.timelineEvents as Row[]:[])].map(row=>String(row.id)));
  // Missing local references remain missing in the copy; absence must not silently erase an authored link.
  const collect=(target:Set<string>)=>(id:unknown)=>{if(typeof id==='string'&&id)target.add(id);return id;};
  const metadataReferences:Record<string,string[]>={dictionaries:['words.*.linkedEntryId'],characterSheets:['linkedEntryId'],radarCharts:['series.*.linkedEntryId'],relationTrees:['nodes.*.codexEntryId']};
  for(const[field,paths]of Object.entries(metadataReferences))for(const item of sourceProject[field as keyof typeof sourceProject] as unknown as Row[]??[])for(const path of paths)at(item,path.split('.'),collect(codexIds));
  for(const table of sourceProject.dataTables??[])for(const column of table.columns)if(column.kind==='reference')for(const item of table.rows)collect(codexIds)(item.cells[column.id]);
  for(const[id,style]of Object.entries(sourceProject.readerPresentation?.chapters??{})){writingIds.add(id);if(style.audio)mediaIds.add(style.audio.assetId);for(const cue of style.paragraphAudio??[])mediaIds.add(cue.track.assetId);}
  const referenceProject={...sourceProject};for(const kind of Object.keys(eraAdapters) as EraDocumentKind[]){const field=eraAdapters[kind].metadata;if(field)Object.assign(referenceProject,{[field]:[...new Map(roots(kind).map(row=>[row.id,row])).values()]});}
  const tools=projectToolIds(referenceProject,{writings:roots('writings') as {id:string}[],scenes:roots('dialog-scene') as {id:string}[],generatedWorlds:roots('worldgen') as {id:string}[],worldMaps:roots('maps') as {id:string}[],boards:roots('board') as {id:string}[],timelines:roots('timeline') as {id:string}[]});
  for(const placement of sourceProject.workspacePlacements??[]){const kind=placement.engineId==='genealogy'?'relation-tree':placement.engineId;if(kind==='codex')codexIds.add(placement.entityId);else if(kind==='writings')writingIds.add(placement.entityId);else if(kind==='media')mediaIds.add(placement.entityId);else (tools[kind] as Set<string>|undefined)?.add(placement.entityId);}
  const rich=(html:string)=>{
    if(/<a\b|wh-media:\/\//i.test(html)){
      const parsed=new DOMParser().parseFromString(html,'text/html');
      for(const anchor of parsed.querySelectorAll('a[href]'))try{
        const url=new URL(anchor.getAttribute('href')!,'https://writer.invalid'),base=`/project/${encodeURIComponent(sourceProject.id)}/`;
        if(url.origin!=='https://writer.invalid'||!url.pathname.startsWith(base))continue;
        const engine=decodeURIComponent(url.pathname.slice(base.length).split('/')[0]);if(!engineTables[engine]&&!engine.startsWith('local-tool-'))continue;
        for(const key of ['entity','entry','writing','compareWriting','map','board','scene','tree','document','world','language','sheet','radar','model','outline','beat','panel']){const id=url.searchParams.get(key);if(id)url.searchParams.set(key,entity(engine,id));}
        const manuscript=url.searchParams.get('manuscript');if(manuscript&&!['main','library'].includes(manuscript))url.searchParams.set('manuscript',remap(manuscript,'manuscript'));
        for(const key of ['draft','draftId','compareDraft']){const id=url.searchParams.get(key);if(id)url.searchParams.set(key,remap(id,'wsnap'));}
        const era=url.searchParams.get('era');if(era)url.searchParams.set('era',remap(era,'era'));
        url.pathname=`/project/${encodeURIComponent(targetProjectId)}/`+url.pathname.slice(base.length);anchor.setAttribute('href',url.pathname+url.search+url.hash);
      }catch{/* An ordinary authored link remains literal. */}
      for(const element of parsed.querySelectorAll('[src],[href]'))for(const attribute of ['src','href']){
        const value=element.getAttribute(attribute);if(!value?.startsWith('wh-media://media/'))continue;
        const path=value.slice('wh-media://media/'.length),mapped=pathMap[path];if(mapped)element.setAttribute(attribute,'wh-media://media/'+mapped);
      }
      html=parsed.body.innerHTML;
    }
    return remapWorldRichContent(html,sourceProject.id,targetProjectId,remap,codexIds,mediaIds,tools);
  };
  const pointer=(row:Row,field:string,engineField='engineId')=>{if(object(row[field])){const value=row[field];if(typeof value.entityId==='string'&&typeof value[engineField]==='string')value.entityId=entity(value[engineField],value.entityId);}};
  const mapKeys=(value:unknown,kind:string):unknown=>object(value)?Object.fromEntries(Object.entries(value).map(([id,v])=>[remap(id,kind),v])):value;
  const branch=(value:unknown):unknown=>{if(!object(value)||!object(value.value)||typeof value.kind!=='string')return value;return{...value,value:row(engineTables[value.kind],value.value)};};
  function row(table:string,input:Row):Row {
    let value=structuredClone(input);
    if(typeof value.id==='string')value.id=remap(value.id,table);
    if(value.projectId===sourceProject.id)value.projectId=targetProjectId;
    for(const[path,target]of Object.entries(refs[table]??{}))at(value,path.split('.'),id=>typeof id==='string'&&id?remap(id,target):id);
    for(const field of richFields[table]??[])if(typeof value[field]==='string')value[field]=rich(value[field]);
    if(table==='writings'){if(typeof input.manuscriptId==='string')value.manuscriptId=remap(input.manuscriptId,'manuscript');value.manuscriptSource=cloneManuscriptWritingSource(input.manuscriptSource as Writing['manuscriptSource'],remap);value.toolDock=remapToolDockLayout(input.toolDock as Writing['toolDock'],remap);}
    if(table==='publishingProfiles'&&input.writingScope){const scope=writingSelection(input.writingScope);value.writingScope=scope.kind==='manuscript'&&scope.id!=='main'?{kind:'manuscript',id:remap(scope.id,'manuscript')}:scope;}
    if(table==='manuscriptSources')value=cloneManuscriptSource(input as unknown as ManuscriptSourceRow,targetProjectId,remap) as unknown as Row;
    if(table==='worldMaps')value=remapImportedWorldMap(input as unknown as WorldMap,targetProjectId,remap,codexIds,eventIds,mediaIds) as unknown as Row;
    if(table==='mapPins')value=remapImportedMapPin(input as unknown as MapPin,targetProjectId,remap(String(input.mapId),'map'),remap,codexIds,mediaIds) as unknown as Row;
    // The legacy map importer intentionally drops generated-world provenance; a complete local copy carries those worlds.
    if(table==='worldMaps'){
      value.source=input.source;value.sourceWorldId=typeof input.sourceWorldId==='string'?remap(input.sourceWorldId,'world'):input.sourceWorldId;value.sourceRevision=input.sourceRevision;
      at(value,['versions','*'],(version)=>{if(!object(version))return version;const original=(input.versions as Row[]).find(item=>item.id===version.id);if(!original)return version;return{...version,source:original.source,sourceWorldId:typeof original.sourceWorldId==='string'?remap(original.sourceWorldId,'world'):original.sourceWorldId,sourceRevision:original.sourceRevision,pins:(original.pins as Row[]).map(pin=>row('mapPins',pin))};});
    }
    if(table==='mapPins')value.sourceWaypointId=typeof input.sourceWaypointId==='string'?remap(input.sourceWaypointId,'waypoint'):input.sourceWaypointId;
    if(table==='boardNodes')pointer(value,'ref');
    if(table==='boardEdges')for(const field of ['sources','targets'])at(value,[field,'*'],item=>object(item)&&typeof item.id==='string'?{...item,id:remap(item.id,item.on==='edge'?'bedge':'bnode')}:item);
    if(table==='boardEdges')for(const field of ['sourceId','targetId'])if(typeof input[field]==='string')value[field]=remap(input[field],snapshot.tables.boardEdges?.some(edge=>edge.id===input[field])?'bedge':'bnode');
    if(table==='boardViews')value.positions=mapKeys(input.positions,'bnode');
    if(table==='annotations'){
      if(typeof input.sourceEntityId==='string')value.sourceEntityId=entity(String(input.sourceEngineId),input.sourceEntityId);
      if(typeof input.eraId==='string')value.eraId=remap(input.eraId,'era');
      const mention=(item:unknown)=>object(item)&&typeof item.entityId==='string'?{...item,entityId:entity(String(item.engineId),item.entityId)}:item;
      at(value,['mentions','*'],mention);at(value,['replies','*'],item=>{if(!object(item))return item;const reply={...item,id:remap(String(item.id),'annreply')};at(reply,['mentions','*'],mention);at(reply,['importedComment','sourceId'],id=>remap(String(id),'msource'));return reply;});at(value,['importedComment','sourceId'],id=>remap(String(id),'msource'));
    }
    if(table==='annotationReferences'){value.annotationId=remap(String(input.annotationId),'ann');value.targetEntityId=entity(String(input.targetEngineId),String(input.targetEntityId));}
    if(table==='relationships')for(const field of ['entityAId','entityBId'])if(typeof input[field]==='string')value[field]=entity(String(input[field==='entityAId'?'entityAType':'entityBType']??'codex'),input[field]);
    if(['entityLinks','conversionReceipts'].includes(table))for(const side of ['source','target'])if(typeof input[side+'EntityId']==='string')value[side+'EntityId']=entity(String(input[side+'EngineId']),input[side+'EntityId'] as string);
    if(table==='conversionReceipts'){
      if(typeof input.conversionLinkId==='string')value.conversionLinkId=remap(input.conversionLinkId,'entityLinks');
      if(object(input.undoPayload))value.undoPayload={...input.undoPayload,...(typeof input.undoPayload.targetId==='string'?{targetId:entity(String(input.targetEngineId),input.undoPayload.targetId)}:{})};
    }
    if(table==='citations')at(value,['researchEvidence','*','id'],id=>remap(String(id),'evidence'));
    if(table==='aiProjectSettings')value.projectId=targetProjectId;
    if(table==='imageRecipes'&&typeof input.hash==='string')value.hash=recipeHash(value as unknown as Recipe);
    if(table==='generatedWorlds')at(value,['manuscriptLinks','*'],item=>object(item)?row('entityLinks',item):item);
    if(table==='judgeFindings')pointer(value,'internal');
    if(table==='creativeBranches'){pointer(value,'root','kind');const kind=object(input.root)?String(input.root.kind):'',id=object(input.root)?input.root.entityId:undefined;const original=snapshot.tables[engineTables[kind]]?.find(item=>item.id===id);if(original&&typeof input.baseHash==='string'&&input.baseHash===sha256Hex(canonicalJson({kind,value:original})))value.baseHash=sha256Hex(canonicalJson({kind,value:row(engineTables[kind],original)}));}
    if(table==='creativeBranchDeltas'){value.targetId=entity(String(input.targetKind),String(input.targetId));value.base=branch(input.base);value.proposal=branch(input.proposal);value.baseHash=sha256Hex(canonicalJson(value.base));}
    if(table==='branchPromotionReceipts')at(value,['changes','*'],item=>{if(!object(item))return item;const before=branch(item.before),after=branch(item.after);return{...item,deltaId:remap(String(item.deltaId),'creativeBranchDeltas'),targetId:entity(String(item.targetKind),String(item.targetId)),before,after,beforeHash:sha256Hex(canonicalJson(before)),afterHash:sha256Hex(canonicalJson(after))};});
    if(table==='narrativeMoments')value.anchorEntityId=entity(String(input.anchorEngineId),String(input.anchorEntityId));
    if(table==='storyClaims'){for(const field of ['source','subject','actor'])pointer(value,field);at(value,['evidence','*'],item=>{if(!object(item))return item;return{...item,entityId:entity(String(item.engineId),String(item.entityId))};});}
    if(table==='sharedCanonEntities'){value.seriesId=targetProjectId;if(object(value.origin)&&value.origin.projectId===sourceProject.id){value.origin.projectId=targetProjectId;value.origin.entityId=entity(String(value.origin.engineId),String(value.origin.entityId));}}
    if(table==='sharedEntityBindings'){if(input.seriesId===sourceProject.id){value.seriesId=targetProjectId;value.sharedEntityId=remap(String(input.sharedEntityId),'sharedCanonEntities');}pointer(value,'local');}
    if(table==='inquiryClaims')for(const field of ['subject','object'])if(object(value[field])&&value[field].kind==='codex')value[field].id=remap(String(value[field].id),'codex');
    if(table==='inquiryRatings')value.id=`${value.hypothesisId}|${value.claimId}`;
    if(table==='genealogyLinks')value.id=genealogyLinkKey(targetProjectId,String(value.linkId));
    if(table==='referencePins'){value.scopeId=String(input.scopeId).startsWith('book:')?entity('writings',String(input.scopeId)):remap(String(input.scopeId),'wr');value.id=value.scopeId;at(value,['entryIds','*'],id=>remap(String(id),'codex'));}
    if(table==='betaPackages')at(value,['chapters','*'],item=>object(item)?{...item,chapterId:remap(String(item.chapterId),'wr')}:item);
    if(table==='betaResponses')for(const key of ['reactions','chapterHashes'])value[key]=mapKeys(input[key],'wr');
    if(table==='snapshots'){
      for(const field of ['localMediaPath','capturePdfPath','captureImagePath','captureHtmlPath'])if(typeof value[field]==='string')value[field]=pathMap[value[field]]??value[field];
      at(value,['mediaItems','*','relPath'],path=>typeof path==='string'?pathMap[path]??path:path);
    }
    return value;
  }
  function encodedAssets(value:unknown):unknown {
    if(value instanceof Blob)return value;if(Array.isArray(value))return value.map(encodedAssets);
    if(object(value))return Object.fromEntries(Object.entries(value).map(([key,child])=>[key,(key==='__worldEraAssetId'||key==='__documentHistoryAsset')&&typeof child==='string'?remap(child,'era-asset'):encodedAssets(child)]));return value;
  }
  function document(kind:EraDocumentKind,input:EraDocument):EraDocument {
    const adapter=eraAdapters[kind];
    const root=adapter.table?row(adapter.table,input.root):(metadataFor({...referenceProject,[adapter.metadata!]:[input.root]})[adapter.metadata!] as unknown as Row[])[0];
    return {root:encodedAssets(root) as EraDocument['root'],children:Object.fromEntries(Object.entries(input.children).map(([table,children])=>[table,children.map(child=>encodedAssets(row(table,child)))]))} as EraDocument;
  }
  function archive(input:Row):Row {
    const value=row('documentArchives',input),kind=(input.kind==='relation-tree'?'genealogy':input.kind) as EraDocumentKind,adapter=eraAdapters[kind];
    const metadataPrefixes:Record<string,string>={dictionaries:'language',dataTables:'table',relationTrees:'tree',modelAssets:'model',characterSheets:'sheet',radarCharts:'radar',sourceToolDocuments:'source-tool'};
    value.sourceId=remap(String(input.sourceId),adapter?.table??(adapter?.metadata?metadataPrefixes[adapter.metadata]??String(adapter.metadata):String(input.kind)));
    if(object(input.metadata)){const metadata=input.metadata;value.metadata={...metadata,item:document(kind,{root:metadata.item as EraDocument['root'],children:{}}).root};}
    at(value,['mutations','*'],item=>{if(!object(item))return item;const table=String(item.table),patch={...item,key:remap(String(item.key),table)};for(const field of ['beforeRow','afterRow','beforeValues','afterValues'])if(object(item[field]))(patch as Row)[field]=row(table,item[field]);return patch;});return value;
  }
  function metadataFor(project:Project):Partial<Project>{
    const copied=remapWorldMetadata(project,remap,codexIds,mediaIds,writingIds,tools);
    // Synced property columns are stable schema keys, not independent column document IDs.
    if(copied.dataTables)copied.dataTables=copied.dataTables.map((table,index)=>({...table,rows:table.rows.map((item,rowIndex)=>({...item,cells:Object.fromEntries(project.dataTables![index].columns.map(column=>{const value=project.dataTables![index].rows[rowIndex].cells[column.id]??'';return[column.id.startsWith('property:')?column.id:remap(column.id,'column'),column.kind==='reference'&&value&&!value.startsWith('=')?remap(value,'codex'):value];}))}))}));
    return copied;
  }
  const metadata=()=>({...sourceProject,...metadataFor(sourceProject),...remapProjectDuplicateExtras(sourceProject,remap,entity)});
  return {remap,entity,row,document,archive,metadata,rich};
}

export async function remapDuplicateSnapshot(snapshot:ProjectDuplicateSnapshot,targetProjectId:string,title:string,pathMap:Record<string,string>={}):Promise<ProjectDuplicateSnapshot> {
  validateManuscriptContents(snapshot.project,snapshot.tables.writings??[],snapshot.tables.worldEraVariants??[],snapshot.tables.publishingProfiles??[],snapshot.tables.documentArchives??[]);
  const clone=createDuplicateRemapper(snapshot,targetProjectId,pathMap),tables:Record<string,Row[]>={};
  for(const[table,rows]of Object.entries(snapshot.tables))tables[table]=rows.map(input=>clone.row(table,input));
  tables.worldEraAssets=(snapshot.tables.worldEraAssets??[]).map(input=>clone.row('worldEraAssets',input));
  const assets=new Map(tables.worldEraAssets.map(row=>[String(row.id),row as unknown as WorldEraAsset]));
  tables.worldEraVariants=(snapshot.tables.worldEraVariants??[]).map(input=>{
    const state=(state:Row)=>({...state,...(state.document?{document:clone.document(input.kind as EraDocumentKind,state.document as EraDocument)}:{})});
    return {...state(input),id:clone.remap(String(input.id),'era-variant'),projectId:targetProjectId,eraId:clone.remap(String(input.eraId),'era'),entityId:clone.entity(String(input.kind),String(input.entityId)),history:(input.history as Row[]|undefined)?.map(state)};
  });
  tables.documentHistory=await Promise.all((snapshot.tables.documentHistory??[]).map(async input=>{
    const document=clone.document(input.kind as EraDocumentKind,input.document as EraDocument),hydrated=await decodeHistoryAssets(targetProjectId,document,{get:async id=>assets.get(id)});
    return {...input,id:clone.remap(String(input.id),'history'),projectId:targetProjectId,entityId:document.root.id,document,assetIds:(input.assetIds as string[]).map(id=>clone.remap(id,'era-asset')),version:await eraDocumentVersion(hydrated)};
  }));
  tables.documentArchives=(snapshot.tables.documentArchives??[]).map(clone.archive);
  for(let index=0;index<(snapshot.tables.conversionReceipts??[]).length;index++){
    const original=snapshot.tables.conversionReceipts[index],target=snapshot.tables.writings.find(row=>row.id===original.targetEntityId);
    // A receipt already stale in the original must stay stale, rather than gaining delete authority.
    if(target&&original.targetFingerprint===fingerprintConversionTarget(target as unknown as Writing))tables.conversionReceipts[index].targetFingerprint=fingerprintConversionTarget(clone.row('writings',target) as unknown as Writing);
  }
  tables.settings=(snapshot.tables.settings??[]).filter(input=>input.key!==PROJECT_SETTING_PREFIXES.activeSprint+snapshot.project.id).map(input=>{
    const key=String(input.key),which=Object.entries(PROJECT_SETTING_PREFIXES).find(([,prefix])=>key===prefix+snapshot.project.id||prefix===PROJECT_SETTING_PREFIXES.tableReadVoices&&snapshot.project.worldEras?.some(era=>key===prefix+snapshot.project.id+'.era:'+era.id));if(!which)throw Error('project_duplicate_setting_unknown');
    const era=snapshot.project.worldEras?.find(era=>key===which[1]+snapshot.project.id+'.era:'+era.id);
    const targetKey=which[1]+targetProjectId+(era?'.era:'+clone.remap(era.id,'era'):'');let value=input.value;
    if(['sprintLog','readingPosition','atlasRoutes','tableReadVoices'].includes(which[0])&&typeof value==='string'&&value){
      const parsed=JSON.parse(value) as Row;
      if(which[0]==='sprintLog')at(parsed,['sprints','*'],item=>object(item)?{...item,id:clone.remap(String(item.id),'sprint'),projectId:targetProjectId,...(typeof item.writingId==='string'?{writingId:clone.remap(item.writingId,'wr')}:{})}:item);
      if(which[0]==='readingPosition'){parsed.projectId=targetProjectId;if(typeof parsed.pieceId==='string')parsed.pieceId=clone.remap(parsed.pieceId,'wr');if(object(parsed.manuscripts))parsed.manuscripts=Object.fromEntries(Object.entries(parsed.manuscripts).map(([id,value])=>[clone.remap(id,'manuscript'),object(value)?{...value,projectId:targetProjectId,...(typeof value.pieceId==='string'?{pieceId:clone.remap(value.pieceId,'wr')}:{})}:value]));}
      if(which[0]==='atlasRoutes')at(parsed,['routes','*'],item=>{if(!object(item))return item;const route={...item,id:clone.remap(String(item.id),'route')};at(route,['placeIds','*'],id=>clone.remap(String(id),'atlasPlaces'));return route;});
      if(which[0]==='tableReadVoices')value=JSON.stringify(Object.fromEntries(Object.entries(parsed).map(([id,voice])=>[id.startsWith('id:')?'id:'+clone.remap(id.slice(3),'codex'):id,voice])));else value=JSON.stringify(parsed);
    }
    if(which[0]==='proofreaderDismissed'&&typeof value==='string'&&value){const parsed=JSON.parse(value) as unknown;const checks:Record<string,string>={'seed-without-payoff':'seed','writing-outside-outline':'wr','character-disappears':'codex','scene-without-pov':'scene','relationship-broken-endpoint':'relationships','stale-draft':'wr'};if(Array.isArray(parsed))value=JSON.stringify(parsed.map(id=>{if(typeof id!=='string')return id;const split=id.indexOf(':'),kind=id.slice(0,split),rest=id.slice(split+1);if(checks[kind])return kind+':'+clone.remap(rest,checks[kind]);if(kind==='beat-without-scene'){const marker=rest.indexOf(':');return kind+':'+rest.slice(0,marker+1)+clone.remap(rest.slice(marker+1),'beat');}return id;}));}
    return{...input,id:`set_${targetKey}`,key:targetKey,value};
  });
  const project={...clone.metadata(),id:targetProjectId,title,children:[],pinned:false,createdAt:Date.now(),updatedAt:Date.now()};
  return {project,parent:snapshot.parent,tables};
}
