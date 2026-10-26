import '@/services/aiBridge/dispatch';
import {defineLocalTool,type LocalToolJson} from '@/engines/local/sdk';
import {rememberLocalToolDefinition} from '@/engines/local/definitions';
import {createLocalToolClient} from '@/engines/local/storage';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {deleteProject} from '@/db/operations';
import {db} from '@/db';
import {installNavigator} from '@/engines/_shared/anchoring';
import type {Project} from '@/types';

// This is a real private renderer/DB fixture, with no mounted Source host or CSS claim.
async function prepare(){
 await db.open();if(await db.projects.count())throw Error('Native theme profile must begin empty');
 const namespace='tests.theme-native',projectId='native-theme-'+crypto.randomUUID(),controlId=projectId+'-control',eraId='past',navigation:string[]=[];
 installNavigator(value=>{navigation.push(value);});
 const definition=defineLocalTool<{notes:string}>({namespace,name:{en:'Native theme',es:'Tema Native'},description:{en:'Private transport fixture.',es:'Fixture privada de transporte.'},document:{defaultTitle:{en:'Notebook',es:'Cuaderno'}},initialState:{notes:''},codec:{version:1,fields:{notes:{kind:'prose'}}},validateState:(value:LocalToolJson):value is {notes:string}=>!!value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.notes==='string',component:()=>null});
 rememberLocalToolDefinition(definition);
 const base:Project={id:projectId,title:'Native theme',description:'Own metadata',mode:'custom',type:'standalone',status:'draft',color:'#d5b575',enabledEngines:['local-tool-'+namespace],engineOrder:[],createdAt:1,updatedAt:1,worldEras:[{id:eraId,name:'Past',description:'Own era',revision:1,createdAt:1,updatedAt:1},{id:'sibling',name:'Sibling',description:'Exact sibling',revision:7,createdAt:2,updatedAt:3,theme:{background:'#273845',accent:'#c7a565'}}],localToolStates:{'tests.control':{revision:3,updatedAt:1,data:{keep:'exact'}}}};
 await db.projects.bulkPut([base,{...base,id:controlId,title:'Unrelated world',localToolStates:{'tests.control':{revision:5,updatedAt:1,data:{keep:'other world'}}}}]);
 const a=await createSourceToolDocument({projectId},namespace,'Source A'),b=await createSourceToolDocument({projectId},namespace,'Source B');
 const client=(options:{eraId?:string;documentId?:string;readOnly?:boolean}={})=>createLocalToolClient(projectId,definition,{...options,requireSelectedRelease:true,releaseHash:null});
 for(const [documentId,notes]of [[a.id,'Exact authored notes A'],[b.id,'Exact authored notes B']]){
  const source=client({documentId}),current=await source.read();await source.save({notes},current.revision,current.document!.version);
  if((await source.read()).data.notes!==notes)throw Error('Source save positive failed');
 }
 const sources=[await client({documentId:a.id}).read(),await client({documentId:b.id}).read()];
 if(sources[0].data.notes!=='Exact authored notes A'||sources[1].data.notes!=='Exact authored notes B')throw Error('Independent Source read positive failed');
 const notices:{scope:'base'|'era';value:unknown}[]=[],stops:(()=>void)[]=[],pending=new Set<Promise<void>>();let subscribed=false,subscriptionFailure:string|undefined;
 const start=()=>{
  if(subscribed)throw Error('Theme subscription already started');subscribed=true;
  for(const [label,options]of [['base',{documentId:a.id}],['era',{documentId:b.id,eraId}]] as const){
   const service=client(options).theme!;
   if(!service||typeof service.get!=='function'||typeof service.subscribe!=='function')throw Error('Theme port absent after Source positive');
   stops.push(service.subscribe(()=>{
    let work:Promise<void>;work=service.get().then(value=>{notices.push({scope:label,value});}).catch(error=>{subscriptionFailure=String(error);}).finally(()=>{pending.delete(work);});pending.add(work);
   }));
  }
  return{notices:notices.length,subscriptions:stops.length};
 };
 const state=async()=>{await Promise.all([...pending]);if(subscriptionFailure)throw Error(subscriptionFailure);return{notices:structuredClone(notices),active:stops.length};};
 const stop=async()=>{for(const unsubscribe of stops.splice(0))unsubscribe();return state();};
 const sdk=async(input:{eraId?:string;documentId?:string;readOnly?:boolean;action?:'get'|'write';expectedRevision?:number})=>{
  const source=client({eraId:input.eraId,documentId:input.documentId,readOnly:input.readOnly});
  if(input.action==='write')return source.callTool('wh_workspace_appearance_save',{patch:{mode:'light'},expectedRevision:input.expectedRevision??0});
  if(!source.theme)throw Error('Theme port absent after Source positive');return source.theme.get();
 };
 const tables=()=>Promise.all(db.tables.map(async table=>({name:table.name,rows:await table.toArray()})));
 const snapshot=async()=>({tables:await tables(),sourceA:await client({documentId:a.id}).read(),sourceB:await client({documentId:b.id}).read(),control:await db.projects.get(controlId),location:location.href,navigation:[...navigation]});
 Reflect.set(window,'__themeNativeSdk',sdk);Reflect.set(window,'__themeNativeSnapshot',snapshot);
 Reflect.set(window,'__themeNativeSubscribe',start);Reflect.set(window,'__themeNativeNotices',state);Reflect.set(window,'__themeNativeUnsubscribe',stop);
 Reflect.set(window,'__themeNativeSettle',async()=>{await new Promise(resolve=>setTimeout(resolve,40));return state();});
 Reflect.set(window,'__themeNativeTables',tables);
 Reflect.set(window,'__themeNativeCleanup',async()=>{await stop();await deleteProject(projectId);await deleteProject(controlId);return{projects:await db.projects.count(),subscriptions:stops.length};});
 Reflect.set(window,'__themeNativeReady',{projectId,controlId,namespace,eraId,a:a.id,b:b.id,sourceHostMounted:false,catalogDefinitionRemembered:true,positiveSources:sources.map(source=>({notes:source.data.notes,revision:source.revision,version:source.document!.version}))});
}
void prepare().catch(error=>Reflect.set(window,'__themeNativeFailure',String(error)));
