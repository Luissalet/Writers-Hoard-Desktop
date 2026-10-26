// Test instrumentation only. No cached kit/helper is supplied to the author modules.
import {useEffect,useState} from 'react';
import {defineLocalTool,type LocalToolJson} from '@/engines/local/sdk';
export type Parts=readonly [typeof import('three'),typeof import('three/examples/jsm/loaders/OBJLoader.js'),typeof import('three/examples/jsm/loaders/GLTFLoader.js'),typeof import('three/examples/jsm/loaders/STLLoader.js'),typeof import('three/examples/jsm/loaders/PLYLoader.js'),typeof import('three/examples/jsm/loaders/FBXLoader.js')];
export const probes=new Map<string,{pending:Promise<Parts>[];results:Parts[];fulfilled:number;errors:unknown[]}>();
export function author(namespace:string,load:()=>Promise<Parts>){
 function Component(){
  const [status,setStatus]=useState('idle');
  useEffect(()=>{probes.set(namespace,{pending:[],results:[],fulfilled:0,errors:[]});return()=>{probes.delete(namespace);};},[]);
  const start=()=>{
   const probe=probes.get(namespace)!;setStatus('loading');
   // Two calls in one turn; a second creation also starts before the first can resolve.
   for(let i=0;i<2;i++){const pending=load();probe.pending.push(pending);void pending.then(value=>{probe.results.push(value);probe.fulfilled++;setStatus('ready');},error=>{probe.errors.push(error);setStatus('error');});}
  };
  return <section data-three-author={namespace}><button type="button" data-three-load onClick={start}>Load own triangle</button><output>{status}</output></section>;
 }
 return defineLocalTool({namespace,name:{en:'Own Three fixture',es:'Prueba Three propia'},description:{en:'Synthetic trusted Source code.',es:'Código Source sintético.'},document:{defaultTitle:{en:'Own model',es:'Modelo propio'}},initialState:{notes:'saved before Three'},validateState:(value:LocalToolJson):value is {notes:string}=>!!value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.notes==='string',component:Component});
}
