import {act} from 'react';import {createRoot} from 'react-dom/client';
import TiptapEditor from '@/components/editor/TiptapEditor';
import {reviewFixture} from './manuscript-review.browser';
import {inspectManuscriptFile} from '@/engines/writings/manuscriptReview/inspect';
import {planManuscriptImport} from '@/engines/writings/manuscriptReview/plan';
export async function testIndependentRevisionAppearance(){
 const fixture=await reviewFixture(),source=await inspectManuscriptFile(fixture.file),plan=await planManuscriptImport([source],{mode:'heading',headingLevel:1,separator:'***'},{projectId:fixture.projectId});const host=document.getElementById('root')!,root=createRoot(host);let ready=false;
 await act(async()=>root.render(<TiptapEditor content={plan.chapters[0].content} referenceContext={{projectId:fixture.projectId,scopeId:'own-review'}} onEditorReady={editor=>{ready=!!editor}}/>));for(let n=0;n<100&&!ready;n++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20))});
 const del=host.querySelector<HTMLElement>('[data-wh-revision-kind="deletion"]'),ins=host.querySelector<HTMLElement>('[data-wh-revision-kind="insertion"]');if(!del||!ins)throw Error('Real imported insertion/deletion marks absent');const d=getComputedStyle(del),i=getComputedStyle(ins),parent=getComputedStyle(del.parentElement!);const proof={deletion:{decoration:d.textDecorationLine,color:d.color,background:d.backgroundColor},insertion:{decoration:i.textDecorationLine,color:i.color,background:i.backgroundColor},parent:{decoration:parent.textDecorationLine,color:parent.color,background:parent.backgroundColor},text:del.textContent!+ins.textContent!};
 const invisible=d.textDecorationLine==='none'&&i.textDecorationLine==='none'&&d.color===i.color&&d.backgroundColor===i.backgroundColor;await act(async()=>root.unmount());return[(invisible?'FINDING DOCX_REVIEW_BODY_MARKS_UNSTYLED: imported deletion/insertion body shows undifferentiated concatenated text ':'Independent revision body has distinct visual styling ')+JSON.stringify(proof)];
}
