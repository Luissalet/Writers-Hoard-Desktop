import { validateSheet,type CharacterSheet } from './types';
import { cocCalculated, resolveCocSheet } from './cocRules';
import { cocConditionKeys, cocDerivedKeys } from './cocTypes';
import { cocConditionNames, cocDerivedNames } from './cocLabels';
import { skillBonus } from './mechanics';
import { sheetInkHeight,sheetInkSvg } from './ink';
import {fiveEDerived,FIVE_E_SOURCE} from './fiveE';
import {statBlockPaper} from './statBlockPaper';
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const label=(value:string)=>value.replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ');
/** Original, complete vector paper. Layout coordinates are independent of viewport width. */
export function sheetPaper(sheet:CharacterSheet,locale:'es'|'en'='en'):{svg:string;height:number} {
  validateSheet(sheet);sheet=resolveCocSheet(sheet);
  if(sheet.preset==='5e-stat-block'&&sheet.paperLayout==='stat-block')return statBlockPaper(sheet,locale);
  const measure=document.createElement('canvas').getContext('2d')!;measure.font='16px Arial';
  const wrap=(value:unknown,width:number)=>{
    const lines:string[]=[];
    for(const paragraph of String(value??'').split('\n')){let line='';for(const word of paragraph.split(/(\s+)/)){if(measure.measureText(line+word).width<=width){line+=word;continue;}if(line.trim())lines.push(line.trimEnd());line='';for(const char of word){if(measure.measureText(line+char).width>width&&line){lines.push(line);line='';}line+=char;}}lines.push(line.trimEnd());}
    return lines;
  };
  let y=52;const elements:string[]=[];
  const text=(x:number,at:number,lines:string[],size=16,weight='normal')=>elements.push(`<text x="${x}" y="${at}" font-family="Arial,sans-serif" font-size="${size}" font-weight="${weight}" fill="#272b2b">${lines.map((line,index)=>`<tspan x="${x}" dy="${index?22:0}">${esc(line)}</tspan>`).join('')}</text>`);
  text(48,y,wrap(sheet.title,850),28,'bold');y+=wrap(sheet.title,850).length*34;text(48,y,[sheet.preset],14);y+=30;
  const section=(name:string,columns:string[],rows:unknown[][])=>{
    if(!rows.length)return;
    y+=22;text(48,y,[name],21,'bold');y+=24;
    const width=904/columns.length;
    const row=(values:unknown[],header=false)=>{const lines=values.map(value=>wrap(value,width-24)),height=Math.max(...lines.map(value=>value.length))*22+20;
      elements.push(`<rect x="48" y="${y}" width="904" height="${height}" fill="${header?'#e8e1d2':'#f6f2e8'}" stroke="#c9c3b5"/>`);
      lines.forEach((line,index)=>text(60+index*width,y+25,line,16,header?'bold':'normal'));y+=height;};
    row(columns,true);rows.forEach(values=>row(values));y+=12;
  };
  const es=locale==='es';
  if(sheet.fiveE){const five=fiveEDerived(sheet)!;section(FIVE_E_SOURCE.title,[es?'Campo':'Field',es?'Valor':'Value'],[['Class',five.calculated?.fact.name],['Level',sheet.numbers.level],['PB',five.proficiency],['Spell DC',five.spellSaveDc??'—'],['Spell attack',five.spellAttack??'—'],['Source',FIVE_E_SOURCE.url],['License','CC BY 4.0'],['Attribution',FIVE_E_SOURCE.attribution]]);}
  section(es?'Rasgos':'Traits',[es?'Rasgo':'Trait',es?'Valor':'Value'],sheet.traits.map(row=>[row.label,row.value]));
  section(es?'Recursos':'Resources',[es?'Recurso':'Resource',es?'Actual':'Current',es?'Máximo':'Maximum',es?'Marcado':'Marked'],sheet.resources.map(row=>[row.label,row.current,row.max,row.marked]));
  section(es?'Habilidades':'Skills',[es?'Habilidad':'Skill',es?'Valor':'Value',es?'Bonificador':'Bonus',es?'Formación':'Training'],sheet.skills.map(row=>[row.label,row.value,skillBonus(sheet,row),row.training]));
  section(es?'Valores':'Values',[es?'Campo':'Field',es?'Valor':'Value'],Object.entries(sheet.numbers).map(([key,value])=>[label(key),value]));
  section(es?'Detalles':'Details',[es?'Campo':'Field',es?'Valor':'Value'],Object.entries(sheet.details).map(([key,value])=>[label(key),value]));
  section(es?'Filas':'Rows',[es?'Sección':'Section',es?'Nombre':'Name',es?'Detalle':'Detail',es?'Expresión':'Expression',es?'Cantidad':'Quantity'],sheet.rows.filter(row=>!row.fiveESpell).map(row=>[row.section,row.name,row.detail,row.expression,row.quantity]));
  section(es?'Conjuros':'Spells',[es?'Sección':'Section',es?'Nivel':'Level',es?'Nombre':'Name',es?'Preparado':'Prepared',es?'Detalle':'Detail',es?'Expresión':'Expression',es?'Cantidad':'Quantity'],sheet.rows.filter(row=>row.fiveESpell).map(row=>[row.section,row.fiveESpell!.level,row.name,row.fiveESpell!.prepared?(es?'Sí [x]':'Yes [x]'):(es?'No [ ]':'No [ ]'),row.detail,row.expression,row.quantity]));
  section(es?'Tiradas':'Rolls',[es?'Etiqueta':'Label',es?'Expresión':'Expression',es?'Dados':'Dice',es?'Total':'Total',es?'Resultado':'Outcome'],sheet.rolls.map(row=>[row.label,row.expression,row.dice.join(', '),row.total,row.outcome]));
  // Append play state after the existing content and ink plane, preserving annotations.
  if(sheet.coc)y=Math.max(y,sheetInkHeight(sheet.ink));
  if(sheet.coc){
    const state=sheet.coc,calculated=cocCalculated(sheet),derived={...calculated,...state.overrides},conditions=cocConditionKeys.filter(key=>state.conditions[key]).map(key=>cocConditionNames[locale][key]);
    const rows:unknown[][]=[
      [es?'Época':'Era',state.era==='modern'?(es?'Moderna':'Modern'):'1920s'],
      ['Pulp',state.pulp?(es?'Sí · PV reforzados':'Yes · increased HP'):(es?'No':'No')],
      [es?'Condiciones':'Conditions',conditions.join(', ')||(es?'Ninguna':'None')],
      [es?'Pérdida hoy / umbral diario':'Lost today / daily threshold',`${state.daySanityLoss} / ${Math.ceil(state.dayStartSanity/5)}`],
      [es?'Cordura al inicio del día':'Day-start sanity',state.dayStartSanity],
    ];
    if(state.pendingCon)rows.push([es?'Tirada pendiente':'Pending check',`CON · ${state.pendingCon==='dying'?(es?'sobrevivir esta ronda':'survive this round'):(es?'mantener la consciencia':'remain conscious')}`]);
    if(state.pendingInt)rows.push([es?'Tirada pendiente':'Pending check',`INT · ${es?'comprender el horror':'comprehend the horror'}`]);
    if(state.temporaryHours!==undefined)rows.push([es?'Duración temporal':'Temporary duration',`${state.temporaryHours} h`]);
    section(es?'Estado del investigador':'Investigator state',[es?'Campo':'Field',es?'Valor':'Value'],rows);
    section(es?'Objetivos de atributos':'Trait targets',[es?'Rasgo':'Trait',es?'Normal / difícil / extremo':'Regular / hard / extreme'],sheet.traits.map(row=>[row.label,`${row.value} / ${Math.floor(row.value/2)} / ${Math.floor(row.value/5)}`]));
    section(es?'Valores calculados y ajustes manuales':'Calculated values and manual overrides',[es?'Campo':'Field',es?'Valor':'Value',es?'Automático':'Automatic',es?'Origen':'Source'],cocDerivedKeys.map(key=>[cocDerivedNames[locale][key],derived[key],calculated[key],state.overrides[key]!==undefined?(es?'Manual':'Manual'):(es?'Automático':'Automatic')]));
    section(es?'Habilidades marcadas para mejora':'Skills marked for development',[es?'Habilidad':'Skill',es?'Valor':'Value'],state.checkedSkills.map(id=>sheet.skills.find(skill=>skill.id===id)).filter(skill=>skill!==undefined).map(skill=>[skill.label,skill.value]));
  }
  if(sheet.coc)section(es?'Contexto de las tiradas':'Roll context',[es?'Etiqueta / fecha':'Label / date',es?'Dificultad / objetivo':'Difficulty / target',es?'Resultado':'Result',es?'Forzada':'Push'],sheet.rolls.filter(row=>row.coc).map(row=>[
    `${row.label} · ${new Date(row.at).toISOString()}`,
    `${row.difficulty??'—'} / ${row.target??'—'}`,
    row.passed===undefined?row.outcome:row.passed?(es?'Éxito':'Passed'):(es?'Fallo':'Failed'),
    row.coc!.pushedFrom?`${es?'Tras':'After'} ${sheet.rolls.find(item=>item.id===row.coc!.pushedFrom)?.total??row.coc!.pushedFrom} · ${row.coc!.justification??''}`:row.coc!.pushedBy?`${es?'Forzada una vez':'Pushed once'} → ${sheet.rolls.find(item=>item.id===row.coc!.pushedBy)?.total??row.coc!.pushedBy}`:'—',
  ]));
  const height=Math.ceil(Math.max(700,y+48,sheetInkHeight(sheet.ink)+48)),prefix='sheet-ink-'+crypto.randomUUID();
  return{height,svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 ${height}" width="1000" height="${height}" role="img" aria-label="${esc(sheet.title)}" data-sheet-paper="paper-v1" style="display:block;width:100%;height:auto;max-height:none"><rect width="1000" height="${height}" fill="#f6f2e8"/>${elements.join('')}${sheetInkSvg(sheet.ink,height,prefix)}</svg>`};
}
