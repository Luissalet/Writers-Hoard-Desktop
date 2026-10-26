import type {Plugin} from 'vite';
// Add to the real production Vite configuration; no transforms, mocks or alternate chunks.
export function threeGraphPlugin():Plugin{let transformed=0;return{name:'test-three-build-graph',transform:{order:'post',handler(_code,id){
 transformed++;if(transformed%250===0)console.log('THREE_BUILD_PROGRESS '+JSON.stringify({at:new Date().toISOString(),transformed,lastId:id}));return null;
}},generateBundle(_options,bundle){
 const chunks=Object.values(bundle).flatMap(row=>row.type==='chunk'?[{file:row.fileName,entry:row.isEntry,facade:row.facadeModuleId,imports:row.imports,dynamicImports:row.dynamicImports,modules:Object.keys(row.modules).map(id=>id.replaceAll('\\','/')),bytes:new TextEncoder().encode(row.code).length}]:[]);
 this.emitFile({type:'asset',fileName:'three-build-graph.js',source:'globalThis.__threeBuildGraph='+JSON.stringify(chunks)+';'});
 this.emitFile({type:'asset',fileName:'three-build-graph.json',source:JSON.stringify(chunks,null,2)+'\n'});
}};}
