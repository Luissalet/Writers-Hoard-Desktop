import '@/engines';
import {db} from '@/db';
import {decodeCsv,encodeCsv,detectCsvDelimiter} from '@/engines/tables/csv';
import {importCsv,parseCsv,addTable,saveCell} from '@/engines/tables/operations';
import {tableCsv} from '@/engines/tables/types';
import {getEraProject} from '@/services/worldEras/store';
import {exportProjectData,importProjectData} from '@/db/operations';
const assert=(value:unknown,message:string):asserts value=>{if(!value)throw Error(message);};
const rejects=async(run:()=>unknown|Promise<unknown>)=>{let failed=false;try{await run();}catch{failed=true;}assert(failed,'Expected invalid CSV to fail');};
export async function prepareRegionalCsvFixture(id='csv-native'){await db.projects.put({id,title:'Regional CSV',type:'standalone',mode:'custom',description:'',status:'draft',color:'#888888',enabledEngines:['tables'],engineOrder:[],worldEras:[{id:'past',name:'Past',createdAt:1,updatedAt:1}],createdAt:1,updatedAt:1});}
export async function testRegionalCsv(){
 const source='Name;Price;Notes\r\n"Müller; coast";-1,25;"First\nSecond and ""quoted"""\r\n北京;2,50;"Text, 1,25"',options={delimiter:'auto' as const,decimal:',' as const,columnKinds:['text','number','text']as ('text'|'number')[]};
 assert(detectCsvDelimiter(source)===';','Quote-aware delimiter');assert(detectCsvDelimiter('Name\tCost\nA\t1')==='\t','Tab detection');await rejects(()=>detectCsvDelimiter('A,B;C\n1,2;3'));
 const table=importCsv(source,'Regional',options),[name,price,notes]=table.columns;
 assert(table.rows[0].cells[price.id]==='-1.25'&&table.rows[1].cells[price.id]==='2.50','Only numeric commas normalized');assert(table.rows[1].cells[notes.id]==='Text, 1,25'&&table.rows[0].cells[name.id]==='Müller; coast','Text stays original');assert(table.rows[0].cells[notes.id].includes('\nSecond and "quoted"'),'Quoted newline/escaped quote');
 assert(importCsv('A;B\n;', 'Empty').rows[0].cells!==undefined,'Explicit empty cells valid');
 for(const malformed of ['A;B\n1','A;B\n"open;2','A;B\n"x"evil;2'])await rejects(()=>importCsv(malformed,'Bad',{delimiter:';'}));
 await rejects(()=>importCsv('A,B\n1,2','Conflict',{decimal:','}));await rejects(()=>importCsv('A;B\nprose;1,2','Wrong type',{...options,columnKinds:['number','number']}));
 const result=tableCsv(table.columns,table.rows,undefined,{delimiter:';',decimal:','}),roundtrip=importCsv(result,'Roundtrip',options);assert(roundtrip.rows[0].cells[roundtrip.columns[1].id]==='-1.25','Negative numeric CSV roundtrip without text apostrophe');
 for(const encoding of ['utf-8','utf-16le']as const){const encoded=encodeCsv(result,encoding),decoded=decodeCsv(encoded);assert(decoded.encoding===encoding&&decoded.text.replace(/^\ufeff/,'')===result.replace(/^\ufeff/,''),encoding+' byte roundtrip');}
 const le=encodeCsv(result,'utf-16le'),be=Uint8Array.from(le);for(let i=0;i<be.length;i+=2){be[i]=le[i+1];be[i+1]=le[i];}assert(decodeCsv(be).text.includes('北京'),'UTF16BE Chinese');
 const legacy=encodeCsv('Name;Price\r\nMüller €;1,25','windows-1252');await rejects(()=>decodeCsv(legacy));assert(decodeCsv(legacy,'windows-1252').text.includes('Müller €'),'1252 explicit bytes');assert(decodeCsv(Uint8Array.of(0xc4,0xe3,0xba,0xc3),'gb18030').text==='你好','Explicit Chinese legacy decoder');await rejects(()=>encodeCsv('北京','windows-1252'));await rejects(()=>decodeCsv(Uint8Array.of(0xff),'utf-8'));
 const P='csv-functional-'+Date.now();await prepareRegionalCsvFixture(P);await addTable(P,table);const era=importCsv(source,'Era only',options);await addTable(P,era,'past');assert(!(await db.projects.get(P))!.dataTables!.some(item=>item.id===era.id),'Era import must not write Base');assert((await getEraProject({projectId:P,eraId:'past'})).dataTables!.some(item=>item.id===era.id),'Era effective imported rows');await saveCell(P,table.id,table.rows[0].id,price.id,'7.5','-1.25');await rejects(()=>saveCell(P,table.id,table.rows[0].id,price.id,'9','-1.25'));assert((await getEraProject({projectId:P,eraId:'past'})).dataTables!.find(item=>item.id===era.id)!.rows[0].cells[era.columns[1].id]==='-1.25','Sibling remains unchanged');
 const serialized=await exportProjectData(P),cloned=await importProjectData(serialized);assert((await db.projects.get(cloned))!.dataTables!.some(item=>item.rows.some(row=>Object.values(row.cells).includes('Text, 1,25'))),'Normal JSON clone preserves text and decimals');
 return['Regional CSV quote-aware detection, explicit ambiguity, malformed/empty/quoted records and numeric-only decimal normalization','Actual UTF8/BOMUTF16LE/BE/1252/GB18030 decoding, byte export roundtrips and unrepresentable/decode failures','Normal Base/era import isolation, existing numeric cell CAS and real JSON clone'];
}
export async function testRegionalCsvRegressions(){const {testVvdTables}=await import('./vvd-tables.browser');const{testTableCalculations}=await import('./table-calculations.browser');return[...await testVvdTables(),...await testTableCalculations()];}
