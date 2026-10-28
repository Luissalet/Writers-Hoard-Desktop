import {testSourceConvergenceControls} from './local-tool-convergence-controls.browser';

const channel=window as unknown as {__want?:{w:number;h:number;n:number}|null;__sizeAck?:number;__shot?:{name:string;forcePaint:true}|null;__shotDone?:string};
const pause=()=>new Promise(resolve=>setTimeout(resolve,30));
async function wait(check:()=>boolean,message:string){const end=Date.now()+12000;while(Date.now()<end){if(check())return;await pause();}throw Error(message);}

/** Same public Source/Dexie/Tiptap body; the existing UI runner owns CSS, resize and screenshots. */
export async function testLocalToolConvergenceControlsLayout(){
 const passed:string[]=[],traces:{width:number;observations:unknown[];result?:unknown;failure?:unknown}[]=[];let sequence=0;
 Reflect.set(window,'__source62ControlsLayoutTraces',traces);
 for(const width of[1280,390]){
  const trace:{width:number;observations:unknown[];result?:unknown;failure?:unknown}={width,observations:[]};traces.push(trace);
  try{
   const n=++sequence;channel.__want={w:width,h:900,n};await wait(()=>channel.__sizeAck===n,'SOURCE62_CONTROLS_RESIZE_ACK_'+width);
   if(innerWidth!==width||innerHeight!==900)throw Error('SOURCE62_CONTROLS_VIEWPORT_HEALTH_'+innerWidth+'x'+innerHeight+' expected '+width+'x900');
   const result=await testSourceConvergenceControls(value=>{
    trace.observations.push(value);Reflect.set(window,'__testStage','source62-controls-'+width+'-'+String((value as {phase?:string})?.phase??'observation'));
   },async label=>{
    const name='source62-controls-'+width+'-'+label;channel.__shot={name,forcePaint:true};await wait(()=>channel.__shotDone===name,'SOURCE62_CONTROLS_CAPTURE_ACK_'+name);
   });
   trace.result=result;
   if(!result.ok)throw Error('SOURCE62_CONTROLS_FAILED_'+width+' '+(result.error?.stack??result.error?.message??result.phase));
   for(const check of result.checks)passed.push(width+'px: '+check);
  }catch(error){
   trace.failure={message:String(error),stack:(error as Error).stack};
   // The normal runner forwards console errors. Preserve all actual prior DB/DOM
   // observations even though its final rejection prints only the error stack.
   console.error('SOURCE62_CONTROLS_LAYOUT_FAILURE '+JSON.stringify({width,traces}));throw error;
  }
 }
 return passed;
}
