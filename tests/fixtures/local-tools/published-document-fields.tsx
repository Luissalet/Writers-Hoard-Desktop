import {useEffect,useLayoutEffect,useState} from 'react';
import * as sdk from '@/engines/local/sdk';
import {defineLocalTool,type LocalToolProps,type LocalToolHostContext,type LocalToolJson,type LocalToolClient} from '@/engines/local/sdk';
import {useLocalToolState} from '@/engines/local/useLocalToolState';
export type Data={score:number;note:string;active:boolean;names:string[];opaque:string};
export const NS='tests.source-published-fields',BNS='tests.source-published-consumer';
export const fields={points:{path:'$.score',type:'number' as const},note:{path:'$.note',type:'string' as const},active:{path:'$.active',type:'boolean' as const},names:{path:'$.names[*]',type:'string[]' as const,mode:'all' as const}};
type Producer={instanceId:string;publish:(data:LocalToolJson)=>()=>void};
export const sourceClients=new Map<string,LocalToolClient<Data>>();
export function Fixture({client,context}:LocalToolProps<Data>){
 const [draft,setDraft]=useState<string>(),[published,setPublished]=useState(false),[error,setError]=useState('');const state=useLocalToolState(client,{observe:true,hasDraft:draft!==undefined});
 const hook=Reflect.get(sdk,'useLocalToolDocumentFields') as undefined|((context:LocalToolHostContext|undefined,data:LocalToolJson|undefined)=>{clear:()=>void;error:string});
 const data=state.snapshot?{...state.snapshot.data,score:draft===undefined?state.snapshot.data.score:Number(draft)}:undefined;
 // The module capability is fixed for this runtime. The red run exercises the older public SDK.
 const publication=hook?.(context,published&&draft!==undefined?data:undefined);
 const instanceId=(context&&Reflect.get(context,'documentFields')as Producer|undefined)?.instanceId;
 useLayoutEffect(()=>{if(!instanceId)return;sourceClients.set(instanceId,client);return()=>{if(sourceClients.get(instanceId)===client)sourceClients.delete(instanceId);};},[client,instanceId]);
 useEffect(()=>{setError('');},[client]);
 return <div data-draft-fixture data-document={client.documentId} data-ready={!!state.snapshot} data-instance={(context&&Reflect.get(context,'documentFields')as Producer|undefined)?.instanceId??''}>
 <input aria-label="Draft score" value={draft??state.snapshot?.data.score??''} onChange={e=>setDraft(e.target.value)}/><textarea aria-label="Independent note" defaultValue="consumer draft unchanged"/>
 <button onClick={()=>setPublished(true)}>Publish draft</button><button onClick={()=>{publication?.clear();setPublished(false);setDraft(undefined);void state.reload();}}>Discard</button>
 <button onClick={()=>{const selected=draft,base=state.snapshot;if(!data||!base)return;void client.save(data,base.revision,base.document?.version).then(()=>{setDraft(current=>current===selected?undefined:current);void state.reload();}).catch(e=>setError(String(e)));}}>Save</button>
 <output data-draft-error>{error||publication?.error||state.error}</output>
 </div>;
}
const common={initialState:{score:7,note:'saved',active:true,names:['Ada','Nora'],opaque:'not-selected'}as Data,codec:{version:1 as const,fields:{score:{kind:'scalar' as const},note:{kind:'scalar' as const},active:{kind:'scalar' as const},names:{kind:'scalar' as const}}},index:{version:1 as const,fields},document:{defaultTitle:{en:'Draft fields',es:'Campos de borrador'},embed:'interactive' as const},validateState:(v:LocalToolJson):v is Data=>!!v&&typeof v==='object'&&!Array.isArray(v)&&typeof v.score==='number'&&Number.isFinite(v.score)&&typeof v.note==='string',component:Fixture};
export const definition=defineLocalTool({...common,namespace:NS,name:{en:'Published field fixture',es:'Campos publicados'},description:{en:'Own public field controls',es:'Controles propios'}});
export const consumerDefinition=defineLocalTool({...common,namespace:BNS,name:{en:'Consumer fixture',es:'Consumidor'},description:{en:'Own consumer draft',es:'Borrador propio'}});
