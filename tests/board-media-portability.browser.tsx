import {db} from '@/db';
import {exportProjectData,importProjectData,deleteProject} from '@/db/operations';
import {createProjectZipArchive,importProjectZip} from '@/services/zipBackup';
import {previewProjectDuplicate,duplicateProject} from '@/services/projectDuplicate/service';
import {saveDocumentHistory,readHistoryPresent,getDocumentHistory} from '@/services/documentHistory/store';
import {deleteBoard} from '@/engines/board/operations';
import {restoreArchivedDocument} from '@/services/documentArchive/store';
import {importLocalMedia} from '@/engines/media/operations';
import {testBoardInteractions} from './board-interactions';
import {boardImage} from '@/services/documentImage/board';
import {makeNode,cloneSelection} from '@/engines/board/graph/mutations';
import {saveWorldEra,saveEraDocument,readWorldDocument} from '@/services/worldEras/store';
import {worldDocumentCloner} from '@/services/worldEras/portability';
import {boardMediaAssert as assert,boardMediaFixture} from './board-media.browser';
export async function testBoardMediaJson(){const f=await boardMediaFixture('json');let copied='';try{
 const node=makeNode({projectId:f.projectId,boardId:f.boardId,kind:'entity',title:'Local reference',position:{x:10,y:20},ref:f.ref()});await db.boardNodes.add(node);const originalBytes=new Uint8Array(await f.audio.blob.arrayBuffer());const data=await exportProjectData(f.projectId);copied=await importProjectData(data);const asset=await db.localMediaAssets.where('projectId').equals(copied).filter(x=>x.kind==='audio').first(),copy=await db.boardNodes.where('projectId').equals(copied).first();assert(asset&&copy?.ref?.entityId===asset.id&&copy.ref.entityId!==f.audio.id,'JSON import leaves Board media reference pointing at old project ID');assert(new Uint8Array(await asset.blob.arrayBuffer()).every((v,i)=>v===originalBytes[i]),'JSON changed exact bytes');return['Real JSON export/import remaps existing media ref to copied owned asset and retains exact bytes'];
 }finally{if(copied)await deleteProject(copied);await f.cleanup();}}
export async function testBoardMediaDomainCollision(){const f=await boardMediaFixture('collision');try{
 const node=makeNode({projectId:f.projectId,boardId:f.boardId,kind:'entity',title:'Collision reference',position:{x:10,y:20},ref:f.ref()});node.id=f.audio.id;await db.boardNodes.add(node);const source=(await readWorldDocument({projectId:f.projectId},'board',f.boardId))!.document;
 const copy=worldDocumentCloner([{kind:'board',document:source}],(await db.projects.get(f.projectId))!,f.projectId+'-copy',(id,prefix)=>prefix+':'+id,{boards:[f.board],localMediaAssets:[f.audio],boardNodes:[node]} as never)('board',source);
 const ref=(copy.children.boardNodes[0]as unknown as{ref:{entityId:string}}).ref;assert(ref.entityId==='media:'+f.audio.id,'Era/history semantic media ref resolved colliding node domain: '+ref.entityId);return['Real worldDocumentCloner keeps media identity when its literal collides with a Board child ID'];
 }finally{await f.cleanup();}}

