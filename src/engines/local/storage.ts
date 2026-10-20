import {db} from '@/db';
import {notifyProjectsChanged} from '@/db/operations';
import {cloneLocalToolJson,localToolNamespace,localToolJsonText,validateLocalToolStates,LocalToolStateError,type LocalToolJson} from './stateTypes';
import type {LocalToolClient,LocalToolCodexCard,LocalToolCodexQuery,LocalToolDefinition} from './sdk';
const categories=new Set(['character','location','item','faction','concept','magic','custom']);
export function createLocalToolClient<T extends LocalToolJson>(projectId:string,definition:LocalToolDefinition<T>):LocalToolClient<T>{
  if(typeof projectId!=='string'||!projectId||projectId.length>500||Array.from(projectId).some(character=>character.charCodeAt(0)<32))throw new LocalToolStateError('missing-project');
  if(!localToolNamespace(definition.namespace))throw new LocalToolStateError('invalid-namespace');
  const namespace=definition.namespace,initial=cloneLocalToolJson(definition.initialState);
  const parse=(value:LocalToolJson):T=>{const copy=cloneLocalToolJson(value);if(definition.validateState(copy)!==true)throw new LocalToolStateError('invalid-state');return copy;};
  return Object.freeze({projectId,namespace,
    async read(){const project=await db.projects.get(projectId);if(!project)throw new LocalToolStateError('missing-project');validateLocalToolStates(project.localToolStates);const current=project.localToolStates?.[namespace];return current?{revision:current.revision,updatedAt:current.updatedAt,data:parse(current.data)}:{revision:null,updatedAt:null,data:parse(initial)};},
    async save(data:T,expectedRevision:number|null){
      const safe=parse(data);if(expectedRevision!==null&&(!Number.isSafeInteger(expectedRevision)||expectedRevision<0))throw new LocalToolStateError('conflict');
      const saved=await db.transaction('rw',db.projects,async()=>{
        const project=await db.projects.get(projectId);if(!project)throw new LocalToolStateError('missing-project');validateLocalToolStates(project.localToolStates);
        const current=project.localToolStates?.[namespace];if(expectedRevision===null?current!==undefined:current?.revision!==expectedRevision)throw new LocalToolStateError('conflict');
        const revision=(current?.revision??0)+1;if(!Number.isSafeInteger(revision))throw new LocalToolStateError('conflict');
        const record={revision,updatedAt:Math.max(Date.now(),(current?.updatedAt??0)+1),data:safe},states={...project.localToolStates,[namespace]:record};
        validateLocalToolStates(states);await db.projects.update(projectId,{localToolStates:states,updatedAt:Math.max(record.updatedAt,project.updatedAt+1)});return record;
      });notifyProjectsChanged();return {...saved,data:cloneLocalToolJson(saved.data)};
    },
    async queryCodex(query:LocalToolCodexQuery={}){
      const {query:search='',type,ids,limit=20}=query;
      if(typeof search!=='string'||search.length>200||type!==undefined&&!categories.has(type)||!Number.isInteger(limit)||limit<1||limit>50||ids!==undefined&&(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string'||id.length>500)))throw new LocalToolStateError('invalid-query');
      if(!await db.projects.get(projectId))throw new LocalToolStateError('missing-project');const wanted=ids?new Set(ids):null,needle=search.toLocaleLowerCase();
      const cards:LocalToolCodexCard[]=[];
      await db.codexEntries.where('projectId').equals(projectId).filter(row=>(!type||row.type===type)&&(!wanted||wanted.has(row.id))&&(!needle||row.title.toLocaleLowerCase().includes(needle))).limit(limit).each(row=>{
        const safeFields=Object.entries(row.fields).filter(([key])=>!['constructor','prototype','__proto__'].includes(key)),fields=safeFields.slice(0,24),card:LocalToolCodexCard={id:row.id,title:row.title.slice(0,500),type:row.type,tags:row.tags.slice(0,20).map(tag=>tag.slice(0,80)),fields:Object.fromEntries(fields.map(([key,value])=>[key.slice(0,100),value.slice(0,256)])),truncated:row.title.length>500||row.tags.length>20||row.tags.some(tag=>tag.length>80)||safeFields.length!==Object.keys(row.fields).length||safeFields.length>24||fields.some(([key,value])=>key.length>100||value.length>256)};localToolJsonText(card as unknown as LocalToolJson);cards.push(card);
      });return cards;
    },
  });
}
