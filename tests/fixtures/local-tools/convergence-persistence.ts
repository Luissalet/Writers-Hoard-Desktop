/** Proposed tests/fixtures/local-tools/convergence-persistence.ts. Private harness DB only. */
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {defineLocalTool,type LocalToolJson,type LocalToolDefinition} from '@/engines/local/sdk';
import type {LocalToolStateCodec} from '@/engines/local/stateCodec';
import {registerLocalToolModules} from '@/engines/local/registry';
import type {LocalToolReleaseManifest} from '@/engines/local/releaseFormat.mjs';
import {pinLocalToolRelease} from '@/engines/local/releases';
import {createSourceToolDocument,readSourceToolDocument} from '@/engines/local/documents/store';
import type {SourceToolDocument} from '@/engines/local/documents/types';
import type {WorldEraScope} from '@/services/worldEras/types';
export type PersistData={value:number;min:number;max:number;notes:string;labels:Record<string,LocalToolJson>;items:{id:string;text:string}[];link:LocalToolJson;opaque:LocalToolJson};
export const NS='tests.convergence-persistence',V1='6'.repeat(64),V2='7'.repeat(64);
export const options1={authorId:'persistence-host',validationId:V1,schemaEpoch:'schema-1'},options2={...options1,validationId:V2};
export const codec:LocalToolStateCodec={version:1,fields:{value:{kind:'scalar'},min:{kind:'scalar'},max:{kind:'scalar'},notes:{kind:'prose'},labels:{kind:'map'},items:{kind:'list',idKey:'id'},link:{kind:'reference'}}};
export const initial:PersistData={value:0,min:0,max:10,notes:'Initial Élodie 漢字',labels:{},items:[],link:null,opaque:{literal:'Keep 🐚 and opaque IDs'}};
export const assert:(value:unknown,message:string)=>asserts value=(value,message)=>{if(!value)throw Error('CONVERGENCE_PERSISTENCE: '+message);};
export function canonical(value:unknown):string{const sort=(value:unknown):unknown=>Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,value])=>[key,sort(value)])):value;return JSON.stringify(sort(value));}
export async function refused(run:()=>unknown,includes?:string){let failure:unknown;try{await run();}catch(error){failure=error;}assert(failure,'Expected rejection'+(includes?' '+includes:''));if(includes)assert(String(failure).includes(includes),'Wrong rejection '+String(failure));return String(failure);}
export function fixtureDefinitions(){
 let validatorCalls=0,forbidValidation=false;
 const validateState=(value:LocalToolJson):value is PersistData=>{
  validatorCalls++;if(forbidValidation)throw Error('PACKAGE_VALIDATOR_MUST_NOT_RUN');
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const row=value as Record<string,LocalToolJson>;
  return typeof row.value==='number'&&typeof row.min==='number'&&typeof row.max==='number'&&row.min<=row.max&&typeof row.notes==='string'&&!!row.labels&&typeof row.labels==='object'&&!Array.isArray(row.labels)&&Array.isArray(row.items)&&row.items.every(item=>!!item&&typeof item==='object'&&!Array.isArray(item)&&typeof item.id==='string'&&typeof item.text==='string')&&Object.hasOwn(row,'opaque')&&Object.hasOwn(row,'link');
 };
 const one=defineLocalTool<PersistData>({namespace:NS,name:{en:'Persistence fixture',es:'Prueba persistencia'},description:{en:'Private durable Source contract',es:'Contrato privado Source'},document:{defaultTitle:{en:'Persistence document',es:'Documento persistente'}},codec,initialState:structuredClone(initial),validateState,component:()=>null});
 const two=defineLocalTool<PersistData>({...one,name:{en:'Persistence fixture v2',es:'Prueba persistencia v2'},component:()=>null});
 const manifest=(hash:string,version:string):LocalToolReleaseManifest=>({format:'writers-hoard-local-tool-source/1',apiVersion:1,namespace:NS,contentHash:hash,version,files:[{path:'module.tsx',sha256:'f'.repeat(64),bytes:1}]});
 const releases=[manifest(V1,'1'),manifest(V2,'2')];
 registerLocalToolModules({[`./installed/${NS}/module.tsx`]:{default:one},[`./installed/${NS}/versions/${V1}/module.tsx`]:{default:one},[`./installed/${NS}/versions/${V2}/module.tsx`]:{default:two}},Object.fromEntries(releases.map(release=>[`./installed/${NS}/versions/${release.contentHash}/release.json`,release])));
 return{one,two,forbid(value:boolean){forbidValidation=value;},calls:()=>validatorCalls};
}
export async function seedProject(id:string){
 await db.projects.add({id,title:'Owned convergence persistence',description:'Literal project prose Élodie 漢字',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:[`local-tool-${NS}`],engineOrder:[],createdAt:1,updatedAt:1});
 await pinLocalToolRelease(id,NS,V1,null);
}
export async function row(scope:WorldEraScope,id:string):Promise<SourceToolDocument>{const found=await readSourceToolDocument(scope,id,NS);assert(found,'Missing owned Source '+id);return found.document;}
export async function newDocument(scope:WorldEraScope,title:string){return createSourceToolDocument(scope,NS,title);}
/** All own rows with a projectId index, plus the actual Project. No global catalog/settings scan. */
export async function ownSnapshot(projectId:string):Promise<string>{
 return db.transaction('r',db.tables,async()=>{
  const tables:Record<string,unknown>={projects:await db.projects.get(projectId)};
  for(const table of db.tables)if(table.schema.indexes.some(index=>index.keyPath==='projectId'))tables[table.name]=(await table.where('projectId').equals(projectId).toArray()).sort((a,b)=>String(a.id)<String(b.id)?-1:String(a.id)>String(b.id)?1:0);
  return canonical(tables);
 });
}
export async function cold(){db.close();await db.open();}
export async function cleanup(projectIds:Iterable<string>){
 if(!db.isOpen())await db.open();for(const id of projectIds){await deleteProject(id);assert(!await db.projects.get(id),'Cleanup retained Project '+id);for(const table of db.tables)if(table.schema.indexes.some(index=>index.keyPath==='projectId'))assert(await table.where('projectId').equals(id).count()===0,'Cleanup retained '+table.name+' for '+id);}
}
export function contract(definition:LocalToolDefinition<PersistData>,validationId=V1){return{namespace:NS,codec:definition.codec!,validationId,schemaEpoch:'schema-1',validateState:definition.validateState};}
