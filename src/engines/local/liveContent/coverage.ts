import * as Y from 'yjs';
import {convergenceBytes,convergenceBase64} from '../convergence/format';
import type {LocalToolConvergenceCheckpoint,LocalToolConvergenceUpdate} from '../convergence/types';
export function mergeDraftUpdates(updates:readonly LocalToolConvergenceUpdate[]):LocalToolConvergenceUpdate{if(updates.length===1)return updates[0];return{...updates[0],updateBase64:convergenceBase64(Y.mergeUpdates(updates.map(update=>convergenceBytes(update.updateBase64))))};}

/** Coverage includes deletions: a state vector alone cannot acknowledge an Undo/delete. */
export function sourceCoverage(checkpoint:LocalToolConvergenceCheckpoint){
 const vector=Y.decodeStateVector(convergenceBytes(checkpoint.stateVectorBase64));
 const deleted=Y.decodeUpdate(convergenceBytes(checkpoint.checkpointBase64)).ds.clients;
 return(update:LocalToolConvergenceUpdate)=>{
  const decoded=Y.decodeUpdate(convergenceBytes(update.updateBase64));
  return decoded.structs.every(item=>(vector.get(item.id.client)??0)>=item.id.clock+item.length)&&[...decoded.ds.clients].every(([client,ranges])=>ranges.every(range=>(deleted.get(client)??[]).some(saved=>saved.clock<=range.clock&&saved.clock+saved.len>=range.clock+range.len)));
 };
}
