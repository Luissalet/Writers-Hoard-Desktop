import type {CharacterSheet,SheetRoll} from './types';
import {randomDie,rollExpression,type Die} from './mechanics';
import {validFiveEAttack} from './fiveETypes';

/** Bound derived context to the existing SheetRoll text limit; source rows stay complete. */
function historyLabel(action:string,name:string,damageType='') {
 const prefix=`${action} · `,available=100000-prefix.length;
 const clip=(text:string,limit:number)=>text.length<=limit?text:`${text.slice(0,limit-1).replace(/[\uD800-\uDBFF]$/,'')}…`;
 if(!damageType)return prefix+clip(name,available);
 const content=available-3,nameBudget=Math.min(name.length,Math.max(Math.floor(content/2),content-damageType.length));
 return `${prefix}${clip(name,nameBudget)} · ${clip(damageType,content-nameBudget)}`;
}

/** Manual row rolls: no target, critical adjudication or resource consumption. */
export function rollFiveEAttack(sheet:CharacterSheet,rowId:string,kind:'attack'|'damage',die:Die=randomDie,labels={attack:'Attack',damage:'Damage'}):SheetRoll {
 const row=sheet.rows.find(item=>item.id===rowId);
 if(sheet.preset!=='5e-character'||!row||!validFiveEAttack(row.fiveEAttack))throw Error('five_e_attack_missing');
 const roll=rollExpression(kind==='attack'?'1d20':row.expression,die);
 if(kind==='damage')return{...roll,label:historyLabel(labels.damage,row.name||row.expression,row.fiveEAttack.damageType)};
 const total=roll.total+row.fiveEAttack.bonus;
 if(!Number.isSafeInteger(total))throw Error('five_e_attack_total_invalid');
 return{...roll,label:historyLabel(labels.attack,row.name||'1d20'),expression:`1d20${row.fiveEAttack.bonus>=0?'+':''}${row.fiveEAttack.bonus}`,total};
}
