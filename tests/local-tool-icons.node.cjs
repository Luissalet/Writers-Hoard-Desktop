// Public author contract: the complete oracle is fixed before icon service implementation.
const {build}=require('esbuild');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=`
import assert from 'node:assert/strict';
import {defineLocalTool,type LocalToolJson} from '@/engines/local/sdk';
import {createFakeLocalToolHost} from '@/engines/local/testing';

type State={version:1;iconId:string|null;notes:string};
interface Icon {id:string;pack:string;name:string;label:string}
interface Icons {
 packs():Promise<{id:string;label:string;count:number}[]>;
 get(id:string):Promise<Icon|null>;
 search(query:string,options?:{offset?:number;limit?:number}):Promise<{items:Icon[];total:number}>;
}
const pack='writer-map-symbols/1',P='icons-author-world',Q='icons-other-world',D='icons-source-document';
const codec={version:1 as const,fields:{notes:{kind:'prose' as const},iconId:{kind:'scalar' as const}}};
const initial:State={version:1,iconId:null,notes:'Saved author notes'};
const definition=defineLocalTool<State>({
 namespace:'tests.icon-notebook',name:{en:'Icon notebook author fixture',es:'Fixture de cuaderno de iconos'},
 description:{en:'Synthetic public source author contract.',es:'Contrato sintético público de autor.'},
 document:{defaultTitle:{en:'Icon notebook',es:'Cuaderno de iconos'}},initialState:initial,codec,
 validateState:(value:LocalToolJson):value is State=>!!value&&typeof value==='object'&&!Array.isArray(value)&&value.version===1&&typeof value.notes==='string'&&(value.iconId===null||typeof value.iconId==='string'),
 component:()=>null,
});
export async function run(){
 const fixtures={projects:[{id:P,updatedAt:1,worldEras:[{id:'future'}],sourceToolDocuments:[{id:D,namespace:definition.namespace,title:'Source icon notebook',revision:1,createdAt:1,updatedAt:1,data:initial,codec}]},{id:Q,updatedAt:1}]};
 const input=structuredClone(fixtures),host=createFakeLocalToolHost(definition,fixtures),before=host.inspect();
 const client=host.createClient({projectId:P},true,D),snapshot=await client.read();
 assert.deepEqual(snapshot.data,initial);
 assert.equal(snapshot.revision,1);assert.equal(snapshot.updatedAt,1);
 assert.equal(snapshot.document?.id,D);assert.equal(snapshot.document?.namespace,definition.namespace);
 assert.equal(snapshot.document?.title,'Source icon notebook');assert.equal(snapshot.provenance,'base');
 assert.deepEqual(host.inspect(),before);assert.deepEqual(host.commands,[]);assert.deepEqual(fixtures,input);
 console.log('PASS public fake Source reads the authored iconId/notes and document identity before the new contract; business/commands/input remain exact');
 const icons=(client as unknown as {readonly icons?:Icons}).icons;
 assert(icons&&typeof icons.get==='function'&&typeof icons.search==='function'&&typeof icons.packs==='function','local_tool_icons_missing: a readonly public author client must provide get/search/packs');
 const packs=await icons.packs();
 assert.equal(packs.length,1);assert.equal(packs[0].id,pack);assert.equal(packs[0].label,'Writer map symbols');assert.equal(packs[0].count,1688);
 const castle={id:pack+':Castle',pack,name:'Castle',label:'Castle'};
 assert.deepEqual(await icons.get('Castle'),castle);assert.deepEqual(await icons.get(castle.id),castle);
 assert.deepEqual(await icons.get('Wand2'),await icons.get('WandSparkles'));
 assert.equal((await icons.get('Wand2'))?.id,pack+':WandSparkles');
 assert.equal((await icons.get(pack+':Wand2'))?.id,pack+':WandSparkles');
 for(const id of ['UnknownIcon',pack+':UnknownIcon','unknown:Castle','https://example.invalid/Castle','tabler:castle',''])assert.equal(await icons.get(id),null,'Unknown identity was reinterpreted: '+id);
 console.log('PASS one existing Writer pack, canonical IDs, explicit Wand2 input alias and honest unknown identities');
 const found=await icons.search('castle'),upper=await icons.search('CASTLE');
 assert.deepEqual(found,upper);assert(found.items.some(row=>row.id===castle.id));
 assert.equal((await icons.search('map pin')).items.some(row=>row.name==='MapPin'),true);
 assert.deepEqual(await icons.search('no-such-icon-author-fixture'),{items:[],total:0});
 const defaultPage=await icons.search('');assert.equal(defaultPage.total,packs[0].count);assert.equal(defaultPage.items.length,50);
 const rows:Icon[]=[];
 for(let offset=0;offset<defaultPage.total;offset+=137){const page=await icons.search('',{offset,limit:137});assert.equal(page.total,defaultPage.total);assert.equal(page.items.length,Math.min(137,defaultPage.total-offset));rows.push(...page.items);}
 assert.equal(rows.length,packs[0].count);assert.equal(new Set(rows.map(row=>row.id)).size,rows.length);
 assert.deepEqual(rows.map(row=>row.name),rows.map(row=>row.name).sort());
 assert.deepEqual(defaultPage.items,rows.slice(0,50));
 assert.deepEqual(await icons.search('',{offset:defaultPage.total+1,limit:50}),{items:[],total:defaultPage.total});
 for(const row of rows){assert.equal(row.pack,pack);assert.equal(row.id,pack+':'+row.name);assert(row.label.trim());}
 for(const options of [{offset:-1},{offset:0.5},{offset:NaN},{offset:Infinity},{limit:0},{limit:-1},{limit:0.5},{limit:NaN},{limit:Infinity}])await assert.rejects(()=>icons.search('',options),'Invalid pagination was silently accepted');
 console.log('PASS literal case-insensitive name/word search, default page50, full pagination without losses/duplicates, outside page and invalid arguments');
 const pristinePacks=await icons.packs(),pristineCastle=await icons.get('Castle'),pristinePage=await icons.search('castle');
 const mutablePacks=await icons.packs();mutablePacks[0].label='MUTATED';mutablePacks.push({id:'foreign',label:'Foreign',count:1});
 const mutableCastle=await icons.get('Castle');assert(mutableCastle);mutableCastle.label='MUTATED';mutableCastle.name='MUTATED';
 const mutablePage=await icons.search('castle');mutablePage.items[0].label='MUTATED';mutablePage.total=-1;mutablePage.items.length=0;
 assert.deepEqual(await icons.packs(),pristinePacks);assert.deepEqual(await icons.get('Castle'),pristineCastle);assert.deepEqual(await icons.search('castle'),pristinePage);
 for(const scope of [{projectId:P,eraId:'future'},{projectId:Q}]){
  const scoped=(host.createClient(scope,true) as unknown as {readonly icons?:Icons}).icons;assert(scoped);
  assert.deepEqual(await scoped.packs(),pristinePacks);assert.deepEqual(await scoped.get('Castle'),pristineCastle);assert.deepEqual(await scoped.search('castle'),pristinePage);
 }
 assert.deepEqual(await client.read(),snapshot);assert.deepEqual(host.inspect(),before);assert.deepEqual(host.commands,[]);assert.deepEqual(fixtures,input);
 console.log('PASS detached responses and global catalogue across project/era; readonly Source snapshot, all business data, commands and input remain exact');
}
`;
(async()=>{
 const result=await build({stdin:{contents:source,resolveDir:root,sourcefile:'local-tool-icons.author-contract.ts',loader:'ts'},bundle:true,platform:'node',format:'cjs',target:'node22',alias:{'@':path.join(root,'src')},write:false,metafile:true,logLevel:'error'});
 // inputs includes modules resolved before tree shaking. Inspect actual contribution instead.
 const emitted=new Set(Object.values(result.metafile.outputs).flatMap(output=>Object.entries(output.inputs).filter(([,entry])=>entry.bytesInOutput>0).map(([file])=>file)));
 const forbidden=[...emitted].filter(file=>/src[\\/]db[\\/]|worldEras[\\/](store|adapters|assets)\.|local[\\/](storage|registry|bootstrap)\.|aiBridge[\\/](dispatch|manifest)\.|worldgen[\\/]core[\\/]placeIconData\.|fullLucideIconCatalog\./.test(file));
 if(forbidden.length)throw Error('Public author bundle emitted application/DB/drawing catalogue: '+forbidden.join(','));
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wh-icons-author-')),file=path.join(directory,'author.cjs');
 try{
  fs.writeFileSync(file,result.outputFiles[0].contents);
  global.fetch=()=>{throw Error('Unexpected network in icon author contract');};
  for(const name of ['indexedDB','window','document'])Object.defineProperty(global,name,{configurable:true,get(){throw Error('Unexpected '+name+' in icon author contract');}});
  await require(file).run();
  console.log('PASS public author headless runtime forbids network/IndexedDB/window/document and emitted graph excludes DB/application/geometry');
 }finally{fs.rmSync(file,{force:true});fs.rmdirSync(directory);}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
