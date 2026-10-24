/** Copied raster bytes belong to this place style, independently of Gallery. */
export interface PlaceImageDescriptor {dataUrl:string;mode:'colour'|'inked'}
export const PLACE_IMAGE_MAX_BYTES=5*1024*1024;
const raster=/^data:image\/(png|jpe?g|webp|gif|avif|bmp);base64,([a-z\d+/=\s]+)$/i;
/** Pure public boundary shared by inspector and MCP; actual decoding belongs to the host. */
export function normalizePlaceImage(value:unknown):PlaceImageDescriptor|null{
 if(value===null)return null;
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Place image must contain raster dataUrl and mode.');
 const input=value as Record<string,unknown>;
 if(Object.keys(input).some(key=>key!=='dataUrl'&&key!=='mode')||typeof input.dataUrl!=='string'||(input.mode!=='colour'&&input.mode!=='inked'))throw new Error('Invalid place image properties.');
 const match=raster.exec(input.dataUrl);if(!match)throw new Error('Place image must be a local raster data URL.');
 const payload=match[2].replace(/\s/g,'');
 if(!payload.length||payload.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(payload))throw new Error('Invalid raster base64.');
 const padding=payload.endsWith('==')?2:payload.endsWith('=')?1:0,bytes=payload.length/4*3-padding;
 if(bytes>PLACE_IMAGE_MAX_BYTES)throw new Error('Place image exceeds 5 MiB.');
 // Non-zero unused bits admit different encodings of the same byte payload.
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
 if((padding===2&&(alphabet.indexOf(payload[payload.length-3])&15)!==0)||(padding===1&&(alphabet.indexOf(payload[payload.length-2])&3)!==0))throw new Error('Invalid raster base64 padding.');
 return{dataUrl:`data:image/${match[1].toLowerCase()==='jpg'?'jpeg':match[1].toLowerCase()};base64,${payload}`,mode:input.mode};
}
/** Runtime-neutral bytes: no DOM, Buffer, fetch, database or loader at import. */
export function placeImageBytes(descriptor:PlaceImageDescriptor):Uint8Array{
 const image=normalizePlaceImage(descriptor)!;const payload=image.dataUrl.slice(image.dataUrl.indexOf(',')+1),alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
 const padding=payload.endsWith('==')?2:payload.endsWith('=')?1:0,result=new Uint8Array(payload.length/4*3-padding);let offset=0;
 for(let i=0;i<payload.length;i+=4){const bits=(alphabet.indexOf(payload[i])<<18)|(alphabet.indexOf(payload[i+1])<<12)|((payload[i+2]==='='?0:alphabet.indexOf(payload[i+2]))<<6)|(payload[i+3]==='='?0:alphabet.indexOf(payload[i+3]));if(offset<result.length)result[offset++]=bits>>>16;if(offset<result.length)result[offset++]=bits>>>8&255;if(offset<result.length)result[offset++]=bits&255;}
 return result;
}
