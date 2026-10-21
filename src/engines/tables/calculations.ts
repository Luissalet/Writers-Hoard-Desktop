import {db} from '@/db';
import type {WorldEraScope} from '@/services/worldEras/types';
import {getEraProject,readWorldDocument} from '@/services/worldEras/store';
import {saveCodexTemplate} from '@/engines/codex/templates';
import type {CalculationResultType,CodexPropertyDefinition} from '@/engines/codex/templateTypes';
import {bindPropertyFormulas} from '@/engines/codex/properties';
import {addTable,changeTable} from './operations';
import {bindTableFormula,effectiveTableColumns,tableDefinitions} from './projection';
import type {DataColumn,WorldTable} from './types';
export async function createTypeTable(scope:WorldEraScope,title:string,templateId:string):Promise<WorldTable>{
 return db.transaction('rw',db.tables,async()=>{const project=await getEraProject(scope),template=project.codexTemplates?.find(item=>item.id===templateId);if(!template)throw Error('table_template_missing');if(!title.trim())throw Error('table_title_required');const table:WorldTable={id:crypto.randomUUID(),title:title.trim(),mode:'table',codexType:template.category,codexTemplateId:templateId,columns:[{id:crypto.randomUUID(),name:'Name',kind:'text',field:'title'}],rows:[]};table.columns=effectiveTableColumns(table,project.codexTemplates??[]);await addTable(scope.projectId,table,scope.eraId);return table;});
}
export interface SaveTableCalculation {tableId:string;columnId?:string;name:string;formula:string;resultType:CalculationResultType;expectedVersion:string;expectedTemplateRevision?:number}
/** Promote only formulas whose dependencies are representable type properties; local/title/set calculations remain in this table. */
export async function saveTableCalculation(scope:WorldEraScope,input:SaveTableCalculation):Promise<{column:DataColumn;promoted:boolean}>{
 return db.transaction('rw',db.tables,async()=>{
 const read=await readWorldDocument(scope,'tables',input.tableId);if(!read||read.version!==input.expectedVersion)throw Error('table_conflict');const table=read.document.root as unknown as WorldTable;if(table.mode==='sheet')throw Error('table_sheet_uses_cell_formulas');
 const project=await getEraProject(scope),templates=project.codexTemplates??[],columns=effectiveTableColumns(table,templates),existing=columns.find(column=>column.id===input.columnId);if(input.columnId&&!existing)throw Error('table_column_missing');if(!input.name.trim()||input.name.includes(']')||columns.some(column=>column.id!==input.columnId&&column.name.toLocaleLowerCase()===input.name.trim().toLocaleLowerCase()))throw Error('table_column_name_invalid');if(!input.formula.trim()||!['whole','decimal','percent','text'].includes(input.resultType))throw Error('table_calculation_invalid');
 const columnId=existing?.id??crypto.randomUUID(),column:DataColumn={...existing,id:columnId,name:input.name.trim(),kind:input.resultType==='text'?'text':'number'},bound=bindTableFormula(input.formula,[...columns.filter(item=>item.id!==columnId),column]);
 const availableDefinitions=tableDefinitions(table,templates);
 const promoted=Boolean(table.codexTemplateId&&!Object.keys(bound.columnBindings).length&&Object.values(bound.rowBindings).every(target=>target===columnId||columns.some(reference=>reference.id===target&&availableDefinitions.some(definition=>definition.id===reference.propertyId||definition.key===reference.field))));
 if(promoted){const template=templates.find(item=>item.id===table.codexTemplateId);if(!template||template.revision!==input.expectedTemplateRevision)throw Error('template_conflict');const definitions=tableDefinitions(table,templates),previous=definitions.find(item=>item.id===existing?.propertyId||item.key===existing?.field),id=previous?.id??crypto.randomUUID(),key=previous?.key??`calculation:${id}`;
 const rowBindings=Object.fromEntries(Object.entries(bound.rowBindings).map(([name,target])=>{const reference=target===columnId?{propertyId:id}:columns.find(item=>item.id===target),definition=definitions.find(item=>item.id===reference?.propertyId||item.key===(reference as DataColumn|undefined)?.field);return[name,target===columnId?id:definition?.id??`missing:${target}`];}));
 const definition:CodexPropertyDefinition={...previous,id,key,label:column.name,kind:column.kind==='number'?'number':'text',formula:input.formula,formulaBindings:rowBindings,resultType:input.resultType};
 const draft=bindPropertyFormulas({...template,fields:{...template.fields,[key]:template.fields[key]??''},propertyDefinitions:[...template.propertyDefinitions?.filter(item=>item.key!==key)??[],definition]},[...definitions.filter(item=>item.id!==id),definition]);await saveCodexTemplate(scope.projectId,draft,input.expectedTemplateRevision!);
 column.propertyId=id;column.field=key;delete column.calculation;
 }else{if(existing?.propertyId&&table.codexTemplateId)throw Error('table_type_property_cannot_become_aggregate');column.calculation={...bound,resultType:input.resultType};}
 await changeTable(scope.projectId,table.id,current=>{if(current.columns.some(item=>item.id===column.id))current.columns=current.columns.map(item=>item.id===column.id?column:item);else current.columns.push(column);if(column.propertyId)current.hiddenPropertyIds=current.hiddenPropertyIds?.filter(id=>id!==column.propertyId);},scope.eraId);
 return{column,promoted};
 });
}
/** Removing a visible column never silently deletes a shared type property. */
export async function removeTableColumn(scope:WorldEraScope,tableId:string,columnId:string,expectedVersion:string):Promise<void>{await db.transaction('rw',db.tables,async()=>{const read=await readWorldDocument(scope,'tables',tableId);if(!read||read.version!==expectedVersion)throw Error('table_conflict');const table=read.document.root as unknown as WorldTable,project=await getEraProject(scope),column=effectiveTableColumns(table,project.codexTemplates??[]).find(item=>item.id===columnId);if(!column)throw Error('table_column_missing');await changeTable(scope.projectId,tableId,current=>{current.columns=current.columns.filter(item=>item.id!==columnId);if(column.propertyId)current.hiddenPropertyIds=[...new Set([...current.hiddenPropertyIds??[],column.propertyId])];for(const row of current.rows)delete row.cells[columnId];},scope.eraId);});}

