import {createProjectZipArchive,importProjectZip} from '@/services/zipBackup';
import '@/engines';
import {db} from '@/db';
import {deleteProject,exportProjectData,importProjectData} from '@/db/operations';
import {saveCodexTemplate} from '@/engines/codex/templates';
import {projectCodexEntry,codexPropertyHtml} from '@/engines/codex/properties';
import {createTypeTable,saveTableCalculation,removeTableColumn,updateTableColumn} from '@/engines/tables/calculations';
import {projectWorldTable,displayTableFormula} from '@/engines/tables/projection';
import {addTable,addColumn,saveCell} from '@/engines/tables/operations';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {readWorldDocument,getEraProject,listEraRows,saveWorldEra} from '@/services/worldEras/store';
import type {CodexEntry,Project} from '@/types';
import type {CodexTemplate} from '@/engines/codex/templateTypes';
import type {WorldTable} from '@/engines/tables/types';
const assert=(value:unknown,message:string):asserts value=>{if(!value)throw Error(message);};
const rejects=async(run:()=>Promise<unknown>)=>{let failed=false;try{await run();}catch{failed=true;}assert(failed,'Expected operation to reject');};
export async function testTableCalculations(){const P='synthetic-table-calculations',scope={projectId:P},past={projectId:P,eraId:'past'};let cloned:string|undefined;const project:Project={id:P,title:P,description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['tables','codex'],engineOrder:[],createdAt:1,updatedAt:1};const version=async(id:string,era=scope)=>(await readWorldDocument(era,'tables',id))!.version;
 const table=async(id:string,era=scope)=>(await readWorldDocument(era,'tables',id))!.document.root as unknown as WorldTable;
 const projectTable=async(id:string,era=scope)=>projectWorldTable(await table(id,era),await listEraRows<CodexEntry>(era,'codexEntries'),(await getEraProject(era)).codexTemplates??[]);
 try{await db.projects.put(project);let template:CodexTemplate=await saveCodexTemplate(P,{id:'sale-type',name:'Sale',category:'item',fields:{price:'',quantity:''},content:'',revision:0,createdAt:1,updatedAt:1,propertyDefinitions:[{id:'price-id',key:'price',label:'Price',kind:'number'},{id:'quantity-id',key:'quantity',label:'Quantity',kind:'number'}]},null);
 const entry=(id:string,price:string,templateId='sale-type'):CodexEntry=>({id,projectId:P,title:id,type:'item',templateId,fields:{price,quantity:'2'},content:'',tags:[],relations:[],createdAt:1,updatedAt:1});await db.codexEntries.bulkPut([entry('sale-a','10'),entry('sale-b','30'),entry('sale-empty',''),entry('unrelated','1000','different-type')]);
 const live=await createTypeTable(scope,'Sales','sale-type');assert((await projectTable(live.id)).rows.length===3,'Concrete type includes unrelated category entry');
 const promoted=await saveTableCalculation(scope,{tableId:live.id,name:'Total',formula:'=@[Price]*@[Quantity]',resultType:'decimal',expectedVersion:await version(live.id),expectedTemplateRevision:template.revision});assert(promoted.promoted,'Row-local formula not promoted');template=(await db.projects.get(P))!.codexTemplates![0];const total=template.propertyDefinitions!.find(item=>item.label==='Total')!,a=(await db.codexEntries.get('sale-a'))!;assert(projectCodexEntry(a,[template]).fields[total.key]==='20','Type property depends on an open table');assert(!Object.hasOwn(a.fields,total.key),'Computed output persisted into card');assert(projectCodexEntry((await db.codexEntries.get('sale-empty'))!,[template]).fields[total.key]==='','Empty input became zero');
 const localTotal=await saveTableCalculation(scope,{tableId:live.id,name:'Sum total',formula:'=SUM([Total])',resultType:'decimal',expectedVersion:await version(live.id)});assert((await projectTable(live.id)).rows[0].cells[localTotal.column.id]==='80','Aggregate of calculated column did not skip empty result');
 const holdings:WorldTable={id:'demo-holdings',title:'Holdings',mode:'table',columns:[{id:'hold',name:'Hold',kind:'text'},{id:'souls',name:'Souls',kind:'number'}],rows:[
  {id:'greyvale',cells:{hold:'Greyvale',souls:'2450'}},{id:'rillford',cells:{hold:'Rillford',souls:'8100'}},
  {id:'stonewatch',cells:{hold:'Stonewatch',souls:'1750'}},{id:'ashen',cells:{hold:'Ashen Deep',souls:'3200'}},
  {id:'thornhallow',cells:{hold:'Thornhallow',souls:'900'}},
 ]};
 await addTable(P,holdings);
 const literal='=IFERROR(@[Souls]/SUM(Table[Souls]),0)';
 const shareOfSouls=await saveTableCalculation(scope,{tableId:holdings.id,name:'% of total Souls',formula:literal,resultType:'percent',expectedVersion:await version(holdings.id)});
 const shareColumn=shareOfSouls.column.id;
 const holdingsProjection=await projectTable(holdings.id);
 assert(JSON.stringify(holdingsProjection.displayRows.map(row=>row.cells[shareColumn]))===JSON.stringify(['14.94%','49.39%','10.67%','19.51%','5.49%']),'VVD preset formula did not yield its five visible percentages');
 assert(holdingsProjection.rows[0].cells[shareColumn]===String(2450/16400),'Structured calculation must retain its raw numeric value');
 const filtered=await runBridgeTool('wh_table_query',{projectId:P,tableId:holdings.id,conditions:[{columnId:'hold',op:'contains',value:'Greyvale'}]});
 assert(filtered.ok,'Filtered structured calculation query failed');
 const matches=(filtered.result as {rows:{id:string;cells:Record<string,string>}[]}).rows;
 assert(matches.length===1&&matches[0].cells['% of total Souls']==='14.94%','Filter changed the denominator');
 await updateTableColumn(scope,holdings.id,{...holdings.columns[1],name:'Souls in hold'},await version(holdings.id));
 const renamed=await projectTable(holdings.id);
 assert(renamed.rows[0].cells[shareColumn]===String(2450/16400)&&displayTableFormula(shareOfSouls.column.calculation!,renamed.columns)==='=IFERROR(@[Souls in hold]/SUM(Table[Souls in hold]),0)','Structured formula did not retain column identity and syntax after rename');
 const spaces=await saveTableCalculation(scope,{tableId:holdings.id,name:'Combined',formula:'=SUM(Table[Souls in hold])',resultType:'whole',expectedVersion:await version(holdings.id)});
 const quoted=await saveTableCalculation(scope,{tableId:holdings.id,name:'Literal',formula:'="Table[Souls]"',resultType:'text',expectedVersion:await version(holdings.id)});
 const afterRename=await projectTable(holdings.id);
 assert(afterRename.rows[0].cells[spaces.column.id]==='16400'&&afterRename.rows[0].cells[quoted.column.id]==='Table[Souls]','Structured token broke column names with spaces or string literals');
 await updateTableColumn(scope,holdings.id,{...holdings.columns[1],name:'SUM'},await version(holdings.id));
 const sumFormula='=SUM(Table[SUM])';
 const sumName=await saveTableCalculation(scope,{tableId:holdings.id,name:'Column named SUM',formula:sumFormula,resultType:'whole',expectedVersion:await version(holdings.id)});
 const beforeKeywordRename=await projectTable(holdings.id);
 assert(displayTableFormula(sumName.column.calculation!,beforeKeywordRename.columns)===sumFormula,'Reopening a structured calculation rewrote the SUM function name');
 await updateTableColumn(scope,holdings.id,{...holdings.columns[1],name:'TRUE'},await version(holdings.id));
 const afterKeywordRename=await projectTable(holdings.id);
 assert(displayTableFormula(sumName.column.calculation!,afterKeywordRename.columns)==='=SUM(Table[TRUE])','Renaming a column rewrote the SUM function name');
 const booleanFormula='=IF(TRUE,SUM(Table[TRUE]),0)';
 const booleanName=await saveTableCalculation(scope,{tableId:holdings.id,name:'Column named TRUE',formula:booleanFormula,resultType:'whole',expectedVersion:await version(holdings.id)});
 const booleanView=await projectTable(holdings.id);
 const reopened=displayTableFormula(booleanName.column.calculation!,booleanView.columns);
 assert(reopened===booleanFormula,'Reopening a structured calculation rewrote the TRUE literal');
 await saveTableCalculation(scope,{tableId:holdings.id,columnId:booleanName.column.id,name:booleanName.column.name,formula:reopened,resultType:'whole',expectedVersion:await version(holdings.id)});
 assert((await projectTable(holdings.id)).rows[0].cells[booleanName.column.id]==='16400','Reopened calculation cannot be saved without changing its result');
 const structured=await saveTableCalculation(scope,{tableId:live.id,name:'Structured sum',formula:'=SUM(Table[Total])',resultType:'decimal',expectedVersion:await version(live.id)});
 assert(!structured.promoted&&(await projectTable(live.id)).rows.every(row=>row.cells[structured.column.id]==='80'),'Structured reference does not read the complete column');
 assert(!(await db.projects.get(P))!.codexTemplates![0].propertyDefinitions!.some(definition=>definition.label==='Structured sum'),'Structured reference promoted to Codex');
 const before=await version(live.id),revision=template.revision;await rejects(()=>saveTableCalculation(scope,{tableId:live.id,name:'Rejected',formula:'=@[Price]*2',resultType:'decimal',expectedVersion:before,expectedTemplateRevision:revision-1}));assert(await version(live.id)===before&&!(await db.projects.get(P))!.codexTemplates![0].propertyDefinitions!.some(item=>item.label==='Rejected'),'Failed CAS partially added column/type property');
 const share=await saveTableCalculation(scope,{tableId:live.id,name:'Share',formula:'=@[Price]/SUM(Price)',resultType:'percent',expectedVersion:await version(live.id)});assert(!share.promoted,'Set aggregate escaped into type');let projected=await projectTable(live.id);assert(projected.rows[0].cells[share.column.id]==='0.25'&&projected.displayRows[0].cells[share.column.id]==='25%'&&!template.propertyDefinitions!.some(item=>item.label==='Share'),'Percent overwrote raw numeric value or persisted to type');assert(projected.rows[2].cells[share.column.id]==='','Empty aggregate-row input became zero');
 const price=projected.columns.find(item=>item.propertyId==='price-id')!;await updateTableColumn(scope,live.id,{...price,name:'Cost'},await version(live.id),template.revision);template=(await db.projects.get(P))!.codexTemplates![0];projected=await projectTable(live.id);assert(projected.rows[0].cells[share.column.id]==='0.25'&&displayTableFormula(share.column.calculation!,projected.columns).includes('@[Cost]'),'Rename lost stable column binding');assert(projectCodexEntry(a,[template]).fields[total.key]==='20','Property rename broke promoted formula identity');
 const percent=await saveTableCalculation(scope,{tableId:live.id,name:'Rate',formula:'=@[Cost]/100',resultType:'percent',expectedVersion:await version(live.id),expectedTemplateRevision:template.revision});template=(await db.projects.get(P))!.codexTemplates![0];const property=projectCodexEntry(a,[template]).properties[percent.column.field!];assert(property.value==='0.1'&&property.displayValue==='10%'&&codexPropertyHtml(property)==='10%','Card projection does not separate numeric value and presentation');
 await saveTableCalculation(scope,{tableId:live.id,name:'Label',formula:'=IF(@[Cost]>20,"High","Low")',resultType:'text',expectedVersion:await version(live.id),expectedTemplateRevision:template.revision});template=(await db.projects.get(P))!.codexTemplates![0];assert(Object.values(projectCodexEntry(a,[template]).properties).some(item=>item.value==='Low'),'Lazy decision/text type calculation failed');
 const safeType=await saveTableCalculation(scope,{tableId:live.id,name:'Safe cost',formula:'=IFERROR(@[Cost]/0,7)',resultType:'decimal',expectedVersion:await version(live.id),expectedTemplateRevision:template.revision});
 assert(safeType.promoted,'Row-only IFERROR did not promote');
 template=(await db.projects.get(P))!.codexTemplates![0];
 assert(projectCodexEntry(a,[template]).fields[safeType.column.field!]==='7','Promoted IFERROR did not recover on the card');
 assert(projectCodexEntry((await db.codexEntries.get('sale-empty'))!,[template]).fields[safeType.column.field!]==='','IFERROR replaced an unfilled input');
 const safeAggregate=await saveTableCalculation(scope,{tableId:live.id,name:'Safe aggregate',formula:'=IFERROR(SUM([Cost])/0,8)',resultType:'decimal',expectedVersion:await version(live.id)});
 assert(!safeAggregate.promoted&&(await projectTable(live.id)).rows.every(row=>row.cells[safeAggregate.column.id]==='8'),'Whole-column IFERROR did not stay on the table');
 const manual:WorldTable={id:'manual-calcs',title:'Manual',mode:'table',columns:[{id:'n',name:'Amount',kind:'number'},{id:'a',name:'A',kind:'number'},{id:'b',name:'B',kind:'number'},{id:'empty',name:'Blank',kind:'number'},{id:'lookup',name:'Imported lookup',kind:'text'}],rows:[{id:'r',cells:{n:'2.5',lookup:'#N/A'}}]};await addTable(P,manual);await saveTableCalculation(scope,{tableId:manual.id,columnId:'a',name:'A',formula:'=@[B]+1',resultType:'decimal',expectedVersion:await version(manual.id)});await saveTableCalculation(scope,{tableId:manual.id,columnId:'b',name:'B',formula:'=@[A]+1',resultType:'decimal',expectedVersion:await version(manual.id)});projected=await projectTable(manual.id);assert(projected.rows[0].cells.a==='#CIRCULAR!'&&projected.rows[0].cells.b==='#CIRCULAR!','Local cycle statuses missing');await rejects(()=>saveCell(P,manual.id,'r','a','42',''));
 for(const [name,formula,type,expected]of [
 ['Recover division','=IFERROR(@[Amount]/0,7)','decimal','7'],
 ['Lazy fallback','=IFERROR(5,1/0)','decimal','5'],
 ['Keep zero','=IFERROR(0,7)','whole','0'],
 ['Original error','=IFERROR(1/0)','decimal','#DIV/0!'],
 ['Fallback error','=IFERROR(1/0,MYSTERY(2))','decimal','#NAME?'],
 ['Recover invalid reference','=IFERROR(@[Missing],7)','decimal','7'],
 ['Recover overflow','=IFERROR(1e308*1e308,7)','decimal','7'],
 ['Propagate nested fallback overflow','=IF(IFERROR(1/0,1e308*1e308),9,8)','decimal','#NUM!'],
 ['Recover imported lookup error','=IFERROR(@[Imported lookup],7)','decimal','7'],
 ['Keep blank','=IFERROR(@[Blank],7)','decimal',''],
 ['Keep cycle','=IFERROR(@[A],7)','decimal','#CIRCULAR!'],
 ['Text fallback','=IFERROR(1/0,"Unavailable")','text','Unavailable'],
 ['Wrong shape','="text"','decimal','#VALUE!'],['Zero','=@[Amount]/0','decimal','#DIV/0!'],['Unknown','=MYSTERY(2)','decimal','#NAME?'],['Count','=COUNT(Amount)','whole','1'],['Scientific','=@[Amount]*1e2','decimal','250']]as const){const result=await saveTableCalculation(scope,{tableId:manual.id,name,formula,resultType:type,expectedVersion:await version(manual.id)});assert((await projectTable(manual.id)).rows[0].cells[result.column.id]===expected,`${name} wrong result`);}
 await removeTableColumn(scope,live.id,price.id,await version(live.id));assert((await projectTable(live.id)).rows[0].cells[share.column.id]==='#REF!','Deleted column still resolves by old name');assert(projectCodexEntry(a,[template]).fields[total.key]==='20','Removing table column deleted shared type property');
 await db.codexEntries.put({...entry('foreign-ref','1'),projectId:'unrelated-project'});await addColumn(P,manual.id,{id:'ref',name:'Link',kind:'reference'});await rejects(()=>saveCell(P,manual.id,'r','ref','foreign-ref',''));
 await saveWorldEra(P,{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1},null);const eraOnly=await saveTableCalculation(past,{tableId:manual.id,name:'Era only',formula:'=IFERROR(@[Amount]/0,7)',resultType:'decimal',expectedVersion:await version(manual.id,past)});
 assert(!(await table(manual.id)).columns.some(item=>item.name==='Era only')&&(await projectTable(manual.id,past)).rows[0].cells[eraOnly.column.id]==='7','Era fallback missing or changed Base table');
 cloned=await importProjectData(await exportProjectData(P));const cloneProject=(await db.projects.get(cloned))!,cloneLive=cloneProject.dataTables!.find(item=>item.title==='Sales')!,cloneType=cloneProject.codexTemplates!.find(item=>item.name==='Sale')!;assert(cloneLive.codexTemplateId===cloneType.id&&cloneLive.codexTemplateId!==live.codexTemplateId,'Clone points at original template');const cloneManual=cloneProject.dataTables!.find(item=>item.title==='Manual')!,cloneRows=projectWorldTable(cloneManual,[],cloneProject.codexTemplates);const scientific=cloneManual.columns.find(item=>item.name==='Scientific')!;assert(cloneRows.rows[0].cells[scientific.id]==='250','Clone lost local column bindings');
 const clonedFallback=cloneManual.columns.find(item=>item.name==='Recover division')!;
 assert(cloneRows.rows[0].cells[clonedFallback.id]==='7','Clone lost the IFERROR binding or fallback');
 const cloneEra=cloneProject.worldEras!.find(item=>item.name==='Past')!;const clonePastProject=await getEraProject({projectId:cloned,eraId:cloneEra.id}),clonePastTable=clonePastProject.dataTables!.find(item=>item.title==='Manual')!,eraColumn=clonePastTable.columns.find(item=>item.name==='Era only')!;assert(projectWorldTable(clonePastTable,[],cloneProject.codexTemplates).rows[0].cells[eraColumn.id]==='7','Own-era clone lost calculation bindings');
 const zip=await createProjectZipArchive(P);await importProjectZip(new File([zip.blob],'table-calculations.zip',{type:'application/zip'}),{replaceProjectIds:[P]});assert((await projectTable(manual.id)).rows[0].cells[(await table(manual.id)).columns.find(item=>item.name==='Scientific')!.id]==='250','ZIP lost calculations');
 return ['Concrete type view excludes unrelated cards; row calculation promotes atomically, computes on closed card and preserves blank input','Raw versus percent display, shared card/wiki formatting, lazy decisions and ID-stable property/column renames','Local aggregates, dependency cycles, result errors, missing references, calculated-cell protection and in-transaction reference integrity','Base/era isolation, template/table CAS with no partial promotion and normal JSON clone remapping','VVD structured column references, local aggregates, filtering, stable rename, spaces and quoted strings'];
 }finally{if(cloned)await deleteProject(cloned);await deleteProject(P);await db.codexEntries.delete('foreign-ref');}}
