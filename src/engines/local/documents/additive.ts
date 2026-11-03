import {parseLocalToolState} from '../clientContract';
import {assertConvergenceIdentity,convergenceCanonical,convergenceIdentity} from '../convergence/format';
import {localToolConvergenceContext} from '../convergence/context';
import {projectSourceDefault} from '../convergence/sourceAdditive';
import type {LocalToolJson} from '../stateTypes';
import type {LocalToolDefinition} from '../sdk';
import type {SourceToolDocument} from './types';
import {isSourceAdditivePredecessor} from './additiveOrigin';

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
 if(!isSourceAdditivePredecessor(document,declaration.from)){
  if(document.convergence)throw Error('local_tool_source_additive_incompatible');
  return parseLocalToolState(definition,document.data);
 }
 const data=document.data;
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.hasOwn(data,declaration.field))throw Error('local_tool_source_additive_incompatible');
 return parseLocalToolState(definition,projectSourceDefault(data,declaration));
}
