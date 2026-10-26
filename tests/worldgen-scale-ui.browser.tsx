import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import WorldgenEngine from '@/engines/worldgen/components/WorldgenEngine';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import { useLocaleStore } from '@/stores/localeStore';
import { getCachedWorld } from '@/engines/worldgen/useWorldGeneration';
import { makeFixture, check, call, terrainRecord } from './worldgen-scale-contract.browser';

const pause=()=>new Promise(resolve=>setTimeout(resolve,60));
function labelled(name:string): HTMLInputElement | undefined {
  return [...document.querySelectorAll<HTMLInputElement>('input')].find(input=>input.getAttribute('aria-label')===name || [...input.labels??[]].some(label=>label.textContent?.trim()===name));
}
function button(name:string) { return [...document.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.trim()===name || node.getAttribute('aria-label')===name); }
async function click(name:string) { const node=button(name);check(node,`Normal WorldgenEngine lacks ${name}`);await act(async()=>{node!.click();await pause();}); }
async function change(input:HTMLInputElement,value:string) { await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));await pause();}); }

export async function testWorldScaleNormalUI() {
  const f=await makeFixture(),root=createRoot(document.getElementById('root')!);
  useLocaleStore.setState({locale:'en',loaded:true});
  try {
    await act(async()=>{root.render(<MemoryRouter initialEntries={[`/project/${f.P}/worldgen`]}><EnginePaneContext.Provider value={{projectId:f.P,instanceId:f.P,visible:true}}><WorldgenEngine projectId={f.P}/></EnginePaneContext.Provider></MemoryRouter>);await pause();});
    for(let i=0;i<300&&!document.querySelector('[data-testid="worldgen-engine"] select');i++)await act(async()=>{await pause();});
    check(document.querySelector('[data-testid="worldgen-engine"] select'),'Normal world engine did not mount');
    // No mock panel, no imported future scale component, no test-side writer.
    for(const details of document.querySelectorAll('details'))details.open=true;
    check(button('Scale of this map'),'Causal RED: normal saved-world UI has no non-generative scale entry');
    await click('Scale of this map');
    const input=labelled('Map width (km)');check(input,'Normal scale form has no labelled width input');
    for(let i=0;i<1000&&!getCachedWorld(f.W,f.world.params);i++)await act(async()=>{await pause();});
    const data=getCachedWorld(f.W,f.world.params);check(data,'Normal engine did not produce/cache real WorldData');
    const buffers=Object.entries(data!).filter(([,value])=>ArrayBuffer.isView(value)).map(([key,value])=>{const array=value as ArrayBufferView;return {key,bytes:new Uint8Array(array.buffer,array.byteOffset,array.byteLength).slice()};});
    function terrainExact() { const next=getCachedWorld(f.W,f.world.params);check(next===data,'Scale replaced/generated a different WorldData object');for(const {key,bytes} of buffers){const value=(next as unknown as Record<string,ArrayBufferView>)[key];check(value&&value.byteLength===bytes.byteLength,'Scale changed '+key+' extent');const current=new Uint8Array(value.buffer,value.byteOffset,value.byteLength);check(bytes.every((byte,index)=>byte===current[index]),'Scale changed real '+key+' bytes');} }
    const before=await db.generatedWorlds.get(f.W);check(before,'Fixture world missing');
    const raw=terrainRecord(before! as unknown as Record<string,unknown>);
    await change(input!,'4096');
    check(JSON.stringify(await db.generatedWorlds.get(f.W))===JSON.stringify(before),'Editing scale draft wrote the saved world');
    await click('Cancel scale');
    check(JSON.stringify(await db.generatedWorlds.get(f.W))===JSON.stringify(before),'Cancel changed the world');
    await click('Scale of this map');
    await change(labelled('Map width (km)')!,'4096');await click('Apply scale');
    for(let i=0;i<150&&(await call('wh_get_world_scale',{worldId:f.W})).widthKm!==4096;i++)await act(async()=>{await pause();});
    check((await call('wh_get_world_scale',{worldId:f.W})).widthKm===4096,'Normal Apply did not reach public scale state');
    check(terrainRecord((await db.generatedWorlds.get(f.W))! as unknown as Record<string,unknown>)===raw,'Normal Apply regenerated/replaced terrain or authored fields');
    terrainExact();
    check(!document.querySelector('[role="dialog"]')?.textContent?.includes('Regenerate'),'Scale opened the regeneration confirmation');
    await click('Undo scale');
    check((await call('wh_get_world_scale',{worldId:f.W})).widthKm===2048,'Normal UI Undo did not restore original effective scale');
    check(terrainRecord((await db.generatedWorlds.get(f.W))! as unknown as Record<string,unknown>)===raw,'UI Undo overwrote terrain fields');
    terrainExact();
    return ['Normal WorldgenEngine exposes independent labelled scale flow; draft/Cancel are read-only; Apply/Undo share public scale state without changing authored terrain'];
  } finally { await act(async()=>root.unmount());await f.cleanup(); }
}
