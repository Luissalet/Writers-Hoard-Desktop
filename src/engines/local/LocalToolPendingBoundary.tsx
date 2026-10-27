import {useContext,useId,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {registerPendingFlusher} from '@/services/pendingWrites';
import {LocalToolAtomPendingContext} from './blocks/pending';

/** Report normal SDK editor drafts to the same navigation/save ledger. */
export default function LocalToolPendingBoundary({children}:{children:ReactNode}){
  const parent=useContext(LocalToolAtomPendingContext),id=useId(),tokens=useRef(new Set<string>()),[hasPending,setHasPending]=useState(false);
  const report=useMemo(()=>(token:string,value:boolean)=>{if(value)tokens.current.add(token);else tokens.current.delete(token);setHasPending(tokens.current.size>0);parent?.(token,value);},[parent]);
  useLayoutEffect(()=>hasPending?registerPendingFlusher('local-tool-draft-'+id,async()=>tokens.current.size===0,true):undefined,[hasPending,id]);
  return <LocalToolAtomPendingContext.Provider value={report}>{children}</LocalToolAtomPendingContext.Provider>;
}
