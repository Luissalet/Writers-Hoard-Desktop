import type {CodexEntry} from '@/types';
import type {CodexTemplate,CodexPropertyDefinition} from '@/engines/codex/templateTypes';
import {effectiveCodexTemplate} from '@/engines/codex/templateHierarchy';
import {evaluatePropertyFormula,parsePropertyFormula,projectCodexEntry,propertyDefinitions,formatCalculationValue,type FormulaValue,type FormulaNode} from '@/engines/codex/properties';
import type {DataColumn,DataRow,WorldTable,TableCalculation} from './types';
const tokens=(source:string)=>source.match(/@\[[^\]]+\]|\[[^\]]+\]|"(?:[^"\\]|\\.)*"|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[\p{L}_][\p{L}\p{N}_]*/gu)??[];
export function tableDefinitions(table:WorldTable,templates:readonly CodexTemplate[]):CodexPropertyDefinition[]{const template=templates.find(item=>item.id===table.codexTemplateId);return template?propertyDefinitions(effectiveCodexTemplate(template,templates)):[];}
export function effectiveTableColumns(table:WorldTable,templates:readonly CodexTemplate[]):DataColumn[]{
 const definitions=tableDefinitions(table,templates),columns=table.columns.map(column=>{const definition=definitions.find(item=>item.id===column.propertyId);return definition?{...column,name:definition.label,field:definition.key,kind:definition.kind==='number'?'number' as const:'text' as const}:column;});
 for(const definition of definitions)if(!table.hiddenPropertyIds?.includes(definition.id)&&!columns.some(column=>column.propertyId===definition.id||column.field===definition.key))columns.push({id:`property:${definition.id}`,name:definition.label,field:definition.key,propertyId:definition.id,kind:definition.kind==='number'?'number':'text'});
 return columns;
}
/** Bind user-facing names once; subsequent label changes never change identity. */
export function bindTableFormula(formula:string,columns:readonly DataColumn[],previous?:TableCalculation):Pick<TableCalculation,'formula'|'rowBindings'|'columnBindings'>{
 const rowBindings:Record<string,string>={},columnBindings:Record<string,string>={};
 const source=formula.replace(/^\s*=/,'');let cursor=0;
 for(const token of tokens(source)){const at=source.indexOf(token,cursor);cursor=at+token.length;if(token.startsWith('"')||/^(?:\d|\.)/.test(token))continue;const row=token.startsWith('@['),name=row?token.slice(2,-1):token.startsWith('[')?token.slice(1,-1):token;if(!row&&!token.startsWith('[')&&(source.slice(cursor).trimStart().startsWith('(')||/^(TRUE|FALSE)$/i.test(token)))continue;
 const target=columns.find(column=>column.name.toLocaleLowerCase()===name.toLocaleLowerCase()||column.field?.toLocaleLowerCase()===name.toLocaleLowerCase());
 (row?rowBindings:columnBindings)[name]=(row?previous?.rowBindings:previous?.columnBindings)?.[name]??target?.id??`missing:${name}`;
 }
 return{formula,rowBindings,columnBindings};
}
export function displayTableFormula(calculation:TableCalculation,columns:readonly DataColumn[]):string{
 return calculation.formula.replace(/@\[[^\]]+\]|\[[^\]]+\]|"(?:[^"\\]|\\.)*"|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[\p{L}_][\p{L}\p{N}_]*/gu,token=>{if(token.startsWith('"'))return token;const row=token.startsWith('@['),name=row?token.slice(2,-1):token.startsWith('[')?token.slice(1,-1):token,id=(row?calculation.rowBindings:calculation.columnBindings)[name],label=columns.find(column=>column.id===id)?.name;if(!label)return token;return row?`@[${label}]`:`[${label}]`;});
}
export function columnCalculation(table:WorldTable,column:DataColumn,templates:readonly CodexTemplate[]):TableCalculation|undefined{
 if(column.calculation)return column.calculation;const definitions=tableDefinitions(table,templates),definition=definitions.find(item=>item.id===column.propertyId||item.key===column.field);if(!definition?.formula)return;
 const columns=effectiveTableColumns(table,templates),rowBindings=Object.fromEntries(Object.entries(definition.formulaBindings??{}).map(([name,id])=>[name,columns.find(column=>column.propertyId===id||column.field===definitions.find(item=>item.id===id)?.key)?.id??`missing:${id}`]));
 return{formula:definition.formula,rowBindings,columnBindings:{},resultType:definition.resultType??(definition.kind==='number'?'decimal':'text')};
}
/** One effective, uncached projection for UI, API, CSV and image export. */
export function projectWorldTable(table:WorldTable,entries:readonly CodexEntry[],templates:readonly CodexTemplate[]=[]):{columns:DataColumn[];rows:DataRow[];displayRows:DataRow[];calculatedColumnIds:string[]}{
 const columns=effectiveTableColumns(table,templates),definitions=tableDefinitions(table,templates),live=Boolean(table.codexType||table.codexTemplateId||table.codexAllTypes),selected=entries.filter(entry=>table.codexAllTypes?true:table.codexTemplateId?entry.templateId===table.codexTemplateId:entry.type===table.codexType);
 const projections=new Map(selected.map(entry=>[entry.id,projectCodexEntry(entry,templates)]));
 const source:DataRow[]=live?selected.map(entry=>({id:entry.id,cells:Object.fromEntries(columns.map(column=>[column.id,column.field==='title'?entry.title:column.field==='__type'?entry.type:projections.get(entry.id)?.fields[column.field??column.name]??'']))})):table.rows;
 const calculatedColumnIds=columns.filter(column=>column.calculation||live&&selected.some(entry=>projections.get(entry.id)?.properties[column.field??column.name]?.calculated)||definitions.some(definition=>definition.id===column.propertyId&&definition.formula)).map(column=>column.id);
 const asts=new Map<string,FormulaNode>(),aggregateMemo=new Map<FormulaNode,FormulaValue>(),cache=new Map<string,FormulaValue>(),visiting=new Set<string>();const fail=(code:string):never=>{throw Error(code);};
 const read=(row:DataRow,id:string):FormulaValue=>{const key=JSON.stringify([row.id,id]);if(cache.has(key))return cache.get(key)!;if(visiting.has(key))return fail('#CIRCULAR!');const column=columns.find(column=>column.id===id);if(!column)return fail('#REF!');visiting.add(key);try{
  let value:FormulaValue;if(column.calculation){const calculation=column.calculation,node=asts.get(id)??parsePropertyFormula(calculation.formula,calculation.rowBindings,calculation.columnBindings);asts.set(id,node);value=evaluatePropertyFormula(node,next=>read(row,next),next=>{if(!columns.some(column=>column.id===next))return fail('#REF!');const values:FormulaValue[]=[];for(const item of source)try{values.push(read(item,next));}catch(reason){if(!(reason instanceof Error)||reason.message!=='')throw reason;}return values;},aggregateMemo);if(calculation.resultType==='text'?typeof value!=='string':typeof value!=='number')fail('#VALUE!');}
  else{const raw=row.cells[id]??'';if(!raw.trim())return fail('');if(raw.startsWith('#'))return fail(raw);value=column.kind==='number'?Number(raw):raw;}
  if(typeof value==='number'&&!Number.isFinite(value))fail('#NUM!');cache.set(key,value);return value;
 }finally{visiting.delete(key);}};
 const rows=source.map(row=>({id:row.id,cells:Object.fromEntries(columns.map(column=>{if(!column.calculation)return[column.id,row.cells[column.id]??''];try{return[column.id,String(read(row,column.id))];}catch(reason){return[column.id,reason instanceof Error?reason.message:'#CALC!'];}}))}));
 const displayRows=rows.map(row=>({id:row.id,cells:Object.fromEntries(columns.map(column=>[column.id,column.calculation?formatCalculationValue(row.cells[column.id],column.calculation.resultType):projections.get(row.id)?.properties[column.field??column.name]?.displayValue??row.cells[column.id]]))}));
 return{columns,rows,displayRows,calculatedColumnIds};
}
