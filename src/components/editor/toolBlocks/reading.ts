import { liveQuery } from 'dexie';
import { escapeToolText,toolTarget } from './model';
import { resolveToolPreview } from './preview';
import { toolBlockCopy } from './copy';
import { modelReaderMarkup } from '@/engines/model-viewer/readerMarkup';
import { sheetPaper } from '@/engines/character-sheets/paper';
import {findLocalToolBlocksInHtml} from '@/engines/local/blocks/types';
import {sourceBlockPreviewHtml} from '@/services/sourceBlockReading';
/** Hydrate only the reader DOM; persisted host HTML and undo are untouched. */
export function hydrateToolDocumentBlocks(container:HTMLElement,projectId:string,locale:'es'|'en',eraId?:string) {
  const subscriptions=[...container.querySelectorAll<HTMLElement>('figure[data-wh-tool-block="true"]')].map(element=>{
    const target=toolTarget({projectId:element.dataset.projectId,kind:element.dataset.toolKind,documentId:element.dataset.documentId,label:element.dataset.label,namespace:element.dataset.namespace,presentation:element.dataset.presentation,sheetDisplay:element.dataset.sheetDisplay});
    let disposeModel:(()=>void)|undefined, generation=0;
    const clear=()=>{generation++;disposeModel?.();disposeModel=undefined;};
    const fallback=()=>{clear();element.replaceChildren(document.createTextNode(toolBlockCopy[locale].unavailable));};
    if(!target||target.projectId!==projectId){fallback();return undefined;}
    const subscription=liveQuery(()=>resolveToolPreview(target,projectId,locale,{eraId})).subscribe({next:preview=>{
      clear();
      if(!preview){fallback();return;}
      element.innerHTML=`<figcaption><strong>${escapeToolText(preview.title)}</strong></figcaption>${preview.model?modelReaderMarkup(preview.model,locale):preview.sheet?sheetPaper(preview.sheet,locale).svg:preview.html}${preview.truncated?`<p>${escapeToolText(toolBlockCopy[locale].truncated)}</p>`:''}`;
      if(preview.model){const current=generation;void import('@/engines/model-viewer/reader').then(({mountModelReaders})=>{if(current===generation)disposeModel=mountModelReaders(element);}).catch(fallback);}
    },error:fallback});
    return{unsubscribe:()=>{clear();subscription.unsubscribe();}};
  });
  const sourceSubscriptions=[...container.querySelectorAll<HTMLElement>('figure[data-wh-source-block="true"]')].map(element=>{
    const fallback=()=>element.replaceChildren(document.createTextNode(toolBlockCopy[locale].unavailable));
    try{
      const span=findLocalToolBlocksInHtml(element.outerHTML)[0];if(!span||span.projectId!==projectId){fallback();return;}
      return liveQuery(()=>sourceBlockPreviewHtml(span.envelope,projectId,locale,{eraId})).subscribe({next:html=>{element.innerHTML=html;},error:fallback});
    }catch{fallback();return;}
  });
  return()=>{subscriptions.forEach(subscription=>subscription?.unsubscribe());sourceSubscriptions.forEach(subscription=>subscription?.unsubscribe());};
}
