import {composePublishingDocument} from '@/engines/writings/publishingDocument';
import {buildPublishingDocx} from '@/engines/writings/publishingDocx';
import JSZip from 'jszip';
import type {Writing} from '@/types';
function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
export async function testPublishingDocxLayout(){
 const writing:Writing={id:'qa-docx-layout',projectId:'qa-docx-layout',title:'Body chapter',content:'<p>Owned body text with note.</p>',wordCount:6,status:'draft',tags:[],createdAt:1,updatedAt:1};
 const document=composePublishingDocument([writing],{projectTitle:'Own title page',includeTitlePage:true,includeSynopsis:false,chapterLabel:'Chapter',locale:'en',generatedAt:1793040000000});
 const read=async(input:typeof document)=>JSZip.loadAsync(await(await buildPublishingDocx(input)).arrayBuffer());
 const legacy=await read(document),legacySettings=await legacy.file('word/settings.xml')!.async('text'),legacyXml=await legacy.file('word/document.xml')!.async('text');
 check(!legacySettings.includes('mirrorMargins')&&!/<w:pgNumType[^>]*w:start=/.test(legacyXml)&&!Object.keys(legacy.files).some(name=>/^word\/footer\d+\.xml$/.test(name)),'Absent options changed legacy pagination: '+JSON.stringify({mirror:legacySettings.includes('mirrorMargins'),pageNumber:legacyXml.match(/<w:pgNumType[^>]*>/g),footers:Object.keys(legacy.files).filter(name=>name.includes('footer'))}));
 const custom=await read({...document,marginsMm:{top:11,bottom:13,inside:17,outside:19},initialPageNumber:7});
 const settings=await custom.file('word/settings.xml')!.async('text'),xml=await custom.file('word/document.xml')!.async('text');
 check(settings.includes('<w:mirrorMargins/>'),'Facing margins missing');
 const parsed=new DOMParser().parseFromString(xml,'application/xml');check(!parsed.querySelector('parsererror'),'Invalid document XML');
 const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
 const sections=[...parsed.getElementsByTagNameNS(ns,'sectPr')];check(sections.length===2,'Numbered body must have separate front matter');
 const get=(element:Element,key:string)=>element.getAttributeNS(ns,key);
 for(const section of sections){const margin=section.getElementsByTagNameNS(ns,'pgMar')[0];check(margin&&get(margin,'top')==='624'&&get(margin,'bottom')==='737'&&get(margin,'left')==='964'&&get(margin,'right')==='1077','Wrong physical margins');}
 check(sections[0].getElementsByTagNameNS(ns,'footerReference').length===0&&!sections[0].getElementsByTagNameNS(ns,'pgNumType')[0]?.hasAttributeNS(ns,'start'),'Front matter numbered');
 const start=sections[1].getElementsByTagNameNS(ns,'pgNumType')[0];check(start&&get(start,'start')==='7','Body initial page not seven');
 const footers=Object.keys(custom.files).filter(name=>/^word\/footer\d+\.xml$/.test(name));check(footers.length===1,'Expected body footer only');
 const footer=await custom.file(footers[0])!.async('text');check(/PAGE/.test(footer)&&footer.includes('w:jc w:val="center"'),'Real centered PAGE field missing');
 check(xml.includes('Owned body text with note.')&&xml.includes('Own title page'),'Authored content missing');
 return ['DOCX optional facing physical margins and initial body PAGE=7 are real OOXML; front matter has no footer; absent options preserve legacy sections/settings/footer absence.'];
}
