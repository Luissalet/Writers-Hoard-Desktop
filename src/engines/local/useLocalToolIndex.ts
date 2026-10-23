import {useEffect,useState} from 'react';
import type {LocalToolClient,LocalToolJson} from './sdk';
import type {LocalToolDocumentQuery,LocalToolIndexRow} from './documentIndex';
/** Live query through the same scoped client used by headless operations. */
export function useLocalToolIndex<T extends LocalToolJson>(client:LocalToolClient<T>,query:LocalToolDocumentQuery={}){
 const key=JSON.stringify(query),[result,setResult]=useState<{client:LocalToolClient<T>;key:string;rows:LocalToolIndexRow[];loading:boolean;error:string}>();
 useEffect(()=>{let active=true,sequence=0;const refresh=()=>{const request=++sequence;setResult(previous=>({client,key,rows:previous?.client===client&&previous.key===key?previous.rows:[],loading:true,error:''}));void client.queryDocuments(JSON.parse(key)).then(rows=>{if(active&&request===sequence)setResult({client,key,rows,loading:false,error:''});}).catch(reason=>{if(active&&request===sequence)setResult({client,key,rows:[],loading:false,error:String(reason)});});};refresh();const stop=client.subscribe?.(refresh);return()=>{active=false;stop?.();};},[client,key]);
 return result?.client===client&&result.key===key?{rows:result.rows,loading:result.loading,error:result.error}:{rows:[],loading:true,error:''};
}
