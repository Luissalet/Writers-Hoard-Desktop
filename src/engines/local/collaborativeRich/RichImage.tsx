import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {LocalToolAssets} from '../assets';
import type {RichImageAlignment,RichImageAsset,RichImageSize} from '../convergence/imageFormat';
import {assetBase64,assetFileHash} from '../assetFileFormat';
import {sourceImageClipboardData} from './imageClipboardData';

const widths={small:'w-1/3',medium:'w-2/3',full:'w-full'};
const margins={left:'mr-auto',center:'mx-auto',right:'ml-auto'};

export function RichImage({assets,id,asset,displaySize,alignment,es,clipboard=false}:{assets?:LocalToolAssets;id:string;asset:RichImageAsset;displaySize:RichImageSize;alignment?:RichImageAlignment;es:boolean;clipboard?:boolean}){
 const {sha256,mime,size}=asset,key=JSON.stringify([sha256,mime,size]);
 const figure=useRef<HTMLElement>(null),[loaded,setLoaded]=useState<{assets?:LocalToolAssets;key:string;url:string|null;clipboardSource?:string}>();
 useEffect(()=>{
  let active=true,url:string|undefined;
  const publish=async(blob?:Blob)=>{
   let clipboardSource:string|undefined;
   if(clipboard&&blob)try{
    const bytes=new Uint8Array(await blob.arrayBuffer());
    if(bytes.length===size&&await assetFileHash(bytes)===sha256)clipboardSource=`data:${mime};base64,${assetBase64(bytes)}`;
   }catch{/* The ordinary image can still render when clipboard preparation fails. */}
   if(!active)return;
   url=blob?URL.createObjectURL(blob):undefined;setLoaded({assets,key,url:url??null,clipboardSource});
  };
  if(assets)void assets.resolveImage({sha256,mime,size}).then(result=>publish(result?.blob),()=>publish());else void publish();
  return()=>{active=false;if(url)URL.revokeObjectURL(url);};
 },[assets,key,sha256,mime,size,clipboard]);
 const result=loaded?.key===key&&loaded.assets===assets?loaded:undefined;
 useLayoutEffect(()=>{
  const node=figure.current,source=result?.clipboardSource;
  if(!node||!source||!clipboard)return;
  sourceImageClipboardData.set(node,source);
  return()=>{sourceImageClipboardData.delete(node);};
 },[result?.clipboardSource,clipboard]);
 return <figure ref={figure} data-writer-image={id} data-image-size={displaySize} data-image-alignment={alignment} className={['my-3 max-w-full',widths[displaySize],alignment&&margins[alignment]].filter(Boolean).join(' ')}>
  {result?.url?<img src={result.url} draggable={false} alt={es?'Imagen compartida':'Shared image'} className="block h-auto w-full rounded"/>:<span className="block rounded border border-border p-2 text-sm text-text-muted" role="status">{result?es?'Imagen no disponible en esta biblioteca.':'Image unavailable in this library.':es?'Cargando imagen…':'Loading image…'}</span>}
 </figure>;
}
