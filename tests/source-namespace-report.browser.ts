import '@/engines';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {publishEdition,restorePublishedEdition} from '@/services/publishedEditions/store';
import {saveWorldEra} from '@/services/worldEras/store';

export async function testSourceNamespaceReport(){
 const passed:string[]=[];
 for(const eraId of [undefined,'past']){
  const projectId=crypto.randomUUID(),id='same-source-id',chapterId=crypto.randomUUID();
  const content=['missing.one','missing.two','present.source','missing.one'].map(namespace=>`<figure data-wh-tool-block="true" data-project-id="${projectId}" data-tool-kind="local-tool" data-document-id="${id}" data-namespace="${namespace}"></figure>`).join('');
  try{
   await db.projects.put({id:projectId,title:'Namespace restoration fixture',type:'standalone',mode:'custom',enabledEngines:['writings'],createdAt:1,updatedAt:1,sourceToolDocuments:[{id,namespace:'present.source',title:'Existing',revision:0,createdAt:1,updatedAt:1,data:{text:'SOURCE_STAYS_EXACT'}}]});
   await db.writings.put({id:chapterId,projectId,title:'Chapter',content,wordCount:0,status:'draft',tags:[],createdAt:1,updatedAt:1});
   if(eraId)await saveWorldEra(projectId,{id:eraId,name:'Past',description:'',revision:0,createdAt:1,updatedAt:1},null);
   const edition=await publishEdition({projectId,eraId,chapterIds:[chapterId],title:'Frozen',locale:'en',expectedRevision:0});
   const restored=await restorePublishedEdition({projectId,editionId:edition.edition.id,targetEraId:eraId,expectedRevision:1});
   if(restored.missingReferences.length!==1||restored.missingReferences[0].id!==id||restored.missingReferences[0].chapterId!==chapterId)throw Error('Exact invalid namespaces must produce one existing-contract warning per chapter/document');
   if(restored.writings[0].content!==content)throw Error('Restoring warnings changed authored atoms');
   if((await db.projects.get(projectId))!.sourceToolDocuments![0].data.text!=='SOURCE_STAYS_EXACT')throw Error('Restoring a warning changed its source');
   passed.push(`${eraId??'Base'}: multiple invalid namespaces cannot hide behind a valid ID or duplicate missing-reference output; atoms/source exact`);
  }finally{await deleteProject(projectId);}
 }
 return passed;
}
