// C41-front own improvement. The original RED used the synchronous adapter;
// the approved contract adds preparePublishingArtifacts as its async sibling.
// Raw original RED remains in _stage/parity-cover-next/AUTHOR-front-integrated-RED.log.
import {buildPublishingArtifacts,preparePublishingArtifacts,preparePublishingPreview} from '@/services/projectTools';
import {buildPublishingEpub} from '@/engines/writings/publishingEpub';
import {buildPublishingDocx} from '@/engines/writings/publishingDocx';
import {exportCoverImage} from '@/engines/writings/coverDesign/export';
import {db} from '@/db';
import type {ReaderPresentation} from '@/engines/writings/readerPresentationTypes';
import type {CoverElement} from '@/engines/writings/coverDesign/types';
import type {PublishingProfile} from '@/types/projectTools';
import type {Writing} from '@/types';
import {bookPreset} from '@/engines/writings/bookStyle';
import {useLocaleStore} from '@/stores/localeStore';
function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
export function coverTestRaster(color:string){const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;const context=canvas.getContext('2d')!;context.fillStyle=color;context.fillRect(0,0,2,2);return canvas.toDataURL('image/png');}
export function coverTestFixture(){
 const cover:ReaderPresentation['cover']={style:'paperback',color:'#112233',texture:'none',artwork:false,showAtStart:false,jacket:{version:1,elements:[{id:'qa-back',kind:'image',src:coverTestRaster('#0000ff'),x:0,y:0,width:600,height:900,rotation:0},{id:'qa-front',kind:'image',src:coverTestRaster('#ff0000'),x:672,y:0,width:600,height:900,rotation:0},{id:'qa-title',kind:'text',text:'FRONT A',x:712,y:80,width:480,height:100,rotation:0,font:'georgia',size:48,bold:true,align:'center',color:'#ffffff'}]}};
 const project={id:'qa-cover-integrated-gap',title:'Captured cover A',author:'QA Author',readerPresentation:{revision:0,cover,chapters:{}}};
 const profile:PublishingProfile={id:'qa-profile-cover-gap',projectId:project.id,name:'QA book',format:'manuscript',includeCover:true,includeTitlePage:true,includeSynopsis:false,includeBibliography:false,citationStyle:'apa',selectedWritingIds:[],createdAt:1,updatedAt:1};
 const writing:Writing={id:'qa-cover-writing',projectId:project.id,title:'Chapter A',content:'<p>Authored prose remains exact.</p>',wordCount:5,status:'draft',tags:[],createdAt:1,updatedAt:1};
 return{project,profile,writing};
}
async function bytes(blob:Blob){return new Uint8Array(await blob.arrayBuffer());}
async function pixel(src:string){const image=new Image();image.src=src;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d')!;context.drawImage(image,0,0);return [...context.getImageData(8,8,1,1).data];}
export async function testPublishingCoverIntegratedGap(){
 const {project,profile,writing}=coverTestFixture(),before=JSON.stringify({project,profile,writing}),at=Date.UTC(2026,9,26);
 const baseline=await exportCoverImage(project.title,undefined,project.readerPresentation.cover,'front','png',1);
 check(baseline.width===600&&baseline.height===900&&JSON.stringify(await pixel(baseline.dataUrl))==='[255,0,0,255]','Actual front baseline');
 const promise=preparePublishingArtifacts(project,profile,[writing],[],{generatedAt:at});
 project.title='Live cover B';project.readerPresentation.cover.jacket!.elements[1]={...project.readerPresentation.cover.jacket!.elements[1],src:coverTestRaster('#00ff00')} as CoverElement;writing.content='<p>Live prose B.</p>';
 const artifacts=await promise,cover=artifacts.document.cover;
 check(cover?.width===1200&&cover.height===1800,'Captured front dimensions');
 check(JSON.stringify(await pixel(cover.src))==='[255,0,0,255]'&&cover.alt==='Captured cover A','Capture before await retained live B');
 check(artifacts.document.sections[0].html.includes('Authored prose remains exact.')&&!artifacts.html.includes('Live prose B.'),'Other input snapshot mutated after capture');
 check(Object.isFrozen(artifacts)&&Object.isFrozen(artifacts.document)&&Object.isFrozen(cover)&&Object.isFrozen(artifacts.document.sections),'Prepared IR is mutable');
 check(!Reflect.set(cover,'src',coverTestRaster('#00ff00')),'Captured cover bytes can be replaced');
 const parsed=new DOMParser().parseFromString(artifacts.html,'text/html');
 check(parsed.body.firstElementChild?.className==='wh-book-cover'&&parsed.querySelector('.wh-book-cover img')?.getAttribute('src')===cover.src,'HTML cover not before title/from same PNG');
 const expected=Uint8Array.from(atob(cover.src.split(',')[1]),letter=>letter.charCodeAt(0));
 const same=(actual:Uint8Array)=>actual.length===expected.length&&actual.every((n,i)=>n===expected[i]);
 const {default:JSZip}=await import('jszip');
 db.close({disableAutoOpen:true});
 let epub:Blob,docx:Blob;
 try{epub=await buildPublishingEpub(artifacts.document);docx=await buildPublishingDocx(artifacts.document);}finally{await db.open();}
 const epubZip=await JSZip.loadAsync(await epub.arrayBuffer()),opf=await epubZip.file('EPUB/package.opf')!.async('string');
 check(same(await epubZip.file('EPUB/images/cover.png')!.async('uint8array')),'EPUB changed captured PNG');
 check(/properties="cover-image"/.test(opf)&&/<spine>\s*<itemref idref="cover-page"/.test(opf),'EPUB cover metadata/spine first');
 check((await epubZip.file('EPUB/cover.xhtml')!.async('string')).includes('images/cover.png'),'EPUB cover.xhtml missing');
 const docxZip=await JSZip.loadAsync(await docx.arrayBuffer()),xml=await docxZip.file('word/document.xml')!.async('string');
 const media=Object.keys(docxZip.files).filter(name=>name.startsWith('word/media/')&&!name.endsWith('/'));
 check(media.length===1&&same(await docxZip.file(media[0])!.async('uint8array')),'DOCX changed captured PNG');
 check(xml.indexOf('<w:drawing>')<xml.indexOf('Captured cover A')&&xml.indexOf('<w:drawing>')<xml.indexOf('Chapter A'),'DOCX cover not first');
 check(xml.indexOf('w:type="page"')>xml.indexOf('<w:drawing>'),'DOCX cover has no following page break');
 const extent=/<wp:extent cx="(\d+)" cy="(\d+)"/.exec(xml);check(extent&&Math.abs(Number(extent[1])/Number(extent[2])-2/3)<0.002,'DOCX front aspect distorted');
 const legacy=coverTestFixture(),off={...legacy.profile,includeCover:undefined};
 const omitted=buildPublishingArtifacts(legacy.project,off,[legacy.writing],[],{generatedAt:at}),explicitFalse=buildPublishingArtifacts(legacy.project,{...off,includeCover:false},[legacy.writing],[],{generatedAt:at});
 check(omitted.html===explicitFalse.html&&omitted.markdown===explicitFalse.markdown&&!omitted.document.cover,'Legacy absent/false changed HTML or markdown');
 const oldEpub=await JSZip.loadAsync(await(await buildPublishingEpub(omitted.document)).arrayBuffer());check(!oldEpub.file('EPUB/cover.xhtml')&&!Object.keys(oldEpub.files).some(name=>name.includes('cover.png')),'Legacy EPUB gained cover');
 const twoColumns=await preparePublishingArtifacts(legacy.project,{...legacy.profile,bookStyle:bookPreset('sourcebook')},[legacy.writing],[],{generatedAt:at});
 const twoZip=await JSZip.loadAsync(await(await buildPublishingDocx(twoColumns.document)).arrayBuffer()),twoXml=await twoZip.file('word/document.xml')!.async('string');
 check(twoXml.indexOf('<w:drawing>')<twoXml.indexOf('w:num="2"'),'Two-column layout includes cover in body columns');
 let unprepared=false;try{buildPublishingArtifacts(legacy.project,legacy.profile,[legacy.writing],[]);}catch(error){unprepared=error instanceof Error&&error.message==='publishing_cover_not_prepared';}check(unprepared,'Synchronous caller silently lost requested cover');
 const locale=useLocaleStore.getState().locale,clock=Date.now;let preview;
 // Clock/locale race is controlled, while the image decode and PNG remain real.
 try{useLocaleStore.setState({locale:'es'});Date.now=()=>at;
  const previewPromise=preparePublishingPreview(legacy.project,{...legacy.profile,includeCopyright:true},[legacy.writing],[]);
  useLocaleStore.setState({locale:'en'});Date.now=()=>at+86400000*365;preview=await previewPromise;
 }finally{Date.now=clock;useLocaleStore.setState({locale});}
 check(preview.document.locale==='es'&&preview.document.copyright?.includes('Todos los derechos reservados.')&&preview.document.generatedAt===at,'Preview recomputed locale/time after its capture await: '+JSON.stringify({locale:preview.document.locale,copyright:preview.document.copyright,generatedAt:preview.document.generatedAt}));
 check(before!==JSON.stringify({project,profile,writing}),'Fixture mutation did not execute');
 // Own QA payload only. Test driver may write these to its private output for real render QA.
 Reflect.set(window,'__coverCaptureArtifacts',{html:artifacts.html,docx:Array.from(await bytes(docx)),epub:Array.from(await bytes(epub)),png:cover.src,source:artifacts.document});
 return ['C41-front: actual renderer PNG1200x1800 captured A before await; live cover/prose B cannot change frozen IR; HTML/EPUB/DOCX same captured bytes with DB closed; first spine/first-page drawing/aspect; absent=false legacy HTML/Markdown and EPUB; two-column cover remains front matter. Native PDF/visual render are separate checks.'];
}

