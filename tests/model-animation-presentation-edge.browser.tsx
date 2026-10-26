import { Component, act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter } from 'react-router-dom';
import { type Transaction, type UpdatingHookContext } from 'dexie';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import type { Project } from '@/types';
import ModelViewerEngine from '@/engines/model-viewer/ModelViewerEngine';
import { assetFromFile, assetBytes, validateGlb } from '@/engines/model-viewer/model';
import { validateAnimationPresentation } from '@/engines/model-viewer/animationPresentation';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { clearUndoJournal, getUndoJournal } from '@/services/undoJournal';
import { useLocaleStore } from '@/stores/localeStore';
import { modelAnimationPresentationFixture } from './model-animation-presentation-fixture';
import { rebuildGlb } from './model-viewer-fixture';

function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const pause = (ms = 35) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean | Promise<boolean>, message: string) { for (let i = 0; i < 180; i++) { if (await predicate()) return; await act(async () => { await pause(); }); } throw Error(message); }
async function click(node: HTMLElement) { await act(async () => { node.click(); await pause(); }); }
async function input(node: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); await pause(); }); }
function button(host: ParentNode, label: string) { const node = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label || item.getAttribute('aria-label') === label); check(node, 'Missing ' + label); return node; }
function label(host: ParentNode) { const node = host.querySelector<HTMLInputElement>('[aria-label="Animation label"]'); check(node, 'Missing owner label editor'); return node; }
const allRows = async () => JSON.stringify(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
class Boundary extends Component<{children:ReactNode},{error:string}> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <p data-test-render-error>{this.state.error}</p> : this.props.children; }
}

