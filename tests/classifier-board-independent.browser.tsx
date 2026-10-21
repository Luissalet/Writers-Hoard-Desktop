import '@/engines';
import {db} from '@/db';
import {deleteProject,exportProjectData,importProjectData,exportFullDatabase,importFullDatabase} from '@/db/operations';
import {alignEntityTokens,entityChunks} from '@/services/entityDetection/alignment';
import {newEntityCandidates} from '@/services/entityDetection/service';
import {makeNode,makeEdge} from '@/engines/board/graph/mutations';
import {createCanvasPile,setPileCollapsed} from '@/engines/board/graph/piles';
import {boardImage} from '@/services/documentImage/board';
import {resolveToolPreview} from '@/components/editor/toolBlocks/preview';
import type {CodexEntry,Project} from '@/types';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {Editor} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import EntityDetectionControls from '@/components/editor/entityDetection/EntityDetectionControls';
import type {EntitySpan} from '@/services/entityDetection/types';
import JSZip from 'jszip';
import {createProjectZipArchive,importProjectZip} from '@/services/zipBackup';
function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const project=(id:string):Project=>({id,title:id,type:'standalone',mode:'custom',description:'',status:'draft',color:'#777777',enabledEngines:['codex','board','gallery'],engineOrder:[],createdAt:1,updatedAt:1});

export async function testIndependentChineseEntityBoundaries(){
 const text='李明住在北京。',tokenize=(value:string)=>[...value];
 const spans=alignEntityTokens(text,tokenize,[{index:1,entity:'B-PER',score:.99},{index:2,entity:'I-PER',score:.99},{index:5,entity:'B-LOC',score:.99},{index:6,entity:'I-LOC',score:.99}]);
 check(spans.some(span=>span.text==='李明')&&spans.some(span=>span.text==='北京'),`Complete BERT Chinese token groups were discarded as partial words: ${JSON.stringify(spans)}`);
 return ['Complete PER/LOC token groups in natural Chinese prose need no Latin-style whitespace boundary'];
}

export async function testIndependentEntityUtf16AndAliases(){
 const text='🧭 𠀀明 llegó a Ávila. Ada Ada',tokenize=(value:string)=>value.match(/[\u{20000}-\u{2fa1f}]|[\p{P}]|[^\s\p{P}\u{20000}-\u{2fa1f}]+/gu)??[];
 const units=tokenize(text),tokens=units.flatMap((value,i)=>value==='Ada'?[{index:i+1,entity:'B-PER',score:.99}]:value==='Ávila'?[{index:i+1,entity:'B-LOC',score:.99}]:[]);
 const spans=alignEntityTokens(text,tokenize,tokens);
 check(spans.length===3&&spans.every(span=>text.slice(span.from,span.to)===span.text)&&spans.filter(span=>span.text==='Ada').length===2,'UTF16 offsets guessed a repeated name occurrence or split an astral character');
 const entry=(id:string):CodexEntry=>({id,projectId:'fixture',title:id,type:'character',fields:{aliases:'["Ada"]'},content:'',tags:[],relations:[],createdAt:1,updatedAt:1});
 const filtered=newEntityCandidates(text,spans,[entry('one'),entry('two')]);check(filtered.length===1&&filtered[0].text==='Ávila','Ambiguous alias became a new entity');
 let mismatch=false;try{alignEntityTokens('Ada',value=>value==='Ada'?['ada']:[],[{index:1,entity:'B-PER',score:.99}]);}catch{mismatch=true;}check(mismatch,'Unverifiable token normalization guessed offsets');
 const splitLatin=(value:string)=>value==='Élodie Durand'?['Él','##odie','Durand']:value==='Élodie'?['Él','##odie']:[value];
 check(alignEntityTokens('Élodie Durand',splitLatin,[{index:1,entity:'B-PER',score:.99}]).length===0,'Latin partial first WordPiece became a fabricated short name');
 check(alignEntityTokens('Élodie Durand',splitLatin,[{index:2,entity:'B-PER',score:.99}]).length===0,'Latin tail WordPiece became a separate fabricated name');
 check(alignEntityTokens('Élodie Durand',splitLatin,[{index:1,entity:'B-PER',score:.99},{index:2,entity:'I-PER',score:.99},{index:3,entity:'I-PER',score:.99}])[0]?.text==='Élodie Durand','Whole Latin WordPiece group stopped working');
 const long=('🧭 𠀀明 — Ada. ').repeat(400),chunks=entityChunks(long,value=>[...value].length),covered=new Uint8Array(long.length);
 for(const chunk of chunks){check(chunk.text===long.slice(chunk.from,chunk.from+chunk.text.length),'Chunk origin differs from source');check(!/^[\uDC00-\uDFFF]/.test(chunk.text)&&!/[\uD800-\uDBFF]$/.test(chunk.text),'Chunk cut a surrogate pair');covered.fill(1,chunk.from,chunk.from+chunk.text.length);}
 check(covered.every(Boolean),'Token budget silently skipped source units');
 return ['Independent exact UTF16 repeated-name offsets, ambiguous alias exclusion, normalization refusal and astral long-text coverage'];
}

