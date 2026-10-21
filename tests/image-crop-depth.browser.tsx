import {act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import ImagePreviewCrop from '@/components/common/ImagePreviewCrop';
import {useLocaleStore} from '@/stores/localeStore';

const state=window as unknown as {__want:unknown;__sizeAck?:number;__native:unknown;__nativeAck?:number;__shot:unknown;__shotDone?:string};
const pause=()=>new Promise(resolve=>setTimeout(resolve,35));let sequence=0;
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
async function wait(check:()=>boolean){for(let i=0;i<220;i++){if(check())return;await pause();}throw Error('Crop UI handshake did not settle');}
async function native(events:unknown[]){const n=++sequence;await act(async()=>{state.__native={n,events};await wait(()=>state.__nativeAck===n);await pause();});}
async function click(node:HTMLElement){assert(node,'Missing native crop action');const r=node.getBoundingClientRect();const p={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),button:'left',clickCount:1};await native([{type:'mouseMove',x:p.x,y:p.y},{type:'mouseDown',...p},{type:'mouseUp',...p}]);}
function load(src:string){return new Promise<HTMLImageElement>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=src;});}
export async function testImageCropDepth(){
 const root=createRoot(document.getElementById('root')!),results:string[]=[];
 const canvas=document.createElement('canvas');canvas.width=240;canvas.height=160;const ctx=canvas.getContext('2d')!;
 for(const [x,y,color]of [[0,0,'#ff0000'],[120,0,'#00ff00'],[0,80,'#0000ff'],[120,80,'#ffff00']]as const){ctx.fillStyle=color;ctx.fillRect(x,y,120,80);}
 const original=canvas.toDataURL('image/png');let confirmed:{cropped:string;original:string}|undefined;
 function Harness(){const [src,setSrc]=useState<string|null>(original);return <><ImagePreviewCrop imageSrc={src} onCancel={()=>setSrc(null)} onConfirm={(cropped,source)=>{confirmed={cropped,original:source};setSrc(null);}}/>{confirmed&&<img alt="Confirmed image" src={confirmed.cropped}/>}</>;}
 try{
  useLocaleStore.setState({locale:'en'});
  for(const width of [1440,640]){
   const n=++sequence;await act(async()=>{state.__want={w:width,h:1000,n};await wait(()=>state.__sizeAck===n);root.render(<Harness key={width}/>);await pause();});
   await act(async()=>{await wait(()=>!!document.querySelector<HTMLImageElement>('.ReactCrop img')?.complete);});
   const button=(text:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.trim()===text)!;
   await click(button('Rotate'));
   const shot=`image-crop-rotated-${width}`;await act(async()=>{state.__shot={name:shot};await wait(()=>state.__shotDone===shot);});
   await click(button('Attach'));
   await act(async()=>{await wait(()=>!!confirmed);});
   assert(confirmed!.original===original,'Rotation changed the original image bytes');
   const output=await load(confirmed!.cropped);
   assert(output.naturalWidth===160&&output.naturalHeight===240,`Rotate90 then Attach saved ${output.naturalWidth}x${output.naturalHeight}; expected160x240`);
   const check=document.createElement('canvas');check.width=160;check.height=240;const pixels=check.getContext('2d')!;pixels.drawImage(output,0,0);
   const corners=[[20,20,[0,0,255]],[140,20,[255,0,0]],[20,220,[255,255,0]],[140,220,[0,255,0]]]as const;
   for(const [x,y,rgb]of corners){const actual=pixels.getImageData(x,y,1,1).data;assert(rgb.every((value,i)=>Math.abs(value-actual[i])<15),`Rotated corner${x},${y} incorrect:${[...actual]}`);}
   results.push(`Native${width}: rotate90 then attach preserves actual orientation/corners and exact original bytes`);
   confirmed=undefined;
  }
  return results;
 }finally{await act(async()=>root.unmount());}
}

