import '@/engines';
import {db} from '@/db';
import {deleteProject,exportProjectData,importProjectData,exportFullDatabase,importFullDatabase} from '@/db/operations';
import {createProjectZipArchive,importProjectZip,createFullZipArchive,importFullZip} from '@/services/zipBackup';
import {normalizeProjectGenres} from '@/services/projectGenres/types';
import {setProjectGenres} from '@/services/projectGenres/store';
import {validateProjectArchiveMetadata,preserveLegacyProjectMetadata} from '@/services/projectArchiveMetadata';
import type {Project} from '@/types';
const check:(value:unknown,message:string)=>asserts value=(value,message)=>{if(!value)throw Error(message);};
export async function testProjectGenres(){
 const P='genres-fixture',clones:string[]=[],genres=['Fantasy','Ensayo histórico 🧭'];
 const project:Project={id:P,title:'Main world genres',description:'Authored description',mode:'custom',type:'standalone',color:'#777777',status:'draft',enabledEngines:['codex'],engineOrder:['codex'],createdAt:1,updatedAt:1};
 await deleteProject(P);await db.projects.put(project);const passed:string[]=[];
 try{
  check(JSON.stringify(normalizeProjectGenres([' fantasy ','FANTASY','Ensayo histórico 🧭']))===JSON.stringify(genres),'Genre normalization lost suggestions/custom Unicode');
  await setProjectGenres(P,genres,[]);let refused=false;try{await setProjectGenres(P,['Horror'],[]);}catch{refused=true;}
  check(refused&&JSON.stringify((await db.projects.get(P))!.genres)===JSON.stringify(genres),'Stale genre write overwrote metadata');
  try{await db.transaction('rw',db.projects,async()=>{await setProjectGenres(P,['Horror'],genres);throw Error('abort genre transaction');});}catch{/* Expected outer abort. */}
  check(JSON.stringify((await db.projects.get(P))!.genres)===JSON.stringify(genres),'Genre write escaped its outer transaction');
  const current=(await db.projects.get(P))!;check(current.description===project.description&&current.enabledEngines.join(',')==='codex','Genre edit changed other project metadata');
  passed.push('Main-project genres support suggestions/custom Unicode, field CAS and outer rollback without changing engine presets');
  const data=await exportProjectData(P),copy=await importProjectData(data);clones.push(copy);check(JSON.stringify((await db.projects.get(copy))!.genres)===JSON.stringify(genres),'Project JSON clone lost genres');
  const zip=await createProjectZipArchive(P);await deleteProject(P);await importProjectZip(new File([zip.blob],'genres.zip'));check(JSON.stringify((await db.projects.get(P))!.genres)===JSON.stringify(genres),'Project ZIP restore lost genres');
  const full=await exportFullDatabase();await db.projects.update(P,{genres:[]});await importFullDatabase(full);check(JSON.stringify((await db.projects.get(P))!.genres)===JSON.stringify(genres),'Full JSON lost genres');
  const allZip=await createFullZipArchive();await db.projects.update(P,{genres:[]});await importFullZip(new File([allZip.blob],'genres-all.zip'));check(JSON.stringify((await db.projects.get(P))!.genres)===JSON.stringify(genres),'Full ZIP lost genres');
  passed.push('Project JSON clone, project ZIP restore and full JSON/ZIP preserve genre labels on the same Project');
  check(JSON.stringify(preserveLegacyProjectMetadata({},current).genres)===JSON.stringify(genres),'Legacy absence erased genres');
  check(preserveLegacyProjectMetadata({genres:[]},current).genres.length===0,'Explicit [] failed to clear genres');
  refused=false;try{validateProjectArchiveMetadata({genres:[42]});}catch{refused=true;}check(refused,'Malformed genre metadata accepted');
  const bad=structuredClone(data);Object.assign(bad.project!,{genres:['Fantasy',42]});const before=(await db.projects.toArray()).map(row=>row.id).sort().join();refused=false;try{await importProjectData(bad);}catch{refused=true;}
  check(refused&&(await db.projects.toArray()).map(row=>row.id).sort().join()===before,'Malformed genre import wrote a project');
  passed.push('Legacy absence preserves genres, explicit [] clears, malformed imported labels reject before writes');
  return passed;
 }finally{for(const id of clones)await deleteProject(id);await deleteProject(P);}
}
