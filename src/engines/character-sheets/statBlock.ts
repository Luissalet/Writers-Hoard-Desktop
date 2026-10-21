import type {CharacterSheet} from './types';
import {sheetProficiency} from './mechanics';

/** D&D Basic Rules, Experience Points by Challenge Rating. Numeric facts only. */
export const STAT_BLOCK_CR=[0,1/8,1/4,1/2,...Array.from({length:30},(_,i)=>i+1)] as const;
const XP=[0,25,50,100,200,450,700,1100,1800,2300,2900,3900,5000,5900,7200,8400,10000,11500,13000,15000,18000,20000,22000,25000,33000,41000,50000,62000,75000,90000,105000,120000,135000,155000];
export interface StatBlockXp {version:1;zeroCrXp:0|10;override?:number}
export function validStatBlockXp(value:unknown):value is StatBlockXp{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const row=value as Record<string,unknown>;
 return Object.keys(row).every(key=>['version','zeroCrXp','override'].includes(key))&&row.version===1&&(row.zeroCrXp===0||row.zeroCrXp===10)&&(row.override===undefined||typeof row.override==='number'&&Number.isSafeInteger(row.override)&&row.override>=0&&row.override<=1000000);
}
export const challengeLabel=(value:number)=>value===.125?'1/8':value===.25?'1/4':value===.5?'1/2':String(value);
export function statBlockDerived(sheet:CharacterSheet){
 if(sheet.preset!=='5e-stat-block')return null;
 const authoredChallenge=sheet.numbers.challenge??null,index=STAT_BLOCK_CR.findIndex(cr=>cr===authoredChallenge),config=sheet.statBlockXp;
 const automaticXp=index<0?null:authoredChallenge===0?(config?.zeroCrXp??10):XP[index];
 const xpSource=config?.override!==undefined?'override':config?'cr':'legacy';
 const effectiveXp=xpSource==='override'?config!.override!:xpSource==='cr'?automaticXp:sheet.numbers.experience??null;
 return{authoredChallenge,challenge:index<0?null:authoredChallenge,automaticXp,effectiveXp,xpSource,zeroCrXp:config?.zeroCrXp??10,proficiency:sheetProficiency(sheet)};
}
