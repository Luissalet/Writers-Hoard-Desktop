import '@/engines';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {getBridgeTool} from '@/services/aiBridge/manifest';
import TablesEngine from '@/engines/tables/TablesEngine';
import {CONDITION_OPS,meetsCondition,type TableCondition} from '@/engines/tables/tableEdits';
import {tableCopy} from '@/engines/tables/copy';
import type {WorldTable} from '@/engines/tables/types';
import {useLocaleStore} from '@/stores/localeStore';
const assert=(value:unknown,message:string):asserts value=>{if(!value)throw Error(message);};
const pause=()=>new Promise(resolve=>setTimeout(resolve,25));
const cases=[{op:'notContains',column:0,value:'áGoRa',names:['Agoranorte','Puerta Sur','']},{op:'startsWith',column:0,value:'áG',names:['Ágora Norte']},{op:'endsWith',column:0,value:'áGoRa',names:['Puerto Ágora']},{op:'gte',column:1,value:'2450',names:['Ágora Norte','Agoranorte','Puerto Ágora']},{op:'lte',column:1,value:'2450',names:['Ágora Norte','Agoranorte','Puerta Sur','']}]as const;
const CSV='Nombre;Importe;Marcado\nÁgora Norte;2450;true\nAgoranorte;02450;false\nPuerto Ágora;2451;false\nPuerta Sur;0;true\n;;false';
async function fixture(projectId:string){
 await db.projects.put({id:projectId,title:'Table filter QA',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['tables'],engineOrder:[],createdAt:1,updatedAt:1});
 const imported=await runBridgeTool('wh_table_import_csv',{projectId,title:'Imported filters',csv:CSV,delimiter:';',decimal:'.',columnKinds:['text','number','text']});assert(imported.ok,'Normal CSV import failed: '+JSON.stringify(imported));return(imported.result as {table:WorldTable}).table;
}
const sorted=(names:readonly string[])=>[...names].sort().join('|');
export async function testTableFilterOperators(){
 const P='table-filter-operators';
 try{
  const table=await fixture(P),before=JSON.stringify(await db.projects.get(P));
  for(const item of cases){const response=await runBridgeTool('wh_table_query',{projectId:P,tableId:table.id,conditions:[{columnId:table.columns[item.column].id,op:item.op,value:item.value}]});assert(response.ok,'Registered query refused '+item.op+': '+JSON.stringify(response));const names=(response.result as {rows:{cells:Record<string,string>}[]}).rows.map(row=>row.cells.Nombre);assert(sorted(names)===sorted(item.names),item.op+' query rows differ: '+JSON.stringify(names));}
  const native=getBridgeTool('wh_table_query')!,schema=native.schema.properties.conditions as {items:{properties:{op:{enum:readonly string[]}}}};for(const item of cases)assert(schema.items.properties.op.enum.includes(item.op),'Native schema omits '+item.op);
  for(const op of ['contains','equals','notEquals','gt','lt','empty','notEmpty','checked','unchecked'])assert((CONDITION_OPS as readonly string[]).includes(op),'Existing operator removed '+op);
  const boundary=async(op:string,value:string)=>{const response=await runBridgeTool('wh_table_query',{projectId:P,tableId:table.id,conditions:[{columnId:table.columns[1].id,op,value}]});assert(response.ok,'Boundary query refused');return(response.result as {rows:{cells:Record<string,string>}[]}).rows.map(row=>row.cells.Nombre);};
  assert(!(await boundary('gt','2450')).includes('Ágora Norte')&&!(await boundary('lt','2450')).includes('Ágora Norte'),'Existing strict inequalities changed');
  assert((await boundary('gte','0')).includes('Puerta Sur')&&(await boundary('lte','0')).includes('Puerta Sur'),'Numeric zero excluded at inclusive boundary');
  assert(!meetsCondition('Ágora',{columnId:'x',op:'startsWith',value:'Ago'} as TableCondition)&&meetsCondition('Ágora',{columnId:'x',op:'startsWith',value:'áG'} as TableCondition),'Text comparison changed diacritic/case semantics');
  assert(meetsCondition('  puerto',{columnId:'x',op:'startsWith',value:'pu'} as TableCondition)===false&&meetsCondition('',{columnId:'x',op:'notContains',value:''} as TableCondition)===false,'Prefix/negative containment unexpectedly trimmed or changed empty target');
  for(const value of ['', ' ', '0', '02450', '2450', '2451', '-1', '2e3', 'NaN']){
   assert(meetsCondition(value,{columnId:'x',op:'gte',value:'2450'} as TableCondition)===(meetsCondition(value,{columnId:'x',op:'gt',value:'2450'})||meetsCondition(value,{columnId:'x',op:'equals',value:'2450'})),'gte diverges from existing comparison for '+JSON.stringify(value));
   assert(meetsCondition(value,{columnId:'x',op:'lte',value:'2450'} as TableCondition)===(meetsCondition(value,{columnId:'x',op:'lt',value:'2450'})||meetsCondition(value,{columnId:'x',op:'equals',value:'2450'})),'lte diverges from existing comparison for '+JSON.stringify(value));
  }
  assert(!(await runBridgeTool('wh_table_query',{projectId:P,tableId:table.id,conditions:[{columnId:table.columns[0].id,op:'invented-filter',value:''}]})).ok,'Unknown operator accepted');assert(before===JSON.stringify(await db.projects.get(P)),'Read-only filtering altered imported table');
  return['Normal CSV import and registered wh_table_query apply five added operators with exact2450/zero boundaries, strict legacy inequalities and full manifest discovery','Text case/diacritics/whitespace, blank and numeric-string behavior follow existing operators; invalid operation rejects and reads preserve stored data'];
 }finally{await deleteProject(P);}
}
export async function testTableFilterOptionsUI(){
 const P='table-filter-options-ui',host=document.createElement('div');document.body.append(host);const root=createRoot(host),passed:string[]=[];
 const wait=async(check:()=>boolean,label:string)=>{for(let i=0;i<120;i++){if(check())return;await act(async()=>{await pause();});}throw Error('UI did not settle '+label);};
 const set=async(selector:string,value:string)=>{const input=host.querySelector<HTMLInputElement|HTMLSelectElement>(selector);assert(input,'Missing UI input '+selector);await act(async()=>{Object.getOwnPropertyDescriptor(input instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event(input instanceof HTMLSelectElement?'change':'input',{bubbles:true}));await pause();});};
 try{
  const table=await fixture(P);
  for(const locale of ['en','es']as const){useLocaleStore.setState({locale,loaded:true});await act(async()=>{root.render(<MemoryRouter><TablesEngine key={locale} projectId={P}/></MemoryRouter>);});await wait(()=>!!host.querySelector('[data-testid="table-filter-add"]'),'filter control');await act(async()=>{host.querySelector<HTMLButtonElement>('[data-testid="table-filter-add"]')!.click();await pause();});
   const options=host.querySelector<HTMLSelectElement>('[data-testid="table-filter-op-0"]')!;for(const item of cases){const option=[...options.options].find(option=>option.value===item.op);assert(option&&option.text===String((tableCopy[locale].ops as Record<string,string>)[item.op]),locale+' UI missing translated operator '+item.op);}
   for(const item of cases){await set('[data-testid="table-filter-column-0"]',table.columns[item.column].id);await set('[data-testid="table-filter-op-0"]',item.op);await set('[data-testid="table-filter-value-0"]',item.value);const names=[...host.querySelectorAll<HTMLTextAreaElement>('tbody tr[data-row-id] td textarea')].filter(node=>node.getAttribute('aria-label')?.endsWith('Nombre')).map(node=>node.value);assert(sorted(names)===sorted(item.names),locale+' actual rendered '+item.op+' differs: '+JSON.stringify(names));}
   passed.push(locale+': all five translated filters select actual imported rows through TablesEngine, including2450 inclusive boundaries');
  }
  return passed;
 }finally{await act(async()=>root.unmount());host.remove();await deleteProject(P);}
}
