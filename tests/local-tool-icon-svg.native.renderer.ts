// Private real-dispatch fixture. No Source host is mounted and no module is registered.
import '@/services/aiBridge/dispatch';
import {createLocalToolIcons,defineLocalTool,type LocalToolJson} from '@/engines/local/sdk';
import {resolveLocalToolIconSvg} from '@/engines/local/iconSvg';
import {createLocalToolClient} from '@/engines/local/storage';
import {db} from '@/db';
import type {Project} from '@/types';
import {installNavigator} from '@/engines/_shared/anchoring';
import {registerPendingFlusher,getPendingWritesSnapshot} from '@/services/pendingWrites';

async function prepare(){
 await db.open();
 if(await db.projects.count())throw Error('SVG native profile must begin without projects');
 const icons=createLocalToolIcons(resolveLocalToolIconSvg);
 if(!icons.resolveSvg)throw Error('Explicit real SDK graphic port is absent');
 const projectId='native-svg-'+crypto.randomUUID(),writingId=projectId+'-notes';
 const definition=defineLocalTool<{notes:string}>({namespace:'tests.icon-svg-native',name:{en:'Private SVG transport',es:'Transporte SVG privado'},description:{en:'Own readonly native fixture.',es:'Fixture nativa propia de lectura.'},initialState:{notes:'No source state is created'},validateState:(value:LocalToolJson):value is {notes:string}=>!!value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.notes==='string',component:()=>null});
 const navigation:string[]=[];installNavigator(value=>{navigation.push(value);});
 let flushes=0,changed=0,seeded=false;
 const stopFlusher=registerPendingFlusher(projectId,async()=>{flushes++;return false;});
 const changedListener=()=>{changed++;};window.addEventListener('wh:data-changed',changedListener);
 const sourceCount=async()=>(await db.projects.toArray()).reduce((sum,project)=>sum+(project.sourceToolDocuments?.length??0),0);
 const snapshot=async()=>({tables:await Promise.all(db.tables.map(async table=>({name:table.name,rows:await table.toArray()}))),navigation:[...navigation],flushes,changed,ledger:{...getPendingWritesSnapshot()},location:location.href,projects:await db.projects.count(),sourceDocuments:await sourceCount()});
 const expected=(id:string)=>icons.resolveSvg!(id);
 const seed=async()=>{
  if(seeded)throw Error('SVG sentinel already seeded');
  await db.projects.put({id:projectId,title:'Own SVG native control',description:'Private SVG transport fixture',mode:'custom',type:'standalone',color:'#d5b575',status:'draft',enabledEngines:[],engineOrder:[],worldEras:[{id:'past',name:'Past',description:'Own era sentinel',revision:1,createdAt:1,updatedAt:1}],createdAt:1,updatedAt:7} as Project);
  await db.writings.put({id:writingId,projectId,title:'Own notes must survive SVG reads',content:'<p>Native SVG notes &amp; references remain exact.</p>',wordCount:9,tags:['native-svg'],status:'draft',createdAt:1,updatedAt:11} as never);
  seeded=true;return{projectId,writingId};
 };
 const scoped=async({id,eraId}:{id:string;eraId?:string})=>{
  const client=createLocalToolClient(projectId,definition,{eraId,readOnly:true});
  if(!client.icons?.resolveSvg)throw Error('Real scoped client lacks SVG capability');
  return{sdk:await client.icons.resolveSvg(id),callTool:await client.callTool('wh_local_tool_icon_svg',{id})};
 };
 const cleanup=async()=>{
  stopFlusher();window.removeEventListener('wh:data-changed',changedListener);
  await db.writings.delete(writingId);await db.projects.delete(projectId);
  await db.documentHistory.where('projectId').equals(projectId).delete();
  return{projects:await db.projects.count(),writings:await db.writings.count(),sourceDocuments:await sourceCount()};
 };
 document.getElementById('root')!.textContent='Private SVG transport fixture; no drawing claim';
 Reflect.set(window,'__svgNativeExpected',expected);Reflect.set(window,'__svgNativeSnapshot',snapshot);
 Reflect.set(window,'__svgNativeSeed',seed);Reflect.set(window,'__svgNativeScoped',scoped);Reflect.set(window,'__svgNativeCleanup',cleanup);
 Reflect.set(window,'__svgNativeReady',{projectId,writingId,sourceHostMounted:false,sourceModulesRegistered:false});
}
void prepare().catch(error=>{console.error(error);Reflect.set(window,'__svgNativeFailure',String(error));});
