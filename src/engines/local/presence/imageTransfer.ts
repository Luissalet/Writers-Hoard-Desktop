import type {LocalToolAssets} from '../assets';
import {validateRichImageAsset,type RichImageAsset} from '../convergence/imageFormat';

export interface ImageRoomLease {roomId:string;instanceId:string;epoch:string}
type Connection={connectionId:string;token:string};

export async function requestRoomImage(origin:string,connection:Connection,lease:ImageRoomLease,asset:RichImageAsset,body?:Blob){
 const query=new URLSearchParams({roomId:lease.roomId,instanceId:lease.instanceId,epoch:lease.epoch});
 const response=await fetch(`${origin}/__wh_presence/image/${asset.sha256}?${query}`,{
  method:body?'PUT':'GET',headers:{'x-writer-connection':connection.connectionId,Authorization:`Bearer ${connection.token}`,...(body?{'Content-Type':asset.mime}:{})},body,
 });
 if(!response.ok){const detail=await response.json().catch(()=>null);throw Error(detail?.error??'local_asset_image_unavailable');}
 return response;
}

export async function sendRoomImages(required:unknown,assets:LocalToolAssets|undefined,current:()=>Promise<boolean>,send:(asset:RichImageAsset,blob:Blob)=>Promise<Response>){
 if(!Array.isArray(required)||!required.length||!assets)throw Error('local_asset_image_unavailable');
 for(const asset of required){
  validateRichImageAsset(asset);
  if(!await current())throw Error('presence_host_unavailable');
  const resolved=await assets.resolveImage(asset);
  if(!await current())throw Error('presence_host_unavailable');
  if(!resolved)throw Error('local_asset_image_unavailable');
  await (await send(asset,resolved.blob)).json();
  if(!await current())throw Error('presence_host_unavailable');
 }
}

export async function receiveRoomImage(asset:RichImageAsset,assets:LocalToolAssets,current:()=>Promise<boolean>,download:()=>Promise<Response>){
 if(!await current())throw Error('presence_host_unavailable');
 const local=await assets.resolveImage(asset);
 if(!await current())throw Error('presence_host_unavailable');
 if(local)return;
 const response=await download();
 if(response.headers.get('Content-Type')!==asset.mime||response.headers.get('Content-Length')!==String(asset.size)){
  await response.body?.cancel();throw Error('local_asset_image_invalid');
 }
 const bytes=await response.arrayBuffer();
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
 if(bytes.byteLength!==asset.size||hash!==asset.sha256)throw Error('local_asset_image_invalid');
 if(!await current())throw Error('presence_host_unavailable');
 await assets.import(new File([bytes],`image-${asset.sha256.slice(0,12)}.png`,{type:asset.mime}),'image');
 if(!await current())throw Error('presence_host_unavailable');
}
