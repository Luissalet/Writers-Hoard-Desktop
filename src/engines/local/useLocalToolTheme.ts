import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {localToolThemeColorTokens,type LocalToolThemeSnapshot,type LocalToolThemeSource} from './themes';

export interface LocalToolThemeView{snapshot?:LocalToolThemeSnapshot;available:boolean;loading:boolean;error:string;retry():void}
interface ThemeClient{readonly theme?:LocalToolThemeSource}
interface View{token:object;snapshot?:LocalToolThemeSnapshot;loading:boolean;error:string}
interface Binding{token:object;active:boolean;sequence:number;view:View;read():void}
const same=(a:LocalToolThemeSnapshot|undefined,b:LocalToolThemeSnapshot)=>!!a&&a.projectId===b.projectId&&a.eraId===b.eraId&&a.mode===b.mode&&localToolThemeColorTokens.every(key=>a.tokens[key]===b.tokens[key]);
/** Data reads do not promise that a visual host has already applied its CSS. */
export function useLocalToolTheme(client?:ThemeClient):LocalToolThemeView{
 const source=client?.theme,token=useMemo(()=>({client,source}),[client,source]);
 const owner=useRef<Binding>(undefined),[view,setView]=useState<View>();
 useLayoutEffect(()=>{
  const binding:Binding={token,active:true,sequence:0,view:{token,loading:!!source,error:''},read:()=>{}};
  owner.current=binding;
  const publish=(next:View)=>{if(!binding.active||owner.current!==binding)return;binding.view=next;setView(next);};
  binding.read=()=>{
   if(!source||!binding.active||owner.current!==binding)return;
   const sequence=++binding.sequence;publish({...binding.view,loading:true});
   void Promise.resolve().then(()=>source.get()).then(snapshot=>{
    if(!binding.active||owner.current!==binding||sequence!==binding.sequence)return;
    publish({token,snapshot:same(binding.view.snapshot,snapshot)?binding.view.snapshot:snapshot,loading:false,error:''});
   }).catch(reason=>{
    if(binding.active&&owner.current===binding&&sequence===binding.sequence)publish({...binding.view,loading:false,error:reason instanceof Error?reason.message:String(reason)});
   });
  };
  if(source)publish(binding.view);
  return()=>{binding.active=false;binding.sequence++;};
 },[source,token]);
 useEffect(()=>{
  const binding=owner.current;if(!source||!binding||binding.token!==token)return;
  const stop=source.subscribe(binding.read);binding.read();return()=>stop();
 },[source,token]);
 const retry=useCallback(()=>{const binding=owner.current;if(binding?.active&&binding.token===token)binding.read();},[token]);
 const current=view?.token===token?view:undefined;
 return{snapshot:current?.snapshot,available:!!source,loading:current?.loading??!!source,error:current?.error??'',retry};
}
