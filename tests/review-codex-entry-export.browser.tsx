import JSZip from 'jszip';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {defineLocalTool} from '@/engines/local/sdk';
import {registerLocalToolModules} from '@/engines/local/registry';
import {serializeLocalToolBlock,type LocalToolOwnedBlockEnvelope} from '@/engines/local/blocks/types';
import {localToolReleaseIdentity,LOCAL_TOOL_SOURCE_FORMAT} from '@/engines/local/releaseFormat.mjs';
import {prepareCodexEntryExport,codexEntryMarkdown} from '@/services/codexEntryExport';
import '@/services/aiBridge/dispatch'; // Wire registered renderer handlers for Native relay.
import type {Project,CodexEntry} from '@/types';
import type {CodexTemplate} from '@/engines/codex/templateTypes';

// Independent reviewer fixtures. No author test exports or product hooks.
function check(value:unknown,message:string):asserts value {if(!value)throw Error(message);}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};}
async function bounded<T>(work:Promise<T>,label:string){let timer:ReturnType<typeof setTimeout>;try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),15000);})]);}finally{clearTimeout(timer!);}}
const hash=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
function png(color:string){const canvas=document.createElement('canvas');canvas.width=canvas.height=2;const context=canvas.getContext('2d')!;context.fillStyle=color;context.fillRect(0,0,2,2);return canvas.toDataURL('image/png');}
function wav(samples=800){const data=new Uint8Array(44+samples*2),view=new DataView(data.buffer);const text=(offset:number,value:string)=>{[...value].forEach((char,index)=>{data[offset+index]=char.charCodeAt(0);});};text(0,'RIFF');view.setUint32(4,data.length-8,true);text(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,samples*2,true);return new Blob([data],{type:'audio/wav'});}
const ownTemplate=(id:string):CodexTemplate=>({id,name:'Reviewer template',category:'custom',fields:{alpha:'0',beta:'false'},content:'',revision:1,createdAt:1,updatedAt:1,propertyDefinitions:[{id:'alpha-id',key:'alpha',label:'Shared label',kind:'number'},{id:'beta-id',key:'beta',label:'Shared label',kind:'text'}],referenceFieldDefinitions:[{key:'links',label:'Entry links'}]});
const card=(projectId:string,id:string,title:string):CodexEntry=>({id,projectId,title,type:'custom',content:'<p>REVIEW_SAVED_BODY</p>',fields:{alpha:'0',beta:'false'},tags:['review'],relations:[],createdAt:1,updatedAt:1});

