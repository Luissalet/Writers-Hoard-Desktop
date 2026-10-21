import {act,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import DaggerheartPlayPanel from '@/engines/character-sheets/DaggerheartPlayPanel';
import {createSheet} from '@/engines/character-sheets/types';
const qa=window as any;let seq=0;
function check(v:unknown,m:string):asserts v{if(!v)throw Error(m);}
const pause=()=>new Promise(r=>setTimeout(r,40));
async function until(f:()=>unknown){for(let i=0;i<180;i++){if(f())return;await act(async()=>{await pause();});}throw Error('Selection oracle timeout '+qa.__testStage);}
async function native(events:unknown[]){const n=++seq;await act(async()=>{qa.__native={n,events};await until(()=>qa.__nativeAck===n);await pause();});}
async function key(keyCode:string){await native([{type:'keyDown',keyCode},{type:'keyUp',keyCode}]);}
async function click(el:Element|null|undefined){check(el,'Missing selection control');el.scrollIntoView({block:'center',behavior:'instant'});const b=el.getBoundingClientRect(),x=Math.round(b.x+b.width/2),y=Math.round(b.y+b.height/2);check(el===document.elementFromPoint(x,y)||el.contains(document.elementFromPoint(x,y)),'Selection control occluded');await native([{type:'mouseMove',x,y},{type:'mouseDown',x,y,button:'left',clickCount:1},{type:'mouseUp',x,y,button:'left',clickCount:1}]);}
const button=(name:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(el=>el.textContent?.trim()===name);
const box=(name:string)=>document.querySelector<HTMLInputElement>(`input[type="checkbox"][aria-label="${name}"]`)!;
async function typeEvasion(value:string){await click(document.querySelector('input[aria-label="evasion"]'));await native([{type:'keyDown',keyCode:'A',modifiers:['control']},{type:'keyUp',keyCode:'A',modifiers:['control']}]);await native([{type:'text',text:value}]);await key('TAB');}
async function wizard(){const select=document.querySelector<HTMLSelectElement>('select[aria-label="Preview core class"]')!;select.scrollIntoView({block:'center',behavior:'instant'});select.focus();await key('END');await key('TAB');await until(()=>document.querySelector('[data-testid="daggerheart-class-preview"]'));}
function Harness({custom=false}:{custom?:boolean}){
 const race=useRef(false),[sheet,setSheet]=useState(()=>{const value=createSheet('daggerheart-character','Selection binding');value.numbers.level=4;value.numbers.evasion=custom?18:10;value.resources.find(r=>r.id==='hp')!.max=7;value.resources.find(r=>r.id==='hp')!.current=2;return value;});qa.__selectionSheet=sheet;
 return <main className="bg-deep p-5 text-text-primary"><button onClick={()=>setSheet(current=>({...current,details:{...current.details,class:'Custom naming'}}))}>Author class elsewhere</button><button onClick={()=>{race.current=true;}}>Race latest draft</button><DaggerheartPlayPanel sheet={sheet} locale="en" confirm={()=>{}} update={change=>setSheet(current=>change(race.current?{...current,numbers:{...current.numbers,evasion:99}}:current))}/></main>;
}
export async function testDaggerheartSelectionBinding(){const passed:string[]=[];
 for(const width of [1440,640]){const n=++seq;qa.__want={w:width,h:1000,n};await until(()=>qa.__sizeAck===n);
  for(const scenario of ['auto-edited','explicit-unrelated','explicit-edited','hp-edited','auto-became-custom','explicit-same-value','latest-draft-race']){
   qa.__testStage=scenario+' '+width;const custom=['explicit-unrelated','explicit-edited','latest-draft-race'].includes(scenario),root=createRoot(document.getElementById('root')!);await act(async()=>root.render(<Harness custom={custom}/>));await wizard();
   if(scenario==='auto-edited'){check(box('Evasion').checked,'Safe default absent');await typeEvasion('18');check(!box('Evasion').checked,'Auto field stayed checked after author edit');await click(button('Apply selected fields'));check(qa.__selectionSheet.numbers.evasion===18,'Auto selection overwrote changed draft');}
   if(scenario==='explicit-unrelated'){check(!box('Evasion').checked,'Custom value auto selected');await click(box('Evasion'));await click(document.querySelector('[aria-label="Hope: 4"]'));check(box('Evasion').checked,'Unrelated resource edit dropped explicit choice');await click(button('Apply selected fields'));check(qa.__selectionSheet.numbers.evasion===11&&qa.__selectionSheet.resources.find((r:any)=>r.id==='hope').current===4,'Explicit expected replacement or unrelated edit lost');}
   if(scenario==='explicit-edited'){await click(box('Evasion'));await typeEvasion('19');check(!box('Evasion').checked,'Explicit choice retained against a different old value');await click(button('Apply selected fields'));check(qa.__selectionSheet.numbers.evasion===19,'Stale explicit selection overwrote newer value');}
   if(scenario==='hp-edited'){await click(box('Starting HP capacity'));await click(document.querySelector('[aria-label="HP marked: 3"]'));check(!box('Starting HP capacity').checked,'HP consent retained against changed played count');await click(box('Starting HP capacity'));await click(button('Apply selected fields'));const hp=qa.__selectionSheet.resources.find((r:any)=>r.id==='hp');check(hp.max===5&&hp.current===3,'Fresh explicit HP choice did not apply displayed state');}
   if(scenario==='auto-became-custom'){await click(button('Author class elsewhere'));check(!box('Class').checked&&!box('Evasion').checked,'Auto selection survived changed safety despite same numeric value');await click(button('Apply selected fields'));check(qa.__selectionSheet.numbers.evasion===10&&qa.__selectionSheet.details.class==='Custom naming','Auto selection replaced custom class/draft');}
   if(scenario==='explicit-same-value'){await click(box('Evasion'));await click(box('Evasion'));await click(button('Author class elsewhere'));check(box('Evasion').checked,'Explicit same-value choice was dropped by unrelated class edit');await click(button('Apply selected fields'));check(qa.__selectionSheet.numbers.evasion===11&&qa.__selectionSheet.details.class==='Custom naming','Explicit expected Evasion or custom class not preserved');}
   if(scenario==='latest-draft-race'){await click(box('Evasion'));await click(button('Race latest draft'));await click(button('Apply selected fields'));check(qa.__selectionSheet.numbers.evasion===99,'Apply used render snapshot instead of current draft');}
   await act(async()=>root.unmount());
  }
  passed.push('Native '+width+': auto/explicit selections bind displayed before/after; unrelated edits preserve intent, changed values/safety expire it, renewed HP choice and latest-draft callback stay correct');
 }
 return passed;
}
