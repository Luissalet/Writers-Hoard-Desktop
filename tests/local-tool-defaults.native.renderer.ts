import '@/services/aiBridge/dispatch';
import {defineLocalTool,type LocalToolJson,type LocalToolDefaultSnapshot} from '@/engines/local/sdk';
import {rememberLocalToolDefinition} from '@/engines/local/definitions';
import {createLocalToolClient} from '@/engines/local/storage';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {deleteProject} from '@/db/operations';
import {db} from '@/db';
import {installNavigator} from '@/engines/_shared/anchoring';
import type {Project} from '@/types';
async function prepare(){
 await db.open();if(await db.projects.count())throw Error('Native defaults profile must begin empty');
 const namespace='tests.defaults-native',projectId='native-defaults-'+crypto.randomUUID(),controlId=projectId+'-control',eraId='past',navigation:string[]=[];installNavigator(value=>{navigation.push(value);});
 const definition=defineLocalTool<{notes:string}>({namespace,name:{en:'Native defaults',es:'Preferencias Native'},description:{en:'Private transport fixture.',es:'Fixture privada de transporte.'},document:{defaultTitle:{en:'Notebook',es:'Cuaderno'}},initialState:{notes:''},codec:{version:1,fields:{notes:{kind:'prose'}}},validateState:(value:LocalToolJson):value is {notes:string}=>!!value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.notes==='string',component:()=>null});
 rememberLocalToolDefinition(definition);
 const base:Project={id:projectId,title:'Native defaults',description:'Own metadata',mode:'custom',type:'standalone',status:'draft',color:'#d5b575',enabledEngines:['local-tool-'+namespace],engineOrder:[],createdAt:1,updatedAt:1,worldEras:[{id:eraId,name:'Past',description:'Own era',revision:1,createdAt:1,updatedAt:1}],localToolStates:{'tests.control':{revision:3,updatedAt:1,data:{keep:'exact'}}}};
 await db.projects.bulkPut([base,{...base,id:controlId,title:'Unrelated world',localToolStates:{'tests.control':{revision:5,updatedAt:1,data:{keep:'other world'}}}}]);
 const a=await createSourceToolDocument({projectId},namespace,'Source A'),b=await createSourceToolDocument({projectId},namespace,'Source B');
 const client=(options:{eraId?:string;documentId?:string;readOnly?:boolean}={})=>createLocalToolClient(projectId,definition,{...options,requireSelectedRelease:true,releaseHash:null});
 for(const [documentId,notes]of [[a.id,'Exact authored notes A'],[b.id,'Exact authored notes B']]){const source=client({documentId}),current=await source.read();await source.save({notes},current.revision,current.document!.version);}
 const sdk=async(input:{action:'get'|'set'|'undo'|'redo';key:string;value?:LocalToolJson;expected?:LocalToolDefaultSnapshot;receiptId?:string;eraId?:string;readOnly?:boolean;documentId?:string})=>{
  const service=client({eraId:input.eraId,documentId:input.documentId,readOnly:input.readOnly}).defaults!;
  if(input.action==='get')return service.get(input.key);if(input.action==='set')return service.set(input.key,input.value!,input.expected!);return service[input.action](input.key,input.receiptId!);
 };
 const snapshot=async()=>({tables:await Promise.all(db.tables.map(async table=>({name:table.name,rows:await table.toArray()}))),sourceA:await client({documentId:a.id}).read(),sourceB:await client({documentId:b.id}).read(),control:await db.projects.get(controlId),location:location.href,navigation:[...navigation]});
 Reflect.set(window,'__defaultsNativeSdk',sdk);Reflect.set(window,'__defaultsNativeSnapshot',snapshot);
 Reflect.set(window,'__defaultsNativeCleanup',async()=>{await deleteProject(projectId);await deleteProject(controlId);return{projects:await db.projects.count()};});
 Reflect.set(window,'__defaultsNativeReady',{projectId,controlId,namespace,eraId,a:a.id,b:b.id,sourceHostMounted:false,catalogDefinitionRemembered:true});
}
void prepare().catch(error=>Reflect.set(window,'__defaultsNativeFailure',String(error)));
