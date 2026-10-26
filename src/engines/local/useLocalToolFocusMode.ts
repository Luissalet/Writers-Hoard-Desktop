import {useCallback,useSyncExternalStore} from 'react';
import {unavailableLocalToolFocus,type LocalToolFocusMode} from './focusMode';
const subscribe=()=>()=>{},getState=()=>unavailableLocalToolFocus;
/** Mutators retain their original UI port; absent and revoked hosts are inert. */
export function useLocalToolFocusMode(context?:{focusMode?:LocalToolFocusMode}){
 const port=context?.focusMode,state=useSyncExternalStore(port?.subscribe??subscribe,port?.getState??getState,getState);
 const set=useCallback((active:boolean)=>{port?.set(active);},[port]),toggle=useCallback(()=>{port?.toggle();},[port]);
 return{...state,set,toggle};
}