export async function testModelAnimationPresentationEdges() {
  const P = 'synthetic-clips-edge', F = P + '-foreign', passed: string[] = [];
  const host = document.getElementById('root'); check(host, 'Missing root'); host.style.cssText = 'max-width:1200px;margin:20px auto;padding:0 24px';
  const root = createRoot(host), project = (id: string): Project => ({ id, title: 'Synthetic animation edge fixture', description: '', mode: 'novelist', type: 'standalone', status: 'draft', color: '#777777', enabledEngines: ['model-viewer'], createdAt: 1, updatedAt: 1 });
  const render = async (id: string) => { await act(async () => { root.render(<Boundary><MemoryRouter><ModelViewerEngine projectId={id} /></MemoryRouter></Boundary>); await pause(); }); };
  const capture = async (name: string) => {
    const callback = (window as unknown as {__modelClipsExtraCapture?:(name:string,rect?:unknown)=>Promise<unknown>}).__modelClipsExtraCapture;
    check(callback, 'Extra runner capture callback missing'); return callback(name);
  };
  clearUndoJournal(); useLocaleStore.setState({ locale: 'en' });
  try {
    const sparse = [0, , 2]; let rejected = false;
    try { validateAnimationPresentation({ order: sparse }, 3); } catch { rejected = true; }
    check(rejected, 'Sparse permutation silently omits a clip');
    const bytes = await modelAnimationPresentationFixture(), asset = await assetFromFile(new File([bytes], 'Edges.glb'));
    await db.projects.bulkAdd([{ ...project(P), modelAssets: [asset] }, { ...project(F), modelAssets: [{ ...asset, id: asset.id + '-foreign' }] }]);
    await render(P); await until(() => host.textContent?.includes('Model ready') === true && !label(host).disabled, 'Owner did not load its CAS snapshot');
    const originalCanvas = host.querySelector('canvas'); check(originalCanvas, 'Missing model Canvas');
    const selector = host.querySelector<HTMLSelectElement>('[data-testid="model-animation"]')!;
    await act(async () => { selector.value = '1'; selector.dispatchEvent(new Event('change', { bubbles: true })); });
    await input(label(host), 'Kept local draft');
    const before = await runBridgeTool('wh_model_animation_get', { projectId: P, modelId: asset.id }); check(before.ok, 'Read failed');
    const remote = await runBridgeTool('wh_model_animation_action', { projectId: P, modelId: asset.id, expectedVersion: (before.result as {version:string}).version, action: 'rename', index: 1, label: 'Remote winning label' }); check(remote.ok, 'Remote edit failed');
    await until(() => selector.selectedOptions[0]?.textContent === 'Remote winning label' && !label(host).disabled, 'Remote winner not displayed');
    check(label(host).value === 'Kept local draft', 'Remote refresh overwrote local draft');
    await click(button(host, 'Save animation label'));
    await until(() => host.querySelector('[role="alert"]')?.textContent?.includes('model changed') === true, 'Stale owner draft did not show conflict');
    await input(label(host), 'Kept and edited after conflict'); await click(button(host, 'Save animation label'));
    check(label(host).value === 'Kept and edited after conflict' && selector.selectedOptions[0].textContent === 'Remote winning label', 'Typing or repeated save silently rebased stale draft');
    check(host.textContent?.includes('Current label: Remote winning label'), 'Recovery does not disclose the current winner');
    await capture('conflict-kept');
    const beforeReview = await allRows(); await click(button(host, 'Review current version'));
    check(await allRows() === beforeReview && label(host).value === 'Kept and edited after conflict', 'Explicit version review wrote data or lost draft');
    await click(button(host, 'Save animation label')); await until(() => selector.selectedOptions[0]?.textContent === 'Kept and edited after conflict', 'Explicit review did not permit a deliberate new CAS save');
    check(host.querySelector('canvas') === originalCanvas, 'Conflict/recovery recreated Canvas');
    passed.push('Sparse permutations reject; conflicting owner draft survives remote refresh and repeated Save, explicit winner review is readonly and enables only a later deliberate Save');

    const longLabel='Ascenso del faro durante la tormenta y llegada de los barcos al puerto antiguo';
    await until(()=>!label(host).disabled,'Current owner snapshot unavailable before long-label edit');await input(label(host),longLabel);await click(button(host,'Save animation label'));
    await until(()=>selector.selectedOptions[0]?.textContent===longLabel,'Long authored label was not retained');
    const setViewport=(window as unknown as {__modelClipsExtraViewport?:(width:number,height:number)=>Promise<void>}).__modelClipsExtraViewport;check(setViewport,'Extra viewport callback missing');
    await setViewport(390,1000);
    check(document.documentElement.scrollWidth<=innerWidth&&selector.getBoundingClientRect().right<=innerWidth,'Long label makes narrow owner controls overflow');
    check(selector.selectedOptions[0].textContent===longLabel,'Narrow layout changed authored label data');await capture('long-label-narrow');await setViewport(1280,1000);
    passed.push('A full long authored label stays exact while owner controls fit a real 390px viewport');

    clearUndoJournal(); await until(() => !label(host).disabled, 'Owner CAS after save unavailable');
    await input(label(host), 'Old scope pending draft');
    const beforeLate = await allRows();
    let observedPut!:()=>void, heldRoot:Transaction|undefined, rootAborted=false, keepaliveError='', stopKeepalive=()=>{};
    const provisional=new Promise<void>(resolve=>{observedPut=resolve;});
    const hold=function(this:UpdatingHookContext<Project,string>,modifications:unknown,key:string,_before:Project,transaction:Transaction){
      if(key!==P||!modifications||typeof modifications!=='object')return;
      const models=(modifications as {modelAssets?:Project['modelAssets']}).modelAssets;
      if(!models?.some(item=>item.id===asset.id&&item.animationPresentation?.labels?.['1']==='Old scope pending draft'))return;
      check(!heldRoot,'Owner writer unexpectedly entered the gate twice');
      heldRoot=transaction;while(heldRoot.parent)heldRoot=heldRoot.parent;
      heldRoot.on('abort',()=>{rootAborted=true;});
      // Hashing/history also use Dexie.waitFor: retain the actual native root
      // independently, until the outside owner switch deliberately aborts it.
      const native=(heldRoot as Transaction&{idbtrans:IDBTransaction}).idbtrans,deadline=Date.now()+5000;
      let holding=true;stopKeepalive=()=>{holding=false;};
      const spin=()=>{
        if(!holding)return;
        if(Date.now()>=deadline){holding=false;keepaliveError='Native owner gate exceeded its deadline';heldRoot?.abort();return;}
        const request=native.objectStore('projects').get(P);
        request.onsuccess=spin;
        request.onerror=()=>{if(!holding)return;holding=false;keepaliveError=String(request.error);heldRoot?.abort();};
      };
      spin();
      const previous=this.onsuccess,context=this;
      this.onsuccess=value=>{previous?.call(context,value);check(value.id===P&&value.modelAssets?.some(item=>item.id===asset.id&&item.animationPresentation?.labels?.['1']==='Old scope pending draft'),'Observed PUT was not the intended owner mutation');observedPut();};
    };
    db.projects.hook('updating',hold);
    let signalTimer:ReturnType<typeof setTimeout>|undefined;
    try{
      await click(button(host,'Save animation label'));
      await Promise.race([provisional,new Promise<never>((_resolve,reject)=>{signalTimer=setTimeout(()=>reject(Error('Owner PUT signal timed out')),5000);})]);
      check(heldRoot?.active&&heldRoot.mode==='readwrite'&&!heldRoot.parent,'Gate did not capture the actual active root write transaction');
      flushSync(()=>{root.render(<Boundary><MemoryRouter><ModelViewerEngine projectId={F}/></MemoryRouter></Boundary>);});
      heldRoot.abort();
    }finally{
      if(signalTimer)clearTimeout(signalTimer);
      stopKeepalive();if(heldRoot?.active)heldRoot.abort();db.projects.hook('updating').unsubscribe(hold);
    }
    await until(()=>rootAborted,'Intentional owner root abort was not observed');
    check(!keepaliveError||keepaliveError.includes('Abort'),'Unexpected gate keepalive error: '+keepaliveError);
    await until(() => host.textContent?.includes('Model ready') === true && !label(host).disabled, 'New scope failed after old operation abort');
    check(await allRows() === beforeLate && getUndoJournal().length === 0, 'Aborted old owner operation wrote data or journal');
    check(label(host).value === '' && !host.querySelector('[role="alert"]'), 'Late old error/draft leaked into new model scope');
    passed.push('Observed provisional owner PUT and actual root abort after scope switch cannot leak draft, error, journal or data into the new owner');

    await render(P); await until(() => host.textContent?.includes('Model ready') === true && !label(host).disabled, 'Original scope did not recover');
    const previousCanvas = host.querySelector('canvas')!, previousGl = previousCanvas.getContext('webgl2')!;
    await click(button(host, 'Play animation'));
    const glb = assetBytes(asset), json = validateGlb(glb), view = new DataView(glb), jsonLength = view.getUint32(12, true);
    json.animations = (json.animations as unknown[]).slice(0, 1);
    const oneBytes = rebuildGlb(json, new Uint8Array(glb, 28 + jsonLength, view.getUint32(20 + jsonLength, true))), one = await assetFromFile(new File([oneBytes], 'One-clip.glb'));
    await act(async () => { await db.projects.update(P, { modelAssets: [{ ...one, id: asset.id, animationPresentation: { order: [0], labels: { '0': 'Only source clip' } } }] }); await pause(); });
    await until(() => host.textContent?.includes('Model ready') === true && host.querySelector<HTMLSelectElement>('[data-testid="model-animation"]')?.options.length === 1, 'Same-ID binary replacement did not load new inventory');
    check(!host.querySelector('[data-test-render-error]'), 'New sidecar was applied to stale loaded inventory');
    check(host.querySelector('canvas') !== previousCanvas && previousGl.isContextLost(), 'Binary replacement retained the old WebGL instance');
    const oneSelect = host.querySelector<HTMLSelectElement>('[data-testid="model-animation"]')!;
    check(oneSelect.value === '0' && oneSelect.options[0].textContent === 'Only source clip' && button(host, 'Play animation') && host.querySelector<HTMLInputElement>('[data-testid="model-animation-loop"]')!.checked, 'Binary replacement did not reset clip/playback/loop against new source inventory');
    await capture('binary-replaced');
    passed.push('Same-ID different GLB and clip count uses its own loaded inventory, disposes old Canvas and resets playback without a render exception');
    return passed;
  } finally { await act(async () => { root.unmount(); await pause(); }); clearUndoJournal(); await deleteProject(P); await deleteProject(F); }
}
