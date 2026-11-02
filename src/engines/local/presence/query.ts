import {assertWorldEra} from '@/services/worldEras/store';
import {readSourceToolDocument} from '../documents/store';
import {presenceHosts} from './registry';
export async function queryLocalToolPresence(scope:{projectId:string;eraId?:string},namespace:string,documentId:string){
 await assertWorldEra(scope);const captured=[...presenceHosts].filter(h=>h.client.projectId===scope.projectId&&h.client.eraId===scope.eraId&&h.client.namespace===namespace&&h.client.documentId===documentId),before=await readSourceToolDocument(scope,documentId,namespace);
 const valid=await Promise.all(captured.map(async host=>({host,valid:await host.valid().catch(()=>false)})));
 await assertWorldEra(scope);const after=await readSourceToolDocument(scope,documentId,namespace);await assertWorldEra(scope);const rows=before&&after&&before.lineage===after.lineage?valid.filter(row=>row.valid&&presenceHosts.has(row.host)).map(({host})=>({instanceId:host.instanceId,roomId:host.roomId,snapshot:host.snapshot()})).filter(row=>row.roomId&&row.snapshot.status!=='unavailable'):[];
 return{status:rows.some(row=>row.snapshot.status==='ready')?'ready':'unavailable',hosts:rows};
}
