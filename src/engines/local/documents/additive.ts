import {parseLocalToolState} from '../clientContract';
import {assertConvergenceIdentity,convergenceCanonical,convergenceIdentity} from '../convergence/format';
import {localToolConvergenceContext} from '../convergence/context';
import {projectSourceDefault} from '../convergence/sourceAdditive';
import type {LocalToolJson} from '../stateTypes';
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

export function assertSourceAdditiveTarget<T extends LocalToolJson>(document:SourceToolDocument,definition:LocalToolDefinition<T>):void {
 const codec=definition.codec,checkpoint=document.convergence?.checkpoint;
 if(!definition.sourceAdditive||!codec?.sourceDefault||!document.codec||convergenceCanonical(document.codec)!==convergenceCanonical(codec))throw Error('local_tool_source_additive_incompatible');
 if(checkpoint)assertConvergenceIdentity(checkpoint,convergenceIdentity({namespace:definition.namespace,codec,...localToolConvergenceContext(definition,codec)!},checkpoint.genesisId));
}

/** Project the default for the selected package only. Durable Source data stays sparse. */
export function parseSourceToolDocumentState<T extends LocalToolJson>(definition:LocalToolDefinition<T>,document:SourceToolDocument):T {
 const declaration=definition.sourceAdditive;
 if(document.convergence?.checkpoint.engine.version==='8'||document.codec?.sourceDefault){
  assertSourceAdditiveTarget(document,definition);
  return parseLocalToolState(definition,projectSourceDefault(document.data,definition.codec!.sourceDefault));
 }
 if(!declaration)return parseLocalToolState(definition,document.data);
 if(!isSourceAdditivePredecessor(document,definition)){
  if(document.convergence)throw Error('local_tool_source_additive_incompatible');
  return parseLocalToolState(definition,document.data);
 }
 const data=document.data;
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.hasOwn(data,declaration.field))throw Error('local_tool_source_additive_incompatible');
 return parseLocalToolState(definition,projectSourceDefault(data,declaration));
}
