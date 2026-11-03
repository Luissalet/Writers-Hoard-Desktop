import {parseLocalToolState} from '../clientContract';
import {assertConvergenceIdentity,convergenceCanonical,convergenceIdentity} from '../convergence/format';
import {cloneLocalToolJson,type LocalToolJson} from '../stateTypes';
import type {LocalToolDefinition} from '../sdk';
import type {SourceToolDocument} from './types';

/** A pre-start root may be shown under the exact old codec, without gaining a writer. */
export function isSourceAdditivePredecessor<T extends LocalToolJson>(document:SourceToolDocument,definition:LocalToolDefinition<T>):boolean {
 const declaration=definition.sourceAdditive;
 if(!declaration||!document.codec||document.namespace!==declaration.from.namespace||
    convergenceCanonical(document.codec)!==convergenceCanonical(declaration.from.codec))return false;
 const checkpoint=document.convergence?.checkpoint;
 if(checkpoint)assertConvergenceIdentity(checkpoint,convergenceIdentity(declaration.from,checkpoint.genesisId));
 return true;
}

/** Project the default for the selected package only. Durable Source data stays sparse. */
export function parseSourceToolDocumentState<T extends LocalToolJson>(definition:LocalToolDefinition<T>,document:SourceToolDocument):T {
 const declaration=definition.sourceAdditive;
 if(!declaration)return parseLocalToolState(definition,document.data);
 if(!isSourceAdditivePredecessor(document,definition)){
  if(document.convergence)throw Error('local_tool_source_additive_incompatible');
  return parseLocalToolState(definition,document.data);
 }
 const data=document.data;
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.hasOwn(data,declaration.field))throw Error('local_tool_source_additive_incompatible');
 return parseLocalToolState(definition,{...data,[declaration.field]:cloneLocalToolJson(declaration.defaultValue)});
}
