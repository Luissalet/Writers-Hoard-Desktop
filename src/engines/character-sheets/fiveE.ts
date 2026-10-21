import type {CharacterSheet,SheetResource,SheetRow} from './types';
import {abilityModifier,sheetProficiency} from './mechanics';
import {FIVE_E_ABILITIES,FIVE_E_AUTO_FIELDS,FIVE_E_CLASS_IDS,FIVE_E_RULESET,type FiveEAbilityId,type FiveEAutoField,type FiveEClassId,type FiveEState,validFiveESpell} from './fiveETypes';
export {FIVE_E_AUTO_FIELDS,FIVE_E_CLASS_IDS,FIVE_E_RULESET};
export const FIVE_E_ACTIONS=['configure','resource','upsert-spell','prepare-spell','casting-override'] as const;
export const FIVE_E_SOURCE={title:'5e (2014) · SRD 5.1',url:'https://media.dndbeyond.com/compendium-images/srd/5.1/SRD_CC_v5.1.pdf',license:'https://creativecommons.org/licenses/by/4.0/',attribution:'This work includes material taken from the System Reference Document 5.1 (“SRD 5.1”) by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.'} as const;
type ClassFact={id:FiveEClassId;name:string;die:number;caster:'none'|'full'|'half'|'pact';ability?:FiveEAbilityId;page:number};
export const FIVE_E_CLASSES:ClassFact[]=[
 {id:'barbarian',name:'Barbarian',die:12,caster:'none',page:8},{id:'bard',name:'Bard',die:8,caster:'full',ability:'charisma',page:11},
 {id:'cleric',name:'Cleric',die:8,caster:'full',ability:'wisdom',page:15},{id:'druid',name:'Druid',die:8,caster:'full',ability:'wisdom',page:19},
 {id:'fighter',name:'Fighter',die:10,caster:'none',page:24},{id:'monk',name:'Monk',die:8,caster:'none',page:26},
 {id:'paladin',name:'Paladin',die:10,caster:'half',ability:'charisma',page:30},{id:'ranger',name:'Ranger',die:10,caster:'half',ability:'wisdom',page:35},
 {id:'rogue',name:'Rogue',die:8,caster:'none',page:39},{id:'sorcerer',name:'Sorcerer',die:6,caster:'full',ability:'charisma',page:42},
 {id:'warlock',name:'Warlock',die:8,caster:'pact',ability:'charisma',page:46},{id:'wizard',name:'Wizard',die:6,caster:'full',ability:'intelligence',page:52},
];
// Numeric class-table facts, SRD5.1 pp11,15,19,30–36,42,46,52. Not spell/rulebook prose.
const FULL_SLOTS=[[],[2],[3],[4,2],[4,3],[4,3,2],[4,3,3],[4,3,3,1],[4,3,3,2],[4,3,3,3,1],[4,3,3,3,2],[4,3,3,3,2,1],[4,3,3,3,2,1],[4,3,3,3,2,1,1],[4,3,3,3,2,1,1],[4,3,3,3,2,1,1,1],[4,3,3,3,2,1,1,1],[4,3,3,3,2,1,1,1,1],[4,3,3,3,3,1,1,1,1],[4,3,3,3,3,2,1,1,1],[4,3,3,3,3,2,2,1,1]];
const HALF_SLOTS=[[],[],[2],[3],[3],[4,2],[4,2],[4,3],[4,3],[4,3,2],[4,3,2],[4,3,3],[4,3,3],[4,3,3,1],[4,3,3,1],[4,3,3,2],[4,3,3,2],[4,3,3,3,1],[4,3,3,3,1],[4,3,3,3,2],[4,3,3,3,2]];
const required=(sheet:CharacterSheet)=>{if(sheet.preset!=='5e-character')throw Error('five_e_character_required');};
const classFact=(id:string)=>{const fact=FIVE_E_CLASSES.find(row=>row.id===id);if(!fact)throw Error('five_e_class_invalid');return fact;};
const levelValue=(level:number)=>{if(!Number.isInteger(level)||level<1||level>20)throw Error('five_e_level_invalid');return level;};
const score=(sheet:CharacterSheet,id:string)=>{const value=sheet.traits.find(row=>row.id===id)?.value;return value!==undefined&&Number.isInteger(value)&&value>=1&&value<=30?value:undefined;};
export function fiveECalculated(sheet:CharacterSheet,classId:string=sheet.fiveE?.classId??'',level=sheet.numbers.level){
 required(sheet);const fact=classFact(classId);levelValue(level);const slots=Array<number>(9).fill(0);
 if(fact.caster==='pact'){const slotLevel=Math.min(5,Math.ceil(level/2));slots[slotLevel-1]=level===1?1:level<11?2:level<17?3:4;}
 else (fact.caster==='full'?FULL_SLOTS[level]:fact.caster==='half'?HALF_SLOTS[level]:[]).forEach((value,index)=>{slots[index]=value;});
 const con=score(sheet,'constitution'),mod=con===undefined?undefined:abilityModifier(con);
 const values:Partial<Record<FiveEAutoField,number|string>>={hitDiceMax:level,...(fact.ability?{castingAbility:fact.ability}:{})};
 if(mod!==undefined)values.hpMax=Math.max(1,fact.die+mod)+(level-1)*Math.max(1,fact.die/2+1+mod);
 slots.forEach((max,index)=>{values[`slot${index+1}Max` as FiveEAutoField]=max;});return{fact,level,slots,values};
}
const resourceId=(field:FiveEAutoField)=>field==='hpMax'?'hp':field==='hitDiceMax'?'hitDice':field.replace(/Max$/,'');
const currentValue=(sheet:CharacterSheet,field:FiveEAutoField)=>{if(field!=='castingAbility')return sheet.resources.find(row=>row.id===resourceId(field))?.max;const id=sheet.fiveE?sheet.fiveE.castingAbilityId:sheet.traits[sheet.numbers.spellAbility??3]?.id;return FIVE_E_ABILITIES.includes(id as FiveEAbilityId)?id:undefined;};
const token=(sheet:CharacterSheet,field:FiveEAutoField)=>JSON.stringify(field==='castingAbility'?{value:currentValue(sheet,field)}:sheet.resources.find(row=>row.id===resourceId(field))??null);
function adjustedCurrent(row:SheetResource,max:number,field:FiveEAutoField){
 if(field==='hpMax')return Math.min(row.current,max); // Level/CON changes never heal.
 const used=row.marked?row.current:row.max-row.current;
 return row.marked?Math.min(used,max):Math.max(0,max-used);
}
function assign(sheet:CharacterSheet,field:FiveEAutoField,value:number|string,create=false){
 if(field==='castingAbility'){sheet.fiveE!.castingAbilityId=value as FiveEAbilityId;return;}
 const id=resourceId(field),row=sheet.resources.find(item=>item.id===id),max=Number(value);
 if(row){row.current=adjustedCurrent(row,max,field);row.max=max;}
 else if(create){if(sheet.resources.length>=500)throw Error('five_e_resources_limit');sheet.resources.push({id,label:field==='hpMax'?'HP':field==='hitDiceMax'?'Hit dice':`Spell slots ${id.slice(4)}`,max,current:field==='hpMax'?0:max,marked:false});}
}
/** Pure update-time reconciliation. No legacy adoption or read-time healing. */
export function reconcileFiveESheet(next:CharacterSheet,previous?:CharacterSheet):CharacterSheet {
 if(next.preset!=='5e-character'||!next.fiveE)return next;
 const calculated=fiveECalculated(next),sheet=structuredClone(next),state=sheet.fiveE!,prior=previous?.fiveE;
 for(const field of [...state.auto]){
  const value=currentValue(next,field),old=previous?currentValue(previous,field):undefined;
  // A completed normalizer/action advances its ledger; a simultaneous max+level edit does not.
  const normalized=state.applied[field]!==prior?.applied[field]&&value===state.applied[field];
  const manual=!!prior&&prior.auto.includes(field)&&value!==old&&!normalized;
  const proposed=calculated.values[field],row=sheet.resources.find(item=>item.id===resourceId(field));
  const used=row?(row.marked?row.current:row.max-row.current):0;
  const destructive=typeof proposed==='number'&&!!row&&(field==='hpMax'?row.current>proposed:used>proposed);
  if(manual||proposed===undefined||field!=='castingAbility'&&!row||destructive){state.auto=state.auto.filter(key=>key!==field);delete state.applied[field];continue;}
  assign(sheet,field,proposed);state.applied[field]=proposed;
 }
 return JSON.stringify(sheet)===JSON.stringify(next)?next:sheet;
}
export function fiveEClassPreview(sheet:CharacterSheet,classId:string,level:number){
 const calculated=fiveECalculated(sheet,classId,level),fresh=sheet.revision===0&&!sheet.fiveE;
 return{source:FIVE_E_SOURCE,...calculated,recordedClass:sheet.details.class??'',changes:FIVE_E_AUTO_FIELDS.filter(field=>calculated.values[field]!==undefined).map(field=>{
  const row=sheet.resources.find(item=>item.id===resourceId(field)),after=calculated.values[field]!,used=row?(row.marked?row.current:row.max-row.current):0;
  const protectedUse=typeof after==='number'&&!!row&&(field==='hpMax'?row.current>after:used>after);
  const safe=!protectedUse&&(sheet.fiveE?.auto.includes(field)||fresh&&(field==='castingAbility'||!!row&&row.current===(row.marked?0:row.max)));
  return{field,before:token(sheet,field),value:currentValue(sheet,field),after,safe:!!safe,missing:field!=='castingAbility'&&!row,clamps:protectedUse};
 })};
}
export function applyFiveEClass(sheet:CharacterSheet,classId:string,level:number,fields:readonly string[],recordClass=false):CharacterSheet {
 const preview=fiveEClassPreview(sheet,classId,level);
 if(!fields.length||new Set(fields).size!==fields.length||fields.some(field=>!preview.changes.some(change=>change.field===field)))throw Error('five_e_fields_invalid');
 const next=structuredClone(sheet),state:FiveEState={version:1,ruleset:FIVE_E_RULESET,classId:preview.fact.id,auto:[],applied:{},...(currentValue(sheet,'castingAbility')?{castingAbilityId:currentValue(sheet,'castingAbility') as FiveEAbilityId}:{}),...(sheet.fiveE?.spellSaveDcOverride===undefined?{}:{spellSaveDcOverride:sheet.fiveE.spellSaveDcOverride}),...(sheet.fiveE?.spellAttackOverride===undefined?{}:{spellAttackOverride:sheet.fiveE.spellAttackOverride})};next.fiveE=state;next.numbers.level=level;
 if(recordClass)next.details.class=preview.fact.name;
 for(const field of FIVE_E_AUTO_FIELDS.filter(field=>fields.includes(field))){const value=preview.values[field]!;assign(next,field,value,true);state.auto.push(field);state.applied[field]=value;}
 return JSON.stringify(next)===JSON.stringify(sheet)?sheet:next;
}
export function setFiveEResource(sheet:CharacterSheet,id:string,value:number){required(sheet);const row=sheet.resources.find(item=>item.id===id);if(!row||!Number.isFinite(value)||value<0||value>row.max)throw Error('five_e_resource_invalid');return row.current===value?sheet:{...sheet,resources:sheet.resources.map(item=>item.id===id?{...item,current:value}:item)};}
export function upsertFiveESpell(sheet:CharacterSheet,row:SheetRow){required(sheet);if(!validFiveESpell(row.fiveESpell))throw Error('five_e_spell_invalid');const old=sheet.rows.find(item=>item.id===row.id);if(!old&&sheet.rows.length>=500)throw Error('five_e_rows_limit');return{...sheet,rows:old?sheet.rows.map(item=>item.id===row.id?structuredClone(row):item):[...sheet.rows,structuredClone(row)]};}
export function prepareFiveESpell(sheet:CharacterSheet,id:string,prepared:boolean){required(sheet);const row=sheet.rows.find(item=>item.id===id);if(!row?.fiveESpell||typeof prepared!=='boolean')throw Error('five_e_spell_missing');return row.fiveESpell.prepared===prepared?sheet:upsertFiveESpell(sheet,{...row,fiveESpell:{...row.fiveESpell,prepared}});}
export function setFiveECastingOverride(sheet:CharacterSheet,key:string,value?:number){required(sheet);if(!sheet.fiveE||!['spellSaveDc','spellAttack'].includes(key)||value!==undefined&&(!Number.isFinite(value)||Math.abs(value)>1000000))throw Error('five_e_override_invalid');const next=structuredClone(sheet),field=key==='spellSaveDc'?'spellSaveDcOverride':'spellAttackOverride';if(value===undefined)delete next.fiveE![field];else next.fiveE![field]=value;return JSON.stringify(sheet)===JSON.stringify(next)?sheet:next;}
export function fiveEDerived(sheet:CharacterSheet){
 if(sheet.preset!=='5e-character')return undefined;
 const config=sheet.fiveE,calculated=config?fiveECalculated(sheet):undefined,id=config?.castingAbilityId,value=id?score(sheet,id):undefined,mod=value===undefined?undefined:abilityModifier(value),pb=sheetProficiency(sheet);
 return{source:config?FIVE_E_SOURCE:null,classId:config?.classId??null,calculated,proficiency:pb,castingAbilityId:id,spellAttack:config?.spellAttackOverride??(mod===undefined?null:pb+mod),spellSaveDc:config?.spellSaveDcOverride??(mod===undefined?null:8+pb+mod),resources:sheet.resources.map(row=>({...row,used:row.marked?row.current:row.max-row.current})),spells:sheet.rows.filter(row=>row.fiveESpell)};
}
