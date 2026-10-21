import {requestDocument,bytesFromBase64} from '@/services/documents/client';
import {inspectManuscriptFile} from '@/engines/writings/manuscriptReview/inspect';
import {planManuscriptImport} from '@/engines/writings/manuscriptReview/plan';
export async function testIndependentZeroWordTable(){
 const opened=await requestDocument<{sessionId:string}>('document.importHtml',{html:'<h1>EMPTY_FORM_TABLE</h1><table><tr><td><p></p></td><td><p></p></td></tr></table><h1>PROSE</h1><p>Remaining prose.</p>'});
 let bytes:Uint8Array;try{const exported=await requestDocument<{dataBase64:string}>('document.exportBytes',{sessionId:opened.sessionId,format:'docx'});bytes=bytesFromBase64(exported.dataBase64)}finally{await requestDocument('document.close',{sessionId:opened.sessionId})}
 const source=await inspectManuscriptFile(new File([bytes!],'Own empty form.docx'));const table=source.blocks.find(block=>block.html.includes('<table'));if(!table)throw Error('Native inspection did not expose the authored empty table; no splitter conclusion supported');const plan=await planManuscriptImport([source],{mode:'heading',headingLevel:1,separator:'***'},{projectId:'independent-zero-table'});
 return[table.words===0&&!plan.chapters.some(chapter=>chapter.content.includes('<table'))?'FINDING DOCX_ZERO_WORD_TABLE_CHAPTER_LOST: native inspected table0words is silently discarded by same heading splitter predicate':'Independent native empty table survives heading plan'];
}
