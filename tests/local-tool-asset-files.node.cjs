const {build}=require('esbuild'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
(async()=>{
 const result=await build({stdin:{contents:"export * from './src/engines/local/assetFileFormat';export * from './src/engines/local/localAssetFonts';export * from './src/engines/local/useLocalToolFontFace';export {defineLocalTool} from './src/engines/local/sdk';export {createFakeLocalToolHost} from './src/engines/local/testing';export {testImageBase64} from './tests/local-tool-image-fixture';",resolveDir:root},bundle:true,platform:'node',format:'cjs',target:'node22',alias:{'@':path.join(root,'src')},write:false,metafile:true,logLevel:'error'});
 assert(!Object.keys(result.metafile.inputs).some(file=>/src\/db\/|assetBrowser|local\/(storage|registry|bootstrap)\./.test(file)),'Pure files/font hook imported host/DB');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wh-file-kit-')),file=path.join(directory,'kit.cjs');fs.writeFileSync(file,result.outputFiles[0].contents);Object.defineProperty(global,'indexedDB',{get(){throw Error('Unexpected IndexedDB');}});global.fetch=()=>{throw Error('Unexpected fetch');};const kit=require(file);
 const bytes=fs.readFileSync(path.join(root,'src/engines/local/examples/assets/glyph-sample.ttf')),row=await kit.prepareAssetFile(new File([bytes],'glyph-sample.ttf'),'font','node-project'),portable=await kit.encodeAssetFile(row),[decoded]=await kit.decodeAssetFiles([portable],'node-project');assert.deepEqual(new Uint8Array(await decoded.blob.arrayBuffer()),new Uint8Array(bytes));
 await assert.rejects(()=>kit.decodeAssetFiles([{...portable,sha256:'0'.repeat(64)}],'node-project'));
 console.log('PASS Pure file codec roundtrips actual font bytes/SHA and rejects corrupt content without DB/network/FontFace');
 const png=Buffer.from(kit.testImageBase64,'base64');
 const raster=await kit.prepareAssetFile(new File([png],'lighthouse.png'),'image','node-project'),rasterPortable=await kit.encodeAssetFile(raster),[restored]=await kit.decodeAssetFiles([rasterPortable],'node-project');
 assert.equal(restored.kind,'image');assert.equal(restored.mime,'image/png');assert.equal(restored.sha256,crypto.createHash('sha256').update(png).digest('hex'));assert.deepEqual(Buffer.from(await restored.blob.arrayBuffer()),png);
 const corrupt=Buffer.from(png);corrupt[65]^=1;
 for(const invalid of [png.subarray(0,-12),corrupt]){
  await assert.rejects(()=>kit.prepareAssetFile(new File([invalid],'invalid.png',{type:'image/png'}),'image','node-project'),{message:'local_asset_image_invalid'});
  await assert.rejects(()=>kit.decodeAssetFiles([{...rasterPortable,base64:invalid.toString('base64'),size:invalid.length,sha256:crypto.createHash('sha256').update(invalid).digest('hex')}],'node-project'),{message:'local_asset_image_invalid'});
 }
 await assert.rejects(()=>kit.prepareAssetFile(new File([png],'wrong.webp',{type:'image/webp'}),'image','node-project'),{message:'local_asset_image_invalid'});
 console.log('PASS PNG image assets roundtrip exact bytes; wrong MIME, missing IEND and damaged chunk CRC reject even with a matching file hash');
 const font={token:row.sha256,mime:row.mime,base64:portable.base64};assert(kit.localAssetFontCss([font]).includes('@font-face'),'Inline preview lost CSS');assert.equal(kit.localAssetFontCss([font],''),'','Explicit empty final HTML must emit no font CSS');assert.equal(kit.localAssetFontCss([font],'<p>Empty selection</p>'),'');assert(kit.localAssetFontCss([font],`<section data-wh-asset-font="${font.token}"></section>`).includes('@font-face'));assert.equal(kit.localAssetFontCss([{...font,token:'bad'}]),'');
 console.log('PASS Font CSS admits only generated tokens and exact referenced fonts; explicit empty HTML emits no resources');
 const packDefinition=fs.readFileSync(path.join(root,'src/engines/local/examples/initiativeDefinition.ts'),'utf8'),declared=[...packDefinition.matchAll(/localAssetFile\(new URL\('\.\/(assets\/[^']+)'/g)].map(match=>match[1]).sort(),manifest=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/local-tools/initiative-asset-release-files.json'),'utf8'));assert.deepEqual(manifest.map(row=>row.path).sort(),declared);for(const descriptor of manifest){const bytes=fs.readFileSync(path.join(root,'src/engines/local/examples',descriptor.path));assert.equal(bytes.length,descriptor.bytes);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),descriptor.sha256);}
 console.log('PASS Shared Initiative fixture covers every actual declared pack file with exact bytes/SHA, without a fixed asset count');
 const definition=kit.defineLocalTool({namespace:'qa.file-kit',name:{en:'Files',es:'Archivos'},description:{en:'Local files',es:'Archivos locales'},initialState:{},validateState:value=>!!value&&typeof value==='object',component:()=>null,operations:[{id:'abort_file',description:{en:'Abort',es:'Abortar'},writes:true,inputSchema:{type:'object',properties:{},additionalProperties:false},run:async(_args,client)=>{await client.assets.import(new File(['discard'],'discard.txt',{type:'text/plain'}),'data');throw Error('deliberate abort');}}]}),host=kit.createFakeLocalToolHost(definition,{projects:[{id:'node-project'}]});await assert.rejects(()=>host.runOperation({projectId:'node-project'},'abort_file',{},true));assert.equal(host.inspect().assetFiles.length,0);const client=host.createClient({projectId:'node-project'}),saved=await client.assets.import(new File(['keep'],'keep.txt',{type:'text/plain'}),'data'),same=await client.assets.import(new File(['keep'],'again.txt',{type:'text/plain'}),'data');assert.equal(saved.id,same.id);assert.equal(await (await client.assets.resolve(saved.ref)).blob.text(),'keep');await assert.rejects(()=>host.createClient({projectId:'node-project'},true).assets.import(new File(['no'],'no.txt'),'data'));
 console.log('PASS Pure author host owns transactional file fixtures: abort rollback, immutable dedupe, exact bytes and readonly import rejection');
 const images=kit.createFakeLocalToolHost(definition,{projects:[{id:'node-project'},{id:'other-project'}]}),imagePort=images.createClient({projectId:'node-project'}),other=images.createClient({projectId:'other-project'});
 const descriptor={sha256:restored.sha256,mime:'image/png',size:png.length};
 await imagePort.assets.import(new File([png],'generic.png',{type:'image/png'}),'data');
 assert.equal(await imagePort.assets.resolveImage(descriptor),null);
 const image=await imagePort.assets.import(new File([png],'image.png',{type:'image/png'}),'image'),again=await imagePort.assets.import(new File([png],'again.png',{type:'image/png'}),'image');
 assert.equal(image.id,again.id);assert.equal(await other.assets.resolveImage(descriptor),null);
 const imageCount=images.inspect().assetFiles.length,found=await imagePort.assets.resolveImage(descriptor);
 assert.equal(found.ref.id,image.id);assert.deepEqual(Buffer.from(await found.blob.arrayBuffer()),png);
 assert.equal(await imagePort.assets.resolveImage({...descriptor,size:png.length+1}),null);
 assert.equal(images.inspect().assetFiles.length,imageCount);
 console.log('PASS Digest lookup returns exact immutable PNG only in the owning project, deduplicates imports and never imports on read');
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
