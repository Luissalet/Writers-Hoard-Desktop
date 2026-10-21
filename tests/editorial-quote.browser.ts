import {prepareStaticEditorialHtml} from '@/components/editor/advanced/proseStyle';
import {renderPublishingHtml} from '@/engines/writings/manuscriptExport';
import {composePublishingDocument} from '@/engines/writings/publishingDocument';
import {db} from '@/db';
import type {Writing} from '@/types';
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const bodies=[
 '“<span data-wh-small-caps="true" style="font-variant-caps:small-caps">Ágata</span> crossed the quiet square. The lamps still burned beside the doors.',
 '«<strong><em>Ágata</em></strong> crossed the quiet square. The lamps still burned beside the doors.',
 '"<em>A</em><strong>́</strong>gata crossed the quiet square. The lamps still burned beside the doors.',
 '‘<a href="#local"><u><span data-wh-small-caps="true">Ágata</span></u></a> crossed the quiet square. The lamps still burned beside the doors.',
];
export async function testEditorialQuotePreparation(){
 const opts={projectTitle:'Quote proof',includeTitlePage:false,includeSynopsis:false,chapterLabel:'Chapter',generatedAt:1};
 const normal='<p>Normal control retains twelve point prose, its spaces and punctuation.</p>';
 assert(prepareStaticEditorialHtml(normal)===normal,'normal paragraph must remain byte-exact');
 const artifacts=[];
 for(let i=0;i<bodies.length;i++){
  const content=`<p data-wh-drop-cap="true">${bodies[i]}</p><p>Another paragraph begins here.</p><hr data-wh-ornament="asterism"><hr data-wh-ornament="diamond">`,snapshot=content;
  const doc=new DOMParser().parseFromString(content,'text/html'),prepared=prepareStaticEditorialHtml(content),out=new DOMParser().parseFromString(prepared,'text/html'),cap=out.querySelector('.wh-drop-cap-initial')!;
  assert(cap?.parentElement?.tagName==='P','render-only initial must be a direct paragraph child');
  assert(out.body.textContent===doc.body.textContent,'quoted/grapheme text exact, without duplication');
  assert(cap.textContent?.normalize('NFC')===bodies[i][0]+'Á','punctuation plus complete accented grapheme');
  for(const tag of ['strong','em','u','a','span[data-wh-small-caps]']){
   const before=Array.from(doc.querySelectorAll(tag)).map(x=>x.textContent).join(''),after=Array.from(out.querySelectorAll(tag)).map(x=>x.textContent).join('');assert(before===after,'all marked text preserved: '+tag);
  }
  if(i===3)assert(cap.querySelector('a')?.getAttribute('href')==='#local','link metadata retained');
  assert(prepareStaticEditorialHtml(prepared)===prepared,'static preparation idempotent');
  const writing:Writing={id:'quote-'+i,projectId:'editorial-quote',title:'Opening '+i,content,wordCount:20,tags:[],status:'draft',createdAt:1,updatedAt:1},ir=composePublishingDocument([writing],opts),before=JSON.stringify({writing,ir});
  const html=renderPublishingHtml(ir);assert(JSON.stringify({writing,ir})===before&&content===snapshot,'render must not mutate canonical Writing/IR');
  artifacts.push({name:'quote-'+i,html,expectedText:doc.body.textContent});
 }
 const writing:Writing={id:'control',projectId:'editorial-quote',title:'Control',content:normal,wordCount:12,tags:[],status:'draft',createdAt:1,updatedAt:1};
 const control=renderPublishingHtml(composePublishingDocument([writing],opts));assert(control.includes(normal)&&!new DOMParser().parseFromString(control,'text/html').querySelector('.wh-drop-cap-initial'),'normal static paragraph unmodified');
 await db.projects.put({id:'editorial-quote',title:'Quote fixture',mode:'custom',type:'standalone',enabledEngines:['writings'],createdAt:1,updatedAt:1});
 await db.writings.put({...writing,id:'editorial-quote-live',content:`<p>“<span data-wh-small-caps="true">Ágata</span> crossed the quiet square.</p>`});
 Object.assign(window,{__editorialQuoteArtifacts:artifacts,__editorialControlHtml:control});
 return ['Detached static cap preserves curly/guillemet/ASCII/curly-single quotes, marked combining grapheme, inline marks and source bytes','Normal paragraph unchanged and render preparation idempotent; canonical Writing/IR untouched'];
}
