// Independent native metadata fixture: normal renderer dispatch, no Source host or engine registration.
import '@/services/aiBridge/dispatch';
import {createLocalToolIcons} from '@/engines/local/sdk';
import {db} from '@/db';
import type {Project} from '@/types';
import {installNavigator} from '@/engines/_shared/anchoring';
import {registerPendingFlusher,getPendingWritesSnapshot} from '@/services/pendingWrites';

async function prepare(){
  await db.open();
  if(await db.projects.count())throw Error('Private native icon profile must start without projects');
  const icons=createLocalToolIcons(),projectId=`native-icons-${crypto.randomUUID()}`,writingId=`${projectId}-notes`;
  const navigation:string[]=[];
  installNavigator(path=>{navigation.push(path);});
  let flushCalls=0,changedEvents=0,seeded=false;
  const stop=registerPendingFlusher(`native-icons:${projectId}`,async()=>{flushCalls++;return false;});
  const onChanged=()=>{changedEvents++;};
  window.addEventListener('wh:data-changed',onChanged);
  const expected=async(args:{action:string;id?:string;query?:string;offset?:number;limit?:number})=>{
    if(args.action==='packs')return icons.packs();
    if(args.action==='get')return icons.get(args.id!);
    if(args.action==='search')return icons.search(args.query??'',{offset:args.offset,limit:args.limit});
    throw Error('Expected helper is only for valid catalogue actions');
  };
  const sourceCount=async()=>(await db.projects.toArray()).reduce((count,project)=>count+(project.sourceToolDocuments?.length??0),0);
  const snapshot=async()=>({
    tables:await Promise.all(db.tables.map(async table=>({name:table.name,rows:await table.toArray()}))),
    navigation:[...navigation],flushCalls,changedEvents,ledger:{...getPendingWritesSnapshot()},location:window.location.href,
    projects:await db.projects.count(),sourceDocuments:await sourceCount(),
  });
  const seed=async()=>{
    if(seeded)throw Error('Own native sentinel was already seeded');
    await db.projects.put({id:projectId,title:'Private native icon sentinel',description:'Own fixture only',mode:'custom',type:'standalone',color:'#d5b575',status:'draft',enabledEngines:[],engineOrder:[],createdAt:1,updatedAt:7} as Project);
    await db.writings.put({id:writingId,projectId,title:'Preserved author notes',content:'<p>Native icon metadata must preserve notes &amp; references.</p>',wordCount:9,tags:['native-icons'],status:'draft',createdAt:1,updatedAt:11} as never);
    seeded=true;
    return{projectId,writingId};
  };
  const cleanup=async()=>{
    stop();window.removeEventListener('wh:data-changed',onChanged);
    await db.projects.delete(projectId);
    await db.writings.delete(writingId);
    await db.documentHistory.where('projectId').equals(projectId).delete();
    return{projects:await db.projects.count(),writings:await db.writings.count(),sourceDocuments:await sourceCount()};
  };
  document.getElementById('root')!.textContent='Private native icon metadata fixture';
  Reflect.set(window,'__localToolIconsNativeExpected',expected);
  Reflect.set(window,'__localToolIconsNativeSnapshot',snapshot);
  Reflect.set(window,'__localToolIconsNativeSeed',seed);
  Reflect.set(window,'__localToolIconsNativeCleanup',cleanup);
  Reflect.set(window,'__localToolIconsNativeReady',{projectId,writingId,sourceHostMounted:false,enginesRegistered:false});
}
void prepare().catch(error=>{console.error(error);Reflect.set(window,'__localToolIconsNativeFailure',String(error));});
