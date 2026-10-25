import {useEffect,useMemo,useRef,useState} from 'react';
import type {LocalToolClient,LocalToolJson} from './sdk';

export interface LocalToolIconProps {
 client:Pick<LocalToolClient<LocalToolJson>,'icons'>;icon?:string|null;fallback?:string|null;
 size?:number;color?:string;label?:string;className?:string;
}
/** Rendering is optional; the persisted identity remains ordinary JSON. */
export function LocalToolIcon({client,icon,fallback='BookOpen',size=20,color,label,className}:LocalToolIconProps){
 const canvas=useRef<HTMLCanvasElement>(null),wrapper=useRef<HTMLSpanElement>(null);
 const binding=useMemo(()=>({client,icons:client.icons,icon,fallback,size,color}),[client,icon,fallback,size,color]);
 const [painted,setPainted]=useState<typeof binding>();
 const drawn=painted===binding;
 useEffect(()=>{
  let active=true;
  const target=canvas.current;
  if(!binding.icons||!target)return;
  void(async()=>{
   const selected=icon?await binding.icons!.get(icon):null;
   const resolved=selected??(fallback?await binding.icons!.get(fallback):null);
   if(!active||!resolved)return;
   const {drawPlaceCatalogIcon}=await import('../worldgen/cartography/placeIcon');
   if(!active||canvas.current!==target)return;
   const ratio=window.devicePixelRatio||1,dimension=Number.isFinite(size)&&size>0?size:20;
   target.width=Math.round(dimension*ratio);target.height=Math.round(dimension*ratio);
   const ctx=target.getContext('2d');if(!ctx)return;
   ctx.scale(ratio,ratio);ctx.translate(dimension/2,dimension/2);
   const ink=color??(wrapper.current?getComputedStyle(wrapper.current).color:'currentColor');
   if(drawPlaceCatalogIcon(ctx,{catalogIcon:{catalog:'writer-map-symbols/1',name:resolved.name},color:ink},dimension/2)&&active)setPainted(binding);
  })().catch(()=>{/* An optional renderer degrades to the neutral mark. */});
  return()=>{active=false;};
 },[binding,icon,fallback,size,color]);
 const dimension=Number.isFinite(size)&&size>0?size:20;
 return <span ref={wrapper} role={label?'img':undefined} aria-label={label||undefined} aria-hidden={label?undefined:true} className={className} style={{display:'inline-flex',width:dimension,height:dimension,flexShrink:0,color,verticalAlign:'middle'}}>
  <canvas ref={canvas} width={dimension} height={dimension} aria-hidden="true" style={{width:dimension,height:dimension,display:drawn?'block':'none'}}/>
  {!drawn&&<svg aria-hidden="true" width={dimension} height={dimension} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="8"/><path d="M9 12h6"/></svg>}
 </span>;
}
