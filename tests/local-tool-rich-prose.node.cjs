const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),Module=require('node:module'),assert=require('node:assert/strict'),{build}=require('esbuild');
const root=path.resolve(__dirname,'..');
async function bundle(contents){return build({stdin:{contents,resolveDir:root,sourcefile:'rich-prose-pure.ts'},bundle:true,platform:'node',format:'cjs',target:'node22',jsx:'automatic',alias:{'@':path.join(root,'src')},write:false,metafile:true,logLevel:'error'});}
function load(result){const compiled=new Module(path.join(root,'rich-prose-pure.cjs'),module);compiled.filename=path.join(root,'rich-prose-pure.cjs');compiled.paths=Module._nodeModulePaths(root);compiled._compile(result.outputFiles[0].text,compiled.filename);return compiled.exports;}
(async()=>{
 const result=await bundle(`export {validateLocalToolCodec,validateLocalToolCodecState,remapLocalToolReferences} from './src/engines/local/stateCodec';export {localToolSemanticPreview,renderLocalToolPreview} from './src/engines/local/previewTypes';`);
 const api=load(result),rich={version:1,fields:{briefing:{kind:'prose',format:'rich'}}},legacy={version:1,fields:{briefing:{kind:'prose'}}},html='<h2>Harbour &amp; lighthouse</h2><ul><li>Ask Nora</li><li>Read chart</li></ul>';
 api.validateLocalToolCodec(rich);api.validateLocalToolCodecState({briefing:html},rich);
 for(const codec of [{version:1,fields:{briefing:{kind:'scalar',format:'rich'}}},{version:1,fields:{briefing:{kind:'prose',format:'markdown'}}}])assert.throws(()=>api.validateLocalToolCodec(codec));
 assert.throws(()=>api.validateLocalToolCodecState({briefing:2},rich));
 const data={briefing:html,opaque:'<h2>Never parse legacy</h2>'},before=JSON.stringify(data);
 const raw=api.localToolSemanticPreview('Old',data,undefined,'en',legacy);assert.equal(raw.fields[0].value,html);assert.equal(raw.fields[0].richHtml,undefined);assert(api.renderLocalToolPreview(raw).includes('&lt;h2&gt;'));
 const semantic=api.localToolSemanticPreview('Rich',data,undefined,'en',rich);assert.equal(semantic.fields[0].value,'Harbour & lighthouse Ask Nora Read chart');assert.equal(semantic.fields[0].richHtml,html);assert.equal(semantic.fields[1].richHtml,undefined);assert.equal(JSON.stringify(data),before);assert(!api.renderLocalToolPreview(semantic).includes('<h2>Harbour'));
 console.log('PASS Opt-in codec validates string rich only, plain projection is pure and legacy HTML remains literal/escaped');
 assert.throws(()=>api.remapLocalToolReferences(data,rich,(_kind,id)=>'copy-'+id),/rich.*remap|remap.*rich/);
 const remapped=api.remapLocalToolReferences(data,rich,(_kind,id)=>'copy-'+id,undefined,value=>value.replace('Nora','Nora copied'));assert(remapped.briefing.includes('Nora copied'));assert.equal(remapped.opaque,data.opaque);assert.equal(JSON.stringify(data),before);
 assert.equal(api.remapLocalToolReferences(data,legacy,(_kind,id)=>'copy-'+id).briefing,html);
 console.log('PASS Rich remap needs an explicit host callback; opaque fields and legacy stay byte-exact');
 const example=await bundle(`export {default as definition} from './src/engines/local/installed/examples.rich-prose/module';`);
 const forbidden=Object.keys(example.metafile.inputs).filter(file=>/src\/(?:db\/|components\/editor\/)|worldEras\/(?:store|adapters|assets)\.|local\/(?:storage|registry|bootstrap|RichProseEditor|richProseHtml)\.|aiBridge\/(?:dispatch|manifest)\./.test(file));assert.deepEqual(forbidden,[],'Real author module imports host internals');
 global.fetch=()=>{throw Error('Network forbidden in pure module');};Object.defineProperty(global,'indexedDB',{configurable:true,get(){throw Error('IndexedDB forbidden in pure module');}});const definition=load(example).definition;assert.equal(definition.namespace,'examples.rich-prose');assert.equal(definition.codec.fields.briefing.format,'rich');assert.equal(definition.blocks[0].codec.fields.briefing.format,'rich');
 console.log('PASS Real SDK module public-wrapper graph remains Node pure without editor, DB, network or application bootstrap');
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
