import {useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {useTranslation} from '@/i18n/useTranslation';
import {useEnginePane} from '@/engines/_shared/EnginePaneContext';
import {activeTourDefinition,closeTour,signalBoundTour,startBoundTour} from '@/components/tutorial/tourController';
import {useTourStore} from '@/components/tutorial/tourStore';
import {tourStatus} from '@/components/tutorial/tourProgress';
import type {TourBinding,TourDefinition} from '@/components/tutorial/tourTypes';
import {deriveLocalToolLocale,localToolTranslator,prepareLocalToolLocales} from './locales';
import {localToolTourProgressKey,type LocalToolTutorialPort,type LocalToolTutorialSnapshot,type LocalToolTourText} from './tutorials';
import type {LocalToolDefinition,LocalToolHostContext} from './sdk';

interface MountedTutorial{namespace:string;projectId:string;eraId?:string;releaseHash:string|null;port:LocalToolTutorialPort}
const mounted=new Set<MountedTutorial>();
/** Only committed, currently mounted hosts participate; no compiled-release registry. */
// This internal host also serves the bridge; it is not a public SDK boundary.
// eslint-disable-next-line react-refresh/only-export-components
export function localToolTutorialSnapshots(namespace:string,projectId:string,eraId:string|undefined,releaseHash:string|null):LocalToolTutorialSnapshot[]{return [...mounted].filter(item=>item.namespace===namespace&&item.projectId===projectId&&item.eraId===eraId&&item.releaseHash===releaseHash).map(item=>item.port.getSnapshot()).filter(item=>item.available);}
export default function LocalToolTutorialHost({definition,context,releaseHash,identity,visible=true,children}:{definition:LocalToolDefinition;context:LocalToolHostContext;releaseHash:string|null;identity:unknown;visible?:boolean;children:(context:LocalToolHostContext)=>ReactNode}){
 const {locale}=useTranslation(),pane=useEnginePane(),root=useRef<HTMLDivElement>(null),[port,setPort]=useState<LocalToolTutorialPort>(),[choice,setChoice]=useState('');
 const {projectId,eraId}=context.scope,documentId=context.document?.id,enabled=visible&&(pane?.visible??true)&&context.view==='editor'&&context.canEdit;
 const tours=definition.tours;
 const definitions=useMemo(()=>{const prepared=prepareLocalToolLocales(definition.locales),translate=(copy:LocalToolTourText)=>'key'in copy?{en:localToolTranslator(deriveLocalToolLocale(prepared,'en'))(copy.key),es:localToolTranslator(deriveLocalToolLocale(prepared,'es'))(copy.key)}:{...copy};return (tours??[]).map(tour=>({id:tour.id,title:translate(tour.title),summary:{en:'',es:''},needsProject:false,steps:tour.steps.map(step=>({id:step.id,anchor:step.target,title:translate(step.title),text:translate(step.body),...(step.advanceOn?{advanceOn:step.advanceOn}:{})}))} satisfies TourDefinition));},[definition.locales,tours]);
 useLayoutEffect(()=>{
  let valid=true;const element=root.current;queueMicrotask(()=>{if(valid)setPort(undefined);});
  if(!enabled||!element||!tours?.length)return()=>{valid=false;};
  const bindings=definitions.map((tour,index):TourBinding=>({root:element,progressKey:localToolTourProgressKey(definition.namespace,tours[index]),definition:()=>tour,isCurrent:()=>valid&&element.isConnected}));
  const current=()=>valid&&element.isConnected,listeners=new Set<()=>void>(),subscriptions=new Set<()=>void>();
  const nextPort:LocalToolTutorialPort={
   async show(id,options){if(!current())return{shown:false,reason:'unavailable'};const binding=bindings.find(item=>item.definition().id===id);if(!binding)return{shown:false,reason:'missing'};const shown=await startBoundTour(binding,options);return shown?{shown:true}:{shown:false,reason:current()?'cancelled':'unavailable'};},
   signal(name){if(!current())return;const active=useTourStore.getState().active,binding=active?.binding;if(binding&&bindings.includes(binding))signalBoundTour(binding,name);},
   getSnapshot(){const state=useTourStore.getState(),active=state.active;return{available:current(),...(active?.binding&&bindings.includes(active.binding)?{active:{id:activeTourDefinition(active)!.id,step:active.index}}:{}),tours:tours.map((tour,index)=>({id:tour.id,revision:tour.revision,...tourStatus(state.progress,bindings[index].progressKey)}))};},
   subscribe(changed){if(!current())return()=>{};listeners.add(changed);const off=useTourStore.subscribe(()=>{if(current())changed();});subscriptions.add(off);return()=>{listeners.delete(changed);subscriptions.delete(off);off();};},
  };
  const entry={namespace:definition.namespace,projectId,eraId,releaseHash,port:nextPort};mounted.add(entry);queueMicrotask(()=>{if(valid)setPort(nextPort);});
  return()=>{valid=false;mounted.delete(entry);const active=useTourStore.getState().active;if(active?.binding&&bindings.includes(active.binding))closeTour();for(const off of subscriptions)off();subscriptions.clear();for(const changed of listeners)changed();listeners.clear();};
 },[enabled,definition.namespace,definitions,tours,projectId,eraId,documentId,releaseHash,identity]);
 const hostContext=useMemo(()=>({...context,...(port&&enabled?{tutorial:port}:{tutorial:undefined})}),[context,port,enabled]);
 const chosen=definitions.find(tour=>tour.id===choice)??definitions[0];
 return <div ref={root} className="min-w-0 space-y-3" data-local-tool-tutorial-root={definition.namespace}>
  {enabled&&chosen&&<div className="flex flex-wrap items-center gap-2">{definitions.length>1&&<select aria-label={locale==='es'?'Recorrido':'Tutorial'} value={chosen.id} onChange={event=>setChoice(event.target.value)} className="min-h-9 rounded-lg border border-border bg-surface px-2 text-sm text-text-primary">{definitions.map(tour=><option key={tour.id} value={tour.id}>{tour.title[locale]}</option>)}</select>}<button data-local-tool-help type="button" disabled={!port} onClick={()=>void port?.show(chosen.id,{resume:true})} className="min-h-9 rounded-lg border border-border px-3 text-sm text-text-primary hover:bg-elevated disabled:opacity-50">{locale==='es'?'Ayuda':'Help'}</button></div>}
  {children(hostContext)}
 </div>;
}
