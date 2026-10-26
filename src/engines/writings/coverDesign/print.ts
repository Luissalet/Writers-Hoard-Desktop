import type {ReaderPresentation} from '../readerPresentationTypes';
import {COVER_HEIGHT,COVER_SPINE,COVER_SPREAD,COVER_WIDTH} from './model';
import {renderCoverSvg} from './render';
import {pngPrintDensity,jpegPrintDensity} from './printDensity';

export interface PrintCoverLayout { trimWidthMm:number; trimHeightMm:number; spineMm:number; bleedMm:number }
export type PrintCoverFormat='pdf'|'png'|'jpeg';
export interface PrintCoverRaster {
 readonly title:string;readonly src:string;readonly width:number;readonly height:number;readonly dpi:number;
 readonly layoutMm:Readonly<PrintCoverLayout>;readonly boxesPt:Readonly<{media:readonly number[];crop:readonly number[];bleed:readonly number[];trim:readonly number[]}>;
}
export const DEFAULT_PRINT_COVER:PrintCoverLayout={trimWidthMm:152.4,trimHeightMm:228.6,spineMm:0,bleedMm:0};
/** Adobe's documented page compatibility range at UserUnit1; only PDF uses it. */
export function assertPrintPdfPage(media:readonly number[]){
 const width=media[2]-media[0],height=media[3]-media[1];
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||width>14400||height>14400)throw Error(`print_cover_pdf_compatibility_limit:${width}x${height}pt`);
}
export function printCoverGeometry(value:unknown,dpi=300){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('print_cover_layout_invalid');
 const row=value as Record<string,unknown>,keys=['trimWidthMm','trimHeightMm','spineMm','bleedMm']as const;
 if(Object.keys(row).some(key=>!keys.includes(key as typeof keys[number]))||keys.some(key=>typeof row[key]!=='number'||!Number.isFinite(row[key])||Number(row[key])<(key.startsWith('trim')?Number.MIN_VALUE:0))||!Number.isFinite(dpi)||dpi<=0)throw Error('print_cover_layout_invalid');
 const layout=Object.freeze(Object.fromEntries(keys.map(key=>[key,row[key]]))as unknown as PrintCoverLayout),{trimWidthMm:W,trimHeightMm:H,spineMm:S,bleedMm:B}=layout;
 const widthMm=2*W+S+2*B,heightMm=H+2*B,scale=dpi/25.4,width=Math.ceil(widthMm*scale),height=Math.ceil(heightMm*scale),pt=(mm:number)=>mm*72/25.4;
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0||![widthMm,heightMm,pt(widthMm),pt(heightMm)].every(Number.isFinite))throw Error('print_cover_dimensions_unrepresentable');
 const media=Object.freeze([0,0,pt(widthMm),pt(heightMm)]),trim=Object.freeze([pt(B),pt(B),pt(B+2*W+S),pt(B+H)]);
 return{layout,widthMm,heightMm,width,height,scale,dpi,boxesPt:Object.freeze({media,crop:media,bleed:media,trim})};
}
function canvasFor(width:number,height:number){
 const canvas=document.createElement('canvas');
 try{canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');if(canvas.width!==width||canvas.height!==height||!context)throw Error(`print_cover_canvas_unavailable:${width}x${height}`);return{canvas,context};}
 catch(cause){canvas.width=0;canvas.height=0;throw Error(`print_cover_canvas_unavailable:${width}x${height}`,{cause});}
}
type Rectangle={x:number;y:number;width:number;height:number};
/** Extend the nearest edge pixel, including corners; never insert white gutters. */
function extend(context:CanvasRenderingContext2D,source:CanvasImageSource,box:Rectangle,inner:Rectangle,outer:Rectangle){
 const xs=[{s:box.x,n:1,d:outer.x,w:inner.x-outer.x},{s:box.x,n:box.width,d:inner.x,w:inner.width},{s:box.x+box.width-1,n:1,d:inner.x+inner.width,w:outer.x+outer.width-inner.x-inner.width}];
 const ys=[{s:box.y,n:1,d:outer.y,w:inner.y-outer.y},{s:box.y,n:box.height,d:inner.y,w:inner.height},{s:box.y+box.height-1,n:1,d:inner.y+inner.height,w:outer.y+outer.height-inner.y-inner.height}];
 context.save();context.beginPath();context.rect(outer.x,outer.y,outer.width,outer.height);context.clip();
 for(const x of xs)for(const y of ys)if(x.w>0&&y.w>0){context.imageSmoothingEnabled=x.n>1&&y.n>1;context.drawImage(source,x.s,y.s,x.n,y.n,x.d,y.d,x.w,y.w);}
 context.restore();
}
/** A captured opaque raster: no DB reads or authored writes survive this call. */
export async function capturePrintCover(title:string,artwork:string|undefined,cover:ReaderPresentation['cover'],layout:PrintCoverLayout,dpi=300):Promise<PrintCoverRaster>{
 const geometry=printCoverGeometry(layout,dpi),captured=structuredClone(cover),capturedTitle=String(title),capturedArtwork=artwork;
 const svg=renderCoverSvg(capturedTitle,capturedArtwork,captured,'spread'),{trimWidthMm:W,trimHeightMm:H,spineMm:S,bleedMm:B}=geometry.layout,f=geometry.scale;
 // Source density follows the largest proportional panel placement, not a fixed quota.
 const sourceScale=Math.max(1,Math.ceil(Math.max(Math.min(W*f/COVER_WIDTH,H*f/COVER_HEIGHT),S?Math.min(S*f/COVER_SPINE,H*f/COVER_HEIGHT):0))),sourceWidth=COVER_SPREAD*sourceScale,sourceHeight=COVER_HEIGHT*sourceScale;
 if(!Number.isSafeInteger(sourceWidth)||!Number.isSafeInteger(sourceHeight))throw Error('print_cover_dimensions_unrepresentable');
 const buffers:HTMLCanvasElement[]=[];let url:string|undefined;
 try{
  const source=canvasFor(sourceWidth,sourceHeight);buffers.push(source.canvas);
  const trim=canvasFor(Math.ceil((2*W+S)*f),Math.ceil(H*f));buffers.push(trim.canvas);
  const output=canvasFor(geometry.width,geometry.height);buffers.push(output.canvas);
  url=URL.createObjectURL(new Blob([svg.replace(`width="${COVER_SPREAD}" height="${COVER_HEIGHT}"`,`width="${sourceWidth}" height="${sourceHeight}"`)],{type:'image/svg+xml'}));
  const image=new Image();image.src=url;await image.decode();source.context.drawImage(image,0,0,sourceWidth,sourceHeight);
  trim.context.fillStyle=captured.color;trim.context.fillRect(0,0,trim.canvas.width,trim.canvas.height);
  const boundaries=[0,Math.round(W*f),Math.round((W+S)*f),trim.canvas.width];
  for(const[index,panel]of [{x:0,width:COVER_WIDTH},{x:COVER_WIDTH,width:COVER_SPINE},{x:COVER_WIDTH+COVER_SPINE,width:COVER_WIDTH}].entries()){
   const panelWidth=boundaries[index+1]-boundaries[index];if(panelWidth===0)continue;
   // Isolate the face before resampling: drawImage interpolation can otherwise
   // sample a neighbouring face outside its source crop at a fold.
   const isolated=canvasFor(panel.width*sourceScale,sourceHeight),box={x:0,y:0,width:isolated.canvas.width,height:sourceHeight},outer={x:boundaries[index],y:0,width:panelWidth,height:trim.canvas.height},scale=Math.min(outer.width/box.width,outer.height/box.height),innerWidth=Math.max(1,Math.min(outer.width,Math.round(box.width*scale))),innerHeight=Math.max(1,Math.min(outer.height,Math.round(box.height*scale))),inner={x:outer.x+Math.round((outer.width-innerWidth)/2),y:Math.round((outer.height-innerHeight)/2),width:innerWidth,height:innerHeight};
   try{isolated.context.drawImage(source.canvas,panel.x*sourceScale,0,box.width,box.height,0,0,box.width,box.height);extend(trim.context,isolated.canvas,box,inner,outer);}finally{isolated.canvas.width=0;isolated.canvas.height=0;}
  }
  output.context.fillStyle=captured.color;output.context.fillRect(0,0,geometry.width,geometry.height);
  extend(output.context,trim.canvas,{x:0,y:0,width:trim.canvas.width,height:trim.canvas.height},{x:Math.round(B*f),y:Math.round(B*f),width:trim.canvas.width,height:trim.canvas.height},{x:0,y:0,width:geometry.width,height:geometry.height});
  const src=output.canvas.toDataURL('image/png');if(!src.startsWith('data:image/png;base64,'))throw Error(`print_cover_canvas_unavailable:${geometry.width}x${geometry.height}`);
  return Object.freeze({title:capturedTitle,src:pngPrintDensity(src,dpi).dataUrl,width:geometry.width,height:geometry.height,dpi,layoutMm:geometry.layout,boxesPt:geometry.boxesPt});
 }catch(cause){if(cause instanceof Error&&cause.message.startsWith('print_cover_'))throw cause;throw Error(`print_cover_render_failed:${geometry.width}x${geometry.height}`,{cause});}
 finally{if(url)URL.revokeObjectURL(url);for(const canvas of buffers){canvas.width=0;canvas.height=0;}}
}
export async function encodePrintCover(raster:PrintCoverRaster,format:PrintCoverFormat){
 if(!['pdf','png','jpeg'].includes(format))throw Error('print_cover_format_invalid');
 let dataUrl=raster.src,metadataDpi:number|undefined=format==='png'?Math.round(raster.dpi/0.0254)*0.0254:undefined;
 if(format==='pdf'){assertPrintPdfPage(raster.boxesPt.media);dataUrl=await(await import('./printPdf')).printCoverPdf(raster);}
 else if(format==='jpeg'){
  const image=new Image();image.src=raster.src;await image.decode();const{canvas,context}=canvasFor(raster.width,raster.height);
  try{context.drawImage(image,0,0);dataUrl=canvas.toDataURL('image/jpeg',0.95);if(!dataUrl.startsWith('data:image/jpeg;base64,'))throw Error('print_cover_jpeg_unavailable');const density=jpegPrintDensity(dataUrl,raster.dpi);dataUrl=density.dataUrl;metadataDpi=density.metadataDpi;}finally{canvas.width=0;canvas.height=0;}
 }
 return{format,filename:(raster.title.replace(/[<>:"/\\|?*]/g,'_')||'cover')+'-print-cover.'+(format==='jpeg'?'jpg':format),mimeType:format==='pdf'?'application/pdf':`image/${format}`,dataUrl,width:raster.width,height:raster.height,dpi:raster.dpi,...(metadataDpi?{metadataDpi}:{}),layoutMm:raster.layoutMm,boxesPt:raster.boxesPt};
}
