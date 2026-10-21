import Dexie,{type Transaction} from 'dexie';
import {db} from '@/db';
import {notifyProjectsChanged} from '@/db/operations';
import {validateProjectPin} from './types';

export async function setProjectPinned(projectId:string,pinned:boolean,expectedPinned:boolean){
 validateProjectPin(pinned);validateProjectPin(expectedPinned);if(typeof pinned!=='boolean'||typeof expectedPinned!=='boolean')throw Error('project_pin_invalid');
 return db.transaction('rw',db.projects,async tx=>{
  const project=await db.projects.get(projectId);if(!project)throw Error('project_missing');
  const previous=project.pinned??false;if(previous!==expectedPinned)throw Error('project_pin_conflict');
  if(previous!==pinned)await db.projects.update(projectId,{pinned,updatedAt:Math.max(Date.now(),project.updatedAt+1)});
  let outer:Transaction=tx;while(outer.parent)outer=outer.parent;outer.on('complete',()=>Dexie.ignoreTransaction(notifyProjectsChanged));
  return{projectId,pinned,previousPinned:previous,changed:previous!==pinned};
 });
}
