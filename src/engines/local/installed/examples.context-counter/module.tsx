import {useEffect,useRef,useState} from 'react';
import {defineLocalTool,useLocalToolContextMenu,useLocalToolT,type LocalToolClient,type LocalToolJson,type LocalToolMenuEntry,type LocalToolMenuTrigger,type LocalToolProps} from '@/engines/local/sdk';

type Count={count:number};
const button='min-h-10 rounded-lg border px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-gold disabled:cursor-default disabled:opacity-50';
const secondary=button+' border-border text-text-primary hover:bg-elevated';

async function changeCount(client:LocalToolClient<Count>,action:'increment'|'reset'){
 const before=await client.read();
 if(!client.state)throw Error('Counter state actions are unavailable.');
 return client.state.apply(before,[{type:'set',field:'count',value:action==='increment'?before.data.count+1:0}]);
}

// Author packages export their definition rather than a React refresh boundary.
// eslint-disable-next-line react-refresh/only-export-components
function ContextCounter({client,context}:LocalToolProps<Count>){
 const messages=useLocalToolT(client),menu=useLocalToolContextMenu(context);
 const [count,setCount]=useState<number|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false);
 const [undo,setUndo]=useState<string[]>([]),[redo,setRedo]=useState<string[]>([]);
 const owner=useRef(0),working=useRef(false);
 useEffect(()=>{
  const generation=++owner.current;working.current=false;setBusy(false);setError(false);setCount(null);setUndo([]);setRedo([]);
  const refresh=()=>{void client.read().then(row=>{if(owner.current===generation)setCount(row.data.count);}).catch(()=>{if(owner.current===generation)setError(true);});};
  refresh();const off=client.subscribe?.(refresh);
  return()=>{owner.current=generation+1;off?.();};
 },[client]);
 const act=async(action:'increment'|'reset'|'undo'|'redo')=>{
  if(working.current||count===null)return;
  const receipt=(action==='undo'?undo:redo).at(-1);
  if((action==='undo'||action==='redo')&&!receipt)return;
  const generation=owner.current;working.current=true;setBusy(true);setError(false);
  try{
   const result=action==='increment'||action==='reset'?await changeCount(client,action):await client.state![action](receipt!);
   if(owner.current!==generation)return;
   setCount(result.snapshot.data.count);
   if(action==='undo'){
    setUndo(ids=>ids.slice(0,-1));if(result.receiptId)setRedo(ids=>[...ids,result.receiptId!]);
   }else if(action==='redo'){
    setRedo(ids=>ids.slice(0,-1));if(result.receiptId)setUndo(ids=>[...ids,result.receiptId!]);
   }else{setRedo([]);if(result.receiptId)setUndo(ids=>[...ids,result.receiptId!]);}
  }catch{if(owner.current===generation)setError(true);}
  finally{if(owner.current===generation){working.current=false;setBusy(false);}}
 };
 const open=(event:LocalToolMenuTrigger)=>{
  const entries:LocalToolMenuEntry[]=[
   {kind:'label',label:messages('counter.count')},
   {kind:'item',id:'increment',label:messages('counter.increment'),disabled:busy||count===null,onSelect:()=>act('increment')},
   {kind:'separator'},
   {kind:'item',id:'reset',label:messages('counter.reset'),variant:'destructive',disabled:busy||count===null||count===0,onSelect:()=>act('reset')},
   {kind:'submenu',id:'more',label:messages('counter.more'),entries:[
    {kind:'item',id:'more-increment',label:messages('counter.increment'),disabled:busy||count===null,onSelect:()=>act('increment')},
    {kind:'submenu',id:'count',label:messages('counter.count'),entries:[{kind:'item',id:'count-reset',label:messages('counter.reset'),variant:'destructive',disabled:busy||count===null||count===0,onSelect:()=>act('reset')}]},
   ]},
  ];
  return menu.open(event,entries,{label:messages('counter.actions')});
 };
 return <section data-context-counter className="min-w-0 space-y-4 p-4 text-text-primary">
  <h2 className="font-display text-xl">{messages('counter.title')}</h2>
  <p className="max-w-prose text-sm text-text-muted">{messages('counter.help')}</p>
  <output data-context-counter-value aria-label={messages('counter.count')} aria-live="polite" tabIndex={0} onContextMenu={open} onKeyDown={event=>{if(event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey)open(event);}} className="block w-fit min-w-12 rounded-lg py-1 text-3xl tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-gold">{count??'…'}</output>
  <div className="flex flex-wrap gap-2">
   <button data-context-counter-action="increment" type="button" disabled={busy||count===null} onClick={()=>void act('increment')} className={button+' border-accent-gold bg-accent-gold text-deep hover:brightness-110'}>{messages('counter.increment')}</button>
   <button data-context-counter-action="reset" type="button" disabled={busy||count===null||count===0} onClick={()=>void act('reset')} className={secondary}>{messages('counter.reset')}</button>
   <button data-context-counter-action="actions" type="button" aria-haspopup="menu" disabled={busy||count===null} onClick={open} className={secondary}>{messages('counter.actions')}</button>
  </div>
  <div className="flex flex-wrap gap-2">
   <button data-context-counter-action="undo" type="button" disabled={busy||!undo.length} onClick={()=>void act('undo')} className={secondary}>{messages('counter.undo')}</button>
   <button data-context-counter-action="redo" type="button" disabled={busy||!redo.length} onClick={()=>void act('redo')} className={secondary}>{messages('counter.redo')}</button>
  </div>
  {error&&<p role="alert" className="max-w-prose text-sm text-danger">{messages('counter.error')}</p>}
 </section>;
}