async function resourceFixture(){
 const id='review-card-'+crypto.randomUUID(),namespace='review.card-'+crypto.randomUUID().slice(0,8),entered=deferred(),release=deferred();let hold=true;
 const oldPng=png('#c01020'),newPng=png('#2040d0'),oldGate=new Blob(['BUNDLE_A_CAPTURED'],{type:'text/plain'}),newGate=new Blob(['BUNDLE_B_LIVE'],{type:'text/plain'});
 const oldFile=new Blob(['USER_FILE_CAPTURED'],{type:'text/plain'}),newFile=new Blob(['USER_FILE_LIVE'],{type:'text/plain'}),sound=wav();
 const manifests=[];
 for(const [index,blob]of [oldGate,newGate].entries()){
  const definition=defineLocalTool({namespace,name:{en:'Review assets',es:'Recursos de revisión'},description:{en:'Independent export fixture',es:'Fixture independiente'},initialState:{},validateState:(value):value is Record<string,never>=>!!value&&typeof value==='object'&&!Array.isArray(value),component:()=>null,assets:{gate:{kind:'data',path:'assets/gate.txt'},file:{kind:'data',path:'assets/file.txt'},portrait:{kind:'image',path:'assets/portrait.png'}},assetFiles:{'assets/gate.txt':async()=>{if(index===0&&hold){entered.resolve();await release.promise;}return blob;},'assets/file.txt':async()=>oldFile,'assets/portrait.png':async()=>new Blob([Uint8Array.from(atob(oldPng.split(',')[1]),char=>char.charCodeAt(0))],{type:'image/png'})}});
  const files=[{path:'assets/gate.txt',bytes:blob.size,sha256:await hash(blob)},{path:'assets/file.txt',bytes:oldFile.size,sha256:await hash(oldFile)},{path:'assets/portrait.png',bytes:atob(oldPng.split(',')[1]).length,sha256:await hash(new Blob([Uint8Array.from(atob(oldPng.split(',')[1]),char=>char.charCodeAt(0))]))},{path:'module.tsx',bytes:0,sha256:await hash(new Blob([]))}];
  const manifest={format:LOCAL_TOOL_SOURCE_FORMAT,apiVersion:1 as const,namespace,version:`1.${index}.0`,files,contentHash:''};manifest.contentHash=await hash(new Blob([localToolReleaseIdentity(manifest)]));
  const path=`./installed/${namespace}/versions/${manifest.contentHash}/module.tsx`;registerLocalToolModules({[path]:{default:definition}},{[path.replace('module.tsx','release.json')]:manifest});manifests.push(manifest);
 }
 const template=ownTemplate(id+'-template'),project:Project={id,title:'Reviewer world',description:'',type:'standalone',mode:'custom',color:'#777777',status:'draft',enabledEngines:['codex'],engineOrder:['codex'],localToolInstallations:{[namespace]:{contentHash:manifests[0].contentHash,revision:1,updatedAt:1}},codexTemplates:[template],createdAt:1,updatedAt:1};
 const envelope:LocalToolOwnedBlockEnvelope={version:1,id:id+'-owned',namespace,key:'assets',name:{en:'Captured assets',es:'Recursos capturados'},scope:'host',revision:0,data:{overrides:{file:{kind:'file',id:id+'-file'},portrait:{kind:'image',id:id+'-image'}}},codec:{version:1,fields:{overrides:{kind:'map',assetReferenceValues:true}}},preview:{version:1,fields:[],assets:[{namespace,slot:'gate',overridesField:'overrides'},{namespace,slot:'file',overridesField:'overrides'},{namespace,slot:'portrait',overridesField:'overrides'}]}};
 const owner={...card(id,id+'-entry','Canonical reviewer card'),templateId:template.id,referenceFields:{links:[id+'-target']},content:serializeLocalToolBlock(id,envelope)+`<figure data-wh-media-block="true" data-project-id="${id}" data-asset-id="${id}-sound"></figure>`};
 const target={...card(id,id+'-target','REFERENCE_CAPTURED_TITLE'),content:'<p>NEVER_EXPAND_REFERENCE_BODY</p>'},unrelated={...card(id,id+'-unrelated','UNRELATED_CARD'),content:'<p>NEVER_EXPAND_UNRELATED</p>'};
 await db.projects.put(project);await db.codexEntries.bulkPut([owner,target,unrelated]);
 await db.localToolAssetFiles.put({id:id+'-file',projectId:id,kind:'data',title:'captured.txt',mime:oldFile.type,size:oldFile.size,sha256:await hash(oldFile),blob:oldFile,createdAt:1});
 await db.inspirationImages.bulkPut([{id:id+'-image',projectId:id,imageData:oldPng,name:'Captured image',notes:'',createdAt:1},{id:id+'-unused-image',projectId:id,imageData:newPng,name:'Not selected',notes:'',createdAt:1}]);
 await db.localMediaAssets.put({id:id+'-sound',projectId:id,title:'SOUND_CAPTURED_TITLE',kind:'audio',mime:sound.type,blob:sound,size:sound.size,notes:'MEDIA_CAPTURED_NOTES',tags:[],linkedEntryIds:[],createdAt:1,updatedAt:1});
 return{id,namespace,owner,project,template,manifests,entered,release,oldPng,newPng,oldFile,newFile,sound,disableGate:()=>{hold=false;}};
}

