// Own QA seeder/inspection; product authority remains Source and ProjectWorkspace.
import '@/engines';
import {createRoot,type Root} from 'react-dom/client';
import {MemoryRouter,useLocation,useNavigate} from 'react-router-dom';
import {useLayoutEffect} from 'react';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {getEngine,type EngineDefinition} from '@/engines/_registry';
import ProjectWorkspace from '@/components/project/workspace/ProjectWorkspace';
import {useEnginePane} from '@/engines/_shared/EnginePaneContext';
import {registerLocalToolModules} from '@/engines/local/registry';
import {registerLocalAppModules} from '@/engines/local/apps';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {createLocalToolClient} from '@/engines/local/storage';
import {saveWorldEra} from '@/services/worldEras/store';
import {APP,WORLD_APP,CHILD,ownApp,ownWorldApp,child} from './local-app-host.author';
export {APP,WORLD_APP,CHILD};
export const MARKER='Own isolated SDK app Host QA',TAIL='OWN_ADMITTED_FINAL_TAIL_Élodie_李明';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export interface Fixture {projectId:string;foreignId:string;A:string;B:string;world:string;childId:string;canonicalId:string;canonicalTitle:string;large:boolean}
export function registerOwnApps(){
 registerLocalToolModules({['./installed/'+CHILD+'/module.tsx']:{default:child}});
 registerLocalAppModules({['./installed/'+APP+'/module.tsx']:{default:ownApp},['./installed/'+WORLD_APP+'/module.tsx']:{default:ownWorldApp}},{},{['./installed/'+APP+'/app-definition.json']:structuredClone(ownApp.app!.descriptor),['./installed/'+WORLD_APP+'/app-definition.json']:structuredClone(ownWorldApp.app!.descriptor)});
}
export async function seedOwnFixture(large=false):Promise<Fixture>{
 registerOwnApps();const projectId=crypto.randomUUID(),foreignId=crypto.randomUUID(),canonicalId=crypto.randomUUID(),canonicalTitle='OWN_CANON_EXCLUDED_'+canonicalId;
 try{
 for(const [id,title] of [[projectId,'Own SDK app Host QA'],[foreignId,'Own SDK foreign control']] as const)await db.projects.add({id,title,description:MARKER+'\n'+projectId+'\n'+foreignId,mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:[APP,WORLD_APP,CHILD].map(id=>'local-tool-'+id),engineOrder:['local-tool-'+APP],createdAt:1,updatedAt:1});
 const childDoc=await createSourceToolDocument({projectId},CHILD,'Own shared child'),A=await createSourceToolDocument({projectId},APP,'Own app A'),B=await createSourceToolDocument({projectId},APP,'Own app B'),world=await createSourceToolDocument({projectId},WORLD_APP,'Own world preset');
 const childClient=createLocalToolClient(projectId,child,{documentId:childDoc.id});await childClient.state!.apply(await childClient.read(),[{type:'set',field:'notes',value:(large?'Own admitted long prose '.repeat(12000):'Own editable Base prose. ')+TAIL}]);
 for(const [definition,id,motto] of [[ownApp,A.id,'Own Base A motto'],[ownApp,B.id,'Own Base B motto'],[ownWorldApp,world.id,'Own world motto']] as const){const client=createLocalToolClient(projectId,definition,{documentId:id});await client.state!.apply(await client.read(),[{type:'list-insert',field:'children',item:{id:'own/α%2F',document:{kind:'local-tool',documentId:childDoc.id},variant:id===B.id?'plain':'panel'},afterId:null},{type:'set',field:'motto',value:motto}]);}
 await saveWorldEra(projectId,{id:'past',name:'Own Past',description:'Own named scope',revision:0,createdAt:1,updatedAt:1},null);
 const eraApp=createLocalToolClient(projectId,ownApp,{documentId:A.id,eraId:'past'});await eraApp.state!.apply(await eraApp.read(),[{type:'set',field:'motto',value:'Own Past A motto'}]);
 const eraChild=createLocalToolClient(projectId,child,{documentId:childDoc.id,eraId:'past'});await eraChild.state!.apply(await eraChild.read(),[{type:'set',field:'notes',value:'Own named-era child prose. '+TAIL}]);
 await db.codexEntries.add({id:canonicalId,projectId,title:canonicalTitle,content:'<p>OWN_CANON_PROSE_EXCLUDED</p>',type:'concept',fields:{},tags:[],relations:[],createdAt:1,updatedAt:1});
 return {projectId,foreignId,A:A.id,B:B.id,world:world.id,childId:childDoc.id,canonicalId,canonicalTitle,large};
 }catch(error){try{await cleanupOwnFixture({projectId,foreignId} as Fixture);}catch(cleanupError){throw new AggregateError([error,cleanupError],'Own fixture preparation/cleanup failed');}throw error;}
}
export async function loadOwnFixture(projectId:string):Promise<Fixture>{
 if(!uuid.test(projectId))throw Error('Explicit own UUID required');registerOwnApps();const project=await db.projects.get(projectId);if(!project?.description.startsWith(MARKER+'\n'))throw Error('Project is not owned by this fixture');const parts=project.description.split('\n'),foreignId=parts[2];if(parts.length!==3||parts[1]!==projectId||!uuid.test(foreignId))throw Error('Owned fixture control identity invalid');
 const docs=project.sourceToolDocuments??[],get=(title:string,namespace:string)=>{const row=docs.find(row=>row.title===title&&row.namespace===namespace);if(!row)throw Error('Owned fixture document missing');return row.id;};
 const foreign=await db.projects.get(foreignId),canonical=(await db.codexEntries.where('projectId').equals(projectId).toArray())[0];if(foreign?.description!==project.description||!canonical)throw Error('Owned control rows missing');
 return {projectId,foreignId:foreign.id,A:get('Own app A',APP),B:get('Own app B',APP),world:get('Own world preset',WORLD_APP),childId:get('Own shared child',CHILD),canonicalId:canonical.id,canonicalTitle:canonical.title,large:false};
}
export const fixturePath=(fixture:Fixture,instanceId=fixture.A,eraId?:string)=>'/project/'+fixture.projectId+'/local-tool-'+APP+'?instance='+encodeURIComponent(instanceId)+(eraId?'&era='+encodeURIComponent(eraId):'');
export async function rawOwnSnapshot(){return JSON.stringify(await Promise.all(db.tables.map(async table=>[table.name,await table.toArray()])));}
export async function cleanupOwnFixture(fixture:Fixture){
 const outputs=[];for(const id of [fixture.projectId,fixture.foreignId]){if(!uuid.test(id))throw Error('Cleanup own UUID required');const row=await db.projects.get(id);if(row&&row.description!==MARKER+'\n'+fixture.projectId+'\n'+fixture.foreignId)throw Error('Refuse foreign cleanup');if(row)await deleteProject(id);const counts:Record<string,number>={projects:await db.projects.where('id').equals(id).count()};for(const table of db.tables)if(table.name!=='projects'&&('projectId'in table.schema.idxByName||table.schema.primKey.name==='projectId'))counts[table.name]=await table.where('projectId').equals(id).count();counts.settings=(await db.settings.toArray()).filter(row=>row.key.includes(id)).length;if(Object.values(counts).some(count=>count!==0))throw Error('Own cleanup incomplete '+JSON.stringify(counts));outputs.push({projectId:id,counts});}return {ownOnly:true,allOwnIndexedTablesEmpty:true,projects:outputs};
}
export async function waitFor(predicate:()=>boolean,label:string){const until=Date.now()+15000;while(Date.now()<until){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error(label);}
export function mountOwnWorkspace(fixture:Fixture,element:HTMLElement,eraId?:string){
 let navigate!:(path:string)=>void,beside!:(path:string)=>void;const engines=[APP,CHILD,WORLD_APP].map(id=>getEngine('local-tool-'+id)).filter(Boolean) as EngineDefinition[];
 function PanePorts(){const pane=useEnginePane();useLayoutEffect(()=>{beside=to=>pane?.openBeside?.(to);},[pane]);return null;}
 function Primary(){const location=useLocation(),go=useNavigate();useLayoutEffect(()=>{navigate=path=>go(path);},[go]);const engine=engines.find(row=>location.pathname.endsWith('/'+row.id));if(!engine)throw Error('Own normal engine route missing');const Component=engine.component;return <ProjectWorkspace projectId={fixture.projectId} engines={engines}><PanePorts/><Component projectId={fixture.projectId}/></ProjectWorkspace>;}
 const root:Root=createRoot(element);root.render(<MemoryRouter initialEntries={[fixturePath(fixture,fixture.A,eraId)]}><Primary/></MemoryRouter>);
 return {root,go:(instanceId=fixture.A,scope?:string)=>navigate(fixturePath(fixture,instanceId,scope)),openBeside:()=>beside(fixturePath(fixture,fixture.B))};
}
export async function ensureOwnMount(fixture:Fixture,instanceId=fixture.A){await waitFor(()=>!!document.querySelector('[data-sdk-app="'+instanceId+'"] [data-sdk-surface] [data-sdk-child] textarea')&&document.querySelector('[data-sdk-app="'+instanceId+'"] [data-sdk-counter]')?.textContent!=='loading','Own normal Host/Surface/Source child not ready');}