export async function testBoardMediaPortableFormats(){
 const f=await boardMediaFixture('formats'),copies:string[]=[];try{
  const source=makeNode({projectId:f.projectId,boardId:f.boardId,kind:'entity',title:'Shared file',position:{x:20,y:30},ref:f.ref()});source.id=f.audio.id;await db.boardNodes.add(source);
  const h=await readHistoryPresent(f.projectId,'board',f.boardId);await saveDocumentHistory(f.projectId,'board',f.boardId,h!.version);
  await saveWorldEra(f.projectId,{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1},null);
  const eraAsset=await importLocalMedia(f.projectId,new File([f.video.blob],'Past only.mp4',{type:'video/mp4'}),'past');const era={projectId:f.projectId,eraId:'past'},read=(await readWorldDocument(era,'board',f.boardId))!,pastNode={...source,id:eraAsset.id,ref:f.ref(eraAsset.id)};
  await saveEraDocument(era,'board',{root:read.document.root,children:{...read.document.children,boardNodes:[pastNode]as never}},read.version);
  const exported=await exportProjectData(f.projectId),copy=await importProjectData(exported);copies.push(copy);
  const board=(await db.boards.where('projectId').equals(copy).first())!,media=(await db.localMediaAssets.where('projectId').equals(copy).toArray()).find(a=>a.title===f.audio.title)!;
  assert((await readWorldDocument({projectId:copy},'board',board.id))!.document.children.boardNodes[0].ref&&((await db.boardNodes.where('boardId').equals(board.id).first())!.ref!.entityId===media.id),'Base JSON media-domain remap failed');
  const past=(await db.projects.get(copy))!.worldEras![0],pastRead=(await readWorldDocument({projectId:copy,eraId:past.id},'board',board.id))!,pastId=(pastRead.document.children.boardNodes[0].ref as {entityId:string}).entityId,pastMedia=(await readWorldDocument({projectId:copy,eraId:past.id},'media',pastId))!;
  assert(pastMedia&&pastMedia.document.root.id===pastId&&pastMedia.document.root.title===eraAsset.title&&(pastMedia.document.root.blob as Blob).size===eraAsset.size,'Era-only copied ref lost its actual video bytes under colliding child ID');
  const history=(await db.documentHistory.where('projectId').equals(copy).toArray()).find(x=>x.kind==='board'&&x.reason==='manual')!,historical=await getDocumentHistory(copy,'board',board.id,history.id);assert((historical.document.children.boardNodes[0].ref as {entityId:string}).entityId===media.id,'Copied history lost semantic media reference');
  const original=new Uint8Array(await f.audio.blob.arrayBuffer());assert(new Uint8Array(await media.blob.arrayBuffer()).every((v,i)=>v===original[i]),'Copied media bytes changed');
  await deleteBoard(f.boardId);const archive=(await db.documentArchives.where('projectId').equals(f.projectId).toArray()).find(a=>a.kind==='board')!;assert(archive,'Normal Board deletion did not archive');
  const preview=await previewProjectDuplicate({projectId:f.projectId}),dup=await duplicateProject({projectId:f.projectId,title:'Media duplicate',operationId:crypto.randomUUID(),expectedSourceVersion:preview.sourceVersion});copies.push(dup.projectId);
  const dupArchive=(await db.documentArchives.where('projectId').equals(dup.projectId).toArray()).find(a=>a.kind==='board')!,dupMedia=(await db.localMediaAssets.where('projectId').equals(dup.projectId).toArray()).find(a=>a.title===f.audio.title)!;
  await restoreArchivedDocument(dup.projectId,dupArchive.id);const restored=(await db.boardNodes.where('projectId').equals(dup.projectId).first())!;assert(restored.ref!.entityId===dupMedia.id,'Duplicate archived Board mutation did not remap media ref');
  const zip=await createProjectZipArchive(f.projectId);await importProjectZip(new File([zip.blob],'Own board media.zip'),{replaceProjectIds:[f.projectId]});
  await restoreArchivedDocument(f.projectId,archive.id);const zipNode=(await db.boardNodes.get(source.id))!;assert(zipNode.ref!.entityId===f.audio.id&&(await db.localMediaAssets.get(f.audio.id))!.blob.size===f.audio.size,'Binary ZIP archive/restore broke Board reference or bytes');
  return['Real JSON Base/era-only media and document history preserve semantic references under colliding IDs and actual Blob bytes','Normal Board archive→project Duplicate→restore retains media refs/bytes without extra Blob snapshots','Actual binary project ZIP roundtrip and native archive restore preserve existing media IDs and bytes'];
 }finally{for(const copy of copies)await deleteProject(copy);await f.cleanup();}
}