export async function testReviewCodexEntrySnapshot(){
 const f=await resourceFixture();let pending:ReturnType<typeof prepareCodexEntryExport>|undefined;
 try{
  pending=prepareCodexEntryExport({projectId:f.id,entryId:f.owner.id,locale:'en'});pending.catch(()=>{});
  // A selected immutable package loader is reached only after readonly capture.
  await bounded(f.entered.promise,'Independent fixture never reached post-capture package IO');
  const beforeProject=(await db.projects.get(f.id))!;
  await db.projects.update(f.id,{localToolInstallations:{[f.namespace]:{contentHash:f.manifests[1].contentHash,revision:2,updatedAt:2}},codexTemplates:beforeProject.codexTemplates!.map(row=>({...row,propertyDefinitions:row.propertyDefinitions!.map(property=>({...property,label:'LIVE_CHANGED_LABEL'})),updatedAt:2})),updatedAt:2});
  await db.localToolAssetFiles.update(f.id+'-file',{blob:f.newFile,size:f.newFile.size,sha256:await hash(f.newFile)});
  await db.inspirationImages.update(f.id+'-image',{imageData:f.newPng});
  const liveSound=wav(1600);await db.localMediaAssets.update(f.id+'-sound',{title:'SOUND_LIVE_TITLE',notes:'MEDIA_LIVE_NOTES',blob:liveSound,size:liveSound.size,updatedAt:2});
  await db.codexEntries.update(f.id+'-target',{title:'REFERENCE_LIVE_TITLE',updatedAt:2});
  await db.codexEntries.update(f.id+'-unrelated',{content:'<p>ANOTHER_UNRELATED_EDIT</p>',updatedAt:2});
  f.release.resolve();const artifact=await bounded(pending,'Independent snapshot preparation did not complete');f.disableGate();
  const html=artifact.prepared.html;
  for(const text of ['BUNDLE_A_CAPTURED','USER_FILE_CAPTURED','MEDIA_CAPTURED_NOTES','SOUND_CAPTURED_TITLE','Shared label','Entry links','REFERENCE_CAPTURED_TITLE'])check(html.includes(text),'Captured card lost '+text);
  for(const text of ['BUNDLE_B_LIVE','USER_FILE_LIVE','MEDIA_LIVE_NOTES','SOUND_LIVE_TITLE','LIVE_CHANGED_LABEL','REFERENCE_LIVE_TITLE','NEVER_EXPAND_REFERENCE_BODY','NEVER_EXPAND_UNRELATED'])check(!html.includes(text),'Captured card mixed/expanded '+text);
  check(html.includes(f.oldPng)&&!html.includes(f.newPng),'Post-capture image read leaked live pixels');
  check(html.includes('0.100 s')&&!html.includes('0.200 s'),'Post-capture media decode leaked live audio bytes');
  const md=await codexEntryMarkdown(artifact,true),zip=await JSZip.loadAsync(md.blob),files=Object.values(zip.files).filter(file=>!file.dir),markdown=await zip.file(files.find(file=>file.name.endsWith('.md'))!.name)!.async('string');
  check(files.filter(file=>file.name.endsWith('.md')).length===1&&!files.some(file=>/(?:^|\/)(world\.json|index\.md)$/.test(file.name)),'Individual output expanded into a vault');
  check(!markdown.includes('[[')&&!markdown.includes('NEVER_EXPAND_REFERENCE_BODY')&&!markdown.includes('NEVER_EXPAND_UNRELATED'),'Outside reference became a fictitious file or body');
  const packedImages=await Promise.all(files.filter(file=>file.name.startsWith('media/')&&file.name.endsWith('.png')).map(file=>file.async('base64')));
  check(packedImages.length>0&&packedImages.every(bytes=>bytes===f.oldPng.split(',')[1]),'ZIP captured an unselected/live image');
  const originalText=await (await codexEntryMarkdown(artifact)).blob.text();
  await db.codexEntries.update(f.owner.id,{content:'<p>POST_PREPARED_LIVE_BODY</p>',updatedAt:4});
  check(await (await codexEntryMarkdown(artifact)).blob.text()===originalText,'Saving recomposed a prepared artifact');
  return ['Independent post-capture package gate: pin/file/image/media/template/reference mutations preserve one captured card and selected ZIP bytes; unrelated edit does not block'];
 }finally{f.release.resolve();f.disableGate();await pending?.catch(()=>{});await deleteProject(f.id);}
}

export async function testReviewCodexEntryYaml(){
 const f=await resourceFixture();f.disableGate();
 try{
  const artifact=await prepareCodexEntryExport({projectId:f.id,entryId:f.owner.id,locale:'en'}),md=await codexEntryMarkdown(artifact),text=await md.blob.text();
  const match=/^---\n([\s\S]*?)\n---\n/.exec(text);check(match,'Actual Markdown bytes lack YAML frontmatter');
  const yaml=match[1],body=text.slice(match[0].length);
  check(/^kind: codex$/m.test(yaml)&&/^title: Canonical reviewer card$/m.test(yaml),'Labels overwrote reserved canonical metadata');
  check(/^  alpha: "0"$/m.test(yaml)&&/^  beta: "false"$/m.test(yaml),'Canonical YAML keys or explicit zero/false values lost');
  check(!/^  Shared label:/m.test(yaml),'Display label replaced canonical field keys');
  const tableRows=body.split('\n').filter(line=>/^\s*\|/.test(line)&&line.includes('Shared label'));
  check(tableRows.length===2,'Two identically labelled properties must remain separate readable Markdown table rows; body='+body);
  check(tableRows.some(line=>/\|\s*0\s*\|/.test(line))&&tableRows.some(line=>/\|\s*false\s*\|/.test(line)),'Markdown table did not preserve the distinct zero/false values');
  check(body.includes('Entry links')&&body.includes('REFERENCE_CAPTURED_TITLE')&&!text.includes('NEVER_EXPAND_REFERENCE_BODY'),'Reference-only target lost its label/title or expanded its body');
  return ['Independent actual Markdown bytes keep canonical YAML and two equal labels as separate zero/false table rows, with reference-only text and bounded resources'];
 }finally{await deleteProject(f.id);}
}

