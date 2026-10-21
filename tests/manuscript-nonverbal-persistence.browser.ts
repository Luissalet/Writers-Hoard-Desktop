import '@/engines';
import { db } from '@/db';
import { requestDocument, bytesFromBase64 } from '@/services/documents/client';
import { inspectManuscriptFile } from '@/engines/writings/manuscriptReview/inspect';
import { planManuscriptImport } from '@/engines/writings/manuscriptReview/plan';
import { applyManuscriptImport } from '@/engines/writings/manuscriptReview/persist';
import { eraWritingOperations } from '@/services/worldEras/writings';
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
export async function testManuscriptNonverbalPersistence() {
 const projectId='nonverbal-'+crypto.randomUUID(),now=Date.now(),scope={projectId};
 await db.projects.add({id:projectId,title:'Nonverbal',mode:'custom',type:'standalone',enabledEngines:['writings','annotations'],createdAt:now,updatedAt:now,worldEras:[{id:'past',name:'Past',description:'',revision:0,createdAt:now,updatedAt:now}]});
 const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR3kAAAAASUVORK5CYII=';
 const opened=await requestDocument<{sessionId:string}>('document.importHtml',{html:`<h1>Title only</h1><h1>Visual</h1><p><img src="${pixel}" alt="" width="40" height="40"></p><h1>Form</h1><table><tr><td><p></p></td><td><p></p></td></tr></table><h1>Prose</h1><p>One authored paragraph.</p><h1>Empty tail</h1>`});
 let file:File;try{const x=await requestDocument<{dataBase64:string}>('document.exportBytes',{sessionId:opened.sessionId,format:'docx'});file=new File([bytesFromBase64(x.dataBase64)],'Visual.docx');}finally{await requestDocument('document.close',{sessionId:opened.sessionId});}
 const source=await inspectManuscriptFile(file!),split={mode:'heading' as const,headingLevel:1,separator:'***'},plan=await planManuscriptImport([source],split,scope);
 assert(plan.chapters.length===3&&!plan.chapters.some(x=>['Title only','Empty tail'].includes(x.title)),'blank/title-only chunks must not become chapters');
 const visual=plan.chapters.find(x=>x.content.includes('<img'))!,form=plan.chapters.find(x=>x.content.includes('<table'))!;
 assert(visual&&form&&visual.words===0&&form.words===0,'zero-word visual/form chapters remain importable');
 const parse=(html:string)=>new DOMParser().parseFromString(html,'text/html');
 const inspectedImage=source.blocks.find(x=>x.html.includes('<img'))!,inspectedTable=source.blocks.find(x=>x.html.includes('<table'))!;
 assert(parse(visual.content).querySelector('img')!.src===parse(inspectedImage.html).querySelector('img')!.src,'exact admitted image bytes');
 assert(parse(form.content).querySelectorAll('td').length===parse(inspectedTable.html).querySelectorAll('td').length,'all admitted form cells');
 const result=await applyManuscriptImport(scope,[source],split,[],plan.digest);
 for(let i=0;i<result.writingIds.length;i++)assert((await db.writings.get(result.writingIds[i]))!.content===plan.chapters[i].content,'exact accepted Base projection persisted');
 const era={projectId,eraId:'past'},choices=plan.chapters.map(x=>({key:x.key,title:x.title,included:x.key!==visual.key})),eraPlan=await planManuscriptImport([source],split,era,choices);
 assert(eraPlan.chapters.length===2&&!eraPlan.chapters.some(x=>x.content.includes('<img'))&&eraPlan.chapters.some(x=>x.content.includes('<table')),'intentional visual exclusion retains form and prose');
 const eraResult=await applyManuscriptImport(era,[source],split,choices,eraPlan.digest);
 for(let i=0;i<eraResult.writingIds.length;i++){assert(!await db.writings.get(eraResult.writingIds[i]),'era create must not write Base');assert((await eraWritingOperations(era).getWriting(eraResult.writingIds[i]))!.content===eraPlan.chapters[i].content,'exact accepted era projection persisted');}
 return ['Real native zero-word image/form chapters persist exact admitted bytes/HTML in Base; title-only/blank chunks omitted','Intentional image exclusion works; remaining zero-word form and prose persist in era without Base writes'];
}
