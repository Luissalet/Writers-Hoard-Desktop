import {lazy,Suspense,useCallback,useEffect,useRef,useState} from 'react';
import {useAppStore} from '@/stores/appStore';
import {COMMAND_CENTRE_SHORTCUT,matchesShortcut} from './shortcuts';

const SearchBody=lazy(()=>import('./GlobalSearchBody').then(module=>({default:module.LoadedGlobalSearch})));

/** Keep the shortcut available before the palette's first real request. */
export default function GlobalSearch(){
  const searchOpen=useAppStore(state=>state.searchOpen),[requested,setRequested]=useState(searchOpen),ready=useRef(false);
  const onReady=useCallback((value:boolean)=>{ready.current=value;},[]);
  if(searchOpen&&!requested)setRequested(true);
  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if(ready.current)return;
      const state=useAppStore.getState();
      if(!event.repeat&&matchesShortcut(event,COMMAND_CENTRE_SHORTCUT)){
        event.preventDefault();state.setSearchOpen(!state.searchOpen);
      }else if(event.key==='Escape'&&!event.defaultPrevented&&state.searchOpen){
        state.setSearchOpen(false);
      }
    };
    window.addEventListener('keydown',handler);
    return()=>window.removeEventListener('keydown',handler);
  },[]);
  // The original body stays mounted after its first request, retaining its
  // exit/focus handling, search-index release and route-change lifetimes.
  return requested||searchOpen?<Suspense fallback={null}><SearchBody onReady={onReady}/></Suspense>:null;
}