export async function testReviewCodexEntryExports(){return[...await testReviewCodexEntrySnapshot(),...await testReviewCodexEntryYaml()];}

export async function testReviewCodexEntryNative(){
 const execute=(window as unknown as {reviewCardNative:{execute:(name:string,args:Record<string,unknown>)=>Promise<unknown>}}).reviewCardNative?.execute;check(execute,'Native reviewer executor is not bound; generic focused runner is insufficient');
 const id='review-card-native-'+crypto.randomUUID(),project:Project={id,title:'Review Native world',description:'',type:'standalone',mode:'custom',color:'#777777',status:'draft',enabledEngines:['codex'],createdAt:1,updatedAt:1},entry=card(id,id+'-one','Native individual card');
 await db.projects.put(project);await db.codexEntries.bulkPut([entry,{...card(id,id+'-other','Native other card'),content:'<p>NATIVE_OTHER_BODY</p>'}]);
 const unwrap=(raw:any)=>{check(raw&&raw.ok!==false&&!raw.isError,'Native executor failure: '+JSON.stringify(raw));return raw.result??raw;};
 try{
  const before=JSON.stringify(await db.projects.get(id));
  const own=unwrap(await execute('wh_world_markdown_export',{projectId:id,entryId:entry.id,locale:'en'}));
  check(own.mime==='text/markdown;charset=utf-8'&&own.fileName.endsWith('.md'),'Native entryId opt-in lost its declared artifact type');
  const bytes=Uint8Array.from(atob(own.base64),char=>char.charCodeAt(0));check(bytes.length===own.bytes&&!new TextDecoder().decode(bytes).includes('NATIVE_OTHER_BODY'),'Native individual payload expanded to other content');
  const old=unwrap(await execute('wh_world_markdown_export',{projectId:id,locale:'en'}));
  check(old.fileName.endsWith('.zip')&&!Object.hasOwn(old,'sourceVersion')&&old.summary&&old.includeMedia===false,'Legacy Native Markdown default shape changed');
  const zip=await JSZip.loadAsync(Uint8Array.from(atob(old.base64),char=>char.charCodeAt(0)));check(zip.file('world.json')&&zip.file('index.md')&&Object.keys(zip.files).filter(name=>name.endsWith('.md')).length>=3,'Legacy Native export no longer includes normal whole-world files');
  const cardHtml=unwrap(await execute('wh_build_world_bible',{projectId:id,presentation:'card',entryIds:[entry.id],locale:'en'}));check(cardHtml.counts.codex===1&&!cardHtml.html.includes('NATIVE_OTHER_BODY'),'Native card Bible admitted wrong selection');
  const legacyHtml=unwrap(await execute('wh_build_world_bible',{projectId:id,locale:'en'}));check(legacyHtml.counts.codex===2&&legacyHtml.html.includes('NATIVE_OTHER_BODY')&&Object.hasOwn(legacyHtml,'generatedAt'),'Legacy Native Bible default changed');
  for(const [name,args]of [['wh_world_markdown_export',{projectId:id,eraId:'missing'}],['wh_build_world_bible',{projectId:id,presentation:'card',entryIds:[entry.id,entry.id]}]]as const){let rejected=false;try{const out:any=await execute(name,args);rejected=out?.ok===false||out?.isError===true;}catch{rejected=true;}check(rejected,'Native executor admitted incompatible opt-in '+name);}
  check(before===JSON.stringify(await db.projects.get(id)),'Native readonly defaults/opt-ins wrote project');
  return ['Independent actual Native executor→registered handlers admit individual opt-ins while preserving whole-world Markdown/Bible defaults and reject incompatible selections'];
 }finally{await deleteProject(id);}
}
