import {db} from '@/db';
import {exportProjectData,importProjectData,deleteProject} from '@/db/operations';
import {createProjectZipArchive,importProjectZip} from '@/services/zipBackup';
import {mutateEraRows,listEraRows} from '@/services/worldEras/store';
import {saveWorldScale,getWorldScale} from '@/engines/worldgen/worldScale';
import {generateWorld} from '@/engines/worldgen/core/pipeline';
import {saveSnapshot,loadSnapshot,dropSnapshot} from '@/engines/worldgen/snapshots';
import {paramsKey} from '@/engines/worldgen/useWorldGeneration';
import {openWorldForReading} from '@/engines/worldgen/bridgeAccess';
import {SculptSurface,elevKmToY} from '@/engines/worldgen/sculpt/scene3d';
import {makeFixture,check,call} from './worldgen-scale-contract.browser';

export async function testPortable(){
 const f=await makeFixture(),owned=new Set([f.P]),operation='scale_'+crypto.randomUUID().replaceAll('-',''),snapshotIds=new Set([f.W]);
 try{
  await saveWorldScale({projectId:f.P},f.W,604.8,0);
  await mutateEraRows({projectId:f.P,eraId:'past'},[{table:'generatedWorlds',id:f.W,changes:{title:'Own era map'}}]);await saveWorldScale({projectId:f.P,eraId:'past'},f.W,1209.6,1);
  const eraOnly={...f.world,id:f.W+'-era-only',title:'Era only'};await mutateEraRows({projectId:f.P,eraId:'past'},[{table:'generatedWorlds',id:eraOnly.id,row:eraOnly}]);await saveWorldScale({projectId:f.P,eraId:'past'},eraOnly.id,55.5,0);
  const resetWorld={...f.world,id:f.W+'-reset',title:'Reset map'};await db.generatedWorlds.add(resetWorld);await saveWorldScale({projectId:f.P},resetWorld.id,4096,0);await saveWorldScale({projectId:f.P},resetWorld.id,null,1);
  async function verify(projectId:string){const project=await db.projects.get(projectId),eraId=project?.worldEras?.find(row=>row.name==='Past')?.id;check(eraId,'Portable era absent');const rows=await db.generatedWorlds.where('projectId').equals(projectId).toArray(),base=rows.find(row=>row.title==='QA scale terrain'),reset=rows.find(row=>row.title==='Reset map');check(base?.mapWidthKm===604.8&&base.scaleRevision===1&&reset?.scaleRevision===2&&!Object.hasOwn(reset,'mapWidthKm'),'Base/reset scale fields lost');const eraRows=await listEraRows({projectId,eraId},'generatedWorlds'),own=eraRows.find(row=>row.title==='Own era map'),only=eraRows.find(row=>row.title==='Era only');check(own?.mapWidthKm===1209.6&&own.scaleRevision===2&&only?.mapWidthKm===55.5&&only.scaleRevision===1,'Era scale fields lost');check(!rows.some(row=>row.title==='Era only'),'Era-only map leaked to Base');check(JSON.stringify(base.params)===JSON.stringify(f.world.params)&&base.edits===f.world.edits&&base.regions?.[0].x===30&&base.regions[0].spanKm===80,'Portable generation/authored coordinates changed');return{projectId,base:base.mapWidthKm,own:own.mapWidthKm,only:only.mapWidthKm,resetAbsent:true,baseRevision:base.scaleRevision,ownRevision:own.scaleRevision,resetRevision:reset.scaleRevision};}
  const original=await verify(f.P),jsonData=JSON.parse(JSON.stringify(await exportProjectData(f.P))),jsonId=await importProjectData(jsonData);owned.add(jsonId);const json=await verify(jsonId);
  const preview=await call('wh_project_duplicate_preview',{projectId:f.P,title:'Own scale clone'}),duplicate=await call('wh_project_duplicate',{projectId:f.P,title:'Own scale clone',operationId:operation,expectedSourceVersion:preview.sourceVersion});check(duplicate.complete,'Browser copy unexpectedly incomplete');owned.add(duplicate.projectId);const clone=await verify(duplicate.projectId);
  const archive=await createProjectZipArchive(f.P);check(archive.blob.size>0,'No actual ZIP');await deleteProject(f.P);const imported=await importProjectZip(new File([archive.blob],archive.fileName,{type:'application/zip'}));check(imported.length===1&&imported[0]===f.P,'ZIP restored wrong project');const zip=await verify(f.P);
  // Real original snapshot storage excludes the mutable calibration; reading rehydrates it.
  const data=generateWorld(f.world.params);data.mapWidthKm=123;data.scaleRevision=999;await saveSnapshot(f.W,paramsKey(data.params),data);const stored=await loadSnapshot(f.W,paramsKey(data.params));check(stored&&!Object.hasOwn(stored,'mapWidthKm')&&!Object.hasOwn(stored,'scaleRevision'),'Mutable scale leaked into generation snapshot');
  const record=(await db.generatedWorlds.get(f.W))!,read=await openWorldForReading(record,'places');check(read.ok&&read.world.data.mapWidthKm===604.8&&read.world.data.scaleRevision===1,'Cold snapshot read did not rehydrate metadata');
  if(!read.ok)throw Error('Snapshot unavailable');const held=read.world.data,buffers=Object.entries(held).filter(([,value])=>ArrayBuffer.isView(value)).map(([name,value])=>[name,value] as const);
  await saveWorldScale({projectId:f.P},f.W,1209.6,1);const next=await openWorldForReading((await db.generatedWorlds.get(f.W))!,'places');check(next.ok&&next.world.data===held&&held.mapWidthKm===1209.6&&buffers.every(([name,value])=>(held as any)[name]===value),'Private readable cache stale/replaced terrain');
  await saveWorldScale({projectId:f.P},f.W,null,2);await openWorldForReading((await db.generatedWorlds.get(f.W))!,'places');check(!Object.hasOwn(held,'mapWidthKm')&&held.scaleRevision===3,'Private cache retained reset override');
  const surface=new SculptSurface({worldWidth:128,worldHeight:64,mesh:16,palette:Array.from({length:44},()=>[.5,.5,.5] as [number,number,number])});try{surface.uploadAll(data.elevation,data.biome);surface.setExaggeration(18);const legacy=surface.yMul,height=surface.heightAtUV(.25,.375);check(legacy===elevKmToY(18,128),'Legacy 3D factor changed');surface.setExaggeration(18,.5);check(surface.yMul===legacy*.5&&surface.heightAtUV(.25,.375)===height,'3D calibration altered raw height/exaggeration');}finally{surface.dispose();}
  return{original,json,clone,zip,zipBytes:archive.blob.size,snapshot:{storedMetadataAbsent:true,readRehydrated:true,samePrivateObjectAndBuffers:true,resetRemoved:true},surface:{legacyPreserved:true,rawHeightExact:true,physicalFactorHalf:true,limits:'Real THREE surface/material CPU state; no WebGL draw or UI camera claim'}};
 }finally{for(const id of owned)await deleteProject(id);for(const id of snapshotIds)await dropSnapshot(id);await db.settings.delete('projectDuplicate.operation.'+operation);}
}
