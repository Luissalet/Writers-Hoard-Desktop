import '@/engines';
import {db} from '@/db';
import {exportProjectData,importProjectData,exportFullDatabase,importFullDatabase,setSetting,PROJECT_SETTING_PREFIXES} from '@/db/operations';
import JSZip from 'jszip';
import {defaultReaderPresentation} from '@/engines/writings/readerPresentationTypes';
import {createProjectZipArchive,importProjectZip,createFullZipArchive,importFullZip} from '@/services/zipBackup';
import {readProjectDuplicate} from '@/services/projectDuplicate/capture';
import {remapDuplicateSnapshot} from '@/services/projectDuplicate/remap';
import {manuscriptFixture} from './writing-manuscripts.browser';
import {deleteWritingRestorable} from '@/engines/writings/operations';
import {readWorldDocument} from '@/services/worldEras/store';
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
export async function testManuscriptJsonOwners(){
 const {project}=await manuscriptFixture('manuscript-json-owners'),payload=await exportProjectData(project.id),target=await importProjectData(payload),restored=(await db.projects.get(target))!,rows=await db.writings.where('projectId').equals(target).toArray();
 assert(rows.length===3&&restored.manuscriptCatalog?.entries.length===2,'JSON preserves independent manuscripts and chapters');
 const owners=new Set(restored.manuscriptCatalog.entries.map(row=>row.id));assert(rows.filter(row=>row.manuscriptId).every(row=>owners.has(row.manuscriptId!)),'JSON chapter owners must use the same remap as catalogue ids');
 assert(rows.find(row=>row.title==='Legacy chapter')?.manuscriptId===undefined,'legacy main remains implicit after clone');
 return['Native project JSON remaps manuscript catalogue and chapter owners together; main stays implicit'];
}
export async function testManuscriptJsonProfileSidecar(){
 const {project,a}=await manuscriptFixture('manuscript-json-profile');await db.publishingProfiles.put({id:project.id+'-profile',projectId:project.id,name:'Book A',format:'manuscript',writingScope:{kind:'manuscript',id:'manuscript-a'},selectionMode:'selected',selectedWritingIds:[a.id],writingOrder:[a.id],includeTitlePage:true,includeSynopsis:false,includeBibliography:false,citationStyle:'apa',createdAt:1,updatedAt:1});
 const payload=await exportProjectData(project.id) as unknown as {publishingProfiles?:unknown[]};assert(payload.publishingProfiles?.length===1,'JSON of a world with manuscripts must transport their native publishing profiles');
 return['New manuscript JSON includes its native publishing profile sidecar'];
}

