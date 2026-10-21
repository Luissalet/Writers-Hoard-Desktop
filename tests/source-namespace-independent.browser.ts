import '@/engines';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {publishEdition,restorePublishedEdition} from '@/services/publishedEditions/store';
import {capturePublicationSnapshot,publicationReaderSource} from '@/services/publishedEditions/snapshot';
import {resolveToolPreview} from '@/components/editor/toolBlocks/preview';
import {saveWorldEra} from '@/services/worldEras/store';
function check(v:unknown,m:string):asserts v{if(!v)throw Error(m);}
export async function testSourceNamespaceIndependent(){
 const results:string[]=[];
 for(const eraId of [undefined,'past']){
  const P='own-src1-'+crypto.randomUUID(),one='shared-id',two='other-id';
  const sources=[{id:one,namespace:'own.source-a',title:'Source A',revision:0,createdAt:1,updatedAt:1,data:{token:'OWN_ACTUAL_A'},preview:{version:1 as const,fields:[{key:'token'}]}},{id:two,namespace:'own.source-b',title:'Source B',revision:0,createdAt:1,updatedAt:1,data:{token:'OWN_ACTUAL_B'},preview:{version:1 as const,fields:[{key:'token'}]}}];
  const block=(id:string,ns:string)=>`<figure data-wh-tool-block="true" data-project-id="${P}" data-tool-kind="local-tool" data-document-id="${id}" data-namespace="${ns}"></figure>`;
  const chapters=[{id:'chapter-a',content:block(one,'missing.one')+block(one,'missing.two')+block(one,'own.source-a')+block(one,'missing.one')+`<a href="/project/${P}/codex?entry=${one}">Same ID, other kind</a>`},{id:'chapter-b',content:block(one,'own.source-a')+block(one,'missing.three')+block(one,'missing.three')+block(two,'own.source-a')+block(two,'own.source-b')},{id:'chapter-valid',content:block(one,'own.source-a')+block(two,'own.source-b')}];
  try{
   await db.projects.put({id:P,title:'Own SRC1 identity',type:'standalone',mode:'custom',enabledEngines:['writings','codex'],createdAt:1,updatedAt:1,sourceToolDocuments:sources});
   await db.codexEntries.put({id:one,projectId:P,title:'Same ID different kind',type:'concept',fields:{},content:'<p>Other kind</p>',tags:[],relations:[],createdAt:1,updatedAt:1});
   await db.writings.bulkPut(chapters.map(row=>({...row,projectId:P,title:row.id,wordCount:0,tags:[],status:'draft' as const,createdAt:1,updatedAt:1})));
   if(eraId)await saveWorldEra(P,{id:eraId,name:'Past',description:'',revision:0,createdAt:1,updatedAt:1},null);
   const captured=publicationReaderSource(await capturePublicationSnapshot({projectId:P,eraId}));
   const validA=await resolveToolPreview({projectId:P,kind:'local-tool',documentId:one,namespace:'own.source-a',label:'A'},P,'en',{source:captured}),validB=await resolveToolPreview({projectId:P,kind:'local-tool',documentId:two,namespace:'own.source-b',label:'B'},P,'en',{source:captured}),wrong=await resolveToolPreview({projectId:P,kind:'local-tool',documentId:two,namespace:'own.source-a',label:'Wrong'},P,'en',{source:captured});
   check(validA?.html.includes('OWN_ACTUAL_A')&&!validA.html.includes('OWN_ACTUAL_B')&&validB?.html.includes('OWN_ACTUAL_B')&&wrong===null,'Actual source identity was matched by namespace or ID alone');
   const original=JSON.stringify((await db.projects.get(P))!.sourceToolDocuments),edition=await publishEdition({projectId:P,eraId,title:'Frozen identity',chapterIds:chapters.map(c=>c.id),locale:'en',expectedRevision:0});
   const restored=await restorePublishedEdition({projectId:P,editionId:edition.edition.id,targetEraId:eraId,expectedRevision:1}),keys=restored.missingReferences.map(ref=>JSON.stringify([ref.kind,ref.id,ref.chapterId]));
   const expected=[['local-tool',one,'chapter-a'],['local-tool',one,'chapter-b'],['local-tool',two,'chapter-b']].map(x=>JSON.stringify(x)).sort();
   check(new Set(keys).size===keys.length&&JSON.stringify(keys.sort())===JSON.stringify(expected),'Multiple bad namespaces must coalesce only within exact kind/id/chapter: '+JSON.stringify(restored.missingReferences));
   check(restored.writings.every((row,i)=>row.content===chapters[i].content),'Warning calculation changed authored atom bytes');
   check(JSON.stringify((await db.projects.get(P))!.sourceToolDocuments)===original,'Restore warning changed actual source data');
   results.push(`${eraId??'Base'}: multiple invalid namespaces coalesce per kind/id/chapter, valid controls stay clean, two source identities and restored atoms/data remain exact`);
  }finally{await deleteProject(P);}
 }
 return results;
}
