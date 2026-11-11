import {annotationSpec,validateAnnotationSpec} from './convergence/annotationFormat';
import type {RichAnnotationSpec} from './convergence/annotationFormat';
import {validateRichDocument} from './convergence/richTypes';
import {validateRichBlockDocument} from './convergence/blockFormat';
import {validateLocalAssetRef} from './assetReference';
import {eraDocumentKinds,type EraDocumentKind} from '../../services/worldEras/documentKinds';
import {cloneLocalToolJson,type LocalToolJson} from './stateTypes';
const object=(value:unknown):value is Record<string,LocalToolJson>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export type LocalToolDocumentReference={kind:EraDocumentKind;documentId:string}
export type LocalToolFieldCodec={kind:'rich';profile:'paragraphs-inline/3';annotation:RichAnnotationSpec}|{kind:'rich';profile:'paragraphs-inline/1'|'paragraphs-inline/2'}|{kind:'rich';profile:'blocks-tree/1'|'blocks-tree/2';schema:'writers-blocks/1'}|{kind:'rich';profile:'blocks-tree/3';schema:'writers-blocks/2'}|{kind:'rich';profile:'blocks-tree/4';schema:'writers-blocks/3'}|{kind:'rich';profile:'blocks-tree/5';schema:'writers-blocks/4'}|{kind:'rich';profile:'blocks-tree/6';schema:'writers-blocks/5'}|{kind:'rich';profile:'blocks-tree/7';schema:'writers-blocks/6'}|{kind:'rich';profile:'blocks-tree/8';schema:'writers-blocks/7'}|{kind:'rich';profile:'blocks-tree/9';schema:'writers-blocks/8'}|{kind:'rich';profile:'blocks-tree/10';schema:'writers-blocks/9'}|{kind:'rich';profile:'blocks-tree/11';schema:'writers-blocks/10'}|{kind:'rich';profile:'blocks-tree/12';schema:'writers-blocks/11'}|{kind:'scalar'|'reference'|'asset-reference'}|{kind:'prose';format?:'rich';collaboration?:'plain-utf16/1'}|{kind:'map';referenceValues?:true;assetReferenceValues?:true}|{kind:'list';idKey:string;referenceKey?:string};
export interface LocalToolSourceDefault {field:string;defaultValue:LocalToolJson;fromHash:string}
export interface LocalToolSourceDefaults {fields:Record<string,LocalToolJson>;fromHash:string}
export interface LocalToolStateCodec {
 version:1|2;
 fields:Record<string,LocalToolFieldCodec>;
 sourceDefault?:LocalToolSourceDefault;
 sourceDefaults?:LocalToolSourceDefaults;
}
export const sourceDefaultHash=(codec:LocalToolStateCodec|undefined)=>codec?.sourceDefaults?.fromHash??codec?.sourceDefault?.fromHash;
export function sourceDefaultEntries(codec:LocalToolStateCodec|undefined):[string,LocalToolJson][] {
 if(codec?.sourceDefaults)return Object.entries(codec.sourceDefaults.fields);
 return codec?.sourceDefault?[[codec.sourceDefault.field,codec.sourceDefault.defaultValue]]:[];
}
export function hasSourceDefault(codec:LocalToolStateCodec|undefined,field:string):boolean {
 return codec?.sourceDefault?.field===field||!!codec?.sourceDefaults&&Object.hasOwn(codec.sourceDefaults.fields,field);
}
export const localToolFieldKey=(key:unknown):key is string=>typeof key==='string'&&!!key&&!['__proto__','constructor','prototype'].includes(key);
export function validateLocalToolReference(value:unknown):asserts value is LocalToolDocumentReference{if(!object(value)||Object.keys(value).length!==2||!eraDocumentKinds.includes(value.kind as EraDocumentKind)||typeof value.documentId!=='string'||!value.documentId)throw Error('local_tool_reference_invalid');}
export function validateLocalToolCodec(value:unknown):asserts value is LocalToolStateCodec{
 const safe=cloneLocalToolJson(value as LocalToolJson);if(!object(safe)||(safe.version!==1&&safe.version!==2)||!object(safe.fields))throw Error('local_tool_codec_invalid');
 const single=safe.sourceDefault,multiple=safe.sourceDefaults;
 if(single!==undefined&&multiple!==undefined||
    Object.keys(safe).length!==(single===undefined&&multiple===undefined?2:3))throw Error('local_tool_codec_invalid');
 const validOrigin=(spec:Record<string,LocalToolJson>)=>typeof spec.fromHash==='string'&&/^[a-f0-9]{64}$/.test(spec.fromHash);
 const validDefault=(key:unknown,value:LocalToolJson)=>{
  if(!localToolFieldKey(key)||!Object.hasOwn(safe.fields as object,key))return false;
  const field=(safe.fields as Record<string,LocalToolJson>)[key];
  return object(field)&&(field.kind==='scalar'||
   field.kind==='map'&&Object.keys(field).length===1&&object(value)&&Object.keys(value).length===0||
   field.kind==='list'&&Object.keys(field).length===2&&localToolFieldKey(field.idKey)&&Array.isArray(value)&&value.length===0);
 };
 if(single!==undefined&&(!object(single)||Object.keys(single).sort().join(',')!=='defaultValue,field,fromHash'||
    !validOrigin(single)||!validDefault(single.field,single.defaultValue)))throw Error('local_tool_codec_invalid');
 if(multiple!==undefined&&(!object(multiple)||Object.keys(multiple).sort().join(',')!=='fields,fromHash'||!validOrigin(multiple)||
    !object(multiple.fields)||Object.keys(multiple.fields).length<2||
    Object.entries(multiple.fields).some(([key,value])=>!validDefault(key,value))))throw Error('local_tool_codec_invalid');
 if((single!==undefined||multiple!==undefined)&&(safe.version!==1||
    Object.values(safe.fields).some(field=>object(field)&&field.kind==='prose'&&field.collaboration!==undefined)))throw Error('local_tool_codec_invalid');
 for(const [key,field]of Object.entries(safe.fields)){if(!localToolFieldKey(key)||!object(field))throw Error('local_tool_codec_invalid');const keys=Object.keys(field);if(field.kind==='rich'){if(field.profile==='paragraphs-inline/3')validateAnnotationSpec(field.annotation);if(safe.version!==2||!(['paragraphs-inline/1','paragraphs-inline/2'].includes(field.profile as string)&&keys.length===2||field.profile==='paragraphs-inline/3'&&keys.length===3&&Object.hasOwn(field,'annotation')||['blocks-tree/1','blocks-tree/2'].includes(field.profile as string)&&keys.length===3&&field.schema==='writers-blocks/1'||field.profile==='blocks-tree/3'&&keys.length===3&&field.schema==='writers-blocks/2'||field.profile==='blocks-tree/4'&&keys.length===3&&field.schema==='writers-blocks/3'||field.profile==='blocks-tree/5'&&keys.length===3&&field.schema==='writers-blocks/4'||field.profile==='blocks-tree/6'&&keys.length===3&&field.schema==='writers-blocks/5'||field.profile==='blocks-tree/7'&&keys.length===3&&field.schema==='writers-blocks/6'||field.profile==='blocks-tree/8'&&keys.length===3&&field.schema==='writers-blocks/7'||field.profile==='blocks-tree/9'&&keys.length===3&&field.schema==='writers-blocks/8'||field.profile==='blocks-tree/10'&&keys.length===3&&field.schema==='writers-blocks/9'||field.profile==='blocks-tree/11'&&keys.length===3&&field.schema==='writers-blocks/10'||field.profile==='blocks-tree/12'&&keys.length===3&&field.schema==='writers-blocks/11'))throw Error('local_tool_codec_invalid');}else if(field.kind==='prose'){if(keys.some(key=>!['kind','format','collaboration'].includes(key))||field.format!==undefined&&field.format!=='rich'||field.collaboration!==undefined&&field.collaboration!=='plain-utf16/1'||field.collaboration!==undefined&&field.format!==undefined)throw Error('local_tool_codec_invalid');}else if(field.kind==='scalar'||field.kind==='reference'||field.kind==='asset-reference'){if(keys.length!==1)throw Error('local_tool_codec_invalid');}else if(field.kind==='map'){if(keys.some(key=>!['kind','referenceValues','assetReferenceValues'].includes(key))||field.referenceValues!==undefined&&field.referenceValues!==true||field.assetReferenceValues!==undefined&&field.assetReferenceValues!==true||field.referenceValues&&field.assetReferenceValues)throw Error('local_tool_codec_invalid');}else if(field.kind==='list'){if(!localToolFieldKey(field.idKey)||field.referenceKey!==undefined&&(!localToolFieldKey(field.referenceKey)||field.referenceKey===field.idKey)||keys.some(key=>!['kind','idKey','referenceKey'].includes(key)))throw Error('local_tool_codec_invalid');}else throw Error('local_tool_codec_invalid');}
}
export function validateLocalToolCodecState(data:LocalToolJson,codec:LocalToolStateCodec):void{
 validateLocalToolCodec(codec);const safe=cloneLocalToolJson(data);if(!object(safe))throw Error('local_tool_codec_state_invalid');
 for(const [key,field]of Object.entries(codec.fields)){const value=safe[key];if(value===undefined)continue;if(field.kind==='rich'){if(isLocalToolRichBlockField(field))validateRichBlockDocument(value,localToolRichLinks(field),localToolRichTables(field),localToolRichTableAxes(field),localToolRichTableWidths(field),localToolRichImages(field),localToolRichImageAlignment(field),localToolRichImageRaster(field),localToolRichImageCells(field),localToolRichTableRowHeights(field),localToolRichTableCellHeaders(field),localToolRichTableCellSpans(field));else validateRichDocument(value,localToolRichLinks(field),annotationSpec(field));}else if(field.kind==='reference'){if(value!==null)validateLocalToolReference(value);}else if(field.kind==='asset-reference'){if(value!==null)validateLocalAssetRef(value);}else if(field.kind==='prose'){if(typeof value!=='string')throw Error('local_tool_codec_state_invalid');}else if(field.kind==='map'){if(!object(value))throw Error('local_tool_codec_state_invalid');if(field.referenceValues)for(const reference of Object.values(value))if(reference!==null)validateLocalToolReference(reference);if(field.assetReferenceValues)for(const reference of Object.values(value))if(reference!==null)validateLocalAssetRef(reference);}else if(field.kind==='list'){if(!Array.isArray(value))throw Error('local_tool_codec_state_invalid');const ids=new Set<string>();for(const item of value){if(!object(item)||typeof item[field.idKey]!=='string'||!item[field.idKey]||ids.has(item[field.idKey] as string))throw Error('local_tool_codec_state_invalid');ids.add(item[field.idKey] as string);if(field.referenceKey&&item[field.referenceKey]!==undefined&&item[field.referenceKey]!==null)validateLocalToolReference(item[field.referenceKey]);}}}
}
export const isLocalToolPlainField=(field:LocalToolFieldCodec|undefined):field is Extract<LocalToolFieldCodec,{kind:'prose'}>&{collaboration:'plain-utf16/1'}=>field?.kind==='prose'&&field.collaboration==='plain-utf16/1';
export const localToolHasPlainFields=(codec:LocalToolStateCodec)=>Object.values(codec.fields).some(isLocalToolPlainField);
export const isLocalToolRichBlockField=(field:LocalToolFieldCodec|undefined)=>field?.kind==='rich'&&['blocks-tree/1','blocks-tree/2','blocks-tree/3','blocks-tree/4','blocks-tree/5','blocks-tree/6','blocks-tree/7','blocks-tree/8','blocks-tree/9','blocks-tree/10','blocks-tree/11','blocks-tree/12'].includes(field.profile);
export const localToolRichLinks=(field:LocalToolFieldCodec|undefined)=>field?.kind==='rich'&&['paragraphs-inline/2','paragraphs-inline/3','blocks-tree/2','blocks-tree/3','blocks-tree/4','blocks-tree/5','blocks-tree/6','blocks-tree/7','blocks-tree/8','blocks-tree/9','blocks-tree/10','blocks-tree/11','blocks-tree/12'].includes(field.profile);

