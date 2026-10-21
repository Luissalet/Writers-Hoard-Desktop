import '@/engines';
import '@/services/aiBridge/dispatch';
import {db} from '@/db';
import {requestDocument,bytesFromBase64} from '@/services/documents/client';
import {inspectManuscriptFile} from '@/engines/writings/manuscriptReview/inspect';
import {planManuscriptImport} from '@/engines/writings/manuscriptReview/plan';
import {applyManuscriptImport} from '@/engines/writings/manuscriptReview/persist';
import {htmlToText} from '@/engines/_shared/anchoring/htmlToText';
import {sha256Hex} from '@/services/judge/text';
const assert=(v:unknown,m:string):asserts v=>{if(!v)throw Error(m)};
const split={mode:'heading' as const,headingLevel:1,separator:'***'};
export async function testIndependentDocxReview(){
 const passed:string[]=[],findings:string[]=[],P='independent-docx-'+Date.now(),scope={projectId:P};await db.projects.put({id:P,title:'Own DOCX',mode:'custom',type:'standalone',enabledEngines:['writings','annotations'],createdAt:1,updatedAt:1});
 const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR3kAAAAASUVORK5CYII=';
 const opened=await requestDocument<{sessionId:string}>('document.importHtml',{html:`<h1>IMAGE_ONLY_CHAPTER</h1><p><img src="${pixel}" alt="Only visual content" width="40" height="40"></p><h1>TEXT_CHAPTER</h1><p>Text survives separately.</p>`});
 let file:File;try{const exported=await requestDocument<{dataBase64:string}>('document.exportBytes',{sessionId:opened.sessionId,format:'docx'});file=new File([bytesFromBase64(exported.dataBase64)],'Visual appendix.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});}finally{await requestDocument('document.close',{sessionId:opened.sessionId})}
 const inspected=await inspectManuscriptFile(file!),imageBlock=inspected.blocks.find(block=>block.html.includes('<img'));assert(imageBlock,'real native inspected source must retain the embedded image for this oracle');const plan=await planManuscriptImport([inspected],split,scope);
 if(!plan.chapters.some(row=>row.content.includes('<img')))findings.push('DOCX_IMAGE_ONLY_CHAPTER_LOST: real native DOCX inspection retains image block but normal heading plan silently drops image-only chapter');const native=(window as any).qaNative;const files=[{name:file!.name,dataBase64:btoa(String.fromCharCode(...new Uint8Array(await file!.arrayBuffer())))}];const external=await native.call('wh_manuscript_import_inspect',{...scope,files,split});assert(external.ok,'native external image inspection failed');if(!external.result.chapters.some((row:any)=>row.content.includes('<img')))passed.push('Same image-only omission also reproduced through actual external MCP inspect');
 const literal='Authored \uE000wh-abcdef-start-3\uE001 and \uE001 survive 👩‍🚀 cafe\u0301.';const textSource=await inspectManuscriptFile(new File([literal],'markers.txt',{type:'text/plain'}));const textPlan=await planManuscriptImport([textSource],{...split,mode:'file'},scope);assert(htmlToText(textPlan.chapters[0].content)===literal,'authored literal marker regression');const originalHash=await sha256Hex(await textSource.original.arrayBuffer());assert(originalHash===textSource.sha256,'source SHA changed');passed.push('Own raw private-use marker/astral/combining TXT inspect+plan preserves authored text and exact source SHA');
 // Fail the final project update inside the import's own normal transaction.
 const before={w:await db.writings.count(),s:await db.manuscriptSources.count()};let refused=false;const failFinal=(_changes:any,key:any)=>{if(key===P)throw Error('own final project update failure')};db.projects.hook('updating',failFinal);
 try{await applyManuscriptImport(scope,[textSource],{...split,mode:'file'},[],textPlan.digest)}catch{refused=true}finally{db.projects.hook('updating').unsubscribe(failFinal)}
 assert(refused&&await db.writings.count()===before.w&&await db.manuscriptSources.count()===before.s,'final project update failure leaked source or writing data');passed.push('Own final project-update failure rolls back source, receipt and writing rows');
 const replan=await planManuscriptImport([textSource],{...split,mode:'file'},scope);const applied=await applyManuscriptImport(scope,[textSource],{...split,mode:'file'},[],replan.digest);const original=(await db.manuscriptSources.get(applied.sourceIds[0]))!;assert(await sha256Hex(await original.original.arrayBuffer())===originalHash,'normal retry changed originalbytes');assert((await db.writings.get(applied.writingIds[0]))!.content===replan.chapters[0].content,'retry persisted another projection');passed.push('Own retry after abort commits exact original bytes and the accepted projection');
 for(const result of passed)console.log('OWN_PASS '+result);console.log('OWN_FINDINGS '+JSON.stringify(findings));return passed.map(row=>'Independent '+row).concat(findings.map(row=>'FINDING '+row));
}
