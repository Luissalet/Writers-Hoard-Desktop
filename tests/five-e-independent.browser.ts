import '@/engines';
import {createSheet,type CharacterSheet} from '@/engines/character-sheets/types';
import {FIVE_E_AUTO_FIELDS,applyFiveEClass,reconcileFiveESheet,fiveECalculated,prepareFiveESpell} from '@/engines/character-sheets/fiveE';
import {sheetPaper} from '@/engines/character-sheets/paper';
function check(v:unknown,m:string):asserts v{if(!v)throw Error(m);}
const resource=(s:CharacterSheet,id:string)=>s.resources.find(r=>r.id===id)!;
export async function testFiveEIndependentControls(){
 const out:string[]=[];
 for(const id of ['wizard','paladin','warlock','fighter'])for(const score of [1,10,30])for(const level of [1,2,11,20]){
  const raw=createSheet('5e-character');raw.traits.find(t=>t.id==='constitution')!.value=score;
  const calculated=fiveECalculated(raw,id,level),die={wizard:6,paladin:10,warlock:8,fighter:10}[id]!,mod=Math.floor((score-10)/2),expected=Math.max(1,die+mod)+(level-1)*Math.max(1,die/2+1+mod);
  check(calculated.values.hpMax===expected,'CON/level fixed HP '+id+score+level);
 }
 out.push('Independent CON1/10/30 and level1/2/11/20 fixed HP controls for four distinct class profiles');
 for(const marked of [false,true]){
  let s=applyFiveEClass(createSheet('5e-character'),'wizard',20,FIVE_E_AUTO_FIELDS);resource(s,'slot7').marked=marked;resource(s,'slot7').current=marked?2:0;
  const low={...structuredClone(s),numbers:{...s.numbers,level:19}},r=reconcileFiveESheet(low,s);check(resource(r,'slot7').max===2&&!r.fiveE!.auto.includes('slot7Max'),'Level reduction discarded two played uses');
  const again=reconcileFiveESheet(r,s);check(JSON.stringify(again)===JSON.stringify(r),'Save reattached destructively unlinked slot');
  const zero=reconcileFiveESheet({...structuredClone(s),numbers:{...s.numbers,level:19},resources:s.resources.map(v=>v.id==='slot7'?{...v,max:0,current:0}:v)},s);
  check(resource(zero,'slot7').max===0&&!zero.fiveE!.auto.includes('slot7Max'),'Explicit manual zero was overwritten');
 }
 out.push('Marked/available high-level spent slots survive destructive level reduction and double reconcile; explicit zero remains manual');
 let s=applyFiveEClass(createSheet('5e-character'),'wizard',5,FIVE_E_AUTO_FIELDS);s.rows=[{id:'one',section:'Rituals',name:'Same name',detail:'First',quantity:1,expression:'',fiveESpell:{version:1,level:1,prepared:false}},{id:'two',section:'Reactions',name:'Same name',detail:'Second',quantity:1,expression:'',fiveESpell:{version:1,level:2,prepared:false}}];
 s=prepareFiveESpell(s,'two',true);s=applyFiveEClass(s,'warlock',5,['castingAbility']);check(!s.rows[0].fiveESpell!.prepared&&s.rows[1].fiveESpell!.prepared&&s.rows[0].id==='one','Duplicate-name prepared rows lost stable identity');
 out.push('Duplicate spell names retain separate stable IDs and prepared marks across class change');return out;
}
export async function testFiveEIndependentPaperSection(){
 const s=createSheet('5e-character','Paper source fields');s.rows=[{id:'existing-manual',section:'AUTHORED_RITUAL_SECTION_🧭',name:'Shield',detail:'My note',expression:'1d4',quantity:2}];
 const text=(svg:string)=>new DOMParser().parseFromString(svg,'image/svg+xml').documentElement.textContent??'';
 check(text(sheetPaper(s).svg).includes('AUTHORED_RITUAL_SECTION_🧭'),'Legacy row section absent in baseline paper');
 s.rows[0].fiveESpell={version:1,level:1,prepared:true};const paper=sheetPaper(s);
 check(text(paper.svg).includes('AUTHORED_RITUAL_SECTION_🧭'),'Converting an existing row to a prepared spell silently omits its authored section from complete paper export');
 return ['Converting an existing manual row to a prepared spell retains its authored section in complete paper export'];
}
