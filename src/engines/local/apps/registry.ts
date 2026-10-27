import {registerLocalToolModules} from '../registry';
import {getLocalToolCatalog} from '../definitions';
import type {LocalToolDefinition} from '../sdk';
function canonical(value:unknown):string{if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';return JSON.stringify(value);}
/** App descriptors accompany the same compiled, hashed Source release. */
export function registerLocalAppModules(modules:Record<string,unknown>,manifests:Record<string,unknown>={},descriptors:Record<string,unknown>={}){
  // Inspect the entire compiled batch before publishing any registration. A
  // document tool in this batch need not precede its app in object order.
  const batch=Object.values(modules).map(module=>(module as {default?:LocalToolDefinition})?.default);
  for(const [path,module] of Object.entries(modules)){
    const definition=(module as {default?:LocalToolDefinition})?.default,descriptor=descriptors[path.replace(/module\.tsx$/,'app-definition.json')];
    if(!definition?.app)continue; // Ordinary tools in a mixed batch use the same registry below.
    if(!descriptor||canonical(descriptor)!==canonical(definition.app.descriptor))throw Error('local_app_descriptor_mismatch');
    for(const namespace of definition.app.descriptor.tools){
      const catalog=getLocalToolCatalog(namespace),compiled=batch.some(source=>source?.namespace===namespace&&!!source.document)||!!catalog?.development?.document||[...catalog?.releases.values()??[]].some(source=>!!source.definition.document);
      if(namespace===definition.namespace||!compiled)throw Error('local_app_document_tool_unavailable');
    }
    const manifest=manifests[path.replace(/module\.tsx$/,'release.json')] as {files?:{path:string}[]}|undefined;
    if(manifest&&!manifest.files?.some(file=>file.path==='app-definition.json'))throw Error('local_app_descriptor_not_in_release');
  }
  return registerLocalToolModules(modules,manifests);
}