export async function testManuscriptDuplicateContext(){
 const {project,main,a,b}=await manuscriptFixture('manuscript-duplicate');
 await db.writings.update(a.id,{content:`<p><a href="/project/${project.id}/writings?manuscript=manuscript-b&amp;writing=${b.id}#part">Other story</a></p>`});
 await db.referencePins.put({id:`book:${project.id}:manuscript:manuscript-a`,projectId:project.id,scopeId:`book:${project.id}:manuscript:manuscript-a`,entryIds:[],updatedAt:1});
 await setSetting(PROJECT_SETTING_PREFIXES.readingPosition+project.id,JSON.stringify({projectId:project.id,pieceId:main.id,manuscripts:{'manuscript-a':{projectId:project.id,pieceId:a.id,offset:7}}}));
 await db.publishingProfiles.put({id:project.id+'-profile',projectId:project.id,name:'Book A',format:'manuscript',writingScope:{kind:'manuscript',id:'manuscript-a'},selectionMode:'selected',selectedWritingIds:[a.id],writingOrder:[a.id],includeTitlePage:true,includeSynopsis:false,includeBibliography:false,citationStyle:'apa',createdAt:1,updatedAt:1});
 const source=await readProjectDuplicate(project.id),before=JSON.stringify(source),target=await remapDuplicateSnapshot(source,'manuscript-duplicate-target','Copied harbour');
 const owners=target.project.manuscriptCatalog!.entries,ownerA=owners.find(row=>row.title==='Story A')!.id,ownerB=owners.find(row=>row.title==='Story B')!.id;
 const chapterA=target.tables.writings.find(row=>row.title==='Chapter A')!,chapterB=target.tables.writings.find(row=>row.title==='Chapter B')!;
 assert(ownerA!=='manuscript-a'&&ownerB!=='manuscript-b'&&chapterA.manuscriptId===ownerA&&chapterB.manuscriptId===ownerB,'duplicate remaps catalogue and structural chapter owner together');
 assert(target.tables.writings.find(row=>row.title==='Legacy chapter')!.manuscriptId===undefined,'implicit main does not materialize during duplicate');
 const profile=target.tables.publishingProfiles[0];assert((profile.writingScope as {id:string}).id===ownerA&&(profile.selectedWritingIds as string[])[0]===chapterA.id,'duplicate profile scope and selected chapter use same remaps');
 const pin=target.tables.referencePins[0];assert(pin.id===`book:${target.project.id}:manuscript:${ownerA}`&&pin.scopeId===pin.id,'compound book pin is local to copied manuscript');
 const setting=target.tables.settings.find(row=>row.key===PROJECT_SETTING_PREFIXES.readingPosition+target.project.id)!;
 const position=JSON.parse(String(setting.value));assert(position.manuscripts[ownerA].pieceId===chapterA.id&&position.manuscripts[ownerA].projectId===target.project.id,'additional Reader bookmarks retain their remapped book and piece');
 assert(String(chapterA.content).includes(target.project.id)&&String(chapterA.content).includes(ownerB)&&String(chapterA.content).includes(String(chapterB.id))&&!String(chapterA.content).includes(project.id+'/'),'editable chapter links remap project, manuscript and chapter');
 assert(JSON.stringify(source)===before,'duplicate projection does not mutate source snapshot');
 return['Real duplicate capture/remap preserves implicit main, independent owners, profile, compound pins, separate bookmarks and cross-book editable links without changing source'];
}

