export interface LocalToolFocusSnapshot {readonly available:boolean;readonly active:boolean}
export interface LocalToolFocusMode {getState():LocalToolFocusSnapshot;set(active:boolean):void;toggle():void;subscribe(changed:()=>void):()=>void}
export const unavailableLocalToolFocus:LocalToolFocusSnapshot=Object.freeze({available:false,active:false});
export const inactiveLocalToolFocus:LocalToolFocusSnapshot=Object.freeze({available:true,active:false});
export const activeLocalToolFocus:LocalToolFocusSnapshot=Object.freeze({available:true,active:true});
export type LocalToolFocusCommand={action:'set';active:boolean}|{action:'toggle'};
/** Records author intent only. No UI is mounted or queued. */
export function createRecordingLocalToolFocusMode(){
 const commands:LocalToolFocusCommand[]=[];
 const port:LocalToolFocusMode=Object.freeze({getState:()=>unavailableLocalToolFocus,set:(active:boolean)=>{commands.push({action:'set',active});},toggle:()=>{commands.push({action:'toggle'});},subscribe:()=>()=>{}});
 return{port,commands};
}