export const localToolRichTables=(field:LocalToolFieldCodec|undefined)=>field?.kind==='rich'&&['blocks-tree/3','blocks-tree/4','blocks-tree/5','blocks-tree/6','blocks-tree/7','blocks-tree/8','blocks-tree/9','blocks-tree/10','blocks-tree/11','blocks-tree/12'].includes(field.profile);
export const localToolRichTableAxes=(field:LocalToolFieldCodec|undefined)=>field?.kind==='rich'&&['blocks-tree/4','blocks-tree/5','blocks-tree/6','blocks-tree/7','blocks-tree/8','blocks-tree/9','blocks-tree/10','blocks-tree/11','blocks-tree/12'].includes(field.profile);
export const localToolRichImageAlignment=(field:LocalToolFieldCodec|undefined)=>field?.kind==='rich'&&['blocks-tree/7','blocks-tree/8','blocks-tree/9','blocks-tree/10','blocks-tree/11','blocks-tree/12'].includes(field.profile);
export const localToolRichImageRaster=(field:LocalToolFieldCodec|undefined)=>field?.kind==='rich'&&['blocks-tree/8','blocks-tree/9','blocks-tree/10','blocks-tree/11','blocks-tree/12'].includes(field.profile);
export const localToolRichImageCells=(field:LocalToolFieldCodec|undefined)=>field?.kind==='rich'&&['blocks-tree/9','blocks-tree/10','blocks-tree/11','blocks-tree/12'].includes(field.profile);
export const localToolRichTableRowHeights=(field:LocalToolFieldCodec|undefined)=>field?.kind==='rich'&&['blocks-tree/10','blocks-tree/11','blocks-tree/12'].includes(field.profile);
export const localToolRichTableCellHeaders=(field:LocalToolFieldCodec|undefined)=>field?.kind==='rich'&&['blocks-tree/11','blocks-tree/12'].includes(field.profile);
export const localToolRichTableCellSpans=(field:LocalToolFieldCodec|undefined)=>field?.kind==='rich'&&field.profile==='blocks-tree/12';
export const localToolRichImages=(field:LocalToolFieldCodec|undefined)=>field?.kind==='rich'&&['blocks-tree/6','blocks-tree/7','blocks-tree/8','blocks-tree/9','blocks-tree/10','blocks-tree/11','blocks-tree/12'].includes(field.profile);
export const localToolRichTableWidths=(field:LocalToolFieldCodec|undefined)=>field?.kind==='rich'&&['blocks-tree/5','blocks-tree/6','blocks-tree/7','blocks-tree/8','blocks-tree/9','blocks-tree/10','blocks-tree/11','blocks-tree/12'].includes(field.profile);
