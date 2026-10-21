import {act,useState} from 'react';import {createRoot} from 'react-dom/client';
import DaggerheartPlayPanel from '@/engines/character-sheets/DaggerheartPlayPanel';import {createSheet} from '@/engines/character-sheets/types';
const qa=window as any;let seq=0;const assert=(v:unknown,m:string):asserts v=>{if(!v)throw Error(m)};const pause=()=>new Promise(r=>setTimeout(r,40));
async function until(f:()=>unknown){for(let i=0;i<180;i++){if(f())return;await act(async()=>{await pause()})}throw Error('Own DH timeout')}
async function native(events:unknown[]){const n=++seq;await act(async()=>{qa.__native={n,events};await until(()=>qa.__nativeAck===n);await pause()})}
async function key(keyCode:string){await native([{type:'keyDown',keyCode},{type:'keyUp',keyCode}])}
async function click(el:Element){el.scrollIntoView({block:'center',behavior:'instant'});const b=el.getBoundingClientRect(),p={x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)};await native([{type:'mouseMove',...p},{type:'mouseDown',...p,button:'left',clickCount:1},{type:'mouseUp',...p,button:'left',clickCount:1}])}
function Harness(){const[sheet,setSheet]=useState(()=>{const s=createSheet('daggerheart-character','Own live preview');s.numbers.level=4;s.resources.find(r=>r.id==='hp')!.max=7;return s});qa.__ownDaggerheart=sheet;return <main className="bg-deep p-5 text-text-primary"><DaggerheartPlayPanel locale="en" sheet={sheet} update={change=>setSheet(change)} confirm={()=>{}}/></main>}
export async function testDaggerheartIndependentPreview(){
 const root=createRoot(document.getElementById('root')!);await act(async()=>root.render(<Harness/>));
 const select=document.querySelector<HTMLSelectElement>('select[aria-label="Preview core class"]')!;select.scrollIntoView({block:'center',behavior:'instant'});select.focus();await key('END');await key('TAB');await until(()=>!!document.querySelector('[data-testid="daggerheart-class-preview"]'));
 const evasion=document.querySelector<HTMLInputElement>('input[aria-label="Evasion"]')!;assert(evasion.checked,'Fixture Wizard preview must initially select safe default Evasion');
 const input=document.querySelector<HTMLInputElement>('input[aria-label="evasion"]')!;await click(input);await native([{type:'keyDown',keyCode:'A',modifiers:['control']},{type:'keyUp',keyCode:'A',modifiers:['control']},{type:'text',text:'18'}]);await key('TAB');await until(()=>qa.__ownDaggerheart.numbers.evasion===18);
 qa.__shot={name:'own-dh-edited-during-preview'};await until(()=>qa.__shotDone==='own-dh-edited-during-preview');
 const apply=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()==='Apply selected fields')!;await click(apply);
 assert(qa.__ownDaggerheart.numbers.evasion===18,'Own freshly authored Evasion18 was overwritten by stale automatically selected preview field: '+JSON.stringify({evasion:qa.__ownDaggerheart.numbers.evasion,class:qa.__ownDaggerheart.details.class}));
 await act(async()=>root.unmount());return['Own custom Evasion edited while preview open stays unless author explicitly selects its replacement'];
}
