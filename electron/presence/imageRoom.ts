import type {IncomingMessage} from 'node:http';
import {createHash} from 'node:crypto';
import {MAX_PROJECT_MEDIA_BYTES} from '../../src/engines/media/types';
import {isCompletePng} from '../../src/services/imageMetadata';
import type {RichImageAsset} from '../../src/engines/local/convergence/imageFormat';

export type ImageBudget={used:number};

/** Binary files live only as long as the room or a current publisher's offer. */
export class RoomImages {
 private readonly files=new Map<string,Buffer>();
 private readonly offers=new Map<string,Map<string,RichImageAsset>>();
 private readonly budget:ImageBudget;
 private published:Map<string,RichImageAsset>;
 constructor(budget:ImageBudget,initial:readonly RichImageAsset[]){this.budget=budget;this.published=new Map(initial.map(asset=>[asset.sha256,asset]));}
 missing(assets:Iterable<RichImageAsset>=this.published.values()){
  return [...assets].filter(asset=>this.files.get(asset.sha256)?.byteLength!==asset.size);
 }
 offer(lease:string,assets:readonly RichImageAsset[]){
  this.offers.set(lease,new Map(assets.filter(asset=>!this.published.has(asset.sha256)).map(asset=>[asset.sha256,asset])));
  this.prune();
 }
 admit(lease:string,assets:readonly RichImageAsset[]){
  const next=new Map(assets.map(asset=>[asset.sha256,asset]));
  for(const [sha,asset]of this.published)if(next.get(sha)?.size!==asset.size)throw Error('local_tool_image_fields_invalid');
  this.published=next;this.retire(lease);
 }
 retire(lease:string){if(this.offers.delete(lease))this.prune();}
 uploadTarget(lease:string,sha:string,bootstrap:boolean){return bootstrap?this.published.get(sha):this.offers.get(lease)?.get(sha);}
 read(sha:string){return this.published.has(sha)?this.files.get(sha):undefined;}
 private prune(){
  for(const [sha,bytes]of this.files)if(!this.published.has(sha)&&![...this.offers.values()].some(offer=>offer.has(sha))){this.files.delete(sha);this.budget.used-=bytes.length;}
 }
 dispose(){for(const bytes of this.files.values())this.budget.used-=bytes.length;this.files.clear();this.offers.clear();this.published.clear();}

 async store(req:IncomingMessage,asset:RichImageAsset,current:()=>boolean){
  if(req.headers['content-type']!==asset.mime||req.headers['content-length']!==String(asset.size))throw Error('local_asset_image_invalid');
  if(this.budget.used+asset.size>MAX_PROJECT_MEDIA_BYTES)throw Error('local_asset_capacity');
  this.budget.used+=asset.size;let keep=false;
  try {
   const bytes=Buffer.allocUnsafe(asset.size);let read=0;
   for await(const chunk of req){if(!current()||!Buffer.isBuffer(chunk)||read+chunk.length>bytes.length)throw Error('local_asset_image_invalid');chunk.copy(bytes,read);read+=chunk.length;}
   if(!current())throw Error('presence_lease_expired');
   if(read!==asset.size||createHash('sha256').update(bytes).digest('hex')!==asset.sha256||!isCompletePng(bytes))throw Error('local_asset_image_invalid');
   const existing=this.files.get(asset.sha256);if(existing){if(existing.length!==asset.size)throw Error('local_asset_image_invalid');return;}
   this.files.set(asset.sha256,bytes);keep=true;
  } finally {if(!keep)this.budget.used-=asset.size;}
 }
}
