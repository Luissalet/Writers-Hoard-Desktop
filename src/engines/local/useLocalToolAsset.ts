import {useLiveQuery} from 'dexie-react-hooks';
import {useEffect,useState} from 'react';
import type {LocalToolClient,LocalToolJson} from './sdk';
import type {LocalAssetOverrides,LocalAssetResolved} from './assets';
export function useLocalToolAsset(client:Pick<LocalToolClient<LocalToolJson>,'assets'|'subscribe'>,slot:string,overrides:LocalAssetOverrides={}){
 const key=JSON.stringify([slot,overrides]),[state,setState]=useState<{client:typeof client;key:string;asset:LocalAssetResolved|null;url:string|null;error?:string}>();
 useEffect(()=>{let active=true,generation=0,url:string|undefined;const refresh=()=>{const requested=++generation;void client.assets.slot(slot,JSON.parse(key)[1]).then(asset=>{if(!active||requested!==generation)return;const next=asset?URL.createObjectURL(asset.blob):undefined;if(url)URL.revokeObjectURL(url);url=next;setState({client,key,asset,url:next??null});}).catch(reason=>{if(active&&requested===generation){if(url)URL.revokeObjectURL(url);url=undefined;setState({client,key,asset:null,url:null,error:String(reason)});}});};refresh();const off=client.subscribe?.(refresh);return()=>{active=false;generation++;off?.();if(url)URL.revokeObjectURL(url);};},[client,slot,key]);
 return state?.client===client&&state.key===key?{...state,loading:false}:{asset:null,url:null,loading:true,error:undefined};
}

/** Readonly hosts resolve the same declarative preview, without mounting authored controls. */
export function useLocalToolAssetPreview(preview:import('./previewTypes').LocalToolSemanticPreview,projectId:string,namespace:string,eraId?:string){const key=JSON.stringify(preview);const value=useLiveQuery(async()=>{if(!namespace)return JSON.parse(key) as typeof preview;const {captureLocalAssetPreview}=await import('./assetBrowser');return captureLocalAssetPreview(JSON.parse(key),projectId,namespace,{eraId});},[key,projectId,namespace,eraId]);return value??preview;}