const definition=defineLocalTool({
 namespace:'examples.context-counter',name:{en:'Contextual counter',es:'Contador contextual'},
 description:{en:'A saved counter with optional host menus and explicit Undo and Redo.',es:'Un contador guardado con menús opcionales del host y botones Deshacer y Rehacer.'},
 initialState:{count:0},
 validateState:(value:LocalToolJson):value is Count=>!!value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.count==='number'&&Number.isFinite(value.count),
 codec:{version:1,fields:{count:{kind:'scalar'}}},
 preview:{version:1,fields:[{key:'count',label:{en:'Count',es:'Cuenta'}}]},
 document:{defaultTitle:{en:'Counter',es:'Contador'}},
 locales:{defaultLocale:'en',catalogs:{
  en:{counter:{title:'Contextual counter',help:'Use the buttons or open Actions on the count. Undo and Redo apply to changes made here.',count:'Count',increment:'Increment',reset:'Reset',actions:'Actions',more:'More actions',undo:'Undo',redo:'Redo',error:'The change could not be saved or reversed. Check the current count and try again.'}},
  es:{counter:{title:'Contador contextual',help:'Usa los botones o abre Acciones sobre la cuenta. Deshacer y Rehacer se aplican a los cambios realizados aquí.',count:'Cuenta',increment:'Incrementar',reset:'Restablecer',actions:'Acciones',more:'Más acciones',undo:'Deshacer',redo:'Rehacer',error:'No se ha podido guardar o revertir el cambio. Comprueba la cuenta actual e inténtalo de nuevo.'}},
 }},
 operations:['increment','reset'].map(action=>({
  id:action,description:action==='increment'?{en:'Increment this counter by one.',es:'Incrementa esta cuenta en uno.'}:{en:'Reset this counter to zero.',es:'Restablece esta cuenta a cero.'},
  writes:true,inputSchema:{type:'object' as const,properties:{},additionalProperties:false},
  run:async(_input:Record<string,LocalToolJson>,client:LocalToolClient<Count>)=>{const result=await changeCount(client,action as 'increment'|'reset');return{count:result.snapshot.data.count,receiptId:result.receiptId};},
 })),
 component:ContextCounter,
});
export default definition;