export async function testIndependentBoardExportPiles(){
 const P='review-independent-board-export',B=`${P}-board`;let clone:string|undefined;try{
  await db.projects.put(project(P));await db.boards.put({id:B,projectId:P,title:'Export board',surface:'slate',createdAt:1,updatedAt:1});
  const a={...makeNode({projectId:P,boardId:B,kind:'card',title:'Hidden alpha title',position:{x:100,y:100}}),content:'Hidden alpha private prose'},b={...makeNode({projectId:P,boardId:B,kind:'postit',title:'Hidden beta title',position:{x:600,y:400}}),content:'Hidden beta private prose'},outside={...makeNode({projectId:P,boardId:B,kind:'card',title:'Visible outside title',position:{x:350,y:200}}),content:'Visible outside prose'};
  const pile=createCanvasPile([a,b,outside],[a.id,b.id],'Visible compact pile'),edge=makeEdge({projectId:P,boardId:B,sources:[{on:'node',id:a.id}],targets:[{on:'node',id:b.id}],label:'Hidden internal relation'}),nodes=[a,b,outside,pile];
  await db.boardNodes.bulkPut(nodes);await db.boardEdges.put(edge);
  const image=await boardImage({projectId:P},nodes,[edge],[],1440),preview=await resolveToolPreview({projectId:P,kind:'board',documentId:B,label:'Board'},P);
  for(const html of [image.html,preview!.html]){check(html.includes('Visible compact pile')&&html.includes('2 items')&&html.includes('Visible outside title'),'Collapsed export lost wrapper/count or geometrically overlapping outside card');for(const forbidden of ['Hidden alpha title','Hidden alpha private prose','Hidden beta title','Hidden beta private prose','Hidden internal relation'])check(!html.includes(forbidden),`Collapsed export leaked ${forbidden}`);}
  const opened=setPileCollapsed(pile,nodes,false);await db.boardNodes.put(opened);
  const expandedImage=await boardImage({projectId:P},[a,b,outside,opened],[edge],[],1440),expandedPreview=await resolveToolPreview({projectId:P,kind:'board',documentId:B,label:'Board'},P);
  for(const html of [expandedImage.html,expandedPreview!.html])check(html.includes(a.title)&&html.includes(a.content)&&html.includes(b.title)&&html.includes(b.content),'Opening pile failed to restore child content in export');
  const outer=createCanvasPile([a,b,outside,pile],[pile.id,outside.id],'Nested pile');await db.boardNodes.bulkPut([pile,outer]);
  clone=await importProjectData(await exportProjectData(P));const cloned=await db.boardNodes.where('projectId').equals(clone).toArray(),originalIds=new Set([a.id,b.id,outside.id,pile.id,outer.id]);
  for(const frame of cloned.filter(node=>node.kind==='frame'))check(frame.memberNodeIds?.length&&frame.memberNodeIds.every(id=>!originalIds.has(id)&&cloned.some(node=>node.id===id)),'Nested JSON clone retained original member IDs or dropped a carried child');
  check(cloned.filter(node=>node.kind==='frame').length===2,'Nested clone lost one wrapper');
  return ['Collapsed Board image and Reader/tool preview retain exact pile count/outside card without child prose or relation leakage; expansion restores children; JSON clone remaps nested membership'];
 }finally{if(clone)await deleteProject(clone);await deleteProject(P);}
}

