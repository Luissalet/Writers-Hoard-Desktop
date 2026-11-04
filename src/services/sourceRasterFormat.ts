import {isCompletePng} from './imageMetadata';

export const SOURCE_RASTER_MIMES=['image/png','image/jpeg','image/webp'] as const;
export type SourceRasterMime=typeof SOURCE_RASTER_MIMES[number];
export const isSourceRasterMime=(value:unknown):value is SourceRasterMime=>
 typeof value==='string'&&SOURCE_RASTER_MIMES.some(mime=>mime===value);

const uint16be=(bytes:Uint8Array,at:number)=>(bytes[at]<<8)|bytes[at+1];
const uint16le=(bytes:Uint8Array,at:number)=>bytes[at]|bytes[at+1]<<8;

/** Walk JPEG marker segments, including stuffed bytes and restarts inside scans. */
function isCompleteJpeg(bytes:Uint8Array):boolean {
 if(uint16be(bytes,0)!==0xffd8)return false;
 let at=2,frame=false,scan=false,inScan=false,scanData=false;
 while(at<bytes.length){
  if(bytes[at++]!==0xff){if(!inScan)return false;scanData=true;continue;}
  while(bytes[at]===0xff)at++;
  const marker=bytes[at++];
  if(inScan&&marker===0){scanData=true;continue;}
  if(inScan&&marker>=0xd0&&marker<=0xd7)continue;
  if(inScan&&!scanData)return false;
  inScan=false;
  if(marker===0xd9)return frame&&scan&&at===bytes.length;
  if(marker<0xc0||marker===0xd8||marker>=0xd0&&marker<=0xd7||at+2>bytes.length)return false;
  const length=uint16be(bytes,at),end=at+length;
  if(length<2||end>bytes.length)return false;
  const startOfFrame=marker<=0xcf&&marker!==0xc4&&marker!==0xc8&&marker!==0xcc;
  if(startOfFrame){
   if(frame||length<11||!uint16be(bytes,at+3)||!uint16be(bytes,at+5)||length!==8+3*bytes[at+7])return false;
   frame=true;
  }
  if(marker===0xda){
   if(!frame||length<8||length!==6+2*bytes[at+2])return false;
   scan=true;inScan=true;scanData=false;
  }
  at=end;
 }
 return false;
}

const uint32le=(bytes:Uint8Array,at:number)=>(bytes[at]|bytes[at+1]<<8|bytes[at+2]<<16|bytes[at+3]<<24)>>>0;
const fourCC=(bytes:Uint8Array,at:number)=>String.fromCharCode(bytes[at],bytes[at+1],bytes[at+2],bytes[at+3]);

interface RiffChunk {name:string;start:number;size:number;next:number}
function riffChunk(bytes:Uint8Array,at:number,end:number):RiffChunk|undefined {
 if(at+8>end)return;
 const start=at+8,size=uint32le(bytes,at+4),next=start+size+(size&1);
 if(next>end||size%2&&bytes[next-1]!==0)return;
 return {name:fourCC(bytes,at),start,size,next};
}

function isWebpBitstream(bytes:Uint8Array,{name,start,size}:RiffChunk):boolean {
 if(name==='VP8L')return size>5&&bytes[start]===0x2f&&(bytes[start+4]&0xe0)===0;
 return name==='VP8 '&&size>10&&(bytes[start]&1)===0&&bytes[start+3]===0x9d&&bytes[start+4]===1&&bytes[start+5]===0x2a&&
  (uint16le(bytes,start+6)&0x3fff)!==0&&(uint16le(bytes,start+8)&0x3fff)!==0;
}

function isWebpFrame(bytes:Uint8Array,{start,size}:RiffChunk):boolean {
 const end=start+size;
 let at=start+16,hasImage=false,hasAlpha=false;
 while(at<end){
  const chunk=riffChunk(bytes,at,end);
  if(!chunk)return false;
  if(chunk.name==='ALPH'){
   if(hasImage||hasAlpha||chunk.size<2)return false;
   hasAlpha=true;
  }else if(chunk.name==='VP8 '||chunk.name==='VP8L'){
   if(hasImage||hasAlpha&&chunk.name==='VP8L'||!isWebpBitstream(bytes,chunk))return false;
   hasImage=true;
  }
  at=chunk.next;
 }
 return hasImage;
}

/** Validate the complete WebP RIFF envelope and its image/frame chunk bounds. */
function isCompleteWebp(bytes:Uint8Array):boolean {
 if(bytes.length<20||fourCC(bytes,0)!=='RIFF'||fourCC(bytes,8)!=='WEBP'||uint32le(bytes,4)!==bytes.length-8)return false;
 let at=12,animated=false,animationHeader=false,frames=0,hasImage=false;
 while(at<bytes.length){
  const chunk=riffChunk(bytes,at,bytes.length);
  if(!chunk)return false;
  if(chunk.name==='VP8X'){
   if(at!==12||chunk.size!==10)return false;
   animated=(bytes[chunk.start]&2)!==0;
  }else if(chunk.name==='ANIM'){
   if(!animated||animationHeader||chunk.size!==6)return false;
   animationHeader=true;
  }else if(chunk.name==='ANMF'){
   if(!animationHeader||!isWebpFrame(bytes,chunk))return false;
   frames++;
  }else if(chunk.name==='VP8 '||chunk.name==='VP8L'){
   if(animated||hasImage||!isWebpBitstream(bytes,chunk))return false;
   hasImage=true;
  }
  at=chunk.next;
 }
 return animated?frames>0:hasImage;
}

export function detectSourceRasterMime(bytes:Uint8Array):SourceRasterMime|undefined {
 if(isCompletePng(bytes))return 'image/png';
 if(isCompleteJpeg(bytes))return 'image/jpeg';
 if(isCompleteWebp(bytes))return 'image/webp';
}
