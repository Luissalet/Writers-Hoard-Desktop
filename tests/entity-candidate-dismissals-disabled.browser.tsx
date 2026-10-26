import { Component, act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import TiptapEditor from '@/components/editor/TiptapEditor';
import { db } from '@/db';
import { ENTITY_DETECTION_HANDLERS as bridge } from '@/services/entityDetection/bridge';
import { getEntityCandidateDismissals } from '@/services/entityDetection/service';
const pause = () => new Promise(resolve => setTimeout(resolve, 350));
let caught = '';
class Boundary extends Component<{children: ReactNode},{failed: boolean}> { state = { failed: false }; static getDerivedStateFromError() { return { failed: true }; } componentDidCatch(error: Error) { caught = error.message; } render() { return this.state.failed ? <p data-failed>Editor failed</p> : this.props.children; } }
export async function testEntityCandidateDismissalsWithoutCodex(): Promise<string[]> {
 const root = createRoot(document.getElementById('root')!); const projectId = 'qa-ner-no-codex', documentId = projectId + '-writing'; const previous = window.electronAPI;
 Object.defineProperty(window, 'electronAPI', { configurable: true, value: { entityDetection: { status: async () => ({ state: 'ready', model: 'controlled-no-model' }), detect: async () => [] } } });
 await db.writings.put({ id: documentId, projectId, title: 'Kept', content: '<p>Kept prose</p>', wordCount: 2, status: 'draft', tags: [], createdAt: 1, updatedAt: 1 });
 try {
  for (const enabled of [false, true]) {
   caught = ''; await db.projects.put({ id: projectId, title: 'Writing only', mode: 'custom', type: 'standalone', description: '', status: 'draft', color: '#777777', enabledEngines: ['writings'], engineOrder: ['writings'], createdAt: 1, updatedAt: 1, entityDetectionPreferences: { detectNewEntities: enabled, autoLinkMentions: true, animateNewLinks: false, revision: 1 } });
   await act(async () => { root.render(<MemoryRouter><Boundary key={String(enabled)}><TiptapEditor content="<p>Kept prose</p>" onChange={() => { throw Error('prose edited'); }} copilotIdentity={{projectId,objectId:documentId,kind:'writings'}} entityCandidateContext={{kind:'writings',documentId}} /></Boundary></MemoryRouter>); await pause(); });
   await act(async () => { await pause(); });
   if (caught || document.querySelector('[data-failed]') || !document.querySelector('.tiptap')) throw Error('NER_WRITINGS_ONLY_EDITOR_BROKEN detection=' + enabled + ' cause=' + caught);
   const state = await getEntityCandidateDismissals({projectId,context:{kind:'writings',documentId}}); if (state.decisions.length) throw Error('unexpected metadata');
  }
  await db.projects.update(projectId, {enabledEngines:['writings','codex']}); await act(async()=>{await pause();});
  await db.projects.update(projectId, {enabledEngines:['writings']}); await act(async()=>{await pause();});
  if(caught || !document.querySelector('.tiptap')) throw Error('engine removed during mount broke editor');
  const scope={projectId,context:{kind:'writings',documentId}};
  const action=await bridge.wh_entity_candidate_dismissal_action({...scope,action:'dismiss',text:'Nora',candidate:{from:0,to:4,text:'Nora',label:'PER',score:.99},expectedVersion:''});
  if(!action.changed || !(await bridge.wh_entity_candidate_dismissals(scope)).decisions[0].discarded) throw Error('metadata bridge incorrectly requires Codex');
  await bridge.wh_entity_candidate_dismissal_action({...scope,action:'undo',receiptId:action.receiptId});
  await act(async()=>{await db.projects.update(projectId,{enabledEngines:['writings','codex']});await pause();});
  for(let i=0;i<25&&!document.querySelector('.wh-entity-panel');i++)await act(async()=>{await pause();});
  if(!document.querySelector('.wh-entity-panel'))throw Error('positive NER panel missing before owner deletion');
  await act(async()=>{await db.writings.delete(documentId);await pause();});
  for(let i=0;i<25&&!document.querySelector('.wh-entity-panel [role=alert]');i++)await act(async()=>{await pause();});
  if(caught || !document.querySelector('.tiptap') || !document.querySelector('.wh-entity-panel [role=alert]')) throw Error('missing owner must report error without losing editor caught='+caught+' editor='+!!document.querySelector('.tiptap')+' panel='+document.querySelector('.wh-entity-panel')?.textContent);
  return ['Writing-only project retains real editor with detection OFF and ON; engine removal while mounted, metadata bridge dismiss/list/Undo without Codex; read never materializes metadata'];
 } finally { await act(async()=>root.unmount()); Object.defineProperty(window,'electronAPI',{configurable:true,value:previous}); }
}
