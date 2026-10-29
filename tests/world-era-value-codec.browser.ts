import {run as causalRun} from './world-era-value-codec.causal';
import {encodeEraValue,decodeEraValue} from '@/services/worldEras/portability';
import {structural,errorInfo} from './world-era-value-codec.structural';

/** Candidate-format literals supplement; causal body R1 remains unchanged. */
export async function run(){
 const result=await causalRun();
 const check=(passed:boolean,name:string)=>{result.checks.push({name,passed});if(!passed&&result.firstFailure===null)result.firstFailure=name;};
 async function compare(name:string,input:unknown,legacy=false){
  const before=await structural(input);
  try{
   const encoded=legacy?input:await encodeEraValue(input),wire=JSON.stringify(encoded);
   if(typeof wire!=='string')throw Error('SUPPLEMENT_REQUIRES_JSON_WIRE');
   const decoded=decodeEraValue(JSON.parse(wire)),after=await structural(decoded);
   result.observations.push({name,inputTagged:before,encodedTagged:await structural(encoded),wire,decodedTagged:after});check(before===after,name);
  }catch(error){result.observations.push({name,inputTagged:before,error:errorInfo(error)});check(false,name);}
 }
 const reserved={__whEraValue:2,value:{ordinary:'literal',nil:null},undefinedPaths:[['root','present']],literalBlobPaths:[['root','literal']]};
 await compare('ROOT_LITERAL_RESERVED_V2_ESCAPED',reserved);
 const nested={root:{id:'codec-literal-v2',literal:reserved,list:[reserved,{deep:reserved}]},children:{}};
 await compare('NESTED_LITERAL_RESERVED_V2_ROUNDTRIP',nested);
 await compare('LEGACY_DOCUMENT_NESTED_RESERVED_V2_UNCHANGED',nested,true);
 const ownKeys=Object.fromEntries([['__proto__',undefined],['constructor',{prototype:undefined}],['',{child:undefined}],['0',undefined]]);
 await compare('OWN_SPECIAL_KEYS_UNDEFINED_ROUNDTRIP',{root:{id:'codec-own-special',ownKeys},children:{}});
 const literalBlob={__whEraBlob:1,mime:'application/octet-stream',base64:'AA==',child:undefined};
 await compare('LITERAL_BLOB_WITH_OWN_UNDEFINED_CHILD',{root:{id:'codec-blob-own-child',literal:literalBlob},children:{}});
 result.ok=result.checks.every(row=>row.passed)&&result.notExecuted.length===0;
 return result;
}

/** Ordinary test entry; preserve complete observations on any codec failure. */
export async function testWorldEraValueCodec() {
 const result = await run();
 if (!result.ok) throw Error('Era value codec regression: ' + JSON.stringify(result));
 return result.checks.map(check => 'Era value codec: ' + check.name);
}
