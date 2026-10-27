import '@/services/aiBridge/dispatch';
import {db} from '@/db';
import {seedOwnFixture,mountOwnWorkspace,ensureOwnMount,rawOwnSnapshot,cleanupOwnFixture,waitFor,type Fixture} from './local-app-host.fixture';
export async function testLocalAppNative(){
 const tableCounts=async()=>Object.fromEntries(await Promise.all(db.tables.map(async table=>[table.name,await table.count()])));const before=await tableCounts();if(Object.values(before).some(count=>count!==0))throw Error('Private empty all-table profile required: '+JSON.stringify(before));let fixture:Fixture|undefined,workspace:ReturnType<typeof mountOwnWorkspace>|undefined,closed=false;
 const status=()=>[...document.querySelectorAll<HTMLElement>('[data-sdk-app]')].map(node=>({instanceId:node.dataset.sdkApp,hostId:node.dataset.sdkHost,route:node.querySelector('[data-sdk-route]')?.textContent??'',motto:node.querySelector('[data-sdk-motto]')?.textContent??'',surfaces:[...node.querySelectorAll<HTMLElement>('[data-sdk-surface]')].map(row=>row.dataset.sdkSurface),counters:[...node.querySelectorAll('[data-sdk-counter]')].map(row=>row.textContent)}));
 const cleanup=async()=>{if(workspace){workspace.root.unmount();workspace=undefined;}const result=fixture?await cleanupOwnFixture(fixture):{ownOnly:true,allOwnIndexedTablesEmpty:true,projects:[]};const counts=await tableCounts();closed=true;return {...result,tableCounts:counts,allTablesEmpty:Object.values(counts).every(count=>count===0)};};
 try{
  fixture=await seedOwnFixture(true);workspace=mountOwnWorkspace(fixture,document.getElementById('root')!);await ensureOwnMount(fixture);workspace.openBeside();await ensureOwnMount(fixture,fixture.B);
  Reflect.set(window,'__sdkNativeSnapshot',rawOwnSnapshot);Reflect.set(window,'__sdkNativeControlSnapshot',async()=>JSON.stringify({foreign:await db.projects.get(fixture!.foreignId),siblings:(await db.projects.get(fixture!.projectId))?.sourceToolDocuments?.filter(row=>row.id!==fixture!.A),variants:await db.worldEraVariants.where('projectId').equals(fixture!.projectId).toArray()}));Reflect.set(window,'__sdkNativeStatus',status);Reflect.set(window,'__sdkNativeCleanup',cleanup);
  Reflect.set(window,'__sdkNativeMount',async(eraId?:string)=>{workspace!.go(fixture!.A,eraId);await ensureOwnMount(fixture!);await waitFor(()=>status().some(row=>row.instanceId===fixture!.A&&row.motto===(eraId?'Own Past A motto':'Own Base A motto')),'Named/Shared Host did not settle');return status();});
  Reflect.set(window,'__sdkNativeReady',fixture);
  const until=Date.now()+180000;while(Date.now()<until&&!Reflect.get(window,'__sdkNativeComplete'))await new Promise(resolve=>setTimeout(resolve,30));
  const result=Reflect.get(window,'__sdkNativeComplete') as {ok?:boolean;error?:string}|undefined;if(!result?.ok)throw Error(result?.error??'Native app deadline');if(!closed)throw Error('Native cleanup not requested');
  return ['Four app tools over two real MCP stdio keys/Native IPC, exact mounted Base/era viewport/noqueue, complete large owned HTML, normal Source apply/Undo across keys, own cleanup0/EOF0'];
 }finally{await cleanup();}
}
