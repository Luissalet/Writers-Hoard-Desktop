import {db} from '@/db';
import {getLocalToolDefinition,localToolEngineId} from './definitions';
import {localToolContentHash} from './releaseFormat.mjs';

export interface RuntimeUsageInstance {kind:'legacy'|'era-state'|'document'|'era-variant'|'archive';documentId?:string;eraId?:string;eraName?:string;title?:string;hidden?:boolean;archived?:boolean;path:string|null}
export async function readRuntimeUsage(contentHash:string){
  if(!localToolContentHash(contentHash))throw Error('local_runtime_trial_hash_invalid');
  return db.transaction('r',[db.localToolPackages,db.projects,db.worldEraVariants,db.documentArchives],async()=>{
    const packet=await db.localToolPackages.get(contentHash);
    if(!packet)throw Error('local_runtime_trial_package_not_found');
    const [projects,variants,archives]=await Promise.all([db.projects.toArray(),db.worldEraVariants.filter(row=>row.kind==='local-tool').toArray(),db.documentArchives.filter(row=>row.kind==='local-tool').toArray()]);
    return{contentHash,members:packet.manifest.members.map(member=>({namespace:member.namespace,projects:projects.flatMap(project=>{
      const namespace=member.namespace,pin=project.localToolInstallations?.[namespace],instances:RuntimeUsageInstance[]=[];
      const route=(documentId?:string,eraId?:string,legacy=false)=>`/project/${encodeURIComponent(project.id)}/${localToolEngineId(namespace)}?`+new URLSearchParams({...documentId?{document:documentId}:{},...eraId?{era:eraId}:{},...legacy?{legacy:'1'}:{}}).toString();
      if(project.localToolStates?.[namespace])instances.push({kind:'legacy',path:route(undefined,undefined,true)});
      for(const era of project.worldEras??[])if(era.localToolStates?.[namespace])instances.push({kind:'era-state',eraId:era.id,eraName:era.name,path:route(undefined,era.id,true)});
      for(const document of project.sourceToolDocuments??[])if(document.namespace===namespace)instances.push({kind:'document',documentId:document.id,title:document.title,path:route(document.id)});
      for(const variant of variants.filter(row=>row.projectId===project.id)){
        const root=variant.document?.root??[...variant.history??[]].reverse().find(row=>row.document?.root)?.document?.root??project.sourceToolDocuments?.find(row=>row.id===variant.entityId);
        if(root?.namespace===namespace)instances.push({kind:'era-variant',documentId:variant.entityId,eraId:variant.eraId,eraName:project.worldEras?.find(era=>era.id===variant.eraId)?.name,...(typeof root.title==='string'?{title:root.title}:{}),hidden:variant.hidden===true,archived:variant.archived===true,path:variant.hidden||variant.archived?null:route(variant.entityId,variant.eraId)});
      }
      for(const archive of archives.filter(row=>row.projectId===project.id))if(archive.metadata?.item.namespace===namespace)instances.push({kind:'archive',documentId:archive.sourceId,title:archive.title,archived:true,path:null});
      if(!pin&&!instances.length)return[];
      const selectedHash=pin?.contentHash??null,development=!!getLocalToolDefinition(namespace);
      return[{projectId:project.id,title:project.title,enabled:project.enabledEngines.includes(localToolEngineId(namespace)),selectedHash,selection:selectedHash===contentHash?'requested' as const:selectedHash?'other' as const:development?'development' as const:'unselected' as const,instances}];
    }).sort((a,b)=>a.projectId<b.projectId?-1:a.projectId>b.projectId?1:0)}))};
  });
}
