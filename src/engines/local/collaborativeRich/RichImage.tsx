import {useEffect,useState} from 'react';
import type {LocalToolAssets} from '../assets';
import type {RichImageAlignment,RichImageAsset,RichImageSize} from '../convergence/imageFormat';

const widths={small:'w-1/3',medium:'w-2/3',full:'w-full'};
const margins={left:'mr-auto',center:'mx-auto',right:'ml-auto'};

export function RichImage({assets,id,asset,displaySize,alignment,es}:{assets?:LocalToolAssets;id:string;asset:RichImageAsset;displaySize:RichImageSize;alignment?:RichImageAlignment;es:boolean}){
 const {sha256,mime,size}=asset,key=JSON.stringify([sha256,mime,size]);
 const [loaded,setLoaded]=useState<{assets?:LocalToolAssets;key:string;url:string|null}>();
 useEffect(()=>{
  let active=true,url:string|undefined;
  const publish=(blob?:Blob)=>{if(!active)return;url=blob?URL.createObjectURL(blob):undefined;setLoaded({assets,key,url:url??null});};
  if(assets)void assets.resolveImage({sha256,mime,size}).then(result=>publish(result?.blob),()=>publish());else publish();
  return()=>{active=false;if(url)URL.revokeObjectURL(url);};
 },[assets,key,sha256,mime,size]);
 const result=loaded?.key===key&&loaded.assets===assets?loaded:undefined;
 return <figure data-writer-image={id} data-image-size={displaySize} data-image-alignment={alignment} className={['my-3 max-w-full',widths[displaySize],alignment&&margins[alignment]].filter(Boolean).join(' ')}>
  {result?.url?<img src={result.url} draggable={false} alt={es?'Imagen compartida':'Shared image'} className="block h-auto w-full rounded"/>:<span className="block rounded border border-border p-2 text-sm text-text-muted" role="status">{result?es?'Imagen no disponible en esta biblioteca.':'Image unavailable in this library.':es?'Cargando imagen…':'Loading image…'}</span>}
 </figure>;
}
