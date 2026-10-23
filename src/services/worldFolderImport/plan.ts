import { getEraProject, assertWorldEra, readWorldDocument } from '@/services/worldEras/store';
import type { WorldEraScope } from '@/services/worldEras/types';
import { sha256Hex } from '@/services/judge/text';
import { parseCodexFolder, CODEX_IMPORT_FORMATS } from '@/engines/genealogy/codexFolderImport';
import { effectiveCodexTemplate } from '@/engines/codex/templateHierarchy';
import { decodeCsv } from '@/engines/tables/csv';
import { importCsv, previewCsv } from '@/engines/tables/operations';
import { validateTimelineDates } from '@/engines/timeline/dateValidation';
import { mediaMime } from '@/engines/media/types';
import { MAX_SOURCE_BYTES } from '@/engines/writings/manuscriptImport';
import { MAX_MEDIA_BYTES } from '@/engines/media/types';
import { readFolderSources, folderPath, type FolderSource, type ArchiveSkip } from './paths';
import { pastedFolderFiles } from './pasted';
import { readPdfSource } from './pdfSource';
import { libraryFolderOf } from './library';
import { renderFolderMarkdown } from './links';
import type { WorldFolderInput, WorldFolderPlan, WorldFolderPlanRow, WorldFolderFinding, WorldFolderImportReceipt, WorldFolderEvent, WorldFolderSkipReason } from './types';