export async function testImageCropSelectionDepth(){
 const trace:unknown[]=[];const traceEvent=(e:PointerEvent)=>trace.push({type:e.type,x:e.clientX,y:e.clientY,buttons:e.buttons,target:(e.target as Element)?.tagName});document.addEventListener('pointerup',traceEvent,true);document.addEventListener('pointercancel',traceEvent,true);
 const root=createRoot(document.getElementById('root')!),results:string[]=[];
 const canvas=document.createElement('canvas');canvas.width=240;canvas.height=160;const ctx=canvas.getContext('2d')!;
 for(const [x,y,color]of [[0,0,'#ff0000'],[120,0,'#00ff00'],[0,80,'#0000ff'],[120,80,'#ffff00']]as const){ctx.fillStyle=color;ctx.fillRect(x,y,120,80);}
 const original=canvas.toDataURL();let confirmed:{cropped:string;original:string}|undefined;
 function Harness(){const [src,setSrc]=useState<string|null>(original);return <ImagePreviewCrop imageSrc={src} onCancel={()=>setSrc(null)} onConfirm={(cropped,source)=>{confirmed={cropped,original:source};setSrc(null);}}/>;}
 try{
  useLocaleStore.setState({locale:'en'});
  for(const width of [1440,640])for(const zoom of [1,1.5]){
   confirmed=undefined;const n=++sequence;
   await act(async()=>{state.__want={w:width,h:1000,n};await wait(()=>state.__sizeAck===n);root.render(<Harness key={`${width}-${zoom}`}/>);await pause();});
   await act(async()=>{await wait(()=>!!document.querySelector<HTMLImageElement>('.ReactCrop img')?.complete);});
   const button=(text:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.trim()===text)!;
   await click(button('Rotate'));
   if(zoom!==1){const slider=document.querySelector<HTMLInputElement>('input[type="range"]')!;await click(slider);for(const keyCode of ['Home',...Array.from({length:20},()=> 'Right')])await native([{type:'keyDown',keyCode},{type:'keyUp',keyCode}]);assert(Number(slider.value)===zoom,`Native zoom expected${zoom},got${slider.value}`);}
   const img=document.querySelector<HTMLImageElement>('.ReactCrop img')!,rect=img.getBoundingClientRect();
   const x=Math.round(rect.x+10),y=Math.round(rect.y+rect.height/2-50);
   await native([{type:'mouseMove',x,y},{type:'mouseDown',x,y,button:'left',clickCount:1}]);
   for(const i of [1,2,3,4,5])await native([{type:'mouseMove',x:x+i*10,y:y+i*6,button:'left',modifiers:['leftButtonDown']}]);
   await native([{type:'mouseUp',x:x+50,y:y+30,button:'left',clickCount:1}]);
   const selection=document.querySelector<HTMLElement>('.ReactCrop__crop-selection');assert(selection,'Native pointer did not create a crop');
   const crop=selection.getBoundingClientRect();assert(Math.abs(crop.width-50)<2&&Math.abs(crop.height-30)<2,`Unexpected native crop ${crop.width}x${crop.height}`);
   const shot=`image-crop-selection-${width}-${zoom}`;await act(async()=>{state.__shot={name:shot};await wait(()=>state.__shotDone===shot);});
   await click(button('Attach'));await act(async()=>{await wait(()=>!!confirmed);});
   assert(confirmed!.original===original,'Crop changed original bytes');assert(confirmed!.cropped.startsWith('data:image/jpeg;base64,'),`Crop produced invalid image:${confirmed!.cropped.slice(0,80)}; selected${crop.width}x${crop.height}; image${img.width}x${img.height}/${img.naturalWidth}x${img.naturalHeight};trace${JSON.stringify(trace)}`);const output=await load(confirmed!.cropped);
   assert(Math.abs(output.naturalWidth-50)<=1&&Math.abs(output.naturalHeight-30)<=1,`Crop output${output.naturalWidth}x${output.naturalHeight} disagrees with selected50x30 at zoom${zoom}`);
   const check=document.createElement('canvas');check.width=output.naturalWidth;check.height=output.naturalHeight;const pixels=check.getContext('2d')!;pixels.drawImage(output,0,0);const rgb=pixels.getImageData(10,10,1,1).data;
   assert(rgb[2]>240&&rgb[0]<15&&rgb[1]<15,`Selected blue pixels saved as${[...rgb]} at zoom${zoom}`);
   results.push(`Native${width}: crop after rotation at zoom${zoom} matches selected dimensions/pixels and original bytes`);
  }
  return results;
 }finally{document.removeEventListener('pointerup',traceEvent,true);document.removeEventListener('pointercancel',traceEvent,true);await act(async()=>root.unmount());}
}
