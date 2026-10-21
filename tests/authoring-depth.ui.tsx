import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import type { Project, Writing } from '@/types';
import type { Scene } from '@/engines/dialog-scene/types';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import SceneEditor from '@/engines/dialog-scene/components/SceneEditor';
import ReadingView from '@/engines/writings/components/ReadingView';
import { appendConversationTurn } from '@/engines/dialog-scene/conversation/authoring';
import { defaultReaderPresentation } from '@/engines/writings/readerPresentation';
import { useLocaleStore } from '@/stores/localeStore';
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 40));
const channel = window as unknown as { __want: unknown; __sizeAck?: number; __shot: unknown; __shotDone?: string; __native: unknown; __nativeAck?: number };
async function wait(check: () => boolean) { for (let i=0;i<150;i++) { if(check())return; await pause(); } throw Error('UI handshake timed out'); }
async function waitUi(check: () => boolean) { for (let i=0;i<150;i++) { if(check())return; await act(async()=>{await pause();}); } throw Error('UI did not settle'); }
let n=0;
async function native(events: unknown[]) { const id=++n; await act(async()=>{channel.__native={n:id,events};await wait(()=>channel.__nativeAck===id);await pause();}); }
async function click(node: HTMLElement) { node.scrollIntoView({block:'center'}); const r=node.getBoundingClientRect(); const pos={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),button:'left',clickCount:1}; await native([{type:'mouseDown',...pos},{type:'mouseUp',...pos}]); }
async function shot(name: string) { await act(async()=>{await pause();channel.__shot={name};await wait(()=>channel.__shotDone===name);}); }
async function size(w: number) { const id=++n; await act(async()=>{channel.__want={w,h:900,n:id};await wait(()=>channel.__sizeAck===id);await pause();}); }

export async function testAuthoringDepthLayout() {
  const P=`authoring-ui-${Date.now()}`, host=document.getElementById('root')!, root=createRoot(host);
  const project:Project={id:P,title:'The northern crossing',description:'',mode:'custom',type:'standalone',status:'draft',color:'#d5b575',enabledEngines:['writings','dialog-scene','codex'],createdAt:1,updatedAt:1,readerPresentation:{...defaultReaderPresentation(),playback:{mode:'play',wordsPerMinute:240}}};
  const scene:Scene={id:`${P}-scene`,projectId:P,title:'El último barco',order:0,tags:[],createdAt:1,updatedAt:1};
  const writing:Writing={id:`${P}-writing`,projectId:P,title:'El último barco',status:'draft',content:'<h2>La llegada</h2><p>Ágata bajó hacia el puerto con el mapa doblado bajo el brazo. En el agua quieta se reflejaban las luces del último barco.</p><blockquote><p>Si la marea cambia, esperaremos al amanecer.</p></blockquote><p>Tomás dejó una cuerda sobre el muelle. La niebla ocultaba ya la otra orilla.</p>',wordCount:52,tags:[],createdAt:1,updatedAt:1};
  try {
    useLocaleStore.setState({locale:'es'});await db.projects.put(project);await db.scenes.put(scene);await db.writings.put(writing);
    await db.codexEntries.bulkPut(['Ágata','Tomás'].map((title,i)=>({id:`${P}-person-${i}`,projectId:P,title,type:'character' as const,content:'',fields:{},tags:[],relations:[],createdAt:1,updatedAt:1})));
    await appendConversationTurn(scene.id,{speaker:`entry:${P}-person-0`,content:'¿Queda sitio en el barco?'});
    await appendConversationTurn(scene.id,{speaker:`entry:${P}-person-1`,content:'Sólo hasta la otra orilla.'});
    await appendConversationTurn(scene.id,{speaker:'',content:'La niebla cubre el embarcadero.'});
    for(const width of [1280,640]) {
      await size(width); await act(async()=>{root.render(<MemoryRouter><EnginePaneContext.Provider value={{instanceId:'authoring-ui-pane',projectId:P,visible:true,primary:true}}><div className="h-screen bg-deep p-4"><SceneEditor scene={scene} scenes={[scene]} onBack={()=>undefined} onUpdateScene={async()=>undefined}/></div></EnginePaneContext.Provider></MemoryRouter>);await pause();});
      await waitUi(()=>!!host.querySelector('[data-testid="conversation-composer"] textarea'));
      const composer=host.querySelector<HTMLElement>('[data-testid="conversation-composer"]')!, select=composer.querySelector('select')!, text=composer.querySelector('textarea')!;
      await click(select); await native([{type:'keyDown',keyCode:'ESCAPE'},{type:'keyUp',keyCode:'ESCAPE'},{type:'keyDown',keyCode:'ENTER'},{type:'keyUp',keyCode:'ENTER'}]);
      assert(document.activeElement===text,'Native Enter on speaker must focus text');
      await native([{type:'text',text:width===1280?'La cuerda está lista.':'Podemos partir.'},{type:'keyDown',keyCode:'ENTER'},{type:'keyUp',keyCode:'ENTER'}]);
      await waitUi(()=>text.value==='' && document.activeElement===select); assert((await db.dialogBlocks.where('sceneId').equals(scene.id).count()) >= 4,'Native input must append a real turn');
      await shot(`conversation-authoring-${width}`);
      await act(async()=>{root.render(<EnginePaneContext.Provider value={{instanceId:'reader-ui-pane',projectId:P,visible:true,primary:true}}><ReadingView pieces={[writing]} onClose={()=>undefined} onOpenInEditor={()=>undefined}/></EnginePaneContext.Provider>);await pause();});
      await waitUi(()=>{const next=host.querySelector<HTMLButtonElement>('[data-reader-playback="next"]');return !!next && !next.hidden && !next.disabled;});
      await click(host.querySelector<HTMLButtonElement>('[data-reader-playback="next"]')!);
      assert(host.querySelectorAll('.ProseMirror > [hidden]').length===2,'Native next block must reveal prose');
      await waitUi(()=>{const progress=Number(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'));return progress>0&&progress<100;});
      assert(getComputedStyle(host.querySelector<HTMLElement>('[data-reader-end]')!).display==='none','Unread blocks must not claim end of manuscript');
      assert(document.documentElement.scrollWidth<=innerWidth+1,'Authoring surface overflows viewport horizontally');
      await shot(`reader-playback-${width}`);
      await act(async()=>{root.render(null);await pause();});
    }
    return ['Real product CSS at1280/640: native conversation speaker→text→append→focus, recovered ordinary turns and screenshots','Actual ReadingView at1280/640: native next block, preserved prose and no horizontal overflow'];
  }finally{await act(async()=>root.unmount());await deleteProject(P);}
}
