import {act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import ImagePreviewCrop from '@/components/common/ImagePreviewCrop';
import {useLocaleStore} from '@/stores/localeStore';

const state=window as unknown as {__want:unknown;__sizeAck?:number;__native:unknown;__nativeAck?:number;__shot:unknown;__shotDone?:string};
let sequence=0;
const pause=(ms=35)=>new Promise(resolve=>setTimeout(resolve,ms));
function assert(value:unknown,message:string):asserts value {if(!value)throw Error(message);}
async function wait(check:()=>boolean){for(let i=0;i<220;i++){if(check())return;await pause();}throw Error('Independent crop handshake timed out');}
async function native(events:unknown[]){const n=++sequence;await act(async()=>{state.__native={n,events};await wait(()=>state.__nativeAck===n);});}
async function click(node:HTMLElement){assert(node,'Missing action');const r=node.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);await native([{type:'mouseMove',x,y},{type:'mouseDown',x,y,button:'left',clickCount:1},{type:'mouseUp',x,y,button:'left',clickCount:1}]);}
const button=(text:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(n=>n.textContent?.trim()===text)!;
function load(src:string){return new Promise<HTMLImageElement>((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=src;});}
async function shot(name:string){await act(async()=>{state.__shot={name,forcePaint:true};await wait(()=>state.__shotDone===name);});}

export async function testImageCropIndependent(){
 const root=createRoot(document.getElementById('root')!),results:string[]=[];
 const source=document.createElement('canvas');source.width=240;source.height=160;const context=source.getContext('2d')!;
 for(const [x,y,color]of [[0,0,'#ff0000'],[120,0,'#00ff00'],[0,80,'#0000ff'],[120,80,'#ffff00']]as const){context.fillStyle=color;context.fillRect(x,y,120,80);}
 const original=source.toDataURL();let confirmed:{cropped:string;original:string}|undefined;
 function Harness(){const [src,setSrc]=useState<string|null>(original);return <><ImagePreviewCrop imageSrc={src} onCancel={()=>setSrc(null)} onConfirm={(cropped,source)=>{confirmed={cropped,original:source};setSrc(null);}}/>{confirmed&&<div style={{padding:24,color:'white'}}><p>Independent confirmed crop</p><img alt="Confirmed crop" src={confirmed.cropped} style={{width:250,height:150,imageRendering:'pixelated'}}/><img alt="Original quadrants" src={original} style={{width:240,height:160,marginLeft:32}}/></div>}</>;}
 try{
  useLocaleStore.setState({locale:'en'});
  for(const width of [1440,640])for(const angle of [180,270])for(const zoom of [1,1.5])for(const mode of ['full','selected','reset']){
   confirmed=undefined;const n=++sequence,key=`${width}-${angle}-${zoom}-${mode}`;
   await act(async()=>{state.__want={w:width,h:1000,n};await wait(()=>state.__sizeAck===n);root.render(<Harness key={key}/>);await pause();});
   await act(async()=>{await wait(()=>!!document.querySelector<HTMLImageElement>('.ReactCrop img')?.complete);await pause(200);});
   for(let i=0;i<angle/90;i++)await click(button('Rotate'));
   if(zoom!==1){const slider=document.querySelector<HTMLInputElement>('input[type="range"]')!;await click(slider);for(const keyCode of ['Home',...Array.from({length:20},()=> 'Right')])await native([{type:'keyDown',keyCode},{type:'keyUp',keyCode}]);assert(Number(slider.value)===zoom,'Native zoom did not settle');}
   if(mode!=='full'){
    const image=document.querySelector<HTMLImageElement>('.ReactCrop img')!.getBoundingClientRect(),layout=document.querySelector<HTMLElement>('.ReactCrop')!.getBoundingClientRect();
    const x=Math.round(Math.max(image.left,layout.left)+12),y=Math.round(Math.max(image.top,layout.top)+12);
    await native([{type:'mouseMove',x,y},{type:'mouseDown',x,y,button:'left',clickCount:1}]);
    for(let i=1;i<=5;i++)await native([{type:'mouseMove',x:x+i*10,y:y+i*6,button:'left',modifiers:['leftButtonDown']}]);
    await native([{type:'mouseUp',x:x+50,y:y+30,button:'left',clickCount:1}]);
    const selected=document.querySelector<HTMLElement>('.ReactCrop__crop-selection')?.getBoundingClientRect();assert(selected&&Math.abs(selected.width-50)<2&&Math.abs(selected.height-30)<2,`Selection mismatch ${key}`);
    if(mode==='reset'){await click(button('Reset'));const reset=document.querySelector<HTMLElement>('.ReactCrop__crop-selection')!.getBoundingClientRect();assert(Math.abs(reset.width-216)<2&&Math.abs(reset.height-144)<2,`Reset failed to replace selection ${key}`);}
   }
   if(angle===270&&zoom===1.5&&mode==='selected')await shot(`independent-crop-selection-${width}`);
   await click(button('Attach'));await act(async()=>{await wait(()=>!!confirmed);});
   assert(confirmed!.original===original,`Original bytes changed ${key}`);
   const output=await load(confirmed!.cropped),expected=mode==='selected'?[50,30]:mode==='reset'?[216,144]:angle===180?[240*zoom,160*zoom]:[160*zoom,240*zoom];
   assert(Math.abs(output.naturalWidth-expected[0])<=1&&Math.abs(output.naturalHeight-expected[1])<=1,`Dimensions ${output.naturalWidth}x${output.naturalHeight}, expected ${expected} (${key})`);
   const check=document.createElement('canvas');check.width=output.naturalWidth;check.height=output.naturalHeight;const pixels=check.getContext('2d')!;pixels.drawImage(output,0,0);
   const colors=angle===180?[[255,255,0],[0,0,255],[0,255,0],[255,0,0]]:[[0,255,0],[255,255,0],[255,0,0],[0,0,255]];
   const points=mode==='selected'?[[10,10]]:mode==='reset'?[[60,30],[156,30],[60,114],[156,114]]:[[20,20],[output.naturalWidth-20,20],[20,output.naturalHeight-20],[output.naturalWidth-20,output.naturalHeight-20]];
   points.forEach(([x,y],i)=>{const actual=pixels.getImageData(x,y,1,1).data;assert(colors[i].every((v,c)=>Math.abs(v-actual[c])<18),`Pixel ${x},${y}: ${[...actual]}, expected ${colors[i]} (${key})`);});
   if(angle===270&&zoom===1.5&&mode==='selected'){
    await act(async()=>{await pause(400);});
    await wait(()=>!document.querySelector('.ReactCrop'));
    await shot(`independent-crop-confirmed-${width}`);
   }
   results.push(`${key}: visible selection/output dimensions, oriented pixels and exact original agree`);
  }
  return results;
 }finally{await act(async()=>root.unmount());}
}