export async function testIndependentClassifierMetadataJson(){
 const P='review-independent-classifier-metadata';let clone:string|undefined;try{
  const prefs={revision:7,detectNewEntities:true,autoLinkMentions:false,animateNewLinks:true},wiki=[{id:'profile-source',name:'Saved scope',revision:4,createdAt:1,updatedAt:1,options:{locale:'es' as const,excludedEntryIds:['card-source'],sections:[{id:'section-source',name:'People',documents:[{kind:'entry' as const,id:'card-source'}]}]}}];
  await db.projects.put({...project(P),entityDetectionPreferences:prefs,wikiProfiles:wiki});
  await db.codexEntries.put({id:'card-source',projectId:P,title:'Scoped card',type:'character',fields:{},content:'',relations:[],tags:[],createdAt:1,updatedAt:1});
  clone=await importProjectData(await exportProjectData(P));const copied=(await db.projects.get(clone))!;
  check(copied.entityDetectionPreferences?.revision===0&&copied.entityDetectionPreferences.detectNewEntities&&!copied.entityDetectionPreferences.autoLinkMentions&&copied.entityDetectionPreferences.animateNewLinks,'Project clone lost independent preference values or retained source CAS revision');
  const card=(await db.codexEntries.where('projectId').equals(clone).toArray())[0],profile=copied.wikiProfiles![0];check(profile.id!=='profile-source'&&profile.revision===0&&profile.options.excludedEntryIds?.[0]===card.id&&profile.options.sections?.[0].documents[0].id===card.id&&profile.options.sections[0].id!=='section-source','Saved wiki metadata clone retained source identities');
  const full=await exportFullDatabase();const legacy={...full,projects:full.projects.map(({entityDetectionPreferences:_prefs,wikiProfiles:_wiki,...row})=>{void _prefs;void _wiki;return row;})};await importFullDatabase(legacy);
  check(JSON.stringify((await db.projects.get(P))!.entityDetectionPreferences)===JSON.stringify(prefs)&&(await db.projects.get(P))!.wikiProfiles?.[0].id==='profile-source','Legacy full JSON erased fields it never carried');
  await importFullDatabase({...full,projects:full.projects.map(row=>row.id===P?{...row,entityDetectionPreferences:{revision:0,detectNewEntities:false,autoLinkMentions:true,animateNewLinks:false},wikiProfiles:[]}:row)});
  const replaced=(await db.projects.get(P))!;check(replaced.entityDetectionPreferences?.detectNewEntities===false&&!replaced.wikiProfiles?.length,'Explicit preference values/empty wiki profiles failed to replace metadata');
  return ['Normal project clone resets preference CAS while preserving independent values and remaps wiki metadata; legacy absent full JSON preserves settings, explicit values/empty wiki profiles replace'];
 }finally{if(clone)await deleteProject(clone);await deleteProject(P);}
}

