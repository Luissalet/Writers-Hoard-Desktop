import type {LocalToolDefinition} from '../sdk';
import type {LocalToolJson} from '../stateTypes';
import type {LocalToolStateCodec} from '../stateCodec';
import {convergenceHash} from './format';

/** A declared data contract version, not a hash of Function.toString or a permission.
 * Authors change this version when changing validator semantics; UI/assets may
 * evolve without pretending to change the document's schema. */
export function localToolConvergenceContext<T extends LocalToolJson>(definition:LocalToolDefinition<T>,codec:LocalToolStateCodec|undefined=definition.codec){
 if(!codec)return undefined;
 const validationId=convergenceHash({namespace:definition.namespace,stateSchemaVersion:definition.stateSchemaVersion??'1'});
 return{validationId,schemaEpoch:convergenceHash({validationId,codec,initialState:definition.initialState})};
}
