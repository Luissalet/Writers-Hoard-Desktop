import {useEffect,useMemo,useState} from 'react';
import type {LocalAssetResolved} from './assets';
/** Each caller owns only its own FontFace; no browser or database access at import. */
export function useLocalToolFontFace(asset:LocalAssetResolved|null):{family?:string;loading:boolean;error?:string}{
 const binding=useMemo(()=>({asset}),[asset]);
 const [state,setState]=useState<{binding:typeof binding|null;family?:string;loading:boolean;error?:string}>({binding:null,loading:false});
 useEffect(()=>{let active=true,owned:FontFace|undefined;if(!asset||asset.kind!=='font')return;const family='wh-resource-'+crypto.randomUUID();void asset.blob.arrayBuffer().then(bytes=>{if(!active)return;owned=new FontFace(family,bytes);return owned.load();}).then(face=>{if(!active||!face)return;document.fonts.add(face);setState({binding,family,loading:false});}).catch(error=>{if(active)setState({binding,loading:false,error:String(error)});});return()=>{active=false;if(owned)document.fonts.delete(owned);};},[asset,binding]);
 return state.binding===binding?state:{loading:asset?.kind==='font'};
}
