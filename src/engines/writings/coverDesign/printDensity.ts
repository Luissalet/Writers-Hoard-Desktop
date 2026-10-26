function decode(url:string){return Uint8Array.from(atob(url.slice(url.indexOf(',')+1)),character=>character.charCodeAt(0));}
function encode(bytes:Uint8Array,mime:string){let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));return`data:${mime};base64,`+btoa(binary);}
function join(parts:Uint8Array[]){const out=new Uint8Array(parts.reduce((n,part)=>n+part.length,0));let at=0;for(const part of parts){out.set(part,at);at+=part.length;}return out;}
function crc32(bytes:Uint8Array){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
/** Canvas encoders default to 96dpi; write the requested physical sampling metadata. */
export function pngPrintDensity(url:string,dpi:number){
 const density=Math.round(dpi/0.0254);if(!Number.isSafeInteger(density)||density<1||density>0xffffffff)throw Error('print_cover_png_density_unrepresentable');
 const bytes=decode(url),parts=[bytes.subarray(0,8)],chunk=new Uint8Array(21),view=new DataView(chunk.buffer);view.setUint32(0,9);chunk.set([112,72,89,115],4);view.setUint32(8,density);view.setUint32(12,density);chunk[16]=1;view.setUint32(17,crc32(chunk.subarray(4,17)));
 for(let at=8;at<bytes.length;){const length=new DataView(bytes.buffer,bytes.byteOffset+at,4).getUint32(0),end=at+length+12,type=String.fromCharCode(...bytes.subarray(at+4,at+8));if(type!=='pHYs')parts.push(bytes.subarray(at,end));if(type==='IHDR')parts.push(chunk);at=end;}
 return{dataUrl:encode(join(parts),'image/png'),metadataDpi:density*0.0254};
}
export function jpegPrintDensity(url:string,dpi:number){
 const density=Math.round(dpi);if(!Number.isSafeInteger(density)||density<1||density>65535)throw Error('print_cover_jpeg_density_unrepresentable');
 const bytes=decode(url);for(let at=2;at+4<bytes.length;){const marker=bytes[at+1];if(marker===0xda||marker===0xd9)break;const length=(bytes[at+2]<<8)|bytes[at+3];if(marker===0xe0&&String.fromCharCode(...bytes.subarray(at+4,at+9))==='JFIF\0'){bytes[at+11]=1;bytes[at+12]=bytes[at+14]=density>>>8;bytes[at+13]=bytes[at+15]=density&255;return{dataUrl:encode(bytes,'image/jpeg'),metadataDpi:density};}if(length<2)break;at+=length+2;}
 const header=new Uint8Array([255,224,0,16,74,70,73,70,0,1,2,1,density>>>8,density&255,density>>>8,density&255,0,0]);
 return{dataUrl:encode(join([bytes.subarray(0,2),header,bytes.subarray(2)]),'image/jpeg'),metadataDpi:density};
}