async function manuscriptZipFile(blob:Blob,change:(zip:JSZip,dir:string)=>Promise<void>){
 const zip=await JSZip.loadAsync(blob),path=Object.keys(zip.files).find(path=>/^projects\/[^/]+\/project.json$/.test(path));assert(path,'archive has project metadata');
 await change(zip,path.slice(0,-'/project.json'.length));return new File([await zip.generateAsync({type:'uint8array'})],'manuscripts.zip');
}
export async function testManuscriptZipRestore(){
 const {project,a,b}=await manuscriptFixture('manuscript-zip');
 await db.projects.update(project.id,{manuscriptCatalog:{...project.manuscriptCatalog!,entries:project.manuscriptCatalog!.entries.map(row=>row.id==='manuscript-a'?{...row,archivedAt:5,reader:{cover:defaultReaderPresentation().cover,playback:{mode:'play',wordsPerMinute:210}}}:row)} as never});
 const wanted=JSON.stringify((await db.projects.get(project.id))!.manuscriptCatalog),archive=await createProjectZipArchive(project.id);
 const file=new File([archive.blob],'manuscripts.zip');
 await db.writings.update(a.id,{content:'<p>LOCAL_BEFORE_RESTORE</p>'});
 try{await importProjectZip(file,{replaceProjectIds:[project.id]});}catch(error){throw Error('normal manuscript ZIP: '+String(error));}
 assert(JSON.stringify((await db.projects.get(project.id))!.manuscriptCatalog)===wanted&&(await db.writings.get(a.id))!.content==='<p>ONLY_STORY_A</p>'&&(await db.writings.get(b.id))!.manuscriptId==='manuscript-b','normal project ZIP restores archive status, independent presentation, owners and prose');
 const legacy=await manuscriptZipFile(archive.blob,async(zip,dir)=>{
  const metadata=JSON.parse(await zip.file(dir+'/project.json')!.async('string'));delete metadata.manuscriptCatalog;zip.file(dir+'/project.json',JSON.stringify(metadata));
  for(const path of Object.keys(zip.files).filter(path=>path.startsWith(dir+'/')&&path.endsWith('.json')&&path!==dir+'/project.json')){
   const raw=JSON.parse(await zip.file(path)!.async('string'));const strip=(value:unknown)=>{if(!value||typeof value!=='object')return;delete (value as Record<string,unknown>).manuscriptId;for(const child of Object.values(value))strip(child);};strip(raw);zip.file(path,JSON.stringify(raw));
  }
 });
 try{await importProjectZip(legacy,{replaceProjectIds:[project.id]});}catch(error){throw Error('legacy manuscript ZIP: '+String(error));}
 assert(JSON.stringify((await db.projects.get(project.id))!.manuscriptCatalog)===wanted&&(await db.writings.get(a.id))!.manuscriptId==='manuscript-a'&&(await db.writings.get(b.id))!.manuscriptId==='manuscript-b','older ZIP without catalogue/owner fields preserves same-world authored metadata');
 const bad=await manuscriptZipFile(archive.blob,async(zip,dir)=>{
  for(const path of Object.keys(zip.files).filter(path=>path.startsWith(dir+'/')&&path.endsWith('.json')&&path!==dir+'/project.json')){
   const raw=JSON.parse(await zip.file(path)!.async('string'));if(raw?.id===a.id){raw.manuscriptId='missing-manuscript';zip.file(path,JSON.stringify(raw));}
  }
 });
 const before=JSON.stringify({project:await db.projects.get(project.id),writings:await db.writings.where('projectId').equals(project.id).toArray()});
 let refused=false;try{await importProjectZip(bad,{replaceProjectIds:[project.id]});}catch{refused=true;}assert(refused&&JSON.stringify({project:await db.projects.get(project.id),writings:await db.writings.where('projectId').equals(project.id).toArray()})===before,'unknown owner rejected before approved replacement clears any rows');
 const reject=(_key:unknown,row:unknown)=>{if((row as {id?:string}).id===b.id)throw Error('late manuscript ZIP write failure');};
 db.writings.hook('creating',reject);try{refused=false;try{await importProjectZip(file,{replaceProjectIds:[project.id]});}catch{refused=true;}}finally{db.writings.hook('creating').unsubscribe(reject);}
 assert(refused&&JSON.stringify({project:await db.projects.get(project.id),writings:await db.writings.where('projectId').equals(project.id).toArray()})===before,'late writing failure rolls back catalogue and earlier chapter replacement together');
 return['Native ZIP roundtrip and same-world legacy replacement preserve book metadata and owners; unknown owner preflight and late write failure leave project/chapters exact'];
}

export async function testWritingManuscriptsPortability(){const out:string[]=[];for(const run of [testManuscriptJsonOwners,testManuscriptJsonProfileSidecar,testManuscriptDuplicateContext,testManuscriptZipRestore,testManuscriptArchivedRestoreIdentity,testManuscriptRestoredCatalogIntegrity])out.push(...await run());return out;}

