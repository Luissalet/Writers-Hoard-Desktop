import { BrowserWindow, ipcMain, session, nativeImage, type IpcMainInvokeEvent } from 'electron';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DocumentImageCaptureRequest, DocumentImageCaptureResult, DocumentImagePage } from '../src/services/documentImage/types';

const ready = async () => {
  await document.fonts.ready;
  await Promise.all(Array.from(document.images).map(image=>image.complete ? image.naturalWidth ? Promise.resolve() : Promise.reject(new Error('image_decode_failed')) : new Promise<void>((resolve,reject)=>{image.addEventListener('load',()=>resolve(),{once:true});image.addEventListener('error',()=>reject(new Error('image_decode_failed')),{once:true});})));
  await Promise.all(Array.from(document.querySelectorAll('svg image')).map(async element=>{const url=element.getAttribute('href');if(url){const image=new Image();image.src=url;await image.decode();}}));
  await Promise.all(Array.from(document.querySelectorAll('video')).map(async video=>{
    if(video.error)throw new Error('video_decode_failed');
    // Background video can defer decoding until play is requested. Keep it
    // muted, decode once, then seek and pause at the declared initial frame.
    await video.play();video.pause();
    if(video.currentTime!==0)await new Promise<void>((resolve,reject)=>{video.addEventListener('seeked',()=>resolve(),{once:true});video.addEventListener('error',()=>reject(new Error('video_decode_failed')),{once:true});video.currentTime=0;});
    if(video.readyState<2)await new Promise<void>((resolve,reject)=>{video.addEventListener('loadeddata',()=>resolve(),{once:true});video.addEventListener('error',()=>reject(new Error('video_decode_failed')),{once:true});});
  }));
  while(Array.from(document.querySelectorAll<HTMLElement>('[data-wh-model-reader]')).some(element=>{
    const status=element.querySelector('[data-model-status]');if(status?.getAttribute('role')==='alert')throw new Error(status.textContent??'model_failed');return !element.querySelector('canvas')||status?.textContent==='Loading model…'||status?.textContent==='Cargando modelo…';
  }))await new Promise(resolve=>setTimeout(resolve,25));
  const height=Math.max(1,Math.ceil(document.body.getBoundingClientRect().height));
  document.body.style.minHeight=height+'px';
  const graphics=Array.from(document.querySelectorAll('canvas')).map(canvas=>{
    const gl=canvas.getContext('webgl2')??canvas.getContext('webgl');if(!gl)return undefined;
    const info=gl.getExtension('WEBGL_debug_renderer_info');return {vendor:String(gl.getParameter(info?.UNMASKED_VENDOR_WEBGL??gl.VENDOR)),renderer:String(gl.getParameter(info?.UNMASKED_RENDERER_WEBGL??gl.RENDERER))};
  }).find(Boolean);
  return {width:Math.ceil(document.body.scrollWidth),height,graphics};
};
function timeout<T>(work:Promise<T>,ms:number,label:string):Promise<T>{return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(label)),ms);work.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});});}

/** Actual local compositor. No app database, persistent partition or network. */
export async function captureDocumentImage(request:DocumentImageCaptureRequest):Promise<DocumentImageCaptureResult>{
  const {html,width,pixelRatio,pageHeight}=request;
  if(typeof html!=='string'||!Number.isInteger(width)||width<1||!Number.isInteger(pageHeight)||pageHeight<1||!Number.isFinite(pixelRatio)||pixelRatio<=0||width*pixelRatio>16000||pageHeight*pixelRatio>16000)throw new Error('invalid_image_geometry');
  const directory=await mkdtemp(path.join(tmpdir(),'writer-document-image-')),file=path.join(directory,'document.html');
  const isolated=session.fromPartition('document-image-'+randomUUID());
  isolated.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!['file:','data:','blob:','about:'].some(scheme=>details.url.startsWith(scheme))}));
  const win=new BrowserWindow({show:false,webPreferences:{session:isolated,nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  // Initial window placement is constrained to the display on Windows. Resize
  // the content explicitly, then apply zoom after navigation resets its origin.
  win.setContentSize(width*pixelRatio,pageHeight*pixelRatio);
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  try{
    await writeFile(file,html,'utf8');await timeout(win.loadFile(file),30000,'document_load_timeout');
    win.webContents.setZoomFactor(pixelRatio);
    await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    const size=await timeout(win.webContents.executeJavaScript(`(${ready.toString()})()`),45000,'document_assets_timeout') as {width:number;height:number;graphics?:{vendor:string;renderer:string}};
    const pages:DocumentImagePage[]=[];
    for(let y=0;y<size.height;y+=pageHeight)for(let x=0;x<size.width;x+=width){
      const w=Math.min(width,size.width-x),h=Math.min(pageHeight,size.height-y);
      const scroll=await win.webContents.executeJavaScript(`window.scrollTo(${x},${y});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve({x:scrollX,y:scrollY}))))`) as {x:number;y:number};
      const bitmap=await timeout(win.webContents.capturePage({x:Math.round((x-scroll.x)*pixelRatio),y:Math.round((y-scroll.y)*pixelRatio),width:w*pixelRatio,height:h*pixelRatio},{stayHidden:true,stayAwake:true}),30000,'document_capture_timeout');
      const png=bitmap.toPNG();
      const pixels=nativeImage.createFromBuffer(png).getSize();
      if(pixels.width!==w*pixelRatio||pixels.height!==h*pixelRatio)throw new Error('document_capture_geometry_mismatch');
      pages.push({index:pages.length+1,x,y,width:w,height:h,pixelWidth:pixels.width,pixelHeight:pixels.height,dataUrl:'data:image/png;base64,'+png.toString('base64')});
    }
    return {width:size.width,height:size.height,pages,graphics:size.graphics};
  }finally{if(!win.isDestroyed())win.destroy();await unlink(file).catch(()=>{});await rmdir(directory).catch(()=>{});}
}

export function registerDocumentImageIpc(assertSender:(event:IpcMainInvokeEvent,channel:string)=>void):void{
  let queue:Promise<unknown>=Promise.resolve();
  ipcMain.handle('document-image:capture',(event,request:DocumentImageCaptureRequest)=>{
    assertSender(event,'document-image:capture');
    const result=queue.then(()=>captureDocumentImage(request));queue=result.catch(()=>{});return result;
  });
}
