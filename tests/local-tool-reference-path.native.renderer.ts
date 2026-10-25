import '@/engines';
import '@/services/aiBridge/dispatch';
import {db} from '@/db';
import {registerLocalToolModules} from '@/engines/local/registry';
import {codecDefinition} from './local-tool-codec.node';
import {authorCard} from './fixtures/local-tools/author-data';
import {saveWorldEra,readWorldDocument,saveEraDocument} from '@/services/worldEras/store';
import {getAnchorAdapter,installNavigator} from '@/engines/_shared/anchoring';
import {registerPendingFlusher,getPendingWritesSnapshot} from '@/services/pendingWrites';

async function prepare(){
  if(!getAnchorAdapter('codex'))throw Error('Normal renderer registry did not register Codex before destination access');
  const projectId=`native-path-${crypto.randomUUID()}`,eraId='native-path-era',cardId=`${projectId}-card`,namespace=codecDefinition.namespace;
  registerLocalToolModules({'./installed/tests.state-codec/module.tsx':{default:codecDefinition}});
  await db.projects.put({id:projectId,title:'Private native reference query',description:'',mode:'custom',type:'standalone',color:'#d5b575',status:'draft',enabledEngines:['codex',`local-tool-${namespace}`],engineOrder:['codex',`local-tool-${namespace}`],createdAt:1,updatedAt:1});
  const card={...authorCard(projectId,'Native Base reference'),id:cardId};
  await db.codexEntries.put(card);
  await saveWorldEra(projectId,{id:eraId,name:'Native era',description:'',revision:0,createdAt:1,updatedAt:1},null);
  const inherited=await readWorldDocument({projectId,eraId},'codex',cardId);
  if(!inherited)throw Error('Own native fixture has no inherited Codex');
  await saveEraDocument({projectId,eraId},'codex',{...inherited.document,root:{...inherited.document.root,title:'Native Era reference'}},inherited.version);
  const navigation:string[]=[];
  installNavigator(path=>{navigation.push(path);});
  let flushCalls=0;
  const stop=registerPendingFlusher(`native-reference-query:${projectId}`,async()=>{flushCalls++;return false;});
  const snapshot=async()=>({
    tables:await Promise.all(db.tables.map(async table=>({name:table.name,rows:await table.toArray()}))),
    navigation:[...navigation],flushCalls,ledger:getPendingWritesSnapshot(),location:window.location.href,
  });
  const cleanup=async()=>{
    stop();
    await db.worldEraVariants.where('projectId').equals(projectId).delete();
    await db.codexEntries.where('projectId').equals(projectId).delete();
    await db.projects.delete(projectId);
    return{projects:await db.projects.where('id').equals(projectId).count(),cards:await db.codexEntries.where('projectId').equals(projectId).count(),variants:await db.worldEraVariants.where('projectId').equals(projectId).count()};
  };
  Reflect.set(window,'__referencePathNativeSnapshot',snapshot);
  Reflect.set(window,'__referencePathNativeCleanup',cleanup);
  Reflect.set(window,'__referencePathNativeReady',{projectId,eraId,cardId,namespace,registeredBeforeOpen:true});
}
void prepare().catch(error=>{console.error(error);Reflect.set(window,'__referencePathNativeFailure',String(error));});
