import {sourceDefaultEntries,sourceDefaultHash} from '../stateCodecFormat';
import {parseLocalToolState} from '../clientContract';
import {assertConvergenceIdentity,convergenceCanonical,convergenceHash,convergenceIdentity,convergenceIdentityOf} from '../convergence/format';
import type {LocalToolSourceProjection} from '../convergence/clientTypes';
import {localToolConvergenceContext} from '../convergence/context';
import {projectSourceDefaults} from '../convergence/sourceAdditive';
import {cloneLocalToolJson,type LocalToolJson} from '../stateTypes';
import type {LocalToolDefinition} from '../sdk';
import type {SourceToolDocument} from './types';
import {findSourceAdditivePredecessor} from './additiveOrigin';
import {validateSourceDocumentCheckpoint} from './portability';

export function assertSourceAdditiveTarget<T extends LocalToolJson>(document:SourceToolDocument,definition:LocalToolDefinition<T>):void {
 const codec=definition.codec,checkpoint=document.convergence?.checkpoint;
 if(!definition.sourceAdditive||!codec||!sourceDefaultHash(codec)||!document.codec||convergenceCanonical(document.codec)!==convergenceCanonical(codec))throw Error('local_tool_source_additive_incompatible');
 if(checkpoint)assertConvergenceIdentity(checkpoint,convergenceIdentity({namespace:definition.namespace,codec,...localToolConvergenceContext(definition,codec)!},checkpoint.genesisId));
}

/** Project the default for the selected package only. Durable Source data stays sparse. */
export function parseSourceToolDocumentState<T extends LocalToolJson>(definition:LocalToolDefinition<T>,document:SourceToolDocument):T {
 const declaration=definition.sourceAdditive;
 const predecessor=findSourceAdditivePredecessor(document,declaration);
 const defaults=sourceDefaultEntries(definition.codec);
 if(predecessor){
  const data=document.data;
  const newFields=defaults.filter(([field])=>!Object.hasOwn(predecessor.codec.fields,field));
  if(!data||typeof data!=='object'||Array.isArray(data)||newFields.some(([field])=>Object.hasOwn(data,field)))throw Error('local_tool_source_additive_incompatible');
  return parseLocalToolState(definition,projectSourceDefaults(data,defaults));
 }
 if(document.convergence?.checkpoint.engine.version==='8'||sourceDefaultHash(document.codec)){
  assertSourceAdditiveTarget(document,definition);
  return parseLocalToolState(definition,projectSourceDefaults(document.data,defaults));
 }
 if(declaration&&document.convergence)throw Error('local_tool_source_additive_incompatible');
 return parseLocalToolState(definition,document.data);
}

export function projectSourceToolAs<T extends LocalToolJson>(document:SourceToolDocument,definition:LocalToolDefinition<T>,identityHash:string,provenance:LocalToolSourceProjection['provenance']):LocalToolSourceProjection {
 if(typeof identityHash!=='string'||!/^[a-f0-9]{64}$/.test(identityHash))throw Error('local_tool_source_projection_invalid');
 const addition=definition.sourceAdditive,checkpoint=document.convergence?.checkpoint;
 if(!addition||!checkpoint)throw Error('local_tool_source_projection_unavailable');
 assertSourceAdditiveTarget(document,definition);
 const declared=[...(addition.ancestors??[]),addition.from].some(epoch=>convergenceHash(epoch)===identityHash);
 if(!declared)throw Error('local_tool_source_projection_unavailable');
 const history=validateSourceDocumentCheckpoint(document,definition.validateState);
 const previous=history?.find(epoch=>convergenceHash(epoch)===identityHash);
 const data=document.data;
 if(!previous||!data||typeof data!=='object'||Array.isArray(data))throw Error('local_tool_source_projection_unavailable');
 const selected=Object.fromEntries(Object.entries(data).filter(([field])=>Object.hasOwn(previous.codec.fields,field)));
 return{identity:convergenceIdentity(previous,checkpoint.genesisId),activeIdentity:convergenceIdentityOf(checkpoint),
  provenance,conflicted:!!document.convergence?.conflict,data:cloneLocalToolJson(projectSourceDefaults(selected,sourceDefaultEntries(previous.codec)))};
}
