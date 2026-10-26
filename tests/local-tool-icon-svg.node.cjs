// Public SVG port contract, fixed before implementation. Fixture SVG is not catalogue geometry.
const {build}=require('esbuild');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=`
import assert from 'node:assert/strict';
import {defineLocalTool,createLocalToolIcons,type LocalToolIcons,type LocalToolJson} from '@/engines/local/sdk';
import {createFakeLocalToolHost} from '@/engines/local/testing';

type State={version:1;iconId:string|null;notes:string};
interface Icons {
 get(id:string):Promise<{id:string;pack:string;name:string;label:string}|null>;
 search(query:string,options?:{offset?:number;limit?:number}):Promise<{items:{id:string;pack:string;name:string;label:string}[];total:number}>;
 packs():Promise<{id:string;label:string;count:number}[]>;
 resolveSvg?(id:string):Promise<string|null>;
}
const pack='writer-map-symbols/1',P='icon-svg-author-world',Q='icon-svg-control-world',D='icon-svg-source-document';
const castle=pack+':Castle',wand=pack+':WandSparkles';
const initial:State={version:1,iconId:'writer-map-symbols/99:FutureSymbol',notes:'Saved author notes, independent of SVG resolution.'};
const codec={version:1 as const,fields:{iconId:{kind:'scalar' as const},notes:{kind:'prose' as const}}};
const definition=defineLocalTool<State>({
 namespace:'tests.icon-svg-notebook',name:{en:'SVG author contract',es:'Contrato de autor SVG'},
 description:{en:'Synthetic public Source and explicit fixture port.',es:'Source sintético público y puerto de fixture explícito.'},
 document:{defaultTitle:{en:'Icon notebook',es:'Cuaderno de iconos'}},initialState:initial,codec,
 validateState:(value:LocalToolJson):value is State=>!!value&&typeof value==='object'&&!Array.isArray(value)&&value.version===1&&typeof value.notes==='string'&&(value.iconId===null||typeof value.iconId==='string'),
 component:()=>null,
});
// These two arbitrary SVG strings prove only fixture-port transport, never production rendering.
const castleFixture='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 20L12 4L22 20Z"/></svg>';
const wandFixture='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 20L20 4"/></svg>';
const svg=(icons:Icons)=>{assert.equal(typeof icons.resolveSvg,'function','local_tool_icon_svg_missing: an explicit iconSvg override must expose readonly icons.resolveSvg');return icons.resolveSvg!.bind(icons);};

export async function run(){
 const fixtures={projects:[{id:P,updatedAt:1,worldEras:[{id:'future'}],sourceToolDocuments:[{id:D,namespace:definition.namespace,title:'Source SVG author notebook',revision:1,createdAt:1,updatedAt:1,data:initial,codec}],business:{note:'Author business state must stay exact'}},{id:Q,updatedAt:1,business:{note:'Unrelated project must stay exact'}}]};
 const input=structuredClone(fixtures),requests:string[]=[];
 // Functions belong to the public third argument, outside JSON fixtures and document data.
 const overrides={locale:'en',iconSvg:async(id:string)=>{requests.push(id);return id===castle?castleFixture:id===wand?wandFixture:null;}};
 const host=createFakeLocalToolHost(definition,fixtures,overrides),before=host.inspect();
 const client=host.createClient({projectId:P},true,D),snapshot=await client.read();
 assert.deepEqual(snapshot.data,initial);assert.equal(snapshot.revision,1);assert.equal(snapshot.updatedAt,1);
 assert.equal(snapshot.document?.id,D);assert.equal(snapshot.document?.namespace,definition.namespace);
 assert.equal(snapshot.document?.title,'Source SVG author notebook');assert.equal(snapshot.provenance,'base');
 assert.deepEqual(host.inspect(),before);assert.deepEqual(host.commands,[]);assert.deepEqual(fixtures,input);assert.deepEqual(requests,[]);
 console.log('PASS public readonly Source reads saved iconId/notes and document identity; business, input, commands and fixture-port calls remain exact');

 const icons=(client as unknown as {icons?:Icons}).icons;assert(icons);
 const packs=await icons.packs();assert.deepEqual(packs,[{id:pack,label:'Writer map symbols',count:1688}]);
 assert.deepEqual(await icons.get('Castle'),{id:castle,pack,name:'Castle',label:'Castle'});
 assert.equal((await icons.get('Wand2'))?.id,wand);assert.equal((await icons.search('')).total,1688);
 assert.equal((await icons.search('castle')).items.some(row=>row.id===castle),true);
 assert.deepEqual(await client.read(),snapshot);assert.deepEqual(host.inspect(),before);assert.deepEqual(host.commands,[]);assert.deepEqual(fixtures,input);assert.deepEqual(requests,[]);
 console.log('PASS existing metadata1688, Castle and Wand2 alias work before SVG; no resolver or writes during metadata queries');

 // First material RED on the delivered baseline: Source and metadata above already passed.
 const resolve=svg(icons);
 assert.equal(await resolve('Castle'),castleFixture);assert.equal(await resolve(castle),castleFixture);
 assert.equal(await resolve('Wand2'),wandFixture);assert.equal(await resolve(pack+':Wand2'),wandFixture);assert.equal(await resolve(wand),wandFixture);
 assert.deepEqual(requests,[castle,castle,wand,wand,wand],'Only existing canonical IDs reach the explicit fixture port');
 console.log('PASS public Source SVG capability forwards canonical IDs and aliases to the explicit fixture port; this is not a geometry claim');

 const beforeUnknown=[...requests];
 for(const id of ['UnknownSymbol',pack+':UnknownSymbol','writer-map-symbols/99:Castle','foreign:Castle','castle','', 'https://example.invalid/icon.svg','<svg/>'])assert.equal(await resolve(id),null,'Unknown ID must not become a fallback or arbitrary SVG: '+id);
 for(const id of [undefined,null,7,{},[]])assert.equal(await resolve(id as unknown as string),null);
 assert.deepEqual(requests,beforeUnknown,'Unknown identities must not invoke or load a resolver');
 assert.equal(await resolve('Circle'),null,'A fixture port may explicitly report unavailable geometry for a known identity');
 assert.equal(requests.at(-1),pack+':Circle');
 const assigned=await icons.get('Castle');assert(assigned);assigned.id='foreign:Changed';assigned.name='Changed';
 assert.equal(await resolve('Castle'),castleFixture,'Mutating detached metadata cannot change canonical resolution');
 console.log('PASS unknown/non-string inputs return null without port calls; explicit port null stays null and detached metadata cannot retarget resolution');

 for(const scope of [{projectId:P,eraId:'future'},{projectId:Q}]){
  const scoped=host.createClient(scope,true),scopedIcons=(scoped as unknown as {icons:Icons}).icons;
  assert.equal(await svg(scopedIcons)('Castle'),castleFixture);assert.equal(await svg(scopedIcons)('UnknownSymbol'),null);
 }
 await assert.rejects(async()=>client.save(initial,snapshot.revision,snapshot.document?.version),/local_tool_query_is_read_only/);
 assert.deepEqual(await client.read(),snapshot);assert.deepEqual(host.inspect(),before);assert.deepEqual(host.commands,[]);assert.deepEqual(fixtures,input);
 console.log('PASS SVG is globally readable across project/era and readonly Source data/revisions/business/commands/input stay exact; no save or flush');

 const plainHost=createFakeLocalToolHost(definition,fixtures),plainBefore=plainHost.inspect(),plainClient=plainHost.createClient({projectId:P},true,D);
 const plainIcons=(plainClient as unknown as {icons:Icons}).icons;
 assert.equal(plainIcons.resolveSvg,undefined,'The metadata-only fake must not advertise geometry without an explicit port');
 assert.deepEqual(await plainIcons.packs(),packs);assert.deepEqual((await plainClient.read()).data,initial);
 assert.deepEqual(plainHost.inspect(),plainBefore);assert.deepEqual(plainHost.commands,[]);
 const metadataOnly=createLocalToolIcons() as Icons;assert.equal(metadataOnly.resolveSvg,undefined);assert.deepEqual(await metadataOnly.packs(),packs);
 // An old structural service implementing only metadata remains valid under the additive interface.
 const oldService:LocalToolIcons={get:id=>metadataOnly.get(id),search:(query,options)=>metadataOnly.search(query,options),packs:()=>metadataOnly.packs()};
 assert.equal((oldService as Icons).resolveSvg,undefined);assert.deepEqual(await oldService.packs(),packs);
 const directCalls:string[]=[],directFactory=createLocalToolIcons as unknown as (port?:(id:string)=>Promise<string|null>)=>Icons;
 const direct=directFactory(async id=>{directCalls.push(id);return id===castle?castleFixture:null;});
 assert.equal(await svg(direct)('Castle'),castleFixture);assert.equal(await svg(direct)('UnknownSymbol'),null);assert.deepEqual(directCalls,[castle]);
 console.log('PASS metadata-only factory/fake and old structural services remain valid; an explicitly supplied public factory port adds SVG without importing a renderer');

 const failure=Error('fixture_svg_resolver_failed'),rejectedCalls:string[]=[];
 const rejectedOverrides={locale:'en',iconSvg:async(id:string):Promise<string|null>=>{rejectedCalls.push(id);throw failure;}};
 const rejectedHost=createFakeLocalToolHost(definition,fixtures,rejectedOverrides),rejectedBefore=rejectedHost.inspect();
 const rejectedClient=rejectedHost.createClient({projectId:P},true,D),rejectedSnapshot=await rejectedClient.read(),rejectedIcons=(rejectedClient as unknown as {icons:Icons}).icons;
 assert.equal(await svg(rejectedIcons)('UnknownSymbol'),null);assert.deepEqual(rejectedCalls,[]);
 await assert.rejects(()=>svg(rejectedIcons)('Castle'),error=>error===failure);
 assert.deepEqual(rejectedCalls,[castle]);assert.deepEqual(await rejectedClient.read(),rejectedSnapshot);
 assert.deepEqual(rejectedHost.inspect(),rejectedBefore);assert.deepEqual(rejectedHost.commands,[]);assert.deepEqual(fixtures,input);
 assert.deepEqual(await client.read(),snapshot);assert.deepEqual(host.inspect(),before);assert.deepEqual(host.commands,[]);
 console.log('PASS explicit resolver failures propagate without fallback/null laundering; all Source and control data remain exact');
}
`;
(async()=>{
 const result=await build({stdin:{contents:source,resolveDir:root,sourcefile:'local-tool-icon-svg.author-contract.ts',loader:'ts'},bundle:true,platform:'node',format:'cjs',target:'node22',alias:{'@':path.join(root,'src')},write:false,metafile:true,logLevel:'error'});
 const emitted=new Set(Object.values(result.metafile.outputs).flatMap(output=>Object.entries(output.inputs).filter(([,entry])=>entry.bytesInOutput>0).map(([file])=>file)));
 const forbidden=[...emitted].filter(file=>/src[\\/]db[\\/]|worldEras[\\/](store|adapters|assets)\.|local[\\/](storage|registry|bootstrap)\.|aiBridge[\\/](dispatch|manifest)\.|worldgen[\\/]core[\\/]placeIconData\.|fullLucideIconCatalog\./.test(file));
 if(forbidden.length)throw Error('Public metadata/fixture-port author bundle emitted application/DB/geometry: '+forbidden.join(','));
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wh-icon-svg-author-')),file=path.join(directory,'author.cjs');
 const originalFetch=Object.getOwnPropertyDescriptor(global,'fetch'),descriptors=new Map();
 try{
  fs.writeFileSync(file,result.outputFiles[0].contents);
  Object.defineProperty(global,'fetch',{configurable:true,value:()=>{throw Error('Unexpected network in SVG fixture-port contract');}});
  for(const name of ['indexedDB','window','document']){descriptors.set(name,Object.getOwnPropertyDescriptor(global,name));Object.defineProperty(global,name,{configurable:true,get(){throw Error('Unexpected '+name+' in SVG fixture-port contract');}});}
  await require(file).run();
  console.log('PASS public Source fixture-port bundle excludes emitted geometry/DB/application; no network or browser globals; production SVG renderer remains a separate test');
 }finally{
  if(originalFetch)Object.defineProperty(global,'fetch',originalFetch);else delete global.fetch;
  for(const [name,descriptor]of descriptors){if(descriptor)Object.defineProperty(global,name,descriptor);else delete global[name];}
  fs.unlinkSync(file);fs.rmdirSync(directory);
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
