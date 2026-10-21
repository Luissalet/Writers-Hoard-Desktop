import '@/engines';
import {act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {db} from '@/db';
import {buildWorldWiki,loadWorldWikiData,type WorldWikiData} from '@/services/worldWikiExport';
import {validateWikiOptions} from '@/services/wikiProfiles/validation';
import {wikiAppearanceCopy,WIKI_FONTS} from '@/services/wikiProfiles/appearance';
import {saveWikiProfile,publishWikiProfile,getWikiProfile,getWikiEdition} from '@/services/wikiProfiles/store';
import {exportProjectData,importProjectData,exportFullDatabase,importFullDatabase} from '@/db/operations';
import {createProjectZipArchive,importProjectZip} from '@/services/zipBackup';
import WikiAppearanceEditor from '@/engines/codex/WikiAppearanceEditor';
import type {WorldWikiOptions} from '@/types/worldWiki';
import type {CodexEntry,Project,WorldMap} from '@/types';

function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const payload='</script><script>window.__wikiInjected=1</script><img src=x onerror="window.__wikiInjected=2">';
const pause=()=>new Promise(resolve=>setTimeout(resolve,40));
async function rejects(run:()=>unknown|Promise<unknown>){let failed=false;try{await run();}catch{failed=true;}assert(failed,'Expected appearance validation failure');}
const slug=(kind:string,id:string)=>kind+'-'+[...new TextEncoder().encode(id)].map(v=>v.toString(16).padStart(2,'0')).join('');
function fixture(P:string){
 const project:Project={id:P,title:'Adversarial literal archive',type:'standalone',mode:'custom',description:'Own independent fixture',enabledEngines:['codex','maps'],createdAt:1,updatedAt:1};
 const entry=(id:string,title:string,fields:Record<string,string>={},type:CodexEntry['type']='character'):CodexEntry=>({id,projectId:P,title,type,fields,content:'<p>Admitted text for '+(id==='public'?'coast':'reference')+'.</p>',tags:[],relations:[],createdAt:1,updatedAt:1});
 const entries=[entry('public','Álvaro',{aliases:'Shared alias; Port captain'}),entry('twin','Twin',{aliases:'Shared alias'}),entry('hostile"#?é',payload),entry('EXCLUDE_ID_903','EXCLUDE_TITLE_903',{aliases:'EXCLUDE_ALIAS_903'}),entry('category-hidden','CATEGORY_SECRET_903',{},'item')];
 entries[0].fields['other names']='OMITTED_ALIAS_903';entries[0].fields.private='PRIVATE_FIELD_903';entries[0].content+='<p data-wh-wiki-hidden="true">HIDDEN_PROSE_903</p>';
 const map=(id:string,title:string):WorldMap=>({id,projectId:P,title,description:'',backgroundImage:png,createdAt:1,updatedAt:1});
 const maps=[map('map"#é','Map "Literal"'),map('EXCLUDE_MAP_ID_903','EXCLUDE_MAP_903')];
 const options:WorldWikiOptions={locale:'en',layout:'shell',headingFont:'garamond',bodyFont:'verdana',colors:{background:'#f8f3e4',accent:'#30586f',secondary:'#e8e1d2',text:'#20313b',border:'#a1adaf'},branding:{name:payload,footer:'Line one\n'+payload,mark:png},excludedEntryIds:['EXCLUDE_ID_903'],excludedMapIds:['EXCLUDE_MAP_ID_903'],excludedFields:['other names','private'],grouping:'manual',sections:[{id:'collapse"<>&',name:'Admitted',view:'list',documents:[{kind:'entry',id:'public'},{kind:'entry',id:'twin'},{kind:'entry',id:'hostile"#?é'},{kind:'map',id:'map"#é'}]},{id:'hidden',name:'Hidden category',category:'item',hideDocuments:true,documents:[]}],home:{featured:[{kind:'entry',id:'EXCLUDE_ID_903'},{kind:'entry',id:'public'}],tiles:[{document:{kind:'map',id:'EXCLUDE_MAP_ID_903'},size:'large'}]}};
 return{project,entries,maps,pins:[],images:[],options};
}

export async function testWikiAppearanceIndependentCore(){const P='wiki-independent-appearance903',data=fixture(P),options=data.options;validateWikiOptions(options);
 for(const bad of [{headingFont:'__proto__'},{headingFont:'georgia;}</style><script>bad</script>'},{bodyFont:'https://fonts.invalid/f'},{colors:{background:'#ffffff;--bad:1'}},{colors:JSON.parse('{"__proto__":"#ffffff"}')},{branding:{mark:'data:image/svg+xml;base64,PHN2Zy8+'}},{branding:{name:{toString:'bad'}}}])await rejects(()=>validateWikiOptions({...options,...bad}));
 for(const font of Object.keys(WIKI_FONTS))validateWikiOptions({headingFont:font,bodyFont:font});
 const html=buildWorldWiki(data as WorldWikiData,options).html,doc=new DOMParser().parseFromString(html,'text/html');
 for(const secret of ['EXCLUDE_TITLE_903','EXCLUDE_ALIAS_903','EXCLUDE_ID_903','EXCLUDE_MAP_903','EXCLUDE_MAP_ID_903','CATEGORY_SECRET_903','PRIVATE_FIELD_903','OMITTED_ALIAS_903','HIDDEN_PROSE_903',slug('entry','EXCLUDE_ID_903'),slug('map','EXCLUDE_MAP_ID_903')])assert(!html.includes(secret),'Excluded literal/slug leaked '+secret);
 assert(doc.querySelectorAll('article').length===4&&doc.querySelectorAll('script').length===1,'Admitted count and script boundary');assert(!doc.querySelector('[onerror]')&&!doc.querySelector('img[src="x"]'),'Literal title/branding became DOM executable markup');assert(doc.querySelector('.wiki-brand')!.textContent===payload&&doc.querySelector('.wiki-footer')!.textContent==='Line one\n'+payload,'Literal brand/footer text changed');
 const ids=[...doc.querySelectorAll('article')].map(a=>a.id);assert(new Set(ids).size===4&&ids.every(id=>/^(entry|map)-[\da-f]+$/.test(id)),'Hostile IDs produce safe collision-free anchors');assert(doc.querySelector('.wiki-featured a')?.getAttribute('href')==='#'+slug('entry','public')&&!doc.querySelector('.wiki-tiles'),'Home admission differs from articles');
 for(const key of ['--paper:#f8f3e4','--accent:#30586f','--secondary:#e8e1d2','--ink:#20313b','--line:#a1adaf'])assert(html.includes(key),'Missing palette token '+key);assert(html.includes('Garamond,serif')&&html.includes('Verdana,sans-serif'),'Independent local fonts absent');
 assert(!buildWorldWiki(data as WorldWikiData,{...options,includeImages:false}).html.includes(png),'Image-disabled export retains mark or map bytes');
 const source={...options,eraId:'source',includeImages:false},target:WorldWikiOptions={eraId:'target',types:['location'],includeImages:true,excludedEntryIds:['keep'],sections:[{id:'keep',name:'Keep',documents:[]}],branding:{name:'Target brand'},home:{title:'Target home'}},copied={...target,...wikiAppearanceCopy(source)};
 assert(copied.eraId===target.eraId&&copied.types===target.types&&copied.excludedEntryIds===target.excludedEntryIds&&copied.sections===target.sections&&copied.branding===target.branding&&copied.home===target.home&&copied.includeImages===true,'Appearance copy crosses content/identity scope');copied.colors!.text='#ffffff';assert(source.colors!.text==='#20313b','Appearance copy aliases mutable colors');
 await db.projects.add(data.project);await db.codexEntries.bulkAdd(data.entries);await db.worldMaps.bulkAdd(data.maps);let profile=await saveWikiProfile(P,{name:'Independent literal edition',options},null);profile=await publishWikiProfile(P,profile.id,profile.revision);const edition=profile.editions![0],snapshot=edition.reader.html;assert(snapshot.includes('wiki-command-form'),'Saved normal publication not Shell');
 const cloneId=await importProjectData(await exportProjectData(P)),clone=(await db.projects.get(cloneId))!.wikiProfiles![0];assert(clone.id!==profile.id&&clone.options.headingFont==='garamond'&&clone.options.bodyFont==='verdana'&&JSON.stringify(clone.options.colors)===JSON.stringify(options.colors)&&clone.options.branding!.mark===png&&clone.editions![0].reader.html===snapshot,'Own JSON clone loses appearance or frozen bytes');const excluded=clone.options.excludedEntryIds![0];assert(excluded!=='EXCLUDE_ID_903'&&(await db.codexEntries.get(excluded))?.projectId===cloneId,'Clone exclusion identity not remapped');
 const full=await exportFullDatabase();await importFullDatabase(full);const archive=await createProjectZipArchive(P);await importProjectZip(new File([archive.blob],'independent.zip',{type:'application/zip'}),{replaceProjectIds:[P]});assert((await getWikiProfile(P,profile.id)).options.branding!.footer===options.branding!.footer&&(await getWikiEdition(P,profile.id,edition.id)).reader.html===snapshot,'Own fullJSON/ZIP loses literal branding or immutable bytes');
 Object.assign(window,{__independentWikiHtml:html,__independentWikiCases:{payload,publicId:slug('entry','public'),hostileId:slug('entry','hostile"#?é'),mapId:slug('map','map"#é')}});
 return['Own adversarial titles/IDs/brand script boundaries; admitted aliases and IDs exclude private/category/home/image sources; five colors and two local fonts validated','Appearance copy preserves content/context/identity and clones colors; own JSON/fullJSON/ZIP/clone keeps appearance, remaps exclusions and retains frozen HTML exactly'];
}

export async function testWikiAppearanceIndependentWidget(){
 const Original=window.FileReader,reads:SlowReader[]=[],outcomes:{case:string;pass:boolean;actual?:unknown}[]=[];class SlowReader{result:string|null=null;onload:null|(()=>void)=null;onerror:null|(()=>void)=null;readAsDataURL(){reads.push(this);}finish(value=png){this.result=value;this.onload?.();}}
 Object.defineProperty(window,'FileReader',{configurable:true,writable:true,value:SlowReader});const host=document.getElementById('root')!,root=createRoot(host);let current:WorldWikiOptions={};let context=0;
 function Harness({initial}:{initial:WorldWikiOptions}){const[options,setOptions]=useState(initial);current=options;return <WikiAppearanceEditor options={options} change={patch=>setOptions(value=>({...value,...(typeof patch==='function'?patch(value):patch)}))} profiles={[]} locale="en" busy={false}/>;}
 const mount=async()=>{await act(async()=>{root.render(<Harness key={++context} initial={{branding:{name:'Old name',footer:'Old footer',mark:png}}}/>);await pause();});};
 const read=async()=>{const input=host.querySelector<HTMLInputElement>('input[type=file]')!,transfer=new DataTransfer();transfer.items.add(new File(['test'],'pending.png',{type:'image/png'}));await act(async()=>{input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));await pause();});return reads.at(-1)!;};
 const edit=async(kind:'input'|'textarea',value:string)=>{const node=host.querySelector<HTMLInputElement|HTMLTextAreaElement>(kind==='input'?'input:not([type])':'textarea')!;await act(async()=>{Object.getOwnPropertyDescriptor(kind==='input'?HTMLInputElement.prototype:HTMLTextAreaElement.prototype,'value')!.set!.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));await pause();});};
 try{await mount();const a=await read();await edit('input','New name');await edit('textarea','New footer');await act(async()=>{a.finish();await pause();});outcomes.push({case:'late mark read keeps concurrent same-profile name and footer',pass:current.branding?.name==='New name'&&current.branding?.footer==='New footer',actual:current.branding});
  await mount();const b=await read();await act(async()=>{[...host.querySelectorAll('button')].find(node=>node.textContent==='Remove mark')!.click();await pause();});await act(async()=>{b.finish();await pause();});outcomes.push({case:'Remove mark cancels pending mark completion',pass:current.branding?.mark===undefined,actual:current.branding?.mark});
  await mount();const c=await read();await mount();await edit('input','New context');await act(async()=>{c.finish();await pause();});outcomes.push({case:'profile/era key remount rejects old read',pass:current.branding?.name==='New context'});
  await mount();const d=await read(),e=await read();await act(async()=>{d.finish(png+'\n');await pause();});const oldIgnored=current.branding?.mark===png;await act(async()=>{e.finish(png+'\n\n');await pause();});outcomes.push({case:'newer file selection supersedes older callback',pass:oldIgnored&&current.branding?.mark===png+'\n\n'});
  Object.assign(window,{__independentWikiWidget:outcomes});const failed=outcomes.filter(row=>!row.pass);assert(!failed.length,JSON.stringify(outcomes));return outcomes.map(row=>'Own delayed FileReader: '+row.case);
 }finally{await act(async()=>root.unmount());Object.defineProperty(window,'FileReader',{configurable:true,writable:true,value:Original});}
}
