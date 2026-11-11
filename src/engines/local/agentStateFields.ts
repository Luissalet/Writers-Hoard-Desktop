import type {BridgeToolSchema} from '@/services/aiBridge/schema';
import type {LocalToolOperation} from './sdk';
import type {LocalToolIndexSpec} from './documentIndex';
import {validateLocalToolIndexSpec} from './documentIndex';
import {validateLocalOperationSchema} from './operationSchema';
import {LocalToolOperationError} from './execution';
import {validateLocalToolCodec,type LocalToolFieldCodec,type LocalToolStateCodec} from './stateCodecFormat';
import type {LocalToolStateAction} from './stateActions';
import {cloneLocalToolJson,LocalToolStateError,type LocalToolJson} from './stateTypes';

type ObjectJson=Record<string,LocalToolJson>;
type Labels={en:string;es:string};
export interface LocalToolAgentField {
 description:Labels;
 schema:ObjectJson;
 /** Only scalar string, number, integer or boolean fields can be indexed here. */
 index?:true;
}
export interface LocalToolStateFields {
 version:LocalToolStateCodec['version'];
 fields:Record<string,{codec:LocalToolFieldCodec;agent?:LocalToolAgentField}>;
}

const plain=(v:unknown):v is ObjectJson=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:ObjectJson,allowed:readonly string[])=>Object.keys(v).every(key=>allowed.includes(key));
const name=/^[a-z][a-z0-9_]{0,59}$/;
const scalarTypes=new Set(['string','number','integer','boolean','null']);
function invalid(field?:string):never{throw Error(field?'local_tool_agent_field_invalid: '+field:'local_tool_state_fields_invalid');}

export function prepareLocalToolStateFields<T extends LocalToolJson>(spec:LocalToolStateFields,documentBacked:boolean) {
 const declaration=cloneLocalToolJson(spec as unknown as LocalToolJson);
 if(!plain(declaration)||!exact(declaration,['version','fields'])||
    (declaration.version!==1&&declaration.version!==2)||!plain(declaration.fields))return invalid();
 const codecFields:LocalToolStateCodec['fields']={}, index:LocalToolIndexSpec={version:1,fields:{}};
 const operations:LocalToolOperation<T>[]=[];
 for(const [field,entry] of Object.entries(declaration.fields)){
  if(!plain(entry)||!exact(entry,['codec','agent'])||!plain(entry.codec))return invalid(field);
  codecFields[field]=entry.codec as unknown as LocalToolFieldCodec;
 }
 const codec={version:declaration.version,fields:codecFields};
 validateLocalToolCodec(codec);
 for(const [field,entry] of Object.entries(declaration.fields)){
  if(!plain(entry)||entry.agent===undefined)continue;
  const agent=entry.agent,descriptor=codec.fields[field];
  if(!plain(agent))return invalid(field);
  const copy=agent.description;
  if(!name.test(field)||!exact(agent,['description','schema','index'])||
     !plain(copy)||!exact(copy,['en','es'])||
     !['en','es'].every(locale=>{const label=copy[locale];return typeof label==='string'&&label.trim().length>0&&label.length<=500;})||
     !plain(agent.schema)||(agent.index!==undefined&&agent.index!==true))return invalid(field);
  const descriptions=copy as unknown as Labels, schema=agent.schema;
  const key={type:'string',minLength:1};
  const expectedRevision={type:documentBacked?'integer':['integer','null'],minimum:0,maximum:Number.MAX_SAFE_INTEGER};
  const add=(id:string,verbs:Labels,args:Record<string,unknown>,action:(input:ObjectJson)=>LocalToolStateAction)=>{
   const properties={expectedRevision,...(documentBacked?{expectedDocumentVersion:key}:{}),...args};
   const inputSchema:BridgeToolSchema={type:'object',properties,required:Object.keys(properties),additionalProperties:false};
   validateLocalOperationSchema(inputSchema);
   operations.push({id,description:{en:verbs.en+': '+descriptions.en,es:verbs.es+': '+descriptions.es},writes:true,inputSchema,
    run:async(input,client)=>{
     if(documentBacked&&!client.documentId)throw new LocalToolOperationError('bad-args','Select the exact local tool document.');
     if(!client.state)throw new LocalToolOperationError('bad-args','The local tool state writer is unavailable.');
     const before=await client.read();
     if(before.revision!==input.expectedRevision||documentBacked&&(!before.document||before.document.version!==input.expectedDocumentVersion))throw new LocalToolStateError('conflict');
     const result=await client.state.apply(before,[action(input)]);
     return {revision:result.snapshot.revision,receiptId:result.receiptId,...(result.snapshot.document?{documentVersion:result.snapshot.document.version}:{})};
    }});
  };
  if(descriptor.kind==='scalar'){
   if(typeof schema.type!=='string'||!scalarTypes.has(schema.type))return invalid(field);
   add('set_'+field,{en:'Set field',es:'Cambiar campo'},{value:schema},i=>({type:'set',field,value:i.value}));
   if(agent.index===true){
    const type=schema.type==='integer'?'number':schema.type;
    if(type!=='string'&&type!=='number'&&type!=='boolean')return invalid(field);
    index.fields[field]={path:'$.'+field,type};
   }
  }else if(descriptor.kind==='map'&&!descriptor.referenceValues&&!descriptor.assetReferenceValues&&agent.index===undefined){
   add('set_'+field+'_key',{en:'Set map entry',es:'Cambiar entrada del mapa'},{key,value:schema},i=>({type:'map-set',field,key:i.key as string,value:i.value}));
   add('remove_'+field+'_key',{en:'Remove map entry',es:'Quitar entrada del mapa'},{key},i=>({type:'map-delete',field,key:i.key as string}));
  }else if(descriptor.kind==='list'&&!descriptor.referenceKey&&agent.index===undefined){
   if(schema.type!=='object'||!plain(schema.properties)||!Array.isArray(schema.required)||
      !schema.required.includes(descriptor.idKey)||!plain(schema.properties[descriptor.idKey])||
      (schema.properties[descriptor.idKey] as ObjectJson).type!=='string')return invalid(field);
   add('add_'+field+'_item',{en:'Add list item',es:'Añadir elemento'},{item:schema,afterId:{type:['string','null'],minLength:1}},i=>({type:'list-insert',field,item:i.item as ObjectJson,afterId:i.afterId as string|null}));
   add('update_'+field+'_item',{en:'Update list item',es:'Cambiar elemento'},{id:key,item:schema},i=>({type:'list-update',field,id:i.id as string,item:i.item as ObjectJson}));
   add('remove_'+field+'_item',{en:'Remove list item',es:'Quitar elemento'},{id:key},i=>({type:'list-delete',field,id:i.id as string}));
  }else return invalid(field);
 }
 if(Object.keys(index.fields).length)validateLocalToolIndexSpec(index);
 return {codec,operations,index:Object.keys(index.fields).length?index:undefined};
}
