import {convergenceClone,convergenceCanonical,convergenceHash,convergenceBytes} from './json';
export {convergenceClone,convergenceCanonical,convergenceHash,convergenceBase64,convergenceBytes} from './json';
import {localToolNamespace} from '../stateTypes';
import {validateLocalToolCodec,localToolHasPlainFields,localToolRichLinks,localToolRichTables,localToolRichTableAxes,localToolRichTableWidths,localToolRichImages,localToolRichImageAlignment,localToolRichImageRaster,localToolRichImageCells,localToolRichTableRowHeights,localToolRichTableCellHeaders,type LocalToolStateCodec} from '../stateCodecFormat';
import {isRichImageEngine} from './imageFormat';
import type {LocalToolConvergenceCheckpoint,LocalToolConvergenceIdentity,LocalToolConvergenceMetadata,LocalToolConvergenceReceipt,LocalToolConvergenceUpdate,LocalToolValidationConflict,LocalToolPlainRange,LocalToolConvergenceIdentityV1,LocalToolConvergenceIdentityV2,LocalToolConvergenceIdentityV3} from './formatTypes';

export const LOCAL_TOOL_CONVERGENCE_ENGINE:LocalToolConvergenceIdentityV1['engine']=Object.freeze({id:'writers-hoard-yjs-registers',version:'1',updateFormat:'yjs-v1',libraryVersion:'13.6.33'});
export const LOCAL_TOOL_PLAIN_ENGINE:LocalToolConvergenceIdentityV2['engine']=Object.freeze({...LOCAL_TOOL_CONVERGENCE_ENGINE,version:'2'});
export const LOCAL_TOOL_RICH_ENGINE:LocalToolConvergenceIdentityV3['engine']=Object.freeze({...LOCAL_TOOL_CONVERGENCE_ENGINE,version:'3'});
export const LOCAL_TOOL_LINK_ENGINE=Object.freeze({...LOCAL_TOOL_CONVERGENCE_ENGINE,version:'4' as const});
export const LOCAL_TOOL_TABLE_ENGINE=Object.freeze({...LOCAL_TOOL_CONVERGENCE_ENGINE,version:'5' as const});
export const LOCAL_TOOL_TABLE_AXES_ENGINE=Object.freeze({...LOCAL_TOOL_CONVERGENCE_ENGINE,version:'6' as const});
export const LOCAL_TOOL_TABLE_WIDTHS_ENGINE=Object.freeze({...LOCAL_TOOL_CONVERGENCE_ENGINE,version:'7' as const});
export const LOCAL_TOOL_SOURCE_ADDITIVE_ENGINE=Object.freeze({...LOCAL_TOOL_CONVERGENCE_ENGINE,version:'8' as const});
export const LOCAL_TOOL_IMAGE_ENGINE=Object.freeze({...LOCAL_TOOL_CONVERGENCE_ENGINE,version:'9' as const});
export const LOCAL_TOOL_IMAGE_ALIGNMENT_ENGINE=Object.freeze({...LOCAL_TOOL_CONVERGENCE_ENGINE,version:'10' as const});
export const LOCAL_TOOL_IMAGE_RASTER_ENGINE=Object.freeze({...LOCAL_TOOL_CONVERGENCE_ENGINE,version:'11' as const});
export const LOCAL_TOOL_IMAGE_CELLS_ENGINE=Object.freeze({...LOCAL_TOOL_CONVERGENCE_ENGINE,version:'12' as const});
export const LOCAL_TOOL_TABLE_ROW_HEIGHTS_ENGINE=Object.freeze({...LOCAL_TOOL_CONVERGENCE_ENGINE,version:'13' as const});
export const LOCAL_TOOL_TABLE_CELL_HEADERS_ENGINE=Object.freeze({...LOCAL_TOOL_CONVERGENCE_ENGINE,version:'14' as const});
export const convergenceEngine=(codec:LocalToolStateCodec):LocalToolConvergenceIdentity['engine']=>codec.sourceDefault?LOCAL_TOOL_SOURCE_ADDITIVE_ENGINE:Object.values(codec.fields).some(localToolRichTableCellHeaders)?LOCAL_TOOL_TABLE_CELL_HEADERS_ENGINE:Object.values(codec.fields).some(localToolRichTableRowHeights)?LOCAL_TOOL_TABLE_ROW_HEIGHTS_ENGINE:Object.values(codec.fields).some(localToolRichImageCells)?LOCAL_TOOL_IMAGE_CELLS_ENGINE:Object.values(codec.fields).some(localToolRichImageRaster)?LOCAL_TOOL_IMAGE_RASTER_ENGINE:Object.values(codec.fields).some(localToolRichImageAlignment)?LOCAL_TOOL_IMAGE_ALIGNMENT_ENGINE:Object.values(codec.fields).some(localToolRichImages)?LOCAL_TOOL_IMAGE_ENGINE:Object.values(codec.fields).some(localToolRichTableWidths)?LOCAL_TOOL_TABLE_WIDTHS_ENGINE:Object.values(codec.fields).some(localToolRichTableAxes)?LOCAL_TOOL_TABLE_AXES_ENGINE:Object.values(codec.fields).some(localToolRichTables)?LOCAL_TOOL_TABLE_ENGINE:Object.values(codec.fields).some(localToolRichLinks)?LOCAL_TOOL_LINK_ENGINE:codec.version===2?LOCAL_TOOL_RICH_ENGINE:localToolHasPlainFields(codec)?LOCAL_TOOL_PLAIN_ENGINE:LOCAL_TOOL_CONVERGENCE_ENGINE;
/** A new Source definition/epoch cannot silently change a table capability. */
export function assertTableAxesOrigin(codec:LocalToolStateCodec,stored:LocalToolStateCodec|undefined,version:LocalToolConvergenceIdentity['engine']['version']|undefined):void {
 const previous=version??(stored&&convergenceEngine(stored).version),next=convergenceEngine(codec).version;
 if((['6','7','9','10','11','12','13','14'].some(version=>version===previous||version===next))&&previous!==next)throw Error('local_tool_convergence_identity_mismatch');
 if(isRichImageEngine(previous)&&(!stored||convergenceCodecHash(stored)!==convergenceCodecHash(codec)))throw Error('local_tool_convergence_identity_mismatch');
 if(previous==='7'){
  const tableFields=(value:LocalToolStateCodec)=>Object.fromEntries(Object.entries(value.fields).filter(([,field])=>localToolRichTables(field)));
  if(!stored||convergenceCanonical(tableFields(stored))!==convergenceCanonical(tableFields(codec)))throw Error('local_tool_convergence_identity_mismatch');
 }
}
const fail=():never=>{throw Error('local_tool_convergence_format_invalid');};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:readonly string[])=>Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const text=(value:unknown):value is string=>typeof value==='string'&&value.length>0;
export function convergenceCodecHash(codec:LocalToolStateCodec):string {validateLocalToolCodec(codec);return convergenceHash(codec);}
export function validateConvergenceMetadata(value:LocalToolConvergenceMetadata):void {
 if(!object(value)||!localToolNamespace(value.namespace)||!text(value.validationId)||!text(value.schemaEpoch))fail();
 validateLocalToolCodec(value.codec);
}
export function convergenceIdentity(metadata:LocalToolConvergenceMetadata,genesisId:string):LocalToolConvergenceIdentity {
 validateConvergenceMetadata(metadata);if(!text(genesisId))fail();const fields={namespace:metadata.namespace,genesisId,codecHash:convergenceCodecHash(metadata.codec),validationId:metadata.validationId,schemaEpoch:metadata.schemaEpoch},engine=convergenceEngine(metadata.codec);if(engine.version==='1')return{...fields,engine};if(engine.version==='2')return{...fields,engine};if(engine.version==='3')return{...fields,engine};if(engine.version==='4')return{...fields,engine};if(engine.version==='5')return{...fields,engine};if(engine.version==='6')return{...fields,engine};if(engine.version==='7')return{...fields,engine};if(engine.version==='8')return{...fields,engine};if(engine.version==='9')return{...fields,engine};if(engine.version==='10')return{...fields,engine};if(engine.version==='11')return{...fields,engine};if(engine.version==='12')return{...fields,engine};if(engine.version==='13')return{...fields,engine};return{...fields,engine};
}
const identityKeys=['namespace','genesisId','engine','codecHash','validationId','schemaEpoch'] as const;
export function validateConvergenceIdentity(value:unknown):asserts value is LocalToolConvergenceIdentity {
 if(!object(value)||!localToolNamespace(value.namespace)||!text(value.genesisId)||!text(value.validationId)||!text(value.schemaEpoch)||typeof value.codecHash!=='string'||! /^[a-f0-9]{64}$/.test(value.codecHash)||![LOCAL_TOOL_CONVERGENCE_ENGINE,LOCAL_TOOL_PLAIN_ENGINE,LOCAL_TOOL_RICH_ENGINE,LOCAL_TOOL_LINK_ENGINE,LOCAL_TOOL_TABLE_ENGINE,LOCAL_TOOL_TABLE_AXES_ENGINE,LOCAL_TOOL_TABLE_WIDTHS_ENGINE,LOCAL_TOOL_SOURCE_ADDITIVE_ENGINE,LOCAL_TOOL_IMAGE_ENGINE,LOCAL_TOOL_IMAGE_ALIGNMENT_ENGINE,LOCAL_TOOL_IMAGE_RASTER_ENGINE,LOCAL_TOOL_IMAGE_CELLS_ENGINE,LOCAL_TOOL_TABLE_ROW_HEIGHTS_ENGINE,LOCAL_TOOL_TABLE_CELL_HEADERS_ENGINE].some(engine=>convergenceCanonical(value.engine)===convergenceCanonical(engine)))fail();
}
/** JSON-only shape validation. Does not execute an engine, registry or package callback. */
export function validateLocalToolConvergenceCheckpoint(value:unknown):asserts value is LocalToolConvergenceCheckpoint {
 convergenceClone(value);validateConvergenceIdentity(value);
 if(!exact(value as unknown as Record<string,unknown>,['format',...identityKeys,'checkpointBase64','stateVectorBase64'])||(value as LocalToolConvergenceCheckpoint).format!=='writers-hoard-local-convergence/1')fail();
 convergenceBytes((value as LocalToolConvergenceCheckpoint).checkpointBase64);convergenceBytes((value as LocalToolConvergenceCheckpoint).stateVectorBase64);
}
export function validateLocalToolConvergenceUpdate(value:unknown):asserts value is LocalToolConvergenceUpdate {
 convergenceClone(value);validateConvergenceIdentity(value);
 if(!exact(value as unknown as Record<string,unknown>,['format',...identityKeys,'updateBase64'])||(value as LocalToolConvergenceUpdate).format!=='writers-hoard-local-convergence-update/1')fail();
 convergenceBytes((value as LocalToolConvergenceUpdate).updateBase64);
}
export function convergenceIdentityOf(value:LocalToolConvergenceIdentity):LocalToolConvergenceIdentity {
 return Object.fromEntries(identityKeys.map(key=>[key,structuredClone(value[key])])) as unknown as LocalToolConvergenceIdentity;
}
export function assertConvergenceIdentity(value:LocalToolConvergenceIdentity,expected:LocalToolConvergenceIdentity):void {
 if(convergenceCanonical(convergenceIdentityOf(value))!==convergenceCanonical(expected))throw Error('local_tool_convergence_identity_mismatch');
}
export function validateLocalToolConvergenceReceipt(value:unknown):asserts value is LocalToolConvergenceReceipt {
 convergenceClone(value);
 if(!object(value)||!exact(value,['format','id','identity','mode','record'])||value.format!=='writers-hoard-local-convergence-receipt/1'||!text(value.id)||!['undo','redo'].includes(value.mode as string)||!object(value.identity)||!exact(value.identity,identityKeys)||!object(value.record))fail();
 validateConvergenceIdentity((value as {identity:unknown}).identity);
}
export function validateLocalToolValidationConflict(value:unknown):asserts value is LocalToolValidationConflict|null {
 if(value===null)return;convergenceClone(value);
 if(!object(value)||!exact(value,['kind','policy','validationId','rawFingerprint','raw'])||value.kind!=='validation'||value.policy!=='authored-valid-snapshot/1'||!text(value.validationId)||typeof value.rawFingerprint!=='string'||convergenceHash(value.raw)!==value.rawFingerprint)fail();
}

/** Causal selection envelope, not an admitted-state JSON budget. Never starts a history. */
export function validateLocalToolPlainRange(value:unknown):asserts value is LocalToolPlainRange {
 convergenceClone(value);
 if(!object(value)||!exact(value,['format','identity','field','afterPlacementId','deleteIds'])||value.format!=='writers-hoard-local-plain-range/1'||!text(value.field)||value.afterPlacementId!==null&&!text(value.afterPlacementId)||!Array.isArray(value.deleteIds)||value.deleteIds.some(id=>!text(id))||new Set(value.deleteIds).size!==value.deleteIds.length)return fail();
 validateConvergenceIdentity(value.identity);if(!exact(value.identity as unknown as Record<string,unknown>,identityKeys)||!['2','3','4','5','6','7'].includes(value.identity.engine.version))fail();
}
