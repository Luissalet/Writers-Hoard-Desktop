import {validFiveE,validFiveESpell,validFiveEAttack,type FiveEState,type FiveESpellRow,type FiveEAttackRow} from './fiveETypes';
import { validCocState, type CocState, type CocRollData } from './cocTypes';
import { validSheetInk,type SheetInk } from './ink';
import {validStatBlockXp,type StatBlockXp} from './statBlock';
import {validDaggerheartClass,type DaggerheartClassState} from './daggerheart';
export const presets = ['5e-character', '5e-stat-block', 'coc7', 'daggerheart-character', 'daggerheart-adversary', 'custom'] as const;
export type SheetPreset = typeof presets[number];
export interface SheetTrait { id: string; label: string; value: number }
export interface SheetSkill { id: string; label: string; traitId?: string; training: 0 | 1 | 2; value: number; bonus: number }
export interface SheetResource { id: string; label: string; current: number; max: number; marked: boolean }
export interface SheetRow { id: string; section: string; name: string; detail: string; expression: string; quantity: number; fiveESpell?:FiveESpellRow; fiveEAttack?:FiveEAttackRow }
export interface SheetRoll { id: string; at: number; label: string; expression: string; dice: number[]; total: number; outcome: string; target?: number; appliedResources?: boolean; passed?: boolean; difficulty?: 'regular' | 'hard' | 'extreme'; coc?: CocRollData }
export interface CharacterSheet {
  id: string; title: string; preset: SheetPreset; linkedEntryId?: string;
  details: Record<string, string>; numbers: Record<string, number>;
  traits: SheetTrait[]; skills: SheetSkill[]; resources: SheetResource[]; rows: SheetRow[]; rolls: SheetRoll[];
  revision: number; createdAt: number; updatedAt: number; coc?: CocState;
  ink?: SheetInk;
  paperLayout?: 'record'|'stat-block';
  statBlockXp?: StatBlockXp;
  daggerheartClass?:DaggerheartClassState;
  fiveE?:FiveEState;
}
export const sourceLinks: Partial<Record<SheetPreset, { title: string; url: string }[]>> = {
  '5e-character': [{ title: 'D&D SRD 5.2.1 · CC BY 4.0', url: 'https://www.dndbeyond.com/srd' }],
  '5e-stat-block': [{ title: 'D&D SRD 5.2.1 · CC BY 4.0', url: 'https://www.dndbeyond.com/srd' }],
  coc7: [{ title: 'Chaosium · Call of Cthulhu 7e Quick-Start', url: 'https://www.chaosium.com/cthulhu-quickstart/' }, {title:'Chaosium · Rules wiki',url:'https://cthulhuwiki.chaosium.com/rules/'}],
  'daggerheart-character': [{ title: 'Daggerheart SRD 2.0', url: 'https://www.daggerheart.com/srd/' }],
  'daggerheart-adversary': [{ title: 'Daggerheart SRD 2.0', url: 'https://www.daggerheart.com/srd/' }],
};
const d20Traits = ['Strength','Dexterity','Constitution','Intelligence','Wisdom','Charisma'];
export const d20Skills: [string, string][] = [['Acrobatics','dexterity'],['Animal Handling','wisdom'],['Arcana','intelligence'],['Athletics','strength'],['Deception','charisma'],['History','intelligence'],['Insight','wisdom'],['Intimidation','charisma'],['Investigation','intelligence'],['Medicine','wisdom'],['Nature','intelligence'],['Perception','wisdom'],['Performance','charisma'],['Persuasion','charisma'],['Religion','intelligence'],['Sleight of Hand','dexterity'],['Stealth','dexterity'],['Survival','wisdom']];
const cocSkills: [string, number][] = [['Art / Craft',5],['Fighting (specialty)',0],['Accounting',5],['Anthropology',1],['Appraise',5],['Archaeology',1],['Charm',15],['Climb',20],['Computer Use',5],['Credit Rating',0],['Cthulhu Mythos',0],['Disguise',5],['Dodge',0],['Drive Auto',20],['Electrical Repair',10],['Fast Talk',5],['Fighting (Brawl)',25],['Firearms (Handgun)',20],['Firearms (Rifle/Shotgun)',25],['First Aid',30],['History',5],['Intimidate',15],['Jump',20],['Language (Other)',1],['Language (Own)',0],['Law',5],['Library Use',20],['Listen',20],['Locksmith',1],['Mechanical Repair',10],['Medicine',1],['Natural World',10],['Navigate',10],['Occult',5],['Operate Heavy Machinery',1],['Persuade',10],['Pilot',1],['Psychology',10],['Psychoanalysis',1],['Ride',5],['Science',1],['Sleight of Hand',10],['Spot Hidden',25],['Stealth',20],['Survival',10],['Swim',20],['Throw',20],['Track',10]];
export function createSheet(preset: SheetPreset, title = ''): CharacterSheet {
  const now = Date.now();
  const sheet: CharacterSheet = { id: crypto.randomUUID(), title, preset, details: {}, numbers: {}, traits: [], skills: [], resources: [], rows: [], rolls: [], revision: 0, createdAt: now, updatedAt: now };
  const resource = (id: string, label: string, max: number, current = max, marked = false): SheetResource => ({id,label,max,current,marked});
  if (preset.startsWith('5e')) {
    if(preset==='5e-stat-block'){sheet.paperLayout='stat-block';sheet.statBlockXp={version:1,zeroCrXp:10};}
    sheet.traits = d20Traits.map(label => ({id:label.toLowerCase(),label,value:10}));
    sheet.skills = d20Skills.map(([label,traitId]) => ({id:crypto.randomUUID(),label,traitId,training:0,value:0,bonus:0}));
    sheet.traits.forEach(trait => sheet.skills.push({id:crypto.randomUUID(),label:`${trait.label} save`,traitId:trait.id,training:0,value:0,bonus:0}));
    sheet.numbers = {level:1,experience:0,challenge:0,armorClass:10,speed:30,initiativeBonus:0,spellAbility:3};
    sheet.details = {class:'',species:'',background:'',alignment:'',size:'',type:'',senses:'',languages:'',resistances:'',immunities:'',vulnerabilities:'',conditions:'',hitDice:'',spellcasting:'',player:'',appearance:'',ideals:'',bonds:'',flaws:'',backstory:'',wealth:'',tools:'',notes:''};
    sheet.resources = [resource('hp','HP',10),resource('inspiration','Inspiration',1,0),resource('tempHp','Temporary HP',0),resource('hitDice','Hit dice',1),resource('deathSuccess','Death save successes',3,0,true),resource('deathFail','Death save failures',3,0,true)];
    for(let level=1;level<=9;level++) sheet.resources.push(resource(`slot${level}`,`Spell slots ${level}`,0));
  } else if (preset === 'coc7') {
    sheet.traits = ['STR','CON','SIZ','DEX','APP','EDU','INT','POW'].map(label => ({id:label.toLowerCase(),label,value:50}));
    sheet.skills = cocSkills.map(([label,value]) => ({id:crypto.randomUUID(),label,training:0,value: label === 'Dodge' ? 25 : label === 'Language (Own)' ? 50 : value,bonus:0}));
    sheet.numbers={age:30,move:8,build:0};
    sheet.details={player:'',gender:'',appearance:'',encounters:'',cash:'',assets:'',spendingLevel:'',occupation:'',birthplace:'',residence:'',pronouns:'',era:'1920s',damageBonus:'0',ideology:'',people:'',places:'',possessions:'',traits:'',injuries:'',phobias:'',conditions:'',notes:''};
    sheet.resources=[resource('hp','HP',10),resource('sanity','Sanity',99,50),resource('mp','Magic points',10),resource('luck','Luck',99,50)];
    sheet.coc={version:1,era:'1920s',pulp:false,overrides:{},conditions:{},checkedSkills:[],dayStartSanity:50,daySanityLoss:0};
  } else if (preset.startsWith('daggerheart')) {
    sheet.traits=['Agility','Strength','Finesse','Instinct','Presence','Knowledge'].map((label,index)=>({id:label.toLowerCase(),label,value:[2,1,1,0,0,-1][index]}));
    sheet.numbers={level:1,proficiency:1,evasion:10,major:6,severe:12,attack:0,difficulty:10,tier:1};
    sheet.details={player:'',pronouns:'',description:'',background:'',connections:'',class:'',subclass:'',ancestry:'',community:'',domains:'',adversaryType:'',motives:'',weapon:'',range:'',damage:'',armor:'',conditions:'',notes:''};
    sheet.resources=[resource('hp','HP marked',6,0,true),resource('stress','Stress marked',6,0,true),resource('armor','Armor slots marked',3,0,true)];
    if (preset==='daggerheart-character') sheet.resources.push(resource('hope','Hope',6,2));
    else sheet.resources.push(resource('fear','Fear (GM)',12,0));
  } else {
    sheet.traits=['Body','Mind','Spirit'].map(label=>({id:crypto.randomUUID(),label,value:0}));
    sheet.resources=[resource('health','Health',10)];sheet.details={notes:''};
  }
  return sheet;
}
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value==='object' && !Array.isArray(value)); }
export function validateSheet(value: unknown): asserts value is CharacterSheet {
  const fail=()=>{throw new Error('invalid_sheet');};
  if(!record(value) || typeof value.id!=='string' || !value.id || typeof value.title!=='string' || value.title.length>300 || !presets.includes(value.preset as SheetPreset)) return fail();
  if(value.linkedEntryId!==undefined && typeof value.linkedEntryId!=='string') return fail();
  if(value.fiveE!==undefined&&(value.preset!=='5e-character'||!validFiveE(value.fiveE)||!Number.isInteger((value.numbers as Record<string,number>)?.level)||(value.numbers as Record<string,number>).level<1||(value.numbers as Record<string,number>).level>20))return fail();
  if(value.coc!==undefined && (value.preset!=='coc7'||!validCocState(value.coc))) return fail();
  if(value.ink!==undefined&&!validSheetInk(value.ink))return fail();
  if(value.paperLayout!==undefined&&value.paperLayout!=='record'&&(value.paperLayout!=='stat-block'||value.preset!=='5e-stat-block'))return fail();
  if(value.daggerheartClass!==undefined&&(value.preset!=='daggerheart-character'||!validDaggerheartClass(value.daggerheartClass)))return fail();
  if(value.statBlockXp!==undefined&&(value.preset!=='5e-stat-block'||!validStatBlockXp(value.statBlockXp)))return fail();
  for(const field of ['revision','createdAt','updatedAt']) if(!Number.isSafeInteger(value[field]) || (value[field] as number)<0) return fail();
  if(!record(value.details)||!record(value.numbers)||Object.keys(value.details).length>200||Object.keys(value.numbers).length>200) return fail();
  if(Object.values(value.details).some(item=>typeof item!=='string'||item.length>100000)||Object.values(value.numbers).some(item=>typeof item!=='number'||!Number.isFinite(item)||Math.abs(item)>1000000)) return fail();
  for(const field of ['traits','skills','resources','rows','rolls']) {
    const items=value[field];if(!Array.isArray(items)||items.length>(field==='rolls'?200:500)) return fail();
    const ids=new Set<string>();
    for(const item of items) {if(!record(item)||typeof item.id!=='string'||!item.id||ids.has(item.id))return fail();ids.add(item.id);
      const textFields=field==='rows'?['section','name','detail','expression']:field==='rolls'?['label','expression','outcome']:['label'];
      if(textFields.some(key=>typeof item[key]!=='string'||(item[key] as string).length>100000))return fail();
      const numberFields=field==='traits'?['value']:field==='skills'?['value','bonus','training']:field==='resources'?['current','max']:field==='rows'?['quantity']:['at','total'];
      if(numberFields.some(key=>typeof item[key]!=='number'||!Number.isFinite(item[key])||Math.abs(item[key] as number)>Number.MAX_SAFE_INTEGER))return fail();
      if(field==='rows'&&item.fiveESpell!==undefined&&(value.preset!=='5e-character'||!validFiveESpell(item.fiveESpell)))return fail();
      if(field==='rows'&&item.fiveEAttack!==undefined&&(value.preset!=='5e-character'||!validFiveEAttack(item.fiveEAttack)))return fail();
      if(field==='skills'&&(![0,1,2].includes(item.training as number)||(item.traitId!==undefined&&typeof item.traitId!=='string')))return fail();
      if(field==='resources'&&(typeof item.marked!=='boolean'||(item.max as number)<0||(item.current as number)<0||(item.current as number)>(item.max as number)))return fail();
      if(field==='rolls'&&(!Array.isArray(item.dice)||item.dice.length>200||item.dice.some(n=>typeof n!=='number'||!Number.isFinite(n))||(item.target!==undefined&&(typeof item.target!=='number'||!Number.isFinite(item.target)))))return fail();
      if(field==='rolls'&&((item.at as number)<0||(item.at as number)>8640000000000000))return fail();
      if(field==='rolls'&&item.appliedResources!==undefined&&typeof item.appliedResources!=='boolean')return fail();
      if(field==='rolls'&&((item.passed!==undefined&&typeof item.passed!=='boolean')||(item.difficulty!==undefined&&!['regular','hard','extreme'].includes(item.difficulty as string))))return fail();
      if(field==='rolls'&&item.coc!==undefined){const meta=item.coc;if(!record(meta)||!['trait','skill','combat','sanity','luck','constitution','intelligence','improvement'].includes(String(meta.kind))||typeof meta.rating!=='number'||!Number.isFinite(meta.rating)||['skillId','pushedFrom','pushedBy','justification'].some(key=>meta[key]!==undefined&&(typeof meta[key]!=='string'||(meta[key] as string).length>100000)))return fail();}
    }
  }
}
export function exportSheet(sheet: CharacterSheet): string {validateSheet(sheet);return JSON.stringify({format:'writers-hoard-character-sheet',version:1,sheet},null,2);}
export function parseSheetImport(text: string): CharacterSheet {
  if(text.length>8000000)throw new Error('too_large');const parsed: unknown=JSON.parse(text);
  if(!record(parsed)||parsed.format!=='writers-hoard-character-sheet'||parsed.version!==1)throw new Error('invalid_format');
  validateSheet(parsed.sheet);const next=structuredClone(parsed.sheet);next.id=crypto.randomUUID();next.revision=0;next.createdAt=Date.now();next.updatedAt=next.createdAt;
  return next;
}
