// QA-only seeding/inspection/cleanup. Candidate code is never imported here.
import '@/engines';
import '@/services/aiBridge/dispatch';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {saveWorldEra} from '@/services/worldEras/store';

const MARKER='own-runtime59-native-cold-r1';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const counts=async()=>Object.fromEntries(await Promise.all(db.tables.map(async table=>[table.name,await table.count()])));
const snapshot=async()=>JSON.stringify(await Promise.all(db.tables.map(async table=>[table.name,await table.toArray()])));
async function seed(){
 const initial=await counts();if(Object.values(initial).some(value=>value!==0))throw Error('Native requires a fresh empty private profile');
 const P=crypto.randomUUID(),Q=crypto.randomUUID();
 for(const id of[P,Q])await db.projects.add({id,title:MARKER+' '+id,description:MARKER,mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:[],engineOrder:[],createdAt:1,updatedAt:1});
 await saveWorldEra(P,{id:'past',name:'Own past',description:MARKER,revision:0,createdAt:1,updatedAt:1},null);
 return{P,Q,marker:MARKER,initial};
}
async function control(Q:string){if(!uuid.test(Q))throw Error('Own UUID required');return JSON.stringify({project:await db.projects.get(Q),variants:await db.worldEraVariants.where('projectId').equals(Q).toArray()});}
async function cleanup(input:{P:string;Q:string;contentHash:string;packageNamespace:string}){
 const projects=[];
 for(const id of[input.P,input.Q]){
  if(!uuid.test(id))throw Error('Own UUID required');const row=await db.projects.get(id);if(row&&row.description!==MARKER)throw Error('Refuse foreign cleanup');
  if(row)await deleteProject(id);
  const own:Record<string,number>={projects:await db.projects.where('id').equals(id).count()};
  for(const table of db.tables)if(table.name!=='projects'&&('projectId'in table.schema.idxByName||table.schema.primKey.name==='projectId'))own[table.name]=await table.where('projectId').equals(id).count();
  own.settings=(await db.settings.toArray()).filter(row=>row.key.includes(id)).length;
  projects.push({id,counts:own});if(Object.values(own).some(value=>value!==0))throw Error('Own indexed cleanup incomplete');
 }
 const inventory=db.tables.find(table=>table.name==='localToolPackages');
 if(inventory){const row=await inventory.get(input.contentHash);if(row){if(row.namespace!==input.packageNamespace)throw Error('Refuse foreign inventory cleanup');await inventory.delete(input.contentHash);}}
 // Actual production startup owns this one documented first-boot marker; no blanket settings clear.
 const startup=await db.settings.get('storage.persistRequestedAt');if(startup)await db.settings.delete('storage.persistRequestedAt');
 const tableCounts=await counts();return{projects,tableCounts,allOwnIndexedTablesEmpty:true,allTablesEmpty:Object.values(tableCounts).every(value=>value===0),startupMarkerRemoved:!!startup};
}
Reflect.set(window,'__runtime59QA',{seed,counts,snapshot,control,cleanup});
Reflect.set(window,'__runtime59QAReady',true);
