import {sourceDefaultEntries,sourceDefaultHash} from '../stateCodecFormat';
import {parseLocalToolState} from '../clientContract';
import {assertConvergenceIdentity,convergenceCanonical,convergenceIdentity} from '../convergence/format';
import {localToolConvergenceContext} from '../convergence/context';
import {projectSourceDefaults} from '../convergence/sourceAdditive';
import type {LocalToolJson} from '../stateTypes';
import type {LocalToolDefinition} from '../sdk';
import type {SourceToolDocument} from './types';
import {isSourceAdditivePredecessor} from './additiveOrigin';

export function assertSourceAdditiveTarget<T extends LocalToolJson>(document:SourceToolDocument,definition:LocalToolDefinition<T>):void {
 const codec=definition.codec,checkpoint=document.convergence?.checkpoint;
 if(!definition.sourceAdditive||!codec||!sourceDefaultHash(codec)||!document.codec||convergenceCanonical(document.codec)!==convergenceCanonical(codec))throw Error('local_tool_source_additive_incompatible');
 if(checkpoint)assertConvergenceIdentity(checkpoint,convergenceIdentity({namespace:definition.namespace,codec,...localToolConvergenceContext(definition,codec)!},checkpoint.genesisId));
}

/** Project the default for the selected package only. Durable Source data stays sparse. */
export function parseSourceToolDocumentState<T extends LocalToolJson>(definition:LocalToolDefinition<T>,document:SourceToolDocument):T {
 const declaration=definition.sourceAdditive;
 if(document.convergence?.checkpoint.engine.version==='8'||sourceDefaultHash(document.codec)){
  assertSourceAdditiveTarget(document,definition);
  return parseLocalToolState(definition,projectSourceDefaults(document.data,sourceDefaultEntries(definition.codec)));
 }
 if(!declaration)return parseLocalToolState(definition,document.data);
 if(!isSourceAdditivePredecessor(document,declaration.from)){
  if(document.convergence)throw Error('local_tool_source_additive_incompatible');
  return parseLocalToolState(definition,document.data);
 }
 const data=document.data,defaults=sourceDefaultEntries(definition.codec);
 if(!data||typeof data!=='object'||Array.isArray(data)||defaults.some(([field])=>Object.hasOwn(data,field)))throw Error('local_tool_source_additive_incompatible');
 return parseLocalToolState(definition,projectSourceDefaults(data,defaults));
}
