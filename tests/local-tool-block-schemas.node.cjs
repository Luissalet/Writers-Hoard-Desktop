// Public schema/policy-shape regression; does not execute a Source handler.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{buildSync}=require('esbuild');
const root=path.resolve(__dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'wh-block-schema-')),bundle=path.join(temporary,'schema.cjs');
try{
 const compiled=buildSync({stdin:{contents:"export {getBridgeTool} from './src/services/aiBridge/manifest';export {validateToolArgs} from './src/services/aiRuntime/toolPolicy';",resolveDir:root},bundle:true,platform:'node',format:'cjs',write:false,metafile:true,alias:{'@':path.join(root,'src')},logLevel:'error'});
 assert.deepEqual(Object.keys(compiled.metafile.inputs).filter(file=>/src\/(db|components)\/|node_modules\/(react|dexie|dompurify)\//.test(file)),[],'Schema/policy graph must remain pure');
 fs.writeFileSync(bundle,compiled.outputFiles[0].contents);const {getBridgeTool,validateToolArgs}=require(bundle),tool=getBridgeTool('wh_local_tool_state_apply'),branches=tool.schema.properties.actions.items.oneOf;
 const cases=[
  ['rich-block-split','newItemId',{type:'rich-block-split',field:'body',capture:{},newNodeId:'N'}],
  ['rich-block-list-indent','listId',{type:'rich-block-list-indent',field:'body',capture:{},direction:'out'}],
  ['rich-block-insert','marks',{type:'rich-block-insert',field:'body',capture:{},block:{id:'P',type:'paragraph',attrs:{}},text:'text'}],
 ];
 let checks=0;
 for(const [name,optional,args] of cases){const shape=branches.find(shape=>shape.properties.type.const===name);assert(shape,'Action remains advertised: '+name);assert(Object.hasOwn(shape.properties,optional),'Optional property remains available: '+optional);assert(!shape.required.includes(optional),'SDK optional field advertised as required: '+optional);checks+=3;const valid=validateToolArgs(shape,args);assert.equal(valid.ok,true,JSON.stringify(valid));assert(!Object.hasOwn(valid.args,optional),'Omission must not fabricate '+optional);checks+=2;const {capture,...missing}=args;void capture;assert.equal(validateToolArgs(shape,missing).ok,false,'The actual capture remains required');checks++;}
 console.log('PASS block action optional metadata and policy-shape '+checks+' checks; no handler/executor claim');
}finally{if(fs.existsSync(bundle))fs.unlinkSync(bundle);fs.rmdirSync(temporary);}
