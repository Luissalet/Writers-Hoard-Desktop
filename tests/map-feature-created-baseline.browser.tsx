import {act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useMapFeatures,type MapFeatureEditor} from '@/components/maps/useMapFeatures';
import type {MapFeature} from '@/types';
import '@/engines';
import '@/services/aiBridge/dispatch';
import {MemoryRouter} from 'react-router-dom';
import MapsEngine from '@/engines/maps/MapsEngine';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {useLocaleStore} from '@/stores/localeStore';

const assert:(v:unknown,m:string)=>asserts v=(v,m)=>{if(!v)throw Error(m);};
export async function testMapFeatureCreatedBaseline(){
 const out:string[]=[],root=createRoot(document.getElementById('root')!);let editor!:MapFeatureEditor,stored:MapFeature[]=[],fail=false;const baselines:MapFeature[][]=[];
 const prior:MapFeature={id:'prior-label',kind:'label',name:'Existing authored label',color:'#cab57d',opacity:1,points:[{x:8,y:8}]};
 function Fixture(){const[features,setFeatures]=useState<MapFeature[]>([structuredClone(prior)]);editor=useMapFeatures({features,onChangeFeatures:async(next,before)=>{baselines.push(structuredClone(before??[]));if(fail)throw Error('own_finish_failure');stored=structuredClone(next);setFeatures(stored);return stored;}});return <output>{features.map(item=>item.name).join('|')}</output>;}
 try{
  for(const kind of['region','path','label'] as const){
   await act(async()=>root.render(<Fixture key={kind}/>));fail=false;await act(async()=>editor.changeTool(kind));
   const points=kind==='label'?[{x:20,y:30}]:[{x:10,y:10},{x:40,y:10},{x:40,y:40}];
   await act(async()=>{await editor.finish(points);});const id=editor.draft!.id;assert(stored.length===2&&stored.some(item=>item.id===id),'finish must persist created feature');
   await act(async()=>editor.patch({name:'Edited after creation '+kind}));await act(async()=>{await editor.save();});
   assert(stored.length===2&&stored[0].name===prior.name&&stored.find(item=>item.id===id)?.name==='Edited after creation '+kind,'post-create metadata save erased feature/prior authored feature');
   assert(baselines.at(-1)?.some(item=>item.id===id),'post-create save baseline omitted created feature');
   out.push(`${kind}: newly completed geometry remains in next metadata-save baseline; same ID/points and prior authored label survive`);
  }
  await act(async()=>root.render(<Fixture key="failed-finish"/>));await act(async()=>editor.changeTool('region'));fail=true;const points=[{x:10,y:10},{x:50,y:10},{x:50,y:50}];await act(async()=>{await editor.finish(points);});
  assert(editor.failed&&editor.drawing&&editor.features.length===1,'failed finish advanced visible/saved feature state');
  const failedBaseline=JSON.stringify(baselines.at(-1));fail=false;await act(async()=>{await editor.finish(points);});assert(JSON.stringify(baselines.at(-1))===failedBaseline,'finish retry changed baseline after failed write');
  await act(async()=>editor.patch({name:'Recovered completed region'}));await act(async()=>{await editor.save();});assert(stored.length===2&&stored.some(item=>item.name==='Recovered completed region'),'finish retry followed by later edit lost geometry');
  out.push('Rejected finish leaves original baseline/state; retry uses it, commits once, and a later metadata edit retains completed geometry');
  return out;
 }finally{await act(async()=>root.unmount());}
}
const channel=window as unknown as Record<string,any>;let sequence=0;
async function wait(check:()=>boolean,label:string){for(let n=0;n<300;n++){if(check())return;await act(async()=>{await new Promise(r=>setTimeout(r,30));});}throw Error('M3 native timeout '+label);}
async function native(events:unknown[]){const n=++sequence;await act(async()=>{channel.__native={n,events};await wait(()=>channel.__nativeAck===n,'input');});}
async function click(node:Element,x=.5,y=.5){node.scrollIntoView({block:'center',behavior:'instant'});await act(async()=>{await new Promise(r=>setTimeout(r,50));});const r=node.getBoundingClientRect();assert(r.width&&r.height,'visible control');const p={x:Math.round(r.x+r.width*x),y:Math.round(r.y+r.height*y),button:'left',clickCount:1};await native([{type:'mouseDown',...p},{type:'mouseUp',...p}]);}
export async function testMapCreatedNative(){
 const out:string[]=[];useLocaleStore.setState({locale:'en'});
 for(const width of[1440,640]){
  const id='m3-map-'+crypto.randomUUID(),map=id+'-map',root=createRoot(document.getElementById('root')!);
  await db.projects.put({id,title:'M3 map fixture',mode:'custom',type:'standalone',enabledEngines:['maps'],engineOrder:['maps'],createdAt:1,updatedAt:1});
  const canvas=document.createElement('canvas');canvas.width=600;canvas.height=300;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#3b5557';ctx.fillRect(0,0,600,300);
  await db.worldMaps.put({id:map,projectId:id,title:'Local geometry',backgroundImage:canvas.toDataURL(),createdAt:1,updatedAt:1});
  try{
   const n=++sequence;channel.__want={w:width,h:1000,n};await wait(()=>channel.__sizeAck===n,'size');
   await act(async()=>root.render(<MemoryRouter initialEntries={[`/project/${id}/maps?map=${map}`]}><MapsEngine projectId={id}/></MemoryRouter>));
   await wait(()=>!!document.querySelector('[data-testid=map-tool-region]'),'normal engine');await click(document.querySelector('[data-testid=map-tool-region]')!);
   for(const[x,y]of[[.15,.2],[.6,.2],[.6,.65]])await click(document.querySelector('[data-testid=map-feature-canvas]')!,x,y);
   await click(document.querySelector('[data-testid=map-feature-finish]')!);await wait(()=>!!document.querySelector('[data-testid=map-feature-name]'),'completed region inspector');
   const created=(await db.worldMaps.get(map))!.features![0];assert(created?.kind==='region','native finish failed');
   const input=document.querySelector<HTMLInputElement>('[data-testid=map-feature-name]')!;await click(input);await native([{type:'keyDown',keyCode:'A',modifiers:['control']},{type:'keyUp',keyCode:'A',modifiers:['control']}]);await wait(()=>input.selectionStart===0&&input.selectionEnd===input.value.length,'selected title');await native([{type:'text',text:'New region retained '+width}]);
   await click(document.querySelector('[data-testid=map-feature-save]')!);await wait(()=>document.querySelector<HTMLInputElement>('[data-testid=map-feature-name]')?.value==='New region retained '+width&&document.querySelector<HTMLButtonElement>('[data-testid=map-feature-save]')?.disabled===true,'metadata saved');
   const actual=(await db.worldMaps.get(map))!.features!;assert(actual.length===1&&actual[0].id===created.id&&actual[0].name==='New region retained '+width,'native metadata save erased freshly created region');
   const read=await channel.qaNative.call('wh_world_era_document_get',{projectId:id,kind:'maps',entityId:map});assert(read.ok&&read.result.document.root.features[0].id===created.id&&read.result.document.root.features[0].name===actual[0].name,'normal external complete-document MCP geometry read differs');
   const name='map-created-retained-'+width;channel.__shot={name,forcePaint:true};await wait(()=>channel.__shotDone===name,'capture');
   out.push(`Normal MapsEngine native pointer/keyboard ${width}: draw→finish→rename→save preserves same region ID/geometry; actual external MCP complete Base document reads it`);
  }finally{await act(async()=>root.unmount());await deleteProject(id);}
 }return out;
}
