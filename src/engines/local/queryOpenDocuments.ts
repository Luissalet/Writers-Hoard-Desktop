import {assertWorldEra} from '@/services/worldEras/store';
import {readSourceToolDocument} from './documents/store';
import {createLocalToolOpenDocumentRegistry,normalizeLocalToolOpenDocumentQuery,type LocalToolOpenDocumentScope,type LocalToolOpenDocumentQuery,type LocalToolOpenDocuments} from './openDocuments';

/** Only normal Source sessions publish membership; native queries never create a mount. */
export const mountedSourceDocuments=createLocalToolOpenDocumentRegistry();
export function createBrowserLocalToolOpenDocuments(scope:LocalToolOpenDocumentScope,options:{validate?:()=>Promise<unknown>;current?:()=>void;subscribe?:(changed:()=>void)=>()=>void}={}):LocalToolOpenDocuments{
 const current=options.current??(()=>{});
 return Object.freeze({
  async query(input:LocalToolOpenDocumentQuery){
   current();const query=normalizeLocalToolOpenDocumentQuery(input);
   const capture=mountedSourceDocuments.capture(scope,query.namespace);
   await(options.validate?options.validate():assertWorldEra(scope));current();
   const rows=await mountedSourceDocuments.projectCaptured(capture,query,readSourceToolDocument);
   current();return mountedSourceDocuments.revalidateCaptured(capture,rows);
  },
  subscribe(changed:()=>void){
   const stopMount=mountedSourceDocuments.subscribe(scope,changed),stopData=options.subscribe?.(changed);
   return()=>{stopMount();stopData?.();};
  },
 });
}
