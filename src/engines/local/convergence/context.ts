import type {LocalToolJson} from '../stateTypes';
import type {LocalToolStateCodec} from '../stateCodecFormat';
import {convergenceHash} from './format';

export interface LocalToolConvergenceDefinition {
 namespace:string;
 codec?:LocalToolStateCodec;
 stateSchemaVersion?:string;
 initialState:LocalToolJson;
}

export function localToolValidationId(namespace:string,stateSchemaVersion='1'):string {
 return convergenceHash({namespace,stateSchemaVersion});
}

/** A declared data contract version, not a hash of Function.toString or a permission.
 * Authors change this version when changing validator semantics; UI/assets may
 * evolve without pretending to change the document's schema. */
export function localToolConvergenceContext(definition:LocalToolConvergenceDefinition,codec:LocalToolStateCodec|undefined=definition.codec){
 if(!codec)return undefined;
 const validationId=localToolValidationId(definition.namespace,definition.stateSchemaVersion);
 return{validationId,schemaEpoch:convergenceHash({validationId,codec,initialState:definition.initialState})};
}