/** A type-bound column label is the property label, never a second alias. */
export async function updateTableColumn(scope:WorldEraScope,tableId:string,draft:DataColumn,expectedVersion:string,expectedTemplateRevision?:number):Promise<void>{await db.transaction('rw',db.tables,async()=>{
 const read=await readWorldDocument(scope,'tables',tableId);if(!read||read.version!==expectedVersion)throw Error('table_conflict');const table=read.document.root as unknown as WorldTable,project=await getEraProject(scope),templates=project.codexTemplates??[],columns=effectiveTableColumns(table,templates),current=columns.find(column=>column.id===draft.id);if(!current||!draft.name.trim()||draft.name.includes(']')||columns.some(column=>column.id!==draft.id&&column.name.toLocaleLowerCase()===draft.name.trim().toLocaleLowerCase()))throw Error('table_column_name_invalid');
 if(current.propertyId&&table.codexTemplateId){const template=templates.find(item=>item.id===table.codexTemplateId),definition=tableDefinitions(table,templates).find(item=>item.id===current.propertyId);if(!template||!definition||template.revision!==expectedTemplateRevision)throw Error('template_conflict');await saveCodexTemplate(scope.projectId,{...template,propertyDefinitions:[...template.propertyDefinitions?.filter(item=>item.key!==definition.key)??[],{...definition,label:draft.name.trim()}]},expectedTemplateRevision!);}
 await changeTable(scope.projectId,tableId,current=>{const saved={...columns.find(column=>column.id===draft.id)!,name:draft.name.trim(),width:Math.max(100,Math.min(600,draft.width??180))};if(current.columns.some(column=>column.id===draft.id))current.columns=current.columns.map(column=>column.id===draft.id?saved:column);else current.columns.push(saved);},scope.eraId);
 });}
