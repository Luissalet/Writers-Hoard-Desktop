import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {db} from '@/db';
import {createLocalToolClient} from '@/engines/local/storage';
import {useLocalToolOpenDocuments,type LocalToolClient} from '@/engines/local/sdk';
import {definition,fields,NS,type Data} from './fixtures/local-tools/open-document-fields';
import {testOpenDocumentFields} from './local-tool-open-document-fields.browser';

const pause=()=>new Promise(resolve=>setTimeout(resolve,20));
async function until(check:()=>boolean,message:string){const deadline=Date.now()+12000;while(Date.now()<deadline){if(check())return;await act(async()=>{await pause();});}throw Error(message);}
async function viewport(){const channel=window as unknown as{__want?:{w:number;h:number;n:number}|null;__sizeAck?:number};const n=1;channel.__want={w:1280,h:900,n};await until(()=>channel.__sizeAck===n,'SDK34_SHIPPING_RESIZE_ACK');if(innerWidth!==1280||innerHeight!==900)throw Error('SDK34_SHIPPING_VIEWPORT_HEALTH');}

/** Full original nine groups, readiness-only correction, normal offline UI runner. */
export async function testLocalToolOpenDocumentFields(){
 const observations:unknown[]=[];Reflect.set(window,'__sdk34ShippingTraces',observations);
 try{await viewport();const result=await testOpenDocumentFields(value=>{observations.push(value);Reflect.set(window,'__testStage','sdk34-'+String((value as{phase?:string}).phase??'observation'));});Reflect.set(window,'__sdk34ShippingResult',result);if(!result.ok)throw Error('SDK34_SHIPPING_FAILED '+(result.error?.stack??result.error?.message??result.phase));return result.checks;}
 catch(error){console.error('SDK34_SHIPPING_FAILURE '+JSON.stringify({observations,failure:{message:String(error),stack:(error as Error).stack}}));throw error;}
}

/** Old client shape: actual SDK client and closures, only the newly added optional port absent. */
export async function testLocalToolOpenDocumentsUnavailable(){
 const observations:unknown[]=[];Reflect.set(window,'__sdk34UnavailableTraces',observations);let host:HTMLDivElement|undefined,root:ReturnType<typeof createRoot>|undefined;
 const counts=async()=>Object.fromEntries(await Promise.all(db.tables.map(async table=>[table.name,await table.count()])));
 try{
  await viewport();const before=await counts();observations.push({phase:'health',before});if(Object.keys(before).length!==89||Object.values(before).some(value=>value!==0))throw Error('SDK34_OLD_CLIENT_PRIVATE_89_EMPTY_REQUIRED');
  const current=createLocalToolClient('sdk34-old-client-'+crypto.randomUUID(),definition);const legacy={...current};Reflect.deleteProperty(legacy,'openDocuments');if(Object.hasOwn(legacy,'openDocuments'))throw Error('SDK34_OLD_CLIENT_FIXTURE_RETAINED_PORT');
  let latest:{rows:unknown[];loading:boolean;error:string}|undefined;
  function Consumer(){const value=useLocalToolOpenDocuments(legacy as LocalToolClient<Data>,{namespace:NS,fields});latest={rows:[...value.rows],loading:value.loading,error:value.error};observations.push({phase:'hook',...latest});return <output data-sdk34-unavailable data-loading={value.loading?'true':'false'}>{value.error}</output>;}
  host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>{root!.render(<Consumer/>);});await until(()=>latest?.loading===false,'SDK34_OLD_CLIENT_HOOK_NEVER_SETTLED');
  if(latest?.error!=='local_tool_open_documents_unavailable'||latest.rows.length!==0||host.textContent!=='local_tool_open_documents_unavailable')throw Error('SDK34_OLD_CLIENT_MISSING_EXPLICIT_UNAVAILABLE '+JSON.stringify(latest));
  await act(async()=>root!.unmount());root=undefined;const after=await counts();observations.push({phase:'readonly',after});if(Object.entries(before).some(([table,count])=>after[table]!==count))throw Error('SDK34_OLD_CLIENT_READ_WROTE_DB');
  return['Actual older SDK client without openDocuments reports local_tool_open_documents_unavailable, no throw or indefinite loading','Unavailable open hook returns empty rows and leaves all89private stores empty'];
 }catch(error){console.error('SDK34_OLD_CLIENT_FAILURE '+JSON.stringify({observations,failure:{message:String(error),stack:(error as Error).stack},dom:host?.outerHTML}));throw error;}
 finally{if(root)await act(async()=>root!.unmount());host?.remove();}
}
