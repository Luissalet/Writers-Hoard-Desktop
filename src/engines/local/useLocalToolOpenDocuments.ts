import {useEffect,useState} from 'react';
import type {LocalToolClient,LocalToolJson} from './sdk';
import {normalizeLocalToolOpenDocumentQuery,type LocalToolOpenDocumentQuery,type LocalToolOpenDocumentRow} from './openDocuments';

/** Mounted Source documents are ephemeral; a membership change retires old rows immediately. */
export function useLocalToolOpenDocuments<T extends LocalToolJson>(client:LocalToolClient<T>,query:LocalToolOpenDocumentQuery){
 let key='',inputError='';
 try{key=JSON.stringify(normalizeLocalToolOpenDocumentQuery(query));}catch(reason){inputError=String(reason);}
 const [result,setResult]=useState<{client:LocalToolClient<T>;key:string;rows:readonly LocalToolOpenDocumentRow[];loading:boolean;error:string}>();
 useEffect(()=>{
  const port=client.openDocuments;
  if(!port){setResult({client,key,rows:[],loading:false,error:'local_tool_open_documents_unavailable'});return;}
  if(inputError){setResult({client,key,rows:[],loading:false,error:inputError});return;}
  let active=true,sequence=0;
  const refresh=()=>{
   const request=++sequence;
   setResult({client,key,rows:[],loading:true,error:''});
   void port.query(JSON.parse(key)).then(rows=>{
    if(active&&request===sequence)setResult({client,key,rows,loading:false,error:''});
   }).catch(reason=>{
    if(active&&request===sequence)setResult({client,key,rows:[],loading:false,error:String(reason)});
   });
  };
  refresh();const stop=port.subscribe(refresh);
  return()=>{active=false;stop();};
 },[client,key,inputError]);
 if(inputError)return{rows:[],loading:false,error:client.openDocuments?inputError:'local_tool_open_documents_unavailable'};
 return result?.client===client&&result.key===key?{rows:result.rows,loading:result.loading,error:result.error}:{rows:[],loading:true,error:''};
}
