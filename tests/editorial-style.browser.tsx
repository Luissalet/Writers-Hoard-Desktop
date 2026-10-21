import '@/engines';
import {Editor} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {closeHistory} from '@tiptap/pm/history';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {createAdvancedExtensions,applyAdvancedFormatting,normalizeAdvancedHtml,insertSceneBreak,SCENE_BREAK_STYLES,EDITORIAL_PROSE_CSS} from '@/components/editor/advanced';
import {FootnoteNode} from '@/components/editor/footnotes/FootnoteNode';
import {BookDocument,ChapterHeadingNode} from '@/components/editor/chapterHeading/ChapterHeadingNode';
import TiptapEditor from '@/components/editor/TiptapEditor';
import {sanitizeRichHtml} from '@/utils/sanitizeRichHtml';
import {composePublishingDocument} from '@/engines/writings/publishingDocument';
import {buildPublishingDocx} from '@/engines/writings/publishingDocx';
import {buildPublishingEpub} from '@/engines/writings/publishingEpub';
import {renderPublishingHtml,renderPublishingMarkdown} from '@/engines/writings/manuscriptExport';
import {createEditorialExtensions,upsertEditorialStyle,applyEditorialStyle} from '@/engines/writings/editorial';
import {db} from '@/db';
import type {Writing} from '@/types';
import JSZip from 'jszip';

