// Independent fresh-Canvas replay and retained Inspector state checks.
import {act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import SpatialEntityInspector from '@/engines/worldgen/components/SpatialEntityInspector';
import {buildAtlas} from '@/engines/worldgen/core/atlas';
import {PaintSession} from '@/engines/worldgen/core/paintSession';
import {getGeography} from '@/engines/worldgen/cartography/texture';
import {drawPlaceCatalogIcon} from '@/engines/worldgen/cartography/placeIcon';
import {PLACE_CATALOG_ID} from '@/engines/worldgen/core/placeIconCatalog';
import type {WorldSpatialStyleOverride} from '@/engines/worldgen/core/spatialEntities';
import {useLocaleStore} from '@/stores/localeStore';
import {placeIconFixture,assertPlaceImage as assert} from './worldgen-place-icons.browser';

function exactReplay(actual:HTMLCanvasElement,name:string,size:number,color:string,ratio:number){
 const expected=document.createElement('canvas');expected.width=expected.height=Math.round(size*ratio);
 const ctx=expected.getContext('2d')!;ctx.scale(ratio,ratio);ctx.translate(size/2,size/2);
 assert(drawPlaceCatalogIcon(ctx,{catalogIcon:{catalog:PLACE_CATALOG_ID,name},color},size/2),'Renderer lacks known symbol '+name);
 assert(actual.width===expected.width&&actual.height===expected.height,'DOM thumbnail has wrong DPR frame');
 const a=actual.getContext('2d')!.getImageData(0,0,actual.width,actual.height).data;
 const b=ctx.getImageData(0,0,expected.width,expected.height).data;
 assert(b.some((v,i)=>i%4===3&&v>0),'Expected replay unexpectedly empty');
 assert(a.every((v,i)=>v===b[i]),'DOM thumbnail differs from actual renderer: '+name+'/'+size+'/'+ratio);
}

const cases=[['Castle','Castle'],['Palette','Palette'],['Wand2','WandSparkles']] as const;
function controls(){const value=document.querySelector<HTMLElement>('[data-testid="place-catalog-controls"]');assert(value,'Normal catalog controls missing');return value;}

async function mountInspector(suffix:string){
 const f=await placeIconFixture(suffix),session=new PaintSession(f.world);
 const root=createRoot(document.getElementById('root')!);let changes=0;
 const style=()=>buildAtlas(f.world,getGeography(f.world)).byKey.get(f.key)!.style;
 function Host(){const[,render]=useState(0);const entity=buildAtlas(f.world,getGeography(f.world)).byKey.get(f.key)!;
  const change=(value:WorldSpatialStyleOverride)=>{session.push({kind:'style',target:'settlement',key:f.key,style:value});changes++;render(n=>n+1);};
  return <MemoryRouter><SpatialEntityInspector projectId={f.projectId} worldId={f.worldId} entity={entity} onStyle={change} onRename={()=>{}} onRemove={()=>{}} onRestore={()=>{}} onMove={()=>{}} onOpenRegion={()=>{}} onReveal2D={()=>{}} onReveal3D={()=>{}}/></MemoryRouter>;
 }
 const close=async()=>{await act(async()=>root.unmount());await f.cleanup();};
 try{await act(async()=>root.render(<Host/>));}catch(error){await close();throw error;}
 const findCell=async(label:string)=>{
  const trigger=controls().querySelector<HTMLButtonElement>('button');assert(trigger,'Normal picker trigger missing');
  await act(async()=>trigger.click());
  const search=document.querySelector<HTMLInputElement>('input[placeholder="Search icons..."]');assert(search,'Normal catalog search missing');
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(search,label);search.dispatchEvent(new Event('input',{bubbles:true}));});
  const cell=document.querySelector<HTMLButtonElement>('button[aria-label="'+label+'"]');assert(cell,'Normal catalog cell missing '+label);return cell;
 };
 return{style,findCell,close,changes:()=>changes};
}

export async function testReviewPlaceCatalogThumbnailReplay(){
 const oldRatio=Object.getOwnPropertyDescriptor(window,'devicePixelRatio');
 useLocaleStore.setState({locale:'en',loaded:true});
 try{
  // Fresh world/session/mount per pair: both compared Canvases have one draw/read history.
  for(const ratio of [1,2])for(const [label,canonical]of cases){
   Object.defineProperty(window,'devicePixelRatio',{configurable:true,value:ratio});
   const fixture=await mountInspector('review-thumbnail-fresh-'+ratio+'-'+label);
   try{
    assert(!fixture.style().catalogIcon&&!controls().querySelector('button canvas'),'Fresh pair unexpectedly has a prior selected graphic');
    const cell=await fixture.findCell(label),canvas=cell.querySelector<HTMLCanvasElement>('canvas');assert(canvas,'Cell lacks own Canvas');
    exactReplay(canvas,canonical,20,'#b3a48e',ratio);
    await act(async()=>cell.click());
    const selected=controls().querySelector<HTMLCanvasElement>('button canvas');assert(selected,'Selected thumbnail missing');
    exactReplay(selected,canonical,22,'#c4973b',ratio);
    assert(fixture.style().catalogIcon?.name===canonical,'UI saved alias instead of canonical identity');
    assert(controls().querySelector('span')?.textContent===canonical,'Selected control name does not match canonical descriptor');
    assert(fixture.changes()===1,'Fresh UI selection must be one normal style change');
   }finally{await fixture.close();}
  }
  // Retained updates are checked separately without mutating Canvas readback history.
  Object.defineProperty(window,'devicePixelRatio',{configurable:true,value:1});
  const retained=await mountInspector('review-thumbnail-retained');
  try{
   let count=0;
   for(const [label,canonical]of cases){
    const cell=await retained.findCell(label);await act(async()=>cell.click());
    assert(retained.style().catalogIcon?.name===canonical,'Retained UI selection did not update canonical descriptor');
    assert(controls().querySelector('span')?.textContent===canonical,'Retained selected control name is stale');
    assert(controls().querySelector('button canvas'),'Retained selected control lost its own Canvas');
    assert(retained.changes()===++count,'Retained selection did not make exactly one normal style change');
   }
  }finally{await retained.close();}
  return ['Normal inspector fresh cells/selected Canvas match the production renderer in12 exact RGBA comparisons at DPR1/2; retained Castle/Palette/Wand2 changes update canonical descriptor and selected control without pixel readbacks'];
 }finally{if(oldRatio)Object.defineProperty(window,'devicePixelRatio',oldRatio);else Reflect.deleteProperty(window,'devicePixelRatio');}
}
