import type { Transaction } from 'dexie';
import { db } from '@/db';
import { PROJECT_SETTING_PREFIXES, projectSettingKeys } from '@/db/operations';
import { eraDocumentVersion } from '@/services/worldEras/adapters';
import type { EraRow } from '@/services/worldEras/types';
import type { Project } from '@/types';
import type { DuplicateRow, ProjectDuplicateSnapshot } from './types';

/** Explicit source inventory: no global data or derived world tiles enter a copy. */
export const DUPLICATE_PROJECT_TABLES = [
  'manuscriptSources','worldEraVariants','worldEraAssets','documentArchives','documentHistory',
  'codexEntries','writings','timelines','timelineEvents','timelineConnections','boards','boardNodes','boardEdges','boardLayers','boardViews',
  'worldMaps','mapPins','atlasPlaces','atlasDivergences','imageCollections','inspirationImages',
  'storyboards','storyboardPanels','scenes','dialogBlocks','videoPlans','videoSegments','snapshots','biographies','biographyFacts','diaryEntries',
  'outlines','outlineBeats','writingSessions','writingGoals','characterArcs','arcBeats','relationships','seeds','payoffs','annotations','writingSnapshots',
  'generatedWorlds','worldWaypoints','notes','entityLinks','citations','publishingProfiles','conversionReceipts','aiThreads','aiMessages','aiProjectSettings',
  'visualRefs','imageRecipes','projectReferenceLinks','judgeRuns','judgeFindings','creativeBranches','creativeBranchDeltas','branchPromotionReceipts',
  'narrativeMoments','storyClaims','sharedEntityBindings','inquiryCases','inquiryClaims','inquiryHypotheses','inquiryRatings','enrichmentRuns',
  'betaPackages','betaResponses','betaComments','referencePins','genealogyLinks','localMediaAssets',
] as const;
export const DUPLICATE_CHILD_TABLES = { annotationReferences:['annotations','annotationId'], sceneCasts:['scenes','sceneId'], storyboardConnectors:['storyboards','storyboardId'] } as const;
export const DUPLICATE_SHARED_TABLES = ['tags','referenceDocuments','referenceSections','referenceLenses'] as const;
export const DUPLICATE_CACHE_TABLES = ['worldSnapshots','canonTiles','renderedTiles'] as const;
export function duplicateSchemaCoverage() {
  const declared = new Set<string>(['projects','settings','sharedCanonEntities',...DUPLICATE_PROJECT_TABLES,...Object.keys(DUPLICATE_CHILD_TABLES),...DUPLICATE_SHARED_TABLES,...DUPLICATE_CACHE_TABLES]);
  return { declared:[...declared].sort(), missing:db.tables.map(table=>table.name).filter(name=>!declared.has(name)), obsolete:[...declared].filter(name=>!db.tables.some(table=>table.name===name)) };
}
/** Requests use the supplied transaction even after asynchronous hashing by callers. */
export async function captureProjectDuplicate(tx: Transaction, projectId: string): Promise<ProjectDuplicateSnapshot> {
  const project = await tx.table('projects').get(projectId) as Project | undefined;
  if (!project) throw Error('project_duplicate_source_missing');
  const tables: Record<string, DuplicateRow[]> = {};
  await Promise.all(DUPLICATE_PROJECT_TABLES.map(async name => { tables[name] = await tx.table(name).where('projectId').equals(projectId).toArray(); }));
  await Promise.all(Object.entries(DUPLICATE_CHILD_TABLES).map(async ([name,[parent,field]])=>{
    const ids=tables[parent].map(row=>row.id as string);
    tables[name]=ids.length?await tx.table(name).where(field).anyOf(ids).toArray():[];
  }));
  tables.sharedCanonEntities=await tx.table('sharedCanonEntities').where('seriesId').equals(projectId).toArray();
  const keys=[...projectSettingKeys(projectId),...(project.worldEras??[]).map(era=>PROJECT_SETTING_PREFIXES.tableReadVoices+projectId+'.era:'+era.id)];
  tables.settings=await tx.table('settings').where('key').anyOf(keys).toArray();
  const parent=project.parentId?await tx.table('projects').get(project.parentId) as Project|undefined:undefined;
  return {project,parent,tables};
}
export function readProjectDuplicate(projectId:string) { return db.transaction('r',db.tables,tx=>captureProjectDuplicate(tx,projectId)); }
export function duplicateSnapshotVersion(snapshot:ProjectDuplicateSnapshot):Promise<string> {
  // Table enumeration order is not authored order. Fresh IDs can reorder an
  // index scan; keep nested arrays/order fields intact while hashing row sets.
  const tables=Object.fromEntries(Object.entries(snapshot.tables).map(([name,rows])=>[name,[...rows].sort((a,b)=>String(a.id??a.projectId).localeCompare(String(b.id??b.projectId)))]));
  return eraDocumentVersion({root:snapshot.project as unknown as EraRow,children:{...tables,...(snapshot.parent?{_parent:[snapshot.parent]}:{})} as Record<string,EraRow[]>});
}
export function snapshotManagedPaths(snapshot:ProjectDuplicateSnapshot):string[] {
  const paths=new Set<string>();
  for(const row of snapshot.tables.snapshots??[]) {
    for(const key of ['localMediaPath','capturePdfPath','captureImagePath','captureHtmlPath'])if(typeof row[key]==='string'&&row[key])paths.add(row[key]);
    for(const item of row.mediaItems as {relPath:string}[]|undefined??[])if(item.relPath)paths.add(item.relPath);
  }
  return [...paths].sort();
}