function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const equal=(a:unknown,b:unknown,message:string)=>assert(JSON.stringify(a)===JSON.stringify(b),`${message}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const fixture='<p>“Ágata crossed the quiet square. The lamps still burned beside the doors.</p><p>Another paragraph begins here, with a first line set apart from the following lines.</p>';
function mount(content:string,book=false){const host=document.createElement('div');document.body.append(host);const editor=new Editor({element:host,extensions:[StarterKit.configure({document:book?false:{}}),FootnoteNode,...createAdvancedExtensions(),...createEditorialExtensions(),...(book?[BookDocument,ChapterHeadingNode.configure({nodeView:false})]:[])],content});return{editor,dispose(){editor.destroy();host.remove();}};}
export async function testEditorialStyle():Promise<string[]>{
 const passed:string[]=[];const {editor,dispose}=mount(fixture);
 try{
  const before=editor.getHTML();editor.view.dispatch(closeHistory(editor.state.tr));
  assert(applyAdvancedFormatting(editor,{dropCap:true,smallCaps:true,firstLineIndent:1.75},{from:1,to:8}),'combined format');
  const formatted=editor.getHTML();assert(formatted.includes('data-wh-drop-cap="true"')&&formatted.includes('data-wh-small-caps="true"')&&formatted.includes('data-wh-first-line-indent="1.75"'),formatted);
  assert(editor.commands.undo(),'undo');equal(editor.getHTML(),before,'single Undo restores inline and block');assert(editor.commands.redo(),'redo');equal(editor.getHTML(),formatted,'redo');
  const reopened=mount(sanitizeRichHtml(formatted));equal(reopened.editor.getJSON(),editor.getJSON(),'sanitizer/HTML reopen');reopened.dispose();
  const json=editor.getJSON();editor.commands.setContent(json);equal(editor.getHTML(),formatted,'JSON roundtrip');
  editor.commands.setTextSelection(editor.state.doc.firstChild!.nodeSize-1);editor.commands.splitBlock();assert(editor.state.doc.child(0).attrs.dropCap===true&&editor.state.doc.child(1).attrs.dropCap!==true,'Enter keeps drop cap only on opening paragraph');
  editor.commands.setContent(fixture);let second=editor.state.doc.firstChild!.nodeSize+1;applyAdvancedFormatting(editor,{dropCap:true},{from:1,to:8});applyAdvancedFormatting(editor,{smallCaps:true},{from:1,to:8});applyAdvancedFormatting(editor,{firstLineIndent:1.75},{from:second,to:second+7});
  for(const ornament of SCENE_BREAK_STYLES){editor.commands.setTextSelection(editor.state.doc.content.size);editor.commands.insertContent({type:'paragraph'});editor.commands.setTextSelection(editor.state.doc.content.size-1);assert(insertSceneBreak(editor,ornament),ornament);}
  const html=editor.getHTML();equal(new DOMParser().parseFromString(html,'text/html').querySelectorAll('hr[data-wh-ornament]').length,5,'all scene-break variants');
  const hostile=sanitizeRichHtml('<p data-wh-drop-cap="yes" data-wh-first-line-indent="-1"><span data-wh-small-caps="url(x)">Safe</span></p><hr data-wh-ornament="<script>">');assert(!hostile.includes('data-wh-'),'invalid semantic values dropped');
  const book=mount('<h1 data-chapter-id="chapter">Chapter</h1>'+html,true);assert(book.editor.getHTML().includes('data-wh-drop-cap="true"')&&book.editor.getHTML().includes('data-wh-ornament="diamond"'),'combined book schema preserves formatting');book.dispose();
  const named=mount('<p>Named text</p>');assert(upsertEditorialStyle(named.editor,{id:'opening',name:'Opening',format:{dropCap:true,smallCaps:true,firstLineIndent:2}}).ok,'named style saved');assert(applyEditorialStyle(named.editor,{id:'opening',from:named.editor.state.doc.child(0).nodeSize+1,to:named.editor.state.doc.content.size-1}).changed,'named style applies new fields');assert(named.editor.getHTML().includes('data-wh-drop-cap="true"'),'style result');named.dispose();
  passed.push('normal editor HTML/JSON/sanitizer/book and named styles preserve typography; combined Undo/Redo and Enter work');
  const writing:Writing={id:'editorial',projectId:'editorial',title:'The crossing',content:html,wordCount:32,tags:[],status:'draft',createdAt:1,updatedAt:1};
  const ir=composePublishingDocument([writing],{projectTitle:'Editorial proof',includeTitlePage:false,includeSynopsis:false,chapterLabel:'Chapter',generatedAt:1});
  assert(ir.sections[0].portableHtml.includes('data-wh-drop-cap="true"'),'IR keeps semantic attrs');
  Object.assign(window,{__editorialStage:'DOCX build'});const docx=await buildPublishingDocx(ir);Object.assign(window,{__editorialStage:'DOCX unzip'});const doczip=await JSZip.loadAsync(await docx.arrayBuffer());const xml=await doczip.file('word/document.xml')!.async('string');
  const word=new DOMParser().parseFromString(xml,'application/xml');assert(!word.querySelector('parsererror'),'well-formed DOCX');const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  assert(word.getElementsByTagNameNS(ns,'smallCaps').length>0,'native smallCaps');assert([...word.getElementsByTagNameNS(ns,'ind')].some(el=>el.getAttributeNS(ns,'firstLine')==='420'),'native firstLine 1.75em →420twips');assert([...word.getElementsByTagNameNS(ns,'framePr')].some(el=>el.getAttributeNS(ns,'dropCap')==='drop'&&el.getAttributeNS(ns,'lines')==='3'),'native drop-cap frame');
  const text=[...word.getElementsByTagNameNS(ns,'t')].map(el=>el.textContent).join('');assert(text.includes('“Ágata crossed the quiet square.'),'Unicode initial is neither lost nor duplicated: '+text);assert(!text.includes('“Á“Á'),'no doubled initial');assert(text.includes('⁂')&&text.includes('◇')&&text.includes('• • •'),'native ornaments');
  Object.assign(window,{__editorialStage:'EPUB build'});const epub=await buildPublishingEpub(ir),epzip=await JSZip.loadAsync(await epub.arrayBuffer()),xhtml=await epzip.file('EPUB/section-1.xhtml')!.async('string');const parsed=new DOMParser().parseFromString(xhtml,'application/xhtml+xml');assert(!parsed.querySelector('parsererror'),'well-formed EPUB');assert(xhtml.includes('data-wh-small-caps="true"')&&xhtml.includes('data-wh-drop-cap="true"')&&xhtml.includes('data-wh-first-line-indent="1.75"'),'EPUB attributes');assert((await epzip.file('EPUB/styles.css')!.async('string')).includes('::first-letter'),'EPUB styling');const restored=normalizeAdvancedHtml(parsed.documentElement.outerHTML);assert(restored.includes('<hr data-wh-ornament="diamond"'),'EPUB scene-break roundtrip');
  const output=renderPublishingHtml(ir);assert(output.includes(EDITORIAL_PROSE_CSS)&&output.includes('data-wh-drop-cap="true"'),'portable HTML contains shared rules');assert(renderPublishingMarkdown(ir).includes('gata crossed'),'Markdown keeps prose');
  (window as unknown as {__editorialArtifacts:unknown}).__editorialArtifacts={html:output,docx:Array.from(new Uint8Array(await docx.arrayBuffer())),epub:Array.from(new Uint8Array(await epub.arrayBuffer()))};
  passed.push('real DOCX native frame/smallCaps/indent and Unicode prose, EPUB XHTML/CSS/roundtrip, shared IR and HTML emitted');
 }finally{dispose();}return passed;
}

type QAWindow=Window&{__want?:{w:number;h:number;n:number}|null;__sizeAck?:number;__shot?:{name:string}|null;__shotDone?:string;__native?:{n:number;events:unknown[]}|null;__nativeAck?:number};const qa=window as QAWindow;let sequence=0;
const delay=(ms=30)=>new Promise(resolve=>setTimeout(resolve,ms));async function until(fn:()=>unknown){const end=Date.now()+15000;while(!fn()){if(Date.now()>end)throw Error('UI handshake timeout');await delay();}}
async function native(events:unknown[]){await act(async()=>{const n=++sequence;qa.__native={n,events};await until(()=>qa.__nativeAck===n);});}
async function click(el:Element){el.scrollIntoView({block:'nearest',behavior:'instant'});await delay();const b=el.getBoundingClientRect(),x=Math.round(b.x+b.width/2),y=Math.round(b.y+b.height/2);assert(document.elementFromPoint(x,y)?.closest('button,input,select,summary,.ProseMirror')===el||el.contains(document.elementFromPoint(x,y)),'control occluded');await native([{type:'mouseDown',x,y,button:'left',clickCount:1},{type:'mouseUp',x,y,button:'left',clickCount:1}]);}
export async function testEditorialStyleLayout():Promise<string[]>{
 const passed:string[]=[];await db.projects.put({id:'editorial-ui',title:'Editorial UI',description:'',mode:'custom',type:'standalone',color:'#d5b575',status:'draft',enabledEngines:['writings'],engineOrder:['writings'],createdAt:1,updatedAt:1});
 for(const width of [1440,640]){
  const n=++sequence;qa.__want={w:width,h:900,n};await until(()=>qa.__sizeAck===n);let editor:Editor|null=null,saved='';const host=document.getElementById('root')!;const root=createRoot(host);
  await act(async()=>root.render(<main style={{maxWidth:1100,margin:'0 auto',padding:16}}><h1 className="font-serif text-2xl mb-4">The crossing</h1><TiptapEditor content={fixture} onChange={html=>saved=html} onEditorReady={value=>{editor=value;}} referenceContext={{projectId:'editorial-ui',scopeId:'editorial-'+width}}/></main>));
  await until(()=>editor);const current=editor as unknown as Editor;await delay(100);
  const summary=[...host.querySelectorAll('summary')].find(el=>/formato avanzado|advanced formatting/i.test(el.textContent??''));assert(summary,'incumbent advanced toolbar');await click(summary);await delay();
  const toolbar=host.querySelector('[role=group][aria-label="Advanced formatting"], [role=group][aria-label="Formato avanzado"]')!, probe=toolbar.querySelector("select")!;assert(getComputedStyle(toolbar).display==="flex"&&parseFloat(getComputedStyle(probe).width)<toolbar.clientWidth/2,"Advanced controls unexpectedly occupy full rows");if(width===1440)assert(toolbar.getBoundingClientRect().height<120,"Advanced desktop toolbar exceeds three compact rows");
  await click(host.querySelector('.ProseMirror')!);await delay(60);await native([{type:'keyDown',keyCode:'Home',modifiers:['control']},{type:'keyUp',keyCode:'Home',modifiers:['control']},{type:'keyDown',keyCode:'Right',modifiers:['control','shift']},{type:'keyUp',keyCode:'Right',modifiers:['control','shift']},{type:'keyDown',keyCode:'Right',modifiers:['control','shift']},{type:'keyUp',keyCode:'Right',modifiers:['control','shift']}]);
  assert(!current.state.selection.empty,'native text selection');const control=(selector:string)=>{const el=host.querySelector(selector);assert(el,selector);return el;};await click(control('button[aria-label="Capitular"],button[aria-label="Drop cap"]'));await click(control('button[aria-label="Versalitas"],button[aria-label="Small caps"]'));
  const second=current.state.doc.firstChild!.nodeSize+1;current.commands.setTextSelection(second);await click(control('input[aria-label="Primera línea (em)"],input[aria-label="First line (em)"]'));await native([{type:'keyDown',keyCode:'A',modifiers:['control']},{type:'keyUp',keyCode:'A',modifiers:['control']},{type:'text',text:'1.75'},{type:'keyDown',keyCode:'Tab'},{type:'keyUp',keyCode:'Tab'}]);
  assert(current.state.doc.child(1).attrs.firstLineIndent===1.75,'native numeric typing sets indent');current.commands.focus('end');current.view.dispatch(closeHistory(current.state.tr));const prior=current.getHTML();
  const select=control('select[aria-label="Separador de escena"],select[aria-label="Scene break"]') as HTMLSelectElement;await act(async()=>{select.value='diamond';select.dispatchEvent(new Event('change',{bubbles:true}));});assert(current.getHTML().includes('data-wh-ornament="diamond"'),'actual scene-break menu change');
  await click(control('button[title="Deshacer"],button[title="Undo"]'));equal(current.getHTML(),prior,'normal toolbar Undo scene break');await click(control('button[title="Rehacer"],button[title="Redo"]'));assert(current.getHTML().includes('data-wh-ornament="diamond"'),'normal toolbar Redo');
  await act(async()=>{current.commands.setTextSelection(second);});const opening=host.querySelector('.ProseMirror p[data-wh-drop-cap="true"]')!;opening.scrollIntoView({block:'center',behavior:'instant'});await delay(100);assert(parseFloat(getComputedStyle(opening,'::first-letter').fontSize)>parseFloat(getComputedStyle(opening).fontSize)*2,'actual rendered drop cap');assert(getComputedStyle(host.querySelector('[data-wh-small-caps="true"]')!).fontVariantCaps==='small-caps','actual rendered small caps');assert(document.documentElement.scrollWidth<=width+1,'no horizontal page overflow');assert(saved.includes('data-wh-ornament="diamond"')&&saved.includes('data-wh-first-line-indent="1.75"'),'normal onChange content');
  qa.__shot={name:'editorial-style-'+width};await until(()=>qa.__shotDone==='editorial-style-'+width);await act(async()=>root.unmount());passed.push(`actual toolbar, native pointer/keyboard and numeric indent, menu onchange, toolbar Undo/Redo and rendered typography at${width}`);
 }return passed;
}
