import { useLayoutEffect, useMemo, useRef } from 'react';
import { sanitizedHtml } from '@/utils/sanitizeRichHtml';
import { hydrateToolDocumentBlocks } from '@/components/editor/toolBlocks/reading';
import { hydrateCodexBlocks } from '@/components/editor/codexBlocks/reading';
import { hydrateLocalMediaBlocks } from '@/engines/media/readingBlocks';
import { toolBlockCopy } from '@/components/editor/toolBlocks/copy';

/** Saved card prose uses the same read-only live projections as the manuscript Reader. */
export default function CodexReadContent({ html, projectId, eraId, locale, player = false }: { html: string; projectId: string; eraId?: string; locale: 'es'|'en'; player?: boolean }) {
  const body=useRef<HTMLDivElement>(null),safe=useMemo(()=>sanitizedHtml(html),[html]);
  useLayoutEffect(()=>{
    const container=body.current;if(!container)return;
    // The player caller removes tool/source blocks before this component exists.
    // Clear cached captions before the first paint while scoped projections resolve.
    container.querySelectorAll('[data-wh-tool-block="true"],[data-wh-source-block="true"]').forEach(block=>block.replaceChildren(document.createTextNode(toolBlockCopy[locale].loading)));
    const stops=[hydrateCodexBlocks(container,projectId,locale==='es'?'La entrada local no está disponible.':'The local entry is unavailable.',eraId,{player})];
    if(!player){stops.push(hydrateToolDocumentBlocks(container,projectId,locale,eraId));stops.push(hydrateLocalMediaBlocks(container,projectId,locale==='es'?'El medio local no está disponible.':'The local media file is unavailable.',eraId,locale));}
    return()=>{for(const stop of stops)stop();};
  },[safe,projectId,eraId,locale,player]);
  return <div ref={body} dangerouslySetInnerHTML={safe}/>;
}