export async function testManuscriptArchivedRestoreIdentity(){
 const messages:string[]=[];
 for(const format of ['full-json','project-zip','full-zip']){
  for(const owner of ['main','manuscript-a']){
   const {project,main,a}=await manuscriptFixture('manuscript-same-id-'+format+'-'+owner),chapter=owner==='main'?main:a;
   const goodJson=format==='full-json'?await exportFullDatabase():undefined,archive=format==='project-zip'?await createProjectZipArchive(project.id):format==='full-zip'?await createFullZipArchive():undefined;
   await deleteWritingRestorable(chapter.id);
   const state=async()=>JSON.stringify({projects:await db.projects.toArray(),writings:await db.writings.toArray(),archives:await db.documentArchives.toArray()});
   const before=await state();
   const rewrite=(value:unknown,legacy:boolean):void=>{
    if(!value||typeof value!=='object'||value instanceof Blob)return;
    const row=value as Record<string,unknown>;
    if(legacy&&row.id===project.id)delete row.manuscriptCatalog;
    if(row.projectId===project.id){if(legacy)delete row.manuscriptId;else if(row.id===chapter.id&&'content' in row)row.manuscriptId=owner==='main'?'manuscript-a':'manuscript-b';}
    for(const child of Object.values(row))rewrite(child,legacy);
   };
   const restore=async(legacy:boolean)=>{
    if(goodJson){const input=structuredClone(goodJson);rewrite(input,legacy);await importFullDatabase(input);return;}
    const zip=await JSZip.loadAsync(archive!.blob);
    for(const path of Object.keys(zip.files).filter(path=>path.endsWith('.json'))){const input=JSON.parse(await zip.file(path)!.async('string'));rewrite(input,legacy);zip.file(path,JSON.stringify(input));}
    const file=new File([await zip.generateAsync({type:'uint8array'})],'same-id-'+format+'.zip');
    if(format==='project-zip')await importProjectZip(file,{replaceProjectIds:[project.id]});else await importFullZip(file);
   };
   let rejected=false;try{await restore(false);}catch{rejected=true;}
   assert(rejected&&await state()===before,format+' cannot change archived '+owner+' into another explicit owner or clear its evidence');
   await restore(true);const row=await db.writings.get(chapter.id),read=await readWorldDocument({projectId:project.id},'writings',chapter.id);
   assert(row&&row.manuscriptId===(owner==='main'?undefined:owner)&&read?.document.root.manuscriptId===row.manuscriptId,format+' legacy same-ID restore inherits archived owner including implicit main and stays readable');
  }
  messages.push(format+': same-ID archived A and implicit main reject reassignment atomically; legacy missing owner/catalogue inherits canonical membership');
 }
 return messages;
}

export async function testManuscriptRestoredCatalogIntegrity(){
 const messages:string[]=[];
 for(const format of ['full-json','project-zip','full-zip']){
  const {project,a}=await manuscriptFixture('manuscript-catalog-integrity-'+format),json=format==='full-json'?await exportFullDatabase():undefined,archive=format==='project-zip'?await createProjectZipArchive(project.id):format==='full-zip'?await createFullZipArchive():undefined;
  await deleteWritingRestorable(a.id);
  const state=async()=>JSON.stringify({projects:await db.projects.toArray(),writings:await db.writings.toArray(),archives:await db.documentArchives.toArray()}),before=await state();
  const amend=(value:unknown,omitA:boolean):void=>{if(!value||typeof value!=='object'||value instanceof Blob)return;const row=value as Record<string,unknown>;if(row.id===project.id&&omitA)(row.manuscriptCatalog as {entries:{id:string}[]}).entries=(row.manuscriptCatalog as {entries:{id:string}[]}).entries.filter(entry=>entry.id!=='manuscript-a');if(row.id===a.id&&row.projectId===project.id)delete row.manuscriptId;for(const child of Object.values(row))amend(child,omitA);};
  const restore=async(omitA:boolean)=>{if(json){const input=structuredClone(json);amend(input,omitA);await importFullDatabase(input);return;}const zip=await JSZip.loadAsync(archive!.blob);for(const path of Object.keys(zip.files).filter(path=>path.endsWith('.json'))){const input=JSON.parse(await zip.file(path)!.async('string'));amend(input,omitA);zip.file(path,JSON.stringify(input));}const file=new File([await zip.generateAsync({type:'uint8array'})],'catalog-integrity.zip');if(format==='project-zip')await importProjectZip(file,{replaceProjectIds:[project.id]});else await importFullZip(file);};
  let rejected=false;try{await restore(true);}catch{rejected=true;}assert(rejected&&await state()===before,format+' cannot inherit A into an explicit catalogue that omits A; entire restore must roll back');
  await restore(false);assert((await db.writings.get(a.id))?.manuscriptId==='manuscript-a','coherent '+format+' preserves archived owner A');messages.push(format+': inherited archived owner must exist in the restored catalogue; incoherent input rolls back and coherent legacy input restores');
 }
 return messages;
}
