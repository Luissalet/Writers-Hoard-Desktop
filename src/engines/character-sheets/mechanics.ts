import type { CharacterSheet, SheetRoll, SheetSkill } from './types';
export type Die = (sides: number) => number;
export const randomDie: Die = sides => {
  if(!Number.isInteger(sides)||sides<2||sides>1000)throw new Error('invalid_die');
  const ceiling=Math.floor(4294967296/sides)*sides;const data=new Uint32Array(1);do{crypto.getRandomValues(data);}while(data[0]>=ceiling);return data[0]%sides+1;
};
export const abilityModifier=(score: number)=>Math.floor((score-10)/2);
export const proficiency=(level: number)=>Math.min(9,2+Math.floor((Math.max(1,level)-1)/4));
export function sheetProficiency(sheet: CharacterSheet): number {return sheet.numbers.proficiencyOverride ?? proficiency(sheet.preset==='5e-stat-block'?sheet.numbers.challenge:Math.min(20,sheet.numbers.level));}
export function skillBonus(sheet: CharacterSheet, skill: SheetSkill): number {
  const trait=sheet.traits.find(item=>item.id===skill.traitId);
  if(sheet.preset.startsWith('5e'))return (trait?abilityModifier(trait.value):skill.value)+sheetProficiency(sheet)*skill.training+skill.bonus;
  return (trait?.value??skill.value)+skill.bonus;
}
export function cocTargets(value: number) {return {regular:value,hard:Math.floor(value/2),extreme:Math.floor(value/5)};}
export function cocOutcome(result: number,target: number,required=target): string {
  if(result===1)return 'critical';if(result===100||(required<50&&result>=96))return 'fumble';
  const targets=cocTargets(target);return result<=targets.extreme?'extreme':result<=targets.hard?'hard':result<=targets.regular?'regular':'failure';
}
export function cocDerived(sheet: CharacterSheet) {
  const get=(id:string)=>sheet.traits.find(item=>item.id===id)?.value??0;const sum=get('str')+get('siz');
  const band=sum<=64?[-2,'−2']:sum<=84?[-1,'−1']:sum<=124?[0,'0']:sum<=164?[1,'+1d4']:sum<=204?[2,'+1d6']:null;
  return {hp:Math.max(0,Math.floor((get('con')+get('siz'))/10)),mp:Math.max(0,Math.floor(get('pow')/5)),sanity:get('pow'),dodge:Math.floor(get('dex')/2),ownLanguage:get('edu'),build:band?.[0] as number|undefined,damageBonus:band?.[1] as string|undefined};
}
export function damageMarks(damage:number,major:number,severe:number,armor=false,massive=false):number {
  if(major<1||severe<major)throw new Error('invalid_thresholds');
  const marks=damage<=0?0:massive&&damage>=severe*2?4:damage>=severe?3:damage>=major?2:1;return Math.max(0,marks-(armor?1:0));
}
function roll(label:string,expression:string,dice:number[],total:number,outcome='',target?:number):SheetRoll {return {id:crypto.randomUUID(),at:Date.now(),label,expression,dice,total,outcome,...(target===undefined?{}:{target})};}
export function d20Check(label:string,bonus:number,target:number,mode:'normal'|'advantage'|'disadvantage'='normal',attack=false,die:Die=randomDie,naturalOneFails=true):SheetRoll {
  const dice=mode==='normal'?[die(20)]:[die(20),die(20)];const natural=mode==='advantage'?Math.max(...dice):mode==='disadvantage'?Math.min(...dice):dice[0];const total=natural+bonus;
  return roll(label,`${mode==='normal'?'d20':mode==='advantage'?'2d20 ↑':'2d20 ↓'} ${bonus>=0?'+':''}${bonus}`,dice,total,attack&&natural===20?'critical':attack&&natural===1&&naturalOneFails?'fumble':total>=target?'success':'failure',target);
}
export function cocCheck(label:string,target:number,die:Die=randomDie,difficulty:'regular'|'hard'|'extreme'='regular'):SheetRoll {const result=die(100),required=cocTargets(target)[difficulty],outcome=cocOutcome(result,target,required);return {...roll(label,'d100', [result],result,outcome,required),difficulty,passed:outcome==='critical'||outcome!=='fumble'&&result<=required};}
export function dualityCheck(label:string,bonus:number,target:number,die:Die=randomDie):SheetRoll {
  const hope=die(12),fear=die(12),total=hope+fear+bonus;return roll(label,`Hope d12 + Fear d12 ${bonus>=0?'+':''}${bonus}`,[hope,fear],total,hope===fear?'critical':`${total>=target?'success':'failure'}-${hope>fear?'hope':'fear'}`,target);
}
/** Bounded additive grammar: NdS and integers, with +/−. Never evaluates code. */
export function rollExpression(expression:string,die:Die=randomDie):SheetRoll {
  const clean=expression.replace(/\s+/g,'').toLowerCase();if(clean.length>100||!clean)throw new Error('invalid_expression');
  const terms=clean.match(/[+-]?[^+-]+/g);if(!terms||terms.join('')!==clean||terms.length>20)throw new Error('invalid_expression');
  let total=0,count=0;const dice:number[]=[];
  for(const term of terms){const sign=term[0]==='-'?-1:1;const body=term.replace(/^[+-]/,'');const match=/^(\d*)d(\d+)$/.exec(body);
    if(match){const amount=match[1]?Number(match[1]):1,sides=Number(match[2]);count+=amount;if(!Number.isInteger(amount)||amount<1||amount>100||sides<2||sides>1000||count>200)throw new Error('dice_limit');
      for(let index=0;index<amount;index++){const result=die(sides);dice.push(result);total+=sign*result;}}
    else {if(!/^\d+$/.test(body)||Number(body)>1000000)throw new Error('invalid_expression');total+=sign*Number(body);}
  }
  return roll(expression,expression,dice,total);
}
