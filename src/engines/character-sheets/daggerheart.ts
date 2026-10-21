import type {CharacterSheet,SheetRow} from './types';

export const DAGGERHEART_SOURCE={version:'2.0',date:'2026-08-25',url:'https://www.daggerheart.com/wp-content/uploads/2026/08/DH_SRD_2_2026_08_25.pdf',license:'https://darringtonpress.com/license/'} as const;
// Core class facts from the current official SRD. No rulebook prose/assets.
export const DAGGERHEART_CLASSES=[
 {id:'bard',name:'Bard',evasion:10,hp:5,domains:'Grace / Codex',page:10,features:['Rally'],hope:'Make a Scene'},
 {id:'druid',name:'Druid',evasion:10,hp:6,domains:'Sage / Arcana',page:14,features:['Beastform','Wildtouch'],hope:'Evolution'},
 {id:'guardian',name:'Guardian',evasion:9,hp:7,domains:'Valor / Blade',page:19,features:['Unstoppable'],hope:'Frontline Tank'},
 {id:'ranger',name:'Ranger',evasion:12,hp:6,domains:'Bone / Sage',page:20,features:['Ranger’s Focus'],hope:'Hold Them Off'},
 {id:'rogue',name:'Rogue',evasion:12,hp:6,domains:'Midnight / Grace',page:22,features:['Cloaked','Sneak Attack'],hope:'Rogue’s Dodge'},
 {id:'seraph',name:'Seraph',evasion:9,hp:7,domains:'Splendor / Valor',page:24,features:['Prayer Dice'],hope:'Life Support'},
 {id:'sorcerer',name:'Sorcerer',evasion:10,hp:6,domains:'Arcana / Midnight',page:25,features:['Arcane Sense','Minor Illusion','Channel Raw Power'],hope:'Volatile Magic'},
 {id:'warrior',name:'Warrior',evasion:11,hp:6,domains:'Blade / Bone',page:28,features:['Attack of Opportunity','Combat Training'],hope:'No Mercy'},
 {id:'wizard',name:'Wizard',evasion:11,hp:5,domains:'Codex / Splendor',page:30,features:['Prestidigitation','Strange Patterns'],hope:'Not This Time'},
] as const;
export type DaggerheartClassId=typeof DAGGERHEART_CLASSES[number]['id'];
export const DAGGERHEART_CLASS_FIELDS=['class','domains','evasion','startingHp','features'] as const;
export type DaggerheartClassField=typeof DAGGERHEART_CLASS_FIELDS[number];
export interface DaggerheartClassState {version:1;classId:DaggerheartClassId;applied:{class?:string;domains?:string;evasion?:number;startingHp?:number};rows:SheetRow[]}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function validDaggerheartClass(v:unknown):v is DaggerheartClassState {
 if(!record(v)||v.version!==1||!DAGGERHEART_CLASSES.some(c=>c.id===v.classId)||!record(v.applied)||!Array.isArray(v.rows)||v.rows.length>32)return false;
 if(Object.entries(v.applied).some(([key,value])=>!['class','domains','evasion','startingHp'].includes(key)||(key==='class'||key==='domains'?typeof value!=='string'||value.length>100000:typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1000000)))return false;
 const ids=new Set<string>();
 return v.rows.every(row=>{if(!record(row)||typeof row.id!=='string'||!row.id||ids.has(row.id)||['section','name','detail','expression'].some(key=>typeof row[key]!=='string'||(row[key] as string).length>100000)||typeof row.quantity!=='number'||!Number.isFinite(row.quantity))return false;ids.add(row.id);return true;});
}
const identicalRow=(a:SheetRow,b:SheetRow)=>['id','section','name','detail','expression','quantity'].every(key=>a[key as keyof SheetRow]===b[key as keyof SheetRow]);
function coreClass(sheet:CharacterSheet,classId:string){if(sheet.preset!=='daggerheart-character')throw Error('daggerheart_character_required');const source=DAGGERHEART_CLASSES.find(c=>c.id===classId);if(!source)throw Error('daggerheart_class_invalid');return source;}
export function daggerheartClassPreview(sheet:CharacterSheet,classId:string){
 const source=coreClass(sheet,classId),hp=sheet.resources.find(r=>r.id==='hp'),applied=sheet.daggerheartClass?.applied;
 const unchangedRows=(sheet.daggerheartClass?.rows??[]).filter(snapshot=>sheet.rows.some(row=>identicalRow(snapshot,row)));
 const protectedRows=(sheet.daggerheartClass?.rows??[]).filter(snapshot=>sheet.rows.some(row=>row.id===snapshot.id&&!identicalRow(snapshot,row))).map(snapshot=>snapshot.id);
 return{source,reference:`${DAGGERHEART_SOURCE.url}#page=${source.page}`,protectedRows,replaceableRows:unchangedRows.map(row=>row.id),changes:[
  {field:'class' as const,before:sheet.details.class??'',after:source.name,safe:!sheet.details.class||sheet.details.class===applied?.class},
  {field:'domains' as const,before:sheet.details.domains??'',after:source.domains,safe:!sheet.details.domains||sheet.details.domains===applied?.domains},
  {field:'evasion' as const,before:sheet.numbers.evasion,after:source.evasion,safe:sheet.numbers.evasion===applied?.evasion||!sheet.daggerheartClass&&!sheet.details.class&&sheet.numbers.evasion===10},
  {field:'startingHp' as const,before:hp?`${hp.current} / ${hp.max}`:'—',after:hp?`${Math.min(hp.current,source.hp)} / ${source.hp}`:'—',safe:false},
  {field:'features' as const,before:unchangedRows.map(row=>row.name).join(', '),after:[...source.features,source.hope].join(', '),safe:true},
 ]};
}
export function applyDaggerheartClass(sheet:CharacterSheet,classId:string,fields:readonly string[]):CharacterSheet {
 const preview=daggerheartClassPreview(sheet,classId),source=preview.source;
 if(!fields.length||fields.some(field=>!DAGGERHEART_CLASS_FIELDS.includes(field as DaggerheartClassField)))throw Error('daggerheart_fields_invalid');
 const next=structuredClone(sheet),state:DaggerheartClassState={version:1,classId:source.id,applied:{...sheet.daggerheartClass?.applied},rows:structuredClone(sheet.daggerheartClass?.rows??[])};
 if(fields.includes('class')){next.details.class=source.name;state.applied.class=source.name;}
 if(fields.includes('domains')){next.details.domains=source.domains;state.applied.domains=source.domains;}
 if(fields.includes('evasion')){next.numbers.evasion=source.evasion;state.applied.evasion=source.evasion;}
 if(fields.includes('startingHp')){const hp=next.resources.find(r=>r.id==='hp');if(!hp)throw Error('daggerheart_hp_missing');hp.max=source.hp;hp.current=Math.min(hp.current,hp.max);state.applied.startingHp=source.hp;}
 if(fields.includes('features')){
  next.rows=next.rows.filter(row=>!preview.replaceableRows.includes(row.id));state.rows=[];
  for(const [index,name]of [...source.features,source.hope].entries()){
   if(next.rows.some(row=>row.name.toLocaleLowerCase('en')===name.toLocaleLowerCase('en')))continue;
   let id=`dh-${source.id}-${index}`,suffix=1;while(next.rows.some(row=>row.id===id))id=`dh-${source.id}-${index}-${suffix++}`;
   const row:SheetRow={id,section:index===source.features.length?'Hope feature':'Class features',name,detail:`${source.name} · SRD ${DAGGERHEART_SOURCE.version} · p. ${source.page}${index===source.features.length?' · Hope cost: 3':''}\n${preview.reference}`,expression:'',quantity:1};next.rows.push(row);state.rows.push(structuredClone(row));
  }
  if(next.rows.length>500)throw Error('daggerheart_rows_limit');
 }
 next.daggerheartClass=state;
 return JSON.stringify(next)===JSON.stringify(sheet)?sheet:next;
}
export function setDaggerheartResource(sheet:CharacterSheet,id:string,value:number):CharacterSheet {
 if(!sheet.preset.startsWith('daggerheart'))throw Error('daggerheart_sheet_required');const resource=sheet.resources.find(r=>r.id===id);
 if(!resource||!Number.isFinite(value)||value<0||value>resource.max)throw Error('daggerheart_resource_invalid');
 return resource.current===value?sheet:{...sheet,resources:sheet.resources.map(r=>r.id===id?{...r,current:value}:r)};
}
export function daggerheartDerived(sheet:CharacterSheet){if(!sheet.preset.startsWith('daggerheart'))return undefined;return{source:DAGGERHEART_SOURCE,coreClasses:sheet.preset==='daggerheart-character'?DAGGERHEART_CLASSES:[],selectedClass:sheet.daggerheartClass?.classId??null,authoredClass:sheet.details.class??'',evasion:sheet.numbers.evasion,level:sheet.numbers.level,tier:sheet.numbers.tier,resources:sheet.resources.map(({id,label,current,max,marked})=>({id,label,current,max,marked}))};}
