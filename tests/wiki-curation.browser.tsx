import {act,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import WikiDocumentSelection from '@/engines/codex/WikiDocumentSelection';
import WikiLayoutEditor from '@/engines/codex/WikiLayoutEditor';
import {moveWikiDocuments,setWikiDocumentsIncluded,wikiDescendants} from '@/services/wikiProfiles/curation';
import {wikiDocumentHidden,wikiDocumentExcluded,wikiRefKey} from '@/services/wikiProfiles/policy';
import {validateWikiOptions} from '@/services/wikiProfiles/validation';
import type {WorldWikiOptions,WikiDocumentRef} from '@/types/worldWiki';
const assert=(condition:unknown,message:string):asserts condition=>{if(!condition)throw Error(message);};
const a:WikiDocumentRef={kind:'notes',id:'a'},b:WikiDocumentRef={kind:'tables',id:'b'};
const documents=[{ref:a,title:'A note'},{ref:b,title:'B table'}],labels={notes:'Notes',tables:'Tables'};
let latest:WorldWikiOptions={};
const initial:WorldWikiOptions={grouping:'manual',additionalDocuments:[a,b],sections:[{id:'root',name:'Root',documents:[a]},{id:'child',name:'Child',parentId:'root',documents:[b]},{id:'other',name:'Other',documents:[]}]};
function Harness(){const [options,setOptions]=useState(initial);useEffect(()=>{latest=options;},[options]);const change=(patch:Partial<WorldWikiOptions>|((current:WorldWikiOptions)=>Partial<WorldWikiOptions>))=>setOptions(current=>({...current,...typeof patch==='function'?patch(current):patch}));return <><WikiDocumentSelection documents={documents} options={options} change={change} labels={labels} locale="en" busy={false} loading={false}/><WikiLayoutEditor documents={documents} options={options} change={change} labels={labels} locale="en" busy={false}/></>;}
const pause=()=>new Promise(resolve=>setTimeout(resolve,30));
async function click(element:Element|null|undefined){assert(element,'Missing click control');await act(async()=>{(element as HTMLElement).click();await pause();});}
async function value(element:Element|null|undefined,next:string){assert(element,'Missing value control');const input=element as HTMLInputElement;await act(async()=>{Object.getOwnPropertyDescriptor(input instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(input,next);input.dispatchEvent(new Event(input instanceof HTMLSelectElement?'change':'input',{bubbles:true}));await pause();});}
export async function testWikiCuration(){const passed:string[]=[],host=document.createElement('div');document.body.append(host);const root=createRoot(host);try{
  for(const [kind,alias] of [['entry','codex'],['entry','codex-entry'],['map','maps'],['relation-tree','genealogy'],['board','board'],['notes','notes']])assert(wikiDocumentExcluded([{kind,id:'blocked'}],alias,'blocked')&&!wikiDocumentExcluded([{kind,id:'other'}],alias,'blocked'),'Every engine alias respects the same exclusion identity');
  assert(wikiDocumentExcluded([{kind:'local-tool',id:'blocked',namespace:'qa.one'}],'local-tool','blocked')&&!wikiDocumentExcluded([{kind:'local-tool',id:'blocked',namespace:'qa.one'}],'local-tool','blocked','qa.two'),'Unknown local reference namespace omits conservatively; known namespaces stay distinct');
  const repeated=[a,a];assert(moveWikiDocuments(initial.sections!,repeated,'child').find(section=>section.id==='child')!.documents.length===2&&moveWikiDocuments(initial.sections!,repeated,'child').find(section=>section.id==='root')!.documents.length===0,'Bulk moves remove old membership');
  const patch=setWikiDocumentsIncluded(initial,[a,{kind:'entry',id:'card'},{kind:'map',id:'map'}],false),restore=setWikiDocumentsIncluded({...initial,...patch},[a,{kind:'entry',id:'card'},{kind:'map',id:'map'}],true);
  assert(patch.excludedEntryIds?.includes('card')&&patch.excludedMapIds?.includes('map')&&!restore.excludedDocuments?.length&&!restore.excludedEntryIds?.length&&!restore.excludedMapIds?.length,'Bulk omission and inclusion clear both new and legacy gates');
  assert(wikiDescendants(initial.sections!,'root').has('child')&&wikiDocumentHidden(b,'tables',{...initial,sections:initial.sections!.map(section=>section.id==='root'?{...section,hideDocuments:true}:section)}),'Ancestor omission reaches descendants');
  for(const sections of [[{id:'a',name:'A',parentId:'missing',documents:[]}],[{id:'a',name:'A',parentId:'b',documents:[]},{id:'b',name:'B',parentId:'a',documents:[]}]]){let invalid=false;try{validateWikiOptions({grouping:'manual',sections});}catch{invalid=true;}assert(invalid,'Missing parents and cycles rejected');}
  passed.push('Bulk gates unify legacy omissions; moving removes old membership; descendant omission and parent validation hold');
  await act(async()=>{root.render(<Harness/>);await pause();});
  const button=(text:string)=>[...host.querySelectorAll('button')].find(button=>button.textContent===text),aria=(name:string)=>host.querySelector(`[aria-label="${name}"]`);
  await click(host.querySelector('[data-testid="wiki-document-curation"] summary'));
  await value(aria('Search wiki documents'),'A note');await click(button('Select visible'));await click(button('Omit selected'));
  assert(latest.excludedDocuments?.length===1&&wikiRefKey(latest.excludedDocuments[0])===wikiRefKey(a),'Filtered bulk action touches only selected visible result');
  await click(button('Include selected'));assert(!latest.excludedDocuments?.length,'Bulk reinclude clears omission');
  await value(aria('Move selected to section'),'child');assert(!latest.sections![0].documents.length&&latest.sections![1].documents.length===2,'Bulk move owns each ref once');
  passed.push('Real selection UI searches, selects visible, omits, includes and moves multiple documents in draft');
  const summaries=[...host.querySelectorAll('summary')];await click(summaries.find(summary=>summary.textContent==='Sections and order'));
  let fieldsets=[...host.querySelectorAll('fieldset')].filter(fieldset=>fieldset.querySelector('legend'));
  const rootField=()=>fieldsets.find(fieldset=>fieldset.querySelector('legend')?.textContent==='Root')!;
  const childField=()=>fieldsets.find(fieldset=>fieldset.querySelector('legend')?.textContent==='Child')!;
  const parentSelect=()=>[...rootField().querySelectorAll('label')].find(label=>label.textContent?.startsWith('Inside'))!.querySelector('select')!;
  assert(![...parentSelect().options].some(option=>option.value==='child'),'Parent picker cannot create cycle');
  const data=new DataTransfer();data.setData('application/x-writer-wiki',JSON.stringify({ref:a}));
  await act(async()=>{rootField().dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:data}));await pause();});
  assert(latest.sections![0].documents.length===1&&latest.sections![1].documents.length===1,'Typed drag moves document between sections');
  data.setData('application/x-writer-wiki',JSON.stringify({section:'other'}));await act(async()=>{rootField().dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:data}));await pause();});
  assert(latest.sections![0].id==='other','Typed drag reorders sibling sections');
  fieldsets=[...host.querySelectorAll('fieldset')].filter(fieldset=>fieldset.querySelector('legend'));
  await click(aria('Remove section Root'));assert(latest.sections!.find(section=>section.id==='child')?.parentId===undefined,'Removing parent promotes children without deleting their docs');
  validateWikiOptions(latest);
  passed.push('Real layout UI prevents cycles, accepts typed document and sibling-section drag and promotes children on parent removal');
  return passed;
}finally{await act(async()=>root.unmount());host.remove();}}
