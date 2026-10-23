export const FIVE_E_RULESET='srd-5.1-2014' as const;
export const FIVE_E_ABILITIES=['strength','dexterity','constitution','intelligence','wisdom','charisma'] as const;
export type FiveEAbilityId=typeof FIVE_E_ABILITIES[number];
export const FIVE_E_CLASS_IDS=['barbarian','bard','cleric','druid','fighter','monk','paladin','ranger','rogue','sorcerer','warlock','wizard'] as const;
export type FiveEClassId=typeof FIVE_E_CLASS_IDS[number];
export const FIVE_E_AUTO_FIELDS=['hpMax','hitDiceMax','castingAbility','slot1Max','slot2Max','slot3Max','slot4Max','slot5Max','slot6Max','slot7Max','slot8Max','slot9Max'] as const;
export type FiveEAutoField=typeof FIVE_E_AUTO_FIELDS[number];
export interface FiveEState {
 version:1;ruleset:typeof FIVE_E_RULESET;classId:FiveEClassId;auto:FiveEAutoField[];
 /** Last automatic output: distinguishes a normalized draft from an explicit manual edit on Save. */
 applied:Partial<Record<FiveEAutoField,number|string>>;
 castingAbilityId?:FiveEAbilityId;spellSaveDcOverride?:number;spellAttackOverride?:number;
}
export interface FiveESpellRow {version:1;level:number;prepared:boolean}
export interface FiveEAttackRow {version:1;bonus:number;damageType:string}
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function validFiveE(value:unknown):value is FiveEState {
 if(!record(value)||value.version!==1||value.ruleset!==FIVE_E_RULESET||!FIVE_E_CLASS_IDS.includes(value.classId as FiveEClassId)||!Array.isArray(value.auto)||new Set(value.auto).size!==value.auto.length||value.auto.some(key=>!FIVE_E_AUTO_FIELDS.includes(key))||!record(value.applied))return false;
 if(value.castingAbilityId!==undefined&&!FIVE_E_ABILITIES.includes(value.castingAbilityId as FiveEAbilityId))return false;
 for(const [key,item]of Object.entries(value.applied))if(!FIVE_E_AUTO_FIELDS.includes(key as FiveEAutoField)||(key==='castingAbility'?!FIVE_E_ABILITIES.includes(item as FiveEAbilityId):typeof item!=='number'||!Number.isSafeInteger(item)||item<0||item>1000000))return false;
 return ['spellSaveDcOverride','spellAttackOverride'].every(key=>value[key]===undefined||typeof value[key]==='number'&&Number.isFinite(value[key])&&Math.abs(value[key])<=1000000);
}
export function validFiveESpell(value:unknown):value is FiveESpellRow{return record(value)&&value.version===1&&Number.isInteger(value.level)&&Number(value.level)>=0&&Number(value.level)<=9&&typeof value.prepared==='boolean';}
export function validFiveEAttack(value:unknown):value is FiveEAttackRow{return record(value)&&value.version===1&&Number.isSafeInteger(value.bonus)&&typeof value.damageType==='string'&&value.damageType.length<=100000;}