export async function testIndependentLateEntityEraAndPreference(){
 const P='review-independent-late-entity',host=document.getElementById('root')!,root=createRoot(host),editorHost=document.createElement('div'),previous=window.electronAPI,entries:CodexEntry[]=[],pending:Array<(spans:EntitySpan[])=>void>=[];
 const pause=(ms=30)=>new Promise(resolve=>setTimeout(resolve,ms)),until=async(test:()=>boolean)=>{for(let i=0;i<100&&!test();i++)await act(async()=>{await pause();});check(test(),'Deferred classifier did not reach expected boundary');};
 document.body.append(editorHost);const editor=new Editor({element:editorHost,extensions:[StarterKit.configure({trailingNode:false})],content:'<p>Ada Lovelace llegó a Madrid.</p>'}),original=editor.getHTML();
 const preferences={revision:0,detectNewEntities:true,autoLinkMentions:true,animateNewLinks:false};
 Object.defineProperty(window,'electronAPI',{configurable:true,value:{entityDetection:{status:async()=>({state:'ready',model:'controlled-late-response-only'}),prepare:async()=>({state:'ready',model:'controlled-late-response-only'}),detect:()=>new Promise<EntitySpan[]>(resolve=>pending.push(resolve))}}});
 try{
  await db.projects.put(project(P));
  await act(async()=>{root.render(<EntityDetectionControls editor={editor} projectId={P} eraId="past" entries={entries} preferences={preferences}/>);await pause();});await until(()=>pending.length===1);
  await act(async()=>{root.render(<EntityDetectionControls editor={editor} projectId={P} eraId="future" entries={entries} preferences={preferences}/>);await pause();});await until(()=>pending.length===2);
  await act(async()=>{pending[0]([{from:0,to:12,text:'Ada Lovelace',label:'PER',score:.99}]);await pause();});
  check(!host.querySelector('[data-create-entity]')&&!editorHost.querySelector('[data-wh-entity-candidate]'),'Past-era inference leaked into future context');
  await act(async()=>{root.render(<EntityDetectionControls editor={editor} projectId={P} eraId="future" entries={entries} preferences={{...preferences,detectNewEntities:false}}/>);await pause();pending[1]([{from:0,to:12,text:'Ada Lovelace',label:'PER',score:.99}]);await pause();});
  check(!host.querySelector('[data-create-entity]')&&!editorHost.querySelector('[data-wh-entity-candidate]'),'Turning detection off accepted a late candidate');
  check(editor.getHTML()===original&&!editor.can().undo()&&await db.codexEntries.where('projectId').equals(P).count()===0,'Late classifier responses changed prose/history or created metadata');
  return ['Independent deferred actual component test: era switch and detection-off discard late spans without prose/history/card mutations'];
 }finally{await act(async()=>root.unmount());editor.destroy();editorHost.remove();Object.defineProperty(window,'electronAPI',{configurable:true,value:previous});await deleteProject(P);}
}

export async function testIndependentClassifierMetadataZip(){
 const P='review-independent-metadata-zip';try{
  const prefs={revision:3,detectNewEntities:true,autoLinkMentions:false,animateNewLinks:true},wiki=[{id:'zip-profile',name:'ZIP scope',revision:2,createdAt:1,updatedAt:1,options:{locale:'es' as const}}];await db.projects.put({...project(P),entityDetectionPreferences:prefs,wikiProfiles:wiki});
  const archive=await createProjectZipArchive(P);
  const changed=async(empty:boolean)=>{const zip=await JSZip.loadAsync(await archive.blob.arrayBuffer());for(const[name,file]of Object.entries(zip.files))if(name.endsWith('/project.json')){const row=JSON.parse(await file.async('string'));if(empty){row.wikiProfiles=[];row.entityDetectionPreferences={revision:0,detectNewEntities:false,autoLinkMentions:true,animateNewLinks:false};}else{delete row.wikiProfiles;delete row.entityDetectionPreferences;}zip.file(name,JSON.stringify(row));}return new File([await zip.generateAsync({type:'uint8array'})],'synthetic-metadata.zip',{type:'application/zip'});};
  await importProjectZip(await changed(false),{replaceProjectIds:[P]});const legacy=(await db.projects.get(P))!;check(JSON.stringify(legacy.entityDetectionPreferences)===JSON.stringify(prefs)&&legacy.wikiProfiles?.[0].id==='zip-profile','Legacy ZIP absence erased classifier/wiki metadata');
  await importProjectZip(await changed(true),{replaceProjectIds:[P]});const explicit=(await db.projects.get(P))!;check(!explicit.entityDetectionPreferences?.detectNewEntities&&explicit.entityDetectionPreferences?.autoLinkMentions&&!explicit.wikiProfiles?.length,'Explicit ZIP preference reset/empty wiki library did not replace metadata');
  return ['Independent ZIP preflight/replace preserves absent legacy classifier/wiki metadata and applies explicit preference reset/empty wiki profiles'];
 }finally{await deleteProject(P);}
}
