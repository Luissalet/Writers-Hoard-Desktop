import '@/engines';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { duplicateProject, previewProjectDuplicate } from '@/services/projectDuplicate/service';
import { readProjectDuplicate, duplicateSnapshotVersion, DUPLICATE_PROJECT_TABLES, DUPLICATE_CHILD_TABLES } from '@/services/projectDuplicate/capture';
import { restoreArchivedDocument } from '@/services/documentArchive/store';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import { seedDuplicateCore } from './project-duplicate.browser';
import { seedDuplicateFamilies, seedDuplicateMetadata } from './project-duplicate-full.fixture';
import type { DuplicateRow } from '@/services/projectDuplicate/types';
import { projectCodexEntry } from '@/engines/codex/properties';

const assert:(value:unknown,message:string)=>asserts value=(value,message)=>{if(!value)throw Error(message);};
export async function testProjectDuplicateAllFamilies(){
 const{id,parent}=await seedDuplicateCore(),clones:string[]=[],out:string[]=[];
 try{
  await db.projects.update(id,{type:'saga',parentId:undefined,children:['external-child-not-copied']});
  const seeded=await seedDuplicateFamilies(id),frozen=await seedDuplicateMetadata(id,seeded.id);const source=await readProjectDuplicate(id),sourceHash=await duplicateSnapshotVersion(source);
  const sourceProjection=projectCodexEntry(source.tables.codexEntries.find(row=>row.title==='Iria') as never,source.project.codexTemplates);assert(sourceProjection.properties.double.value==='8'&&sourceProjection.properties.label.options?.[0].color==='#ffcc00','source fixture must project valid formulas and option colors before copying');
  for(const table of [...DUPLICATE_PROJECT_TABLES,...Object.keys(DUPLICATE_CHILD_TABLES),'sharedCanonEntities'])assert(source.tables[table].length>0,`fixture must exercise copied table ${table}`);
  const preview=await previewProjectDuplicate({projectId:id}),result=await duplicateProject({projectId:id,title:'All authored families',operationId:crypto.randomUUID(),expectedSourceVersion:preview.sourceVersion});clones.push(result.projectId);
  const copy=await readProjectDuplicate(result.projectId);
  for(const[table,rows]of Object.entries(source.tables))assert(copy.tables[table].length===rows.length,`lost ${table} rows ${copy.tables[table].length}/${rows.length}`);
  assert(copy.project.children?.length===0&&!copy.parent&&source.project.children?.[0]==='external-child-not-copied','saga copied original children');
  const first=(table:string)=>copy.tables[table][0],find=(table:string,field:string,value:unknown)=>copy.tables[table].find(row=>row[field]===value)!;
  const card=find('codexEntries','title','Iria'),chapter=first('writings'),beat=first('outlineBeats'),scene=first('scenes'),clip=first('snapshots'),citation=first('citations');
  assert(first('biographies').subjectId===card.id&&(first('biographyFacts').sources as DuplicateRow[])[0].entityId===clip.id,'biography source/subject crossed project');
  assert(beat.linkedWritingId===chapter.id&&beat.linkedSceneId===scene.id&&first('arcBeats').linkedBeatId===beat.id&&first('payoffs').seedId===first('seeds').id,'outline/arc/seed/payoff references not local');
  assert(first('storyboardPanels').imageRef===first('inspirationImages').id&&first('storyboardPanels').linkedSceneId===scene.id&&first('storyboardConnectors').targetId===first('storyboardPanels').id,'storyboard image/scene/parent-only connector escaped');
  assert((first('inquiryClaims').supports as DuplicateRow[])[0].citationId===citation.id&&(first('inquiryClaims').supports as DuplicateRow[])[0].evidenceId===(citation.researchEvidence as DuplicateRow[])[0].id,'inquiry evidence pairing wrong');
  assert(first('inquiryRatings').id===`${first('inquiryHypotheses').id}|${first('inquiryClaims').id}`,'inquiry composite key not reconstructed');
  assert(first('referencePins').id===`book:${copy.project.id}`&&first('genealogyLinks').id===`${copy.project.id}\0${first('genealogyLinks').linkId}`&&first('aiProjectSettings').projectId===copy.project.id,'special key identities wrong');
  assert(first('worldMaps').source==='worldgen'&&first('worldMaps').sourceWorldId===first('generatedWorlds').id&&first('mapPins').sourceWaypointId===first('worldWaypoints').id,'worldgen/map lineage stripped');
  assert((first('worldMaps').versions as DuplicateRow[])[0].sourceWorldId===first('generatedWorlds').id&&((first('worldMaps').versions as DuplicateRow[])[0].pins as DuplicateRow[])[0].sourceWaypointId===first('worldWaypoints').id,'historical map lineage stripped');
  assert(first('sharedCanonEntities').seriesId===copy.project.id&&first('sharedEntityBindings').sharedEntityId===first('sharedCanonEntities').id,'saga owned shared identity wrong');
  assert(first('projectReferenceLinks').documentId===seeded.id('referenceDocuments')&&await db.referenceDocuments.get(seeded.id('referenceDocuments'))&&await db.referenceSections.count()===1&&await db.referenceLenses.count()===1&&await db.tags.count()===1,'shared globals duplicated or replaced');
  const worldId=String(first('generatedWorlds').id);assert(!await db.worldSnapshots.get(worldId)&&!await db.canonTiles.where('worldId').equals(worldId).count()&&!await db.renderedTiles.where('worldId').equals(worldId).count(),'derived cache copied under new world');
  assert((first('betaResponses').reactions as DuplicateRow)[String(chapter.id)]&&first('betaComments').writingId===chapter.id,'beta chapter map/comment associations wrong');
  assert((first('notes').text as string).includes('Literal <p>same</p>'),'plain note parsed as markup');
  const effective=projectCodexEntry(card as never,copy.project.codexTemplates);assert(effective.properties.double.value==='8'&&effective.properties.label.options?.[0].color==='#ffcc00','effective formula or option palette lost');
  const synced=copy.project.dataTables!.find(table=>table.title==='Synced values')!;assert(synced.columns[0].id==='property:p-count'&&synced.rows[0].cells['property:p-count']==='4'&&synced.codexTemplateId===copy.project.codexTemplates![0].id,'synced schema column/cells diverged');
  assert(copy.project.publishedEditions![0].reader.html===frozen.html&&copy.project.wikiProfiles![0].editions![0].reader.html===frozen.html&&copy.project.publishedEditions![0].reader.sha256===frozen.hash,'frozen artifact bytes changed');
  assert(copy.project.readerPresentation!.chapters[String(chapter.id)].audio!.assetId===first('localMediaAssets').id&&copy.project.readerPresentation!.cover.jacket!.elements[0].id!=='jacket-title','reader audio/own jacket identities wrong');
  const flow=copy.project.writingWorkflows![0];assert(flow.materials.length===4&&flow.materials.find(item=>item.kind==='citation')!.id===citation.id&&flow.materials.find(item=>item.kind==='snapshot')!.id===clip.id&&flow.exports[0].stepId===flow.steps[0].id&&flow.exports[0].output==='same literal export','workflow complete materials/step identity/prose lost');
  const possibility=copy.project.creativePossibilities![0];assert(possibility.provenance.sources[0].id===first('boardNodes').id&&possibility.provenance.sources[1].id==='same'&&possibility.provenance.sources[1].projectId==='external-project'&&possibility.promotion!.entityId===beat.id,'creative provenance ownership/typed promotion lost');
  const missing=copy.project.dictionaries![0].words[0].linkedEntryId;assert(missing&&missing!=='missing-authored-reference'&&!copy.tables.codexEntries.some(row=>row.id===missing),'authored missing link erased or resurrected');
  assert(await duplicateSnapshotVersion(await readProjectDuplicate(id))===sourceHash,'copy changed source');
  out.push(`${DUPLICATE_PROJECT_TABLES.length+Object.keys(DUPLICATE_CHILD_TABLES).length+1} copied table policies exercised with authored family fixtures; per-table row parity and actual cross-engine links, composites, saga children/shared ownership, plain notes and map/live+historical worldgen lineage`);
  out.push('Effective formulas/colors, stable synced property cells, immutable book/wiki HTML bytes, Reader audio/jacket, complete workflows, creative local/external provenance, and orphan dictionary link preserve actual data semantics');
  const archive=first('documentArchives');await restoreArchivedDocument(copy.project.id,String(archive.id));assert((await db.codexEntries.where('projectId').equals(copy.project.id).toArray()).some(row=>row.title==='Deleted card remains recoverable'),'copied archive cannot restore deleted-only identity');assert(!(await db.codexEntries.where('projectId').equals(id).toArray()).some(row=>row.title==='Deleted card remains recoverable'),'archive restore resurrected original');
  out.push('Normal Archive restore of copied deleted-only card restores only target; original remains deleted');
  const archiveFile=await createProjectZipArchive(copy.project.id),beforeZip=await readProjectDuplicate(copy.project.id),wanted=Object.fromEntries(Object.entries(beforeZip.tables).filter(([table])=>table!=='settings').map(([table,rows])=>[table,rows.length]));
  await deleteProject(copy.project.id);await importProjectZip(new File([archiveFile.blob],'complete-project.zip'));
  const restored=await readProjectDuplicate(copy.project.id);for(const[table,count]of Object.entries(wanted))assert(restored.tables[table].length===count,`actual ZIP restore lost ${table}`);
  const original=(await db.manuscriptSources.where('projectId').equals(copy.project.id).first())!;assert(await original.original.text()==='Original portable manuscript','portable manuscript original bytes lost');
  out.push('Actual normal project ZIP export/delete/import restores all copied row families, recovered archive state and original manuscript bytes; existing session-only settings omission is not claimed as archive coverage');
  return out;
 }finally{for(const clone of clones)await deleteProject(clone);await deleteProject(id);await deleteProject(parent);for(const table of ['referenceDocuments','referenceSections','referenceLenses','tags'])await db.table(table).delete(`fixture-${id}-${table}`);}
}
