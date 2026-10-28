import {createContext,useContext} from 'react';
import * as publicSDK from '@/engines/local/sdk';
import type {LocalToolDefinition,LocalToolJson,LocalToolProps} from '@/engines/local/sdk';
import {defineLocalTool} from '@/engines/local/sdk';
import rich from '@/engines/local/installed/examples.rich-prose/module';
import {useLocalToolIndex} from '@/engines/local/useLocalToolIndex';

export type Data={briefing:string;caption:string;score:number;active:boolean;names:string[];opaque:{secret:string}};
export const NS='tests.open-document-fields',BNS='tests.open-document-fields-consumer',UNAVAILABLE='tests.open-document-fields-unavailable';
export const MARKER='own-sdk34-open-fields-causal-r1';
export const initial:Data={briefing:'<p>Own saved Élodie 李明</p>',caption:'Own source',score:0,active:true,names:['Ada','Élodie'],opaque:{secret:'not-selected'}};
export const fields={briefing:{path:'$.briefing',type:'string' as const},score:{path:'$.score',type:'number' as const},active:{path:'$.active',type:'boolean' as const},names:{path:'$.names[*]',type:'string[]' as const,mode:'all' as const}};
const valid=(value:LocalToolJson):value is Data=>!!value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.briefing==='string'&&typeof value.caption==='string'&&typeof value.score==='number'&&Number.isFinite(value.score)&&typeof value.active==='boolean'&&Array.isArray(value.names)&&value.names.every(name=>typeof name==='string')&&!!value.opaque&&typeof value.opaque==='object'&&!Array.isArray(value.opaque)&&typeof value.opaque.secret==='string';
const Rich=rich.component as LocalToolDefinition<Data>['component'];
export const ProjectionProbeContext=createContext(false);
function OpenProbe({client}:LocalToolProps<Data>){const usePublic=Reflect.get(publicSDK,'useLocalToolOpenDocuments') as undefined|((client:LocalToolProps<Data>['client'],query:{namespace:string;fields:typeof fields})=>{rows:{id:string;fields:Record<string,unknown>}[];loading:boolean;error:string});if(typeof usePublic!=='function')throw Error('SDK34_PUBLIC_OPEN_HOOK_UNAVAILABLE_AFTER_PORT_HEALTH');const result=usePublic(client,{namespace:NS,fields});return <output data-sdk34-open data-loading={result.loading?'true':'false'} data-error={result.error}>{JSON.stringify(result.rows)}</output>;}
function Consumer(props:LocalToolProps<Data>){const enabled=useContext(ProjectionProbeContext),index=useLocalToolIndex(props.client,{namespace:NS});return <><Rich {...props}/><output data-sdk34-durable data-loading={index.loading?'true':'false'} data-error={index.error}>{JSON.stringify(index.rows.map(row=>({id:row.id,fields:row.fields})))}</output>{enabled&&<OpenProbe {...props}/>}</>;}
const common={initialState:initial,validateState:valid,codec:{version:1 as const,fields:{briefing:{kind:'prose' as const,format:'rich' as const},caption:{kind:'scalar' as const},score:{kind:'scalar' as const},active:{kind:'scalar' as const},names:{kind:'scalar' as const}}},index:{version:1 as const,fields},document:{defaultTitle:{en:'Own source',es:'Fuente propia'},embed:'interactive' as const},preview:{version:1 as const,fields:[{key:'briefing',label:{en:'Briefing',es:'Informe'}}]}};
export const definition=defineLocalTool<Data>({...common,namespace:NS,name:{en:'Own producer',es:'Productor propio'},description:{en:'Own typed saved source',es:'Fuente propia tipada guardada'},component:Rich});
export const consumerDefinition=defineLocalTool<Data>({...common,namespace:BNS,name:{en:'Own consumer',es:'Consumidor propio'},description:{en:'Own draft and durable index control',es:'Control propio de borrador e índice durable'},component:Consumer});
