import { db } from '@/db';
import type { Project, CodexEntry } from '@/types';
import { deleteProject } from '@/db/operations';
import { hydrateCodexBlocks } from '@/components/editor/codexBlocks/reading';

const P = 'review-codex-reader-nested';
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
export async function reviewCodexReaderNested(): Promise<string[]> {
  const root = document.getElementById('root')!;
  let stop: (() => void) | undefined;
  try {
    await db.projects.put({id:P,title:'Reader review',description:'',mode:'custom',type:'standalone',status:'draft',color:'#888888',enabledEngines:['codex'],createdAt:1,updatedAt:1} as Project);
    const base: CodexEntry = {id:P+'-allowed',projectId:P,title:'Allowed live target',type:'custom',content:'<p>Public target</p>',fields:{},revealed:{at:1},tags:[],relations:[],createdAt:1,updatedAt:1};
    const parent: CodexEntry = {...base,id:P+'-parent',title:'Public parent',content:`<p>Public parent prose</p><figure data-wh-codex-block="true" data-project-id="foreign" data-entry-id="${base.id}"><figcaption>FOREIGN_CACHED_SECRET</figcaption></figure><figure data-wh-codex-block="true" data-project-id="${P}" data-entry-id="${base.id}"><figcaption>OLD_LOCAL_CACHED_SECRET</figcaption></figure>`};
    await db.codexEntries.bulkPut([base,parent]);
    root.innerHTML=`<figure data-wh-codex-block="true" data-project-id="${P}" data-entry-id="${parent.id}"></figure>`;
    stop = hydrateCodexBlocks(root,P,'Unavailable',undefined,{player:true});
    for(let i=0;i<100&&!root.textContent?.includes('Public parent prose');i++) await pause();
    assert(root.textContent?.includes('Public parent prose'),'player reference failed to resolve public prose');
    assert(!root.textContent?.includes('FOREIGN_CACHED_SECRET'),'Player reference leaks caption of nested foreign pointer whose id matches a revealed local card');
    assert(!root.textContent?.includes('OLD_LOCAL_CACHED_SECRET'),'Player reference leaks persisted caption of nested valid pointer instead of scoped live source');
    const passed=['Player reference projection never exposes nested foreign or cached local Codex captions'];
    const until=async(check:()=>boolean,message:string)=>{for(let i=0;i<100;i++){if(check())return;await pause();}throw Error(message);};
    await db.projects.update(P,{wikiOptions:{excludedEntryIds:[parent.id]}});
    await until(()=>root.textContent==='Unavailable','Live project exclusion did not revoke an admitted target');
    await db.projects.update(P,{wikiOptions:{excludedEntryIds:[]}});
    await until(()=>Boolean(root.textContent?.includes('Public parent prose')),'Removing project exclusion did not restore public reference');
    await db.codexEntries.update(parent.id,{revealed:undefined});
    await until(()=>root.textContent==='Unavailable','Live unreveal did not revoke the target');
    assert((await db.codexEntries.get(parent.id))!.content===parent.content,'Policy refresh changed source prose');
    passed.push('Player references re-evaluate project exclusions and reveal revocation live without modifying source prose');
    stop(); stop=undefined; const detachedText=root.innerHTML;
    await db.codexEntries.update(parent.id,{title:'After teardown',revealed:{at:2}}); await pause(); await pause();
    assert(root.innerHTML===detachedText,'Disposed reader subscription still changes retained DOM');
    passed.push('Disposed readonly reader cannot update retained DOM after source changes');
    return passed;
  } finally { stop?.(); root.replaceChildren(); if(await db.projects.get(P)) await deleteProject(P); }
}