export async function testBoardMediaEraRootCollision(){const f=await boardMediaFixture('root-collision');try{
 const node=makeNode({projectId:f.projectId,boardId:f.boardId,kind:'entity',title:'Same literal',position:{x:10,y:20},ref:f.ref()});node.id=f.audio.id;await db.boardNodes.add(node);
 const board=(await readWorldDocument({projectId:f.projectId},'board',f.boardId))!.document,media=(await readWorldDocument({projectId:f.projectId},'media',f.audio.id))!.document;
 const clone=worldDocumentCloner([{kind:'board',document:board},{kind:'media',document:media}],(await db.projects.get(f.projectId))!,f.projectId+'-copy',(id,prefix)=>prefix+':'+id,{boards:[f.board],localMediaAssets:[f.audio],boardNodes:[node]}as never);
 const copied=clone('media',media),reference=(clone('board',board).children.boardNodes[0].ref as{entityId:string});assert(copied.root.id==='media:'+f.audio.id&&copied.root.id===reference.entityId,'Cloned media root and reference use different engine domains: '+copied.root.id+' / '+reference.entityId);assert((copied.root.blob as Blob).size===f.audio.blob.size,'Root clone changed bytes');return['Board and media roots in the same clone sources preserve media-domain identity and bytes under literal child collision'];
 }finally{await f.cleanup();}}

export async function testBoardMediaStaticCopy(){const f=await boardMediaFixture('static-copy');try{
 const original=testBoardInteractions(),node=makeNode({projectId:f.projectId,boardId:f.boardId,kind:'entity',title:'Cached own caption',position:{x:10,y:20},ref:f.ref()});
 const same=cloneSelection([node],[],{x:40,y:40},f.boardId,f.projectId).nodes[0],foreign=cloneSelection([node],[],{x:40,y:40},'another-board','another-project').nodes[0];
 assert(same.ref?.entityId===f.audio.id&&!foreign.ref&&foreign.title===node.title,'Same-owner sharing or cross-project pointer removal failed');
 const before=JSON.stringify(node),view=await boardImage({projectId:f.projectId},[node],[],[],700);assert(view.html.includes(f.audio.title)&&!/<audio|<video|blob:/i.test(view.html),'Static DocumentImage projection gained player or lost caption');assert(JSON.stringify(node)===before,'Static projection rewrote reference');return[original,'Same-project copy shares existing file; cross-project copy retains caption/geometry without its media pointer; real static document projection has no player/URL and does not rewrite'];
 }finally{await f.cleanup();}}
export async function testBoardMediaArchiveGuard(){const f=await boardMediaFixture('archive-guard'),other=f.projectId+'-other';try{
 await db.projects.add({...await db.projects.get(f.projectId),id:other}as never);await db.boardNodes.add(makeNode({projectId:f.projectId,boardId:f.boardId,kind:'entity',title:'Archive source',position:{x:10,y:20},ref:f.ref()}));await deleteBoard(f.boardId);const archive=(await db.documentArchives.where('projectId').equals(f.projectId).first())!,before=JSON.stringify(archive);
 const reject=async()=>{let failed=false;try{await restoreArchivedDocument(f.projectId,archive.id);}catch{failed=true;}assert(failed&&!await db.boards.get(f.boardId)&&JSON.stringify(await db.documentArchives.get(archive.id))===before,'Missing/foreign reference bypassed restore ownership guard or partially wrote');};
 await db.localMediaAssets.delete(f.audio.id);await reject();await db.localMediaAssets.put({...f.audio,projectId:other});await reject();await db.localMediaAssets.put(f.audio);await restoreArchivedDocument(f.projectId,archive.id);assert((await db.boardNodes.where('boardId').equals(f.boardId).first())?.ref?.entityId===f.audio.id,'Own restored media still rejected');return['Real archive restore rejects missing and foreign owned media with exact archive/no partial Board, then admits same original file without relaxing owner/key checks'];
 }finally{await deleteProject(other);await f.cleanup();}}
