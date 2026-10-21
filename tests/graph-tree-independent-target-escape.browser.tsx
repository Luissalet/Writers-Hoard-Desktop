import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import RelationTreesWorkspace from '@/engines/genealogy/components/RelationTreesWorkspace';
import {createLocalDraftStore} from '@/hooks/localDraftStore';
import type {RelationTreeDocument} from '@/engines/genealogy/relationTrees';
import {useLocaleStore} from '@/stores/localeStore';
import {prepareGraphTreeFixture} from './graph-tree-affordances.browser';
const qa=window as any;let seq=0;
const assert=(v:unknown,m:string):asserts v=>{if(!v)throw Error(m)};
const pause=()=>new Promise(r=>setTimeout(r,45));
async function until(f:()=>unknown){for(let i=0;i<180;i++){if(f())return;await act(async()=>{await pause()})}throw Error('Own UI timeout '+qa.__testStage)}
async function native(events:unknown[]){const n=++seq;await act(async()=>{qa.__native={n,events};await until(()=>qa.__nativeAck===n);await pause()})}
const point=(el:Element)=>{const b=el.getBoundingClientRect();return{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}};
const edge=(id:string)=>[...document.querySelectorAll<SVGGElement>('.react-flow__edge')].find(e=>e.dataset.id===id)!;
export async function testGraphTreeIndependentUi(){
 useLocaleStore.setState({locale:'en'});const f=await prepareGraphTreeFixture('own-ui-target-escape'),root=createRoot(document.getElementById('root')!);
 qa.__want={w:1440,h:1000,n:++seq};await until(()=>qa.__sizeAck===seq);
 await act(async()=>root.render(<MemoryRouter initialEntries={['/project/'+f.projectId+'/genealogy?tree='+f.treeId]}><main className="bg-deep p-5 text-text-primary"><RelationTreesWorkspace projectId={f.projectId} canonical={<p>Own canonical</p>}/></main></MemoryRouter>));
 await until(()=>!!edge('route'));await act(async()=>{await new Promise(r=>setTimeout(r,400))});
 const canvas=document.querySelector('[data-testid="relation-tree-canvas"]')!;canvas.scrollIntoView({block:'start',behavior:'instant'});
 const path=edge('route').querySelector<SVGPathElement>('.react-flow__edge-interaction')!,p=path.getPointAtLength(path.getTotalLength()/2).matrixTransform(path.getScreenCTM()!);
 await native([{type:'mouseMove',x:Math.round(p.x),y:Math.round(p.y)},{type:'mouseDown',x:Math.round(p.x),y:Math.round(p.y),button:'left',clickCount:1},{type:'mouseUp',x:Math.round(p.x),y:Math.round(p.y),button:'left',clickCount:1}]);
 await until(()=>edge('route').classList.contains('selected'));
 const updater=edge('route').querySelector('.react-flow__edgeupdater-source')!,last=edge('segment:'+JSON.stringify(['route',2])).querySelector('.react-flow__edgeupdater-target')!;
 assert(updater&&last,'Outer endpoint controls missing');
 const style=getComputedStyle(updater);console.log('OWN ENDPOINT OBSERVATION '+JSON.stringify({outerHTML:updater.outerHTML,fill:style.fill,stroke:style.stroke,opacity:style.opacity,cursor:style.cursor,sourceRect:updater.getBoundingClientRect().toJSON(),lastRect:last.getBoundingClientRect().toJSON(),middleUpdaters:edge('segment:'+JSON.stringify(['route',1])).querySelectorAll('.react-flow__edgeupdater').length}));
 qa.__shot={name:'own-target-selected-endpoints'};await until(()=>qa.__shotDone==='own-target-selected-endpoints');
 const store=createLocalDraftStore<{tree:RelationTreeDocument}>('wh.relation-trees.v1.'+f.projectId,(v):v is {tree:RelationTreeDocument}=>!!v&&typeof v==='object'),before=JSON.stringify(store.get(f.treeId)?.tree?.edges);
 const start=point(last),end=point(document.querySelector('.react-flow__node[data-id="d"] .react-flow__handle[data-handleid="bottom"]')!);
 qa.__testStage='own target Escape while reconnecting';
 await native([{type:'mouseMove',...start},{type:'mouseDown',...start,button:'left',clickCount:1}]);
 await native([{type:'mouseMove',x:Math.round((start.x+end.x)/2),y:Math.round((start.y+end.y)/2),button:'left'}]);
 await native([{type:'keyDown',keyCode:'ESCAPE'},{type:'keyUp',keyCode:'ESCAPE'}]);
 await native([{type:'mouseMove',...end,button:'left'},{type:'mouseUp',...end,button:'left',clickCount:1}]);
 await act(async()=>{await pause()});
 const after=store.get(f.treeId)?.tree;console.log('OWN ESCAPE OBSERVATION '+JSON.stringify({before,after:after?.edges}));
 assert(JSON.stringify(after?.edges)===before,'Own Escape reconnect cancellation persisted a changed logical endpoint');
 await act(async()=>root.unmount());return ['Own selected endpoint DOM/style and native Escape cancellation'];
}