export async function folderContextVersion(scope:WorldEraScope):Promise<string>{
  const project=await getEraProject(scope);
  return sha256Hex(JSON.stringify({scope,engines:project.enabledEngines,templates:project.codexTemplates,imports:project.worldFolderImports??[],eras:project.worldEras?.map(era=>({id:era.id,revision:era.revision}))}));
}
export async function folderStableId(scope:WorldEraScope,path:string,suffix:string,format:string):Promise<string>{return `world-folder:${(await sha256Hex(JSON.stringify([scope.projectId,scope.eraId??null,format,path,suffix]))).slice(0,32)}`;}
function checkDecision(value:NonNullable<WorldFolderInput['decisions']>[number]):void{
  if(!value||typeof value.path!=='string'||value.include!==undefined&&typeof value.include!=='boolean'||value.target!==undefined&&!['codex','writings','tables','timeline'].includes(value.target)||value.title!==undefined&&(typeof value.title!=='string'||!value.title.trim())||value.type!==undefined&&!['character','location','item','faction','concept','magic','custom'].includes(value.type)||value.excludedRows!==undefined&&(!Array.isArray(value.excludedRows)||value.excludedRows.some(row=>!Number.isSafeInteger(row)||row<0)))throw Error('world_folder_decision_invalid');
}
const EMPTY_CODES=new Set(['empty_file','empty_document','empty_collection']);
const TEXT_SOURCE=/\.(md|markdown|csv|json|pdf)$/i;
/** Recomputed by UI/MCP Apply; neither route accepts pre-rendered caller HTML. */
export async function inspectWorldFolderImport(scope:WorldEraScope,input:WorldFolderInput):Promise<WorldFolderPlan>{return (await prepareWorldFolderImport(scope,input)).plan;}
export async function prepareWorldFolderImport(scope:WorldEraScope,input:WorldFolderInput):Promise<{plan:WorldFolderPlan;sources:FolderSource[]}>{
  await assertWorldEra(scope);
  if(!CODEX_IMPORT_FORMATS.includes(input.format))throw Error('world_folder_format_invalid');
  const project=await getEraProject(scope),receipts:WorldFolderImportReceipt[]=project.worldFolderImports??[];
  const libraryFolder=input.libraryFolderId===undefined?undefined:libraryFolderOf(project,input.libraryFolderId);
  const given=input.files===undefined&&input.pasted!==undefined?[]:input.files,taken=new Set<string>();
  if(Array.isArray(given))for(const file of given)try{taken.add(folderPath(file.path));}catch{/* readFolderSources reports the invalid path */}
  const pastedFiles=await pastedFolderFiles(input.pasted,taken,receipts.filter(receipt=>receipt.eraId===scope.eraId&&receipt.format===input.format).flatMap(receipt=>receipt.files));
  const encryptedArchives:ArchiveSkip[]=[];
  const sources=await readFolderSources(Array.isArray(given)?[...given,...pastedFiles]:given,encryptedArchives),decisions=new Map<string,NonNullable<WorldFolderInput['decisions']>[number]>();
  for(const decision of input.decisions??[]){checkDecision(decision);if(decisions.has(decision.path)||!sources.some(source=>source.path===decision.path))throw Error('world_folder_decision_stale');decisions.set(decision.path,decision);}
  const rows:WorldFolderPlanRow[]=[],findings:WorldFolderFinding[]=[],assets:WorldFolderPlan['assets']=[],bodies=new Map<string,string>(),seenContent=new Map<string,string>();
  const report=(path:string,code:string,message:string,blocking=true,row?:number,reason?:WorldFolderSkipReason)=>findings.push({path,code,message,blocking,row,...(reason?{reason}:{})});
  for(const archive of encryptedArchives)report(archive.path,'archive_encrypted','Este ZIP está cifrado y no se puede abrir. / This ZIP is encrypted and cannot be opened.',false,undefined,'encrypted');
  for(const [sourceIndex,source] of sources.entries()){
    if(sourceIndex&&sourceIndex%20===0)await new Promise(resolve=>setTimeout(resolve,0));
    const {path}=source,decision=decisions.get(path),stem=path.split('/').at(-1)!.replace(/\.[^.]+$/,'');
    const raster=/\.(png|jpe?g|gif|webp)$/i.exec(path),mime=raster?`image/${/jpe?g/i.test(raster[1])?'jpeg':raster[1].toLowerCase()}`:mediaMime({name:path,type:''});
    if(raster||mime){const old=receipts.filter(receipt=>receipt.eraId===scope.eraId&&receipt.format===input.format).find(receipt=>receipt.files.some(file=>file.path===path));const file=old?.files.find(file=>file.path===path);assets.push({path,kind:raster?'raster':'media',used:false,status:decision?.include===false?'excluded':file?file.sha256===source.sha256?'duplicate':'conflict':'new',...(mime?{mime}:{}),...(!raster?{id:old?.refs.find(ref=>ref.path===path&&ref.kind==='media')?.id??await folderStableId(scope,path,'media',input.format)}:{})});continue;}
    const isPdf=/\.pdf$/i.test(path);
    if(!/\.(md|markdown|csv|json|pdf)$/i.test(path)){
      assets.push({path,kind:'unsupported',used:false});
      if(!source.bytes.length){report(path,'empty_file','Archivo vacío. / Empty file.',false,undefined,'empty');continue;}
      const manuscript=/\.(docx|epub)$/i.exec(path);
      report(path,manuscript?'manuscript_import_available':'unsupported_file',manuscript?`${manuscript[1].toUpperCase()}: use Import manuscript in Writings to retain compatible review data and the original file.`:'Excluded unsupported file.',false,undefined,'unsupported-type');continue;
    }
    if(!source.bytes.length){report(path,'empty_file','Archivo vacío. / Empty file.',false,undefined,'empty');continue;}
    if(source.bytes.length>MAX_SOURCE_BYTES){report(path,'too_large','El archivo supera el límite de importación (32 MiB). / The file exceeds the import limit (32 MiB).',false,undefined,'too-large');continue;}
    if(TEXT_SOURCE.test(path)){const first=seenContent.get(source.sha256);if(first&&decision?.include!==true){report(path,'duplicate_content',`Mismo contenido que ${first}. / Same content as ${first}.`,false,undefined,'duplicate');continue;}
      // Only a file that stays in the import claims its content: leaving the first of two identical files out must not drop the second.
      if(!first&&decision?.include!==false)seenContent.set(source.sha256,path);}
    const previous=receipts.filter(receipt=>receipt.eraId===scope.eraId&&receipt.format===input.format).flatMap(receipt=>receipt.files).find(file=>file.path===path);
    const status=decision?.include===false?'excluded':previous?(previous.sha256===source.sha256?'duplicate':'conflict'):'new';
    try{
      if(/\.csv$/i.test(path)){
        const decoded=decodeCsv(source.bytes,decision?.csv?.encoding);
        if(!decoded.text.trim()){report(path,'empty_file','Archivo vacío. / Empty file.',false,undefined,'empty');continue;}
        const parsed=previewCsv(decoded.text,decision?.csv),target=decision?.target??'tables';
        if(target==='writings')throw Error('CSV supports table, Codex records or timeline.');
        const row:WorldFolderPlanRow={path,sourcePath:path,title:decision?.title??stem,target,id:await folderStableId(scope,path,target,input.format),reason:'CSV: table by default; mapped destinations are explicit.',status,csv:parsed};
        if(target==='tables'){
          const selectedRecords=parsed.records.filter((_,index)=>!decision?.excludedRows?.includes(index)),selectedCsv=[parsed.headers,...selectedRecords].map(cells=>cells.map(cell=>`"${cell.replaceAll('"','""')}"`).join(parsed.delimiter)).join('\n');
          const table=importCsv(selectedCsv,row.title,decision?.csv);table.id=row.id;
          table.columns.forEach((column,index)=>{column.id=`${row.id}:column:${index}`;});
          // importCsv generated column identities; rebuild cells using source-order values.
          const generated=importCsv(selectedCsv,row.title,decision?.csv);
          table.rows=generated.rows.map((record,index)=>({id:`${row.id}:row:${index}`,cells:Object.fromEntries(table.columns.map((column,position)=>[column.id,record.cells[generated.columns[position].id]]))}));
          row.table=table;rows.push(row);
        }else{
          rows.push(row);const mapping=decision?.csv?.mapping;
          if(!mapping||!Number.isInteger(mapping.title)||mapping.title<0||mapping.title>=parsed.headers.length){if(status==='new')report(path,'csv_mapping_required','Choose the title column before applying.');continue;}
          for(const key of ['description','start','end','lane'] as const)if(mapping[key]!==undefined&&(!Number.isInteger(mapping[key])||mapping[key]!<0||mapping[key]!>=parsed.headers.length))throw Error('csv_mapping_invalid');
          if(target==='timeline'&&mapping.start===undefined){if(status==='new')report(path,'csv_mapping_required','Choose the date column before applying.');continue;}
          const events:WorldFolderEvent[]=[];
          for(const [index,cells] of parsed.records.entries()){
            if(index&&index%100===0)await new Promise(resolve=>setTimeout(resolve,0));
            if(decision?.excludedRows?.includes(index))continue;
            const title=cells[mapping.title].trim();if(!title){if(status==='new')report(path,'csv_title_required','Mapped title is empty.',true,index);continue;}
            const id=await folderStableId(scope,path,`${target}:${index}`,input.format),body=mapping.description===undefined?'':cells[mapping.description];
            if(target==='codex'){
              const recordPath=`${path}#row=${index}`,names=new Set<string>();const fields=Object.fromEntries(parsed.headers.map((header,position)=>{const name=header||`Column ${position+1}`;let unique=name,ordinal=2;while(names.has(unique.toLocaleLowerCase()))unique=`${name} (${ordinal++})`;names.add(unique.toLocaleLowerCase());return[unique,cells[position]];}));rows.push({path:recordPath,sourcePath:path,id,title,target,type:decision?.type??'custom',templateId:decision?.templateId,status,reason:`CSV row ${index+1}`,fields,tags:[]});bodies.set(recordPath,body);
            }else{
              const start=cells[mapping.start!],end=mapping.end===undefined?'':cells[mapping.end],dateMode=mapping.dateMode??'calendar';
              if(dateMode!=='text'&&dateMode!=='calendar')throw Error('csv_date_mode_invalid');
              if(dateMode==='calendar'&&(!start||validateTimelineDates(start,end))){if(status==='new')report(path,'csv_date_invalid',`${start}${end?` – ${end}`:''}`,true,index);continue;}
              events.push({id,title,description:body,date:start,dateMode,...(dateMode==='calendar'?{realDate:start,...(end?{realDateEnd:end}:{})}:{}),lane:mapping.lane===undefined?'':cells[mapping.lane]});
            }
          }
          if(target==='timeline')row.events=events;
          // Container describes the mapping but is not itself a Codex card.
          if(target==='codex')rows.splice(rows.indexOf(row),1);
        }
      }else{
        let text:string,parsePath=path;
        if(isPdf){
          const pdf=await readPdfSource(source.bytes,stem);
          if('skip' in pdf){report(path,pdf.code,pdf.message,false,undefined,pdf.skip);continue;}
          text=pdf.text;parsePath=`${path}.md`;
        }else text=new TextDecoder('utf-8',{fatal:true}).decode(source.bytes);
        const parsed=parseCodexFolder({format:input.format,files:[{path:parsePath,text}]});
        for(const issue of parsed.issues){const empty=EMPTY_CODES.has(issue.code);report(path,issue.code,issue.message,status==='new'&&issue.code!=='unmodeled_fields'&&!empty,undefined,empty?'empty':undefined);}
        for(const found of parsed.documents){
          const document=parsePath===path?found:{...found,path:path+found.path.slice(parsePath.length)};
          const target=decision?.target??(document.fields.importType==='chapter'||document.fields.importType==='writing'?'writings':'codex');
          if(target!=='codex'&&target!=='writings')throw Error('Markdown/JSON supports Codex or chapter.');
          const row:WorldFolderPlanRow={path:document.path,sourcePath:path,title:decision?.title??document.title,target,id:await folderStableId(scope,document.path,target,input.format),type:decision?.type??document.type,templateId:decision?.templateId,fields:{...document.fields,__importSourcePath:document.path,__importSourceFormat:input.format,__importSourceContent:text,...(document.explicitId?{__importSourceId:document.explicitId}:{})},tags:document.tags,reason:decision?.target?'Selected destination':target==='writings'?'Explicit chapter metadata':'Codex document default',status};
          bodies.set(row.path,document.body);rows.push(row);
        }
      }
    }catch(error){report(path,'source_parse_failed',error instanceof Error?error.message:String(error),status==='new');}
  }
  for(const row of rows)if(row.status==='duplicate'){
    const ref=receipts.filter(receipt=>receipt.eraId===scope.eraId&&receipt.format===input.format).flatMap(receipt=>receipt.refs).find(ref=>ref.path===row.path&&ref.kind===row.target);
    if(ref)row.id=ref.id;
    if(!ref||!await readWorldDocument(scope,ref.kind,ref.id)){row.status='conflict';report(row.path,'imported_destination_changed','The previous destination is unavailable or differs from this selection. Existing imports are not replaced or resurrected.');}
  }
  for(const row of rows){
    if(row.status==='conflict')report(row.path,'source_changed','This source was imported previously; changed sources are not overwritten.');
    if(row.target==='codex'&&row.templateId){const template=project.codexTemplates?.find(item=>item.id===row.templateId);if(!template){report(row.path,'template_missing','Selected template is unavailable.');continue;}const effective=effectiveCodexTemplate(template,project.codexTemplates??[]);row.type=effective.category;row.fields={...effective.fields,...row.fields};if(effective.propertyDefinitions)row.propertyDefinitions=structuredClone(effective.propertyDefinitions);}
    const body=bodies.get(row.path);if(body!==undefined)row.content=renderFolderMarkdown(body,row.sourcePath,scope.projectId,scope.eraId,sources,rows,row.status==='new'?assets:assets.map(asset=>({...asset})),findings);
  }
  for(const asset of assets)if(asset.kind==='media'&&decisions.get(asset.path)?.include===true)asset.used=true;
  for(const asset of assets)if(decisions.get(asset.path)?.include===false){if(asset.used)report(asset.path,'excluded_attachment_referenced','A selected document refers to an excluded attachment.');asset.used=false;}
  for(const asset of assets)if(asset.used&&asset.status==='conflict')report(asset.path,'attachment_source_changed','A previously imported attachment changed.');
  for(const asset of assets)if(asset.used&&asset.kind==='media'&&asset.status==='duplicate'&&(!asset.id||!await readWorldDocument(scope,'media',asset.id))){asset.status='conflict';report(asset.path,'imported_attachment_missing','The previously imported media is unavailable. No dependent document will be created or deleted media restored.');}
  const contextVersion=await folderContextVersion(scope),files=sources.map(({path,sha256})=>({path,sha256}));
  for(const asset of assets)if(asset.used&&asset.kind==='media'){const size=sources.find(source=>source.path===asset.path)?.bytes.length??0;if(size>MAX_MEDIA_BYTES)report(asset.path,'too_large','El medio supera el límite de 50 MiB. / The media file exceeds the 50 MiB limit.',true,undefined,'too-large');}
  const draft={contextVersion,rows,findings,files,assets,...(libraryFolder?{libraryFolder}:{})};
  return{plan:{...draft,digest:await sha256Hex(JSON.stringify({version:1,scope,format:input.format,decisions:input.decisions??[],...draft}))},sources};
}
