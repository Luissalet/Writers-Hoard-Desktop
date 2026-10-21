import {d20Skills,type CharacterSheet} from './types';
import {abilityModifier,skillBonus} from './mechanics';
import {statBlockDerived,challengeLabel} from './statBlock';
import {sheetInkHeight,sheetInkSvg} from './ink';
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const named=(value:string)=>value.replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ');
const signed=(value:number)=>(value>=0?'+':'')+value;
const abilities=['strength','dexterity','constitution','intelligence','wisdom','charisma'];
const groups=[['Traits','Rasgos',['traits','features','rasgos','dotes']],['Actions','Acciones',['actions','acciones']],['Bonus actions','Acciones adicionales',['bonus actions','bonus action','acciones adicionales','accion adicional']],['Reactions','Reacciones',['reactions','reacciones']],['Legendary actions','Acciones legendarias',['legendary actions','acciones legendarias']],['Lair actions','Acciones de guarida',['lair actions','acciones de guarida']],['Mythic actions','Acciones míticas',['mythic actions','acciones miticas']]] as const;
const fold=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
/** Original stat-block composition. The record renderer and stored ink never migrate. */
export function statBlockPaper(sheet:CharacterSheet,locale:'es'|'en'):{svg:string;height:number}{
 const es=locale==='es',derived=statBlockDerived(sheet)!,canvas=document.createElement('canvas').getContext('2d')!,elements:string[]=[];canvas.font='16px Arial';let y=54;
 const wrap=(value:unknown,width=904)=>{const lines:string[]=[];for(const paragraph of String(value??'').split('\n')){let line='';for(const token of paragraph.split(/(\s+)/)){if(canvas.measureText(line+token).width<=width){line+=token;continue;}if(line.trim())lines.push(line.trimEnd());line='';for(const char of token){if(canvas.measureText(line+char).width>width&&line){lines.push(line);line='';}line+=char;}}lines.push(line.trimEnd());}return lines;};
 const text=(x:number,at:number,value:unknown,size=16,bold=false,width=904)=>{const family=size>=25?'Georgia,serif':'Arial,sans-serif',leading=Math.max(22,Math.ceil(size*1.35));canvas.font=`${bold?'bold ':''}${size}px ${family}`;const lines=wrap(value,width);elements.push(`<text x="${x}" y="${at}" font-family="${family}" font-size="${size}" font-weight="${bold?'bold':'normal'}" fill="#272b2b">${lines.map((line,i)=>`<tspan x="${x}" dy="${i?leading:0}">${esc(line)}</tspan>`).join('')}</text>`);return lines.length*leading;};
 const line=(label:string,value:unknown)=>{y+=text(48,y,`${label}: ${value}`)+5;};
 const section=(title:string)=>{y+=12;elements.push(`<path d="M48 ${y-8}H952" stroke="#a8b9b5"/>`);y+=text(48,y+12,title,21,true)+22;};
 y+=text(48,y,sheet.title,30,true)+12;
 const identity=[sheet.details.size,sheet.details.type,sheet.details.alignment].filter(Boolean).join(' · ');if(identity)y+=text(48,y,identity,15)+12;
 const hp=sheet.resources.find(row=>row.id==='hp'),temp=sheet.resources.find(row=>row.id==='tempHp');
 const resourceValue=(resource:CharacterSheet['resources'][number])=>`${resource.current} / ${resource.max}${resource.marked?(es?' · marcado':' · marked'):''}`;
 line(es?'CA':'AC',sheet.numbers.armorClass??'—');line(hp?.label|| (es?'PV':'HP'),hp?`${resourceValue(hp)}${sheet.details.hitDice?' · '+sheet.details.hitDice:''}`:'—');
 line(es?'Velocidad':'Speed',sheet.numbers.speed??'—');
 const dex=sheet.traits.find(row=>row.id==='dexterity');line(es?'Iniciativa':'Initiative',signed(abilityModifier(dex?.value??10)+(sheet.numbers.initiativeBonus??0)));
 y+=8;canvas.font='bold 13px Arial';const cell=904/6,scoreAt=39+22*Math.max(...abilities.map(id=>wrap(sheet.traits.find(row=>row.id===id)?.label??id,cell-18).length)),abilityHeight=scoreAt+27;elements.push(`<rect x="48" y="${y}" width="904" height="${abilityHeight}" fill="#e8eeea"/>`);
 abilities.forEach((id,index)=>{const trait=sheet.traits.find(row=>row.id===id),x=60+index*cell;text(x,y+25,trait?.label??id.slice(0,3).toUpperCase(),13,true,cell-18);text(x,y+scoreAt,trait?`${trait.value} (${signed(abilityModifier(trait.value))})`:'—',19,false,cell-18);});y+=abilityHeight+28;
 line('CR',`${derived.authoredChallenge===null?'—':challengeLabel(derived.authoredChallenge)} · XP ${derived.effectiveXp??'—'} (${derived.xpSource==='legacy'?(es?'registrado':'recorded'):derived.xpSource==='override'?(es?'manual':'override'):'CR'}) · PB ${signed(derived.proficiency)}`);
 if(derived.automaticXp===null)line(es?'XP por CR':'CR XP',es?'CR fuera de la tabla':'CR outside the table');
 if(temp&&(temp.current||temp.max||temp.marked||temp.label!=='Temporary HP'))line(temp.label|| (es?'PV temporales':'Temporary HP'),resourceValue(temp));
 const shownDetails=new Set(['size','type','alignment',...(hp?['hitDice']:[])]);
 const detailNames:Record<string,string>={resistances:es?'Resistencias':'Resistances',immunities:es?'Inmunidades':'Immunities',vulnerabilities:es?'Vulnerabilidades':'Vulnerabilities',conditions:es?'Condiciones':'Conditions',senses:es?'Sentidos':'Senses',languages:es?'Idiomas':'Languages'};
 for(const[key,label]of Object.entries(detailNames)){if(sheet.details[key])line(label,sheet.details[key]);shownDetails.add(key);}
 const defaultSkills=new Set([...d20Skills.map(([name])=>name),...abilities.map(id=>id[0].toUpperCase()+id.slice(1)+' save')]);
 const trained=sheet.skills.filter(row=>!defaultSkills.has(row.label)||row.training!==0||row.value!==0||row.bonus!==0);if(trained.length)line(es?'Habilidades y salvaciones':'Skills and saves',trained.map(row=>`${row.label} ${signed(skillBonus(sheet,row))}`).join(' · '));
 const extras=sheet.traits.filter(row=>!abilities.includes(row.id));if(extras.length)line(es?'Otros rasgos':'Other abilities',extras.map(row=>`${row.label} ${row.value}`).join(' · '));
 const resourceDefaults:Record<string,[number,number,boolean]>={inspiration:[0,1,false],hitDice:[1,1,false],deathSuccess:[0,3,true],deathFail:[0,3,true],...Object.fromEntries(Array.from({length:9},(_,i)=>['slot'+(i+1),[0,0,false] as [number,number,boolean]]))};
 const resourceLabels:Record<string,string>={inspiration:'Inspiration',hitDice:'Hit dice',deathSuccess:'Death save successes',deathFail:'Death save failures',...Object.fromEntries(Array.from({length:9},(_,i)=>['slot'+(i+1),'Spell slots '+(i+1)]))};
 for(const resource of sheet.resources){if(resource.id==='hp'||resource.id==='tempHp')continue;const d=resourceDefaults[resource.id];if(!d||resource.label!==resourceLabels[resource.id]||resource.current!==d[0]||resource.max!==d[1]||resource.marked!==d[2])line(resource.label,`${resource.current} / ${resource.max}${resource.marked?(es?' · marcado':' · marked'):''}`);}
 const detailExtras=Object.entries(sheet.details).filter(([key,value])=>!shownDetails.has(key)&&value);if(detailExtras.length){section(es?'Otros detalles':'Other details');for(const[key,value]of detailExtras)line(named(key),value);}
 const numberExtras=Object.entries(sheet.numbers).filter(([key])=>!['challenge','armorClass','speed','initiativeBonus'].includes(key));if(numberExtras.length){section(es?'Valores registrados':'Recorded values');for(const[key,value]of numberExtras)line(key==='experience'?(es?'XP registrado':'Recorded XP'):named(key),value);}
 const printed=new Set<string>();
 const rows=(title:string,items:CharacterSheet['rows'])=>{if(!items.length)return;section(title);for(const row of items){printed.add(row.id);if(row.name)y+=text(48,y,row.name,17,true)+3;if(row.detail)y+=text(48,y,row.detail)+3;const meta=[row.expression,row.quantity!==1?`${es?'Cantidad':'Quantity'} ${row.quantity}`:''].filter(Boolean).join(' · ');if(meta)y+=text(48,y,meta,14)+3;if(!row.name&&!row.detail&&!meta)y+=text(48,y,'—');y+=10;}};
 for(const[en,spanish,aliases]of groups)rows(es?spanish:en,sheet.rows.filter(row=>aliases.some(alias=>alias===fold(row.section))));
 for(const name of new Set(sheet.rows.filter(row=>!printed.has(row.id)).map(row=>row.section)))rows(name|| (es?'Otras entradas':'Other entries'),sheet.rows.filter(row=>!printed.has(row.id)&&row.section===name));
 if(sheet.rolls.length){section(es?'Historial de tiradas':'Roll history');for(const roll of sheet.rolls)line(roll.label,`${roll.expression} · [${roll.dice.join(', ')}] = ${roll.total} · ${roll.outcome}`);}
 const height=Math.ceil(Math.max(700,y+48,sheetInkHeight(sheet.ink)+48)),prefix='sheet-ink-'+crypto.randomUUID();
 return{height,svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 ${height}" width="1000" height="${height}" role="img" aria-label="${esc(sheet.title)}" data-sheet-paper="paper-v1" data-sheet-layout="stat-block" style="display:block;width:100%;height:auto;max-height:none"><rect width="1000" height="${height}" fill="#f6f2e8"/>${elements.join('')}${sheetInkSvg(sheet.ink,height,prefix)}</svg>`};
}
