import Dexie,{type Transaction} from 'dexie';
import {db} from '@/db';
import {notifyProjectsChanged} from '@/db/operations';
import {normalizeProjectGenres} from './types';
export async function setProjectGenres(projectId:string,genres:unknown,expectedGenres:unknown){
 if(!Array.isArray(genres)||!Array.isArray(expectedGenres))throw Error('project_genres_invalid');
 const next=normalizeProjectGenres(genres),expected=normalizeProjectGenres(expectedGenres);
 return db.transaction('rw',db.projects,async tx=>{
  const project=await db.projects.get(projectId);if(!project)throw Error('project_missing');
  if(JSON.stringify(normalizeProjectGenres(project.genres))!==JSON.stringify(expected))throw Error('project_genres_conflict');
  const updatedAt=Math.max(Date.now(),project.updatedAt+1);
  await db.projects.update(projectId,{genres:next,updatedAt});
  let outer:Transaction=tx;while(outer.parent)outer=outer.parent;outer.on('complete',()=>Dexie.ignoreTransaction(notifyProjectsChanged));
  return{projectId,genres:next,previousGenres:normalizeProjectGenres(project.genres),updatedAt};
 });
}
