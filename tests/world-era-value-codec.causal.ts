import {encodeEraValue, decodeEraValue} from '@/services/worldEras/portability';
import {structural, errorInfo} from './world-era-value-codec.structural';

/** Pure actual-codec focal. No database, DOM, host, model or external service. */
export async function run() {
 const result:{ok:boolean;firstFailure:string|null;checks:{name:string;passed:boolean}[];observations:unknown[];notExecuted:string[];scope:string}={ok:false,firstFailure:null,checks:[],observations:[],notExecuted:[],scope:'Actual era-value codec through JSON; not ZIP/Source/UI/Native or complete format adoption'};
 const check=(passed:boolean,name:string)=>{result.checks.push({name,passed});if(!passed&&result.firstFailure===null)result.firstFailure=name;};
 const observe=(name:string,value:unknown)=>result.observations.push({name,value});
 async function roundtrip(name:string,input:unknown){
  const before=await structural(input);
  try{
   const encoded=await encodeEraValue(input),encodedTagged=await structural(encoded),wire=JSON.stringify(encoded);
   if(typeof wire!=='string'){observe(name,{inputTagged:before,encodedTagged,wireType:typeof wire,error:'ENCODED_VALUE_HAS_NO_JSON_REPRESENTATION'});check(false,name);return;}
   const decoded=decodeEraValue(JSON.parse(wire)),after=await structural(decoded);
   observe(name,{inputTagged:before,encodedTagged,wire,decodedTagged:after});check(before===after,name);
  }catch(error){observe(name,{inputTagged:before,error:errorInfo(error)});check(false,name);}
 }
 async function legacy(name:string,wireValue:unknown,expected:unknown){
  const before=await structural(expected);
  try{const wire=JSON.stringify(wireValue);if(typeof wire!=='string')throw Error('LEGACY_FIXTURE_REQUIRES_JSON');const decoded=decodeEraValue(JSON.parse(wire)),after=await structural(decoded);observe(name,{wire,expectedTagged:before,decodedTagged:after});check(before===after,name);}
  catch(error){observe(name,{expectedTagged:before,error:errorInfo(error)});check(false,name);}
 }
 const ordinary={root:{id:'codec-ordinary',data:{text:'Ordinary Élodie 李明 \ud800',nil:null,bool:true,number:23,list:[null,false,3,'plain'],nested:{kept:'value'}}},children:{}};
 await legacy('CONTROL_LEGACY_JSON_DECODE',ordinary,ordinary);
 await roundtrip('CONTROL_ORDINARY_JSON_ROUNDTRIP',ordinary);
 const bytes=new Uint8Array([0,1,127,255,42]),blob=new Blob([bytes],{type:'application/octet-stream'});
 const oldBlob={__whEraBlob:1,mime:blob.type,base64:btoa(String.fromCharCode(...bytes))};
 await legacy('CONTROL_LEGACY_BLOB_DECODE_BYTES',oldBlob,blob);
 await roundtrip('CONTROL_CURRENT_BLOB_ROUNDTRIP_BYTES',blob);
 const own={root:{id:'codec-own',keep:'value',present:undefined,nested:{child:undefined}},children:{}},absent={root:{id:'codec-own',keep:'value',nested:{}},children:{}};
 check(Object.hasOwn(own.root,'present')&&!Object.hasOwn(absent.root,'present')&&await structural(own)!==await structural(absent),'CONTROL_OBSERVER_OWN_UNDEFINED_DISTINCT_ABSENT');
 await roundtrip('OBJECT_OWN_UNDEFINED_PRESERVED',own);
 await roundtrip('OBJECT_ABSENT_REMAINS_ABSENT',absent);
 await roundtrip('HISTORY_ARRAY_OWN_UNDEFINED',[{id:'codec-h1',kind:'local-tool',codexPropertyDefinitions:undefined},{id:'codec-h2',kind:'local-tool'}]);
 await roundtrip('ARRAY_OWN_UNDEFINED_DISTINCT_NULL',{root:{id:'codec-array',list:[undefined,null,'tail']},children:{}});
 await roundtrip('LITERAL_LEGACY_BLOB_TAG_IS_NOT_BLOB',{root:{id:'codec-blob-literal',literal:oldBlob},children:{}});
 await roundtrip('NESTED_LITERAL_LEGACY_BLOB_TAGS',{root:{id:'codec-blob-nested',literal:oldBlob,list:[oldBlob,{deeper:oldBlob}],real:blob},children:{}});
 try{
  const candidate=await encodeEraValue(own),wire=JSON.stringify(candidate);
  observe('CANDIDATE_DOCUMENT_WIRE',{tagged:await structural(candidate),wireType:typeof wire,...(typeof wire==='string'?{wire}:{})});
  check(typeof wire==='string','CANDIDATE_DOCUMENT_HAS_SERIALIZABLE_WIRE');
  if(typeof wire==='string'){
   const literal=JSON.parse(wire);
   const literalDocument={root:{id:'codec-wire-literal',literal,list:[literal,{deep:literal}],present:undefined,absent:{}},children:{}};
   await roundtrip('NESTED_LITERAL_EQUAL_TO_ACTUAL_ROOT_WIRE',literalDocument);
   const legacyDocument={root:{id:'codec-legacy-wire-literal',literal,list:[literal,{deep:literal}]},children:{}};
   await legacy('LEGACY_WITH_NESTED_NEW_WIRE_NOT_REINTERPRETED',legacyDocument,legacyDocument);
   const escapedCandidate=await encodeEraValue(literalDocument),escapedWire=JSON.stringify(escapedCandidate);
   check(typeof escapedWire==='string','ESCAPED_LITERAL_HAS_SERIALIZABLE_WIRE');
   if(typeof escapedWire==='string')await roundtrip('NESTED_LITERAL_EQUAL_TO_ACTUAL_ESCAPE_WIRE',{root:{id:'codec-escape-literal',literal:JSON.parse(escapedWire)},children:{}});
   else result.notExecuted.push('LITERAL_EQUAL_TO_ACTUAL_ESCAPE_WIRE: no serializable escape wire');
  }else result.notExecuted.push('Actual root-wire/escape collision cases: candidate document has no JSON wire');
 }catch(error){observe('CANDIDATE_WIRE_FAILURE',{error:errorInfo(error)});check(false,'CANDIDATE_DOCUMENT_WIRE_AVAILABLE');result.notExecuted.push('Actual root-wire/escape collision cases unavailable');}
 result.ok=result.checks.every(row=>row.passed)&&result.notExecuted.length===0;
 return result;
}
