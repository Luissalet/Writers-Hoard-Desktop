import { noteImageLayoutCss } from '@/components/editor/blocks/style';
import { getEraProject,listEraRows,readWorldDocument } from '@/services/worldEras/store';
import { eraDocumentKinds,type EraDocumentKind,type EraDocument,type WorldEraScope } from '@/services/worldEras/types';
import type { CodexEntry,Project,WorldMap,MapPin,Timeline,TimelineEvent,TimelineConnection } from '@/types';
import type { WorldTable } from '@/engines/tables/types';
import { cellKey } from '@/engines/tables/types';
import { sheetValues } from '@/engines/tables/formulas';
import { projectWorldTable } from '@/engines/tables/projection';
import { projectCodexEntry,codexPropertyHtml } from '@/engines/codex/properties';
import { exportMapSvg,DEFAULT_MAP_LAYERS } from '@/components/maps/mapGeometry';
import { exportRelationTreeSvg,type RelationTreeDocument } from '@/engines/genealogy/relationTrees';
import { exportRadarSvgComplete } from '@/engines/radar/interchange';
import { resolveRadarSeries } from '@/engines/radar/model';
import type { RadarChartDocument } from '@/engines/radar/types';
import type { CharacterSheet } from '@/engines/character-sheets/types';
import { sheetPaper } from '@/engines/character-sheets/paper';
import { sourceDocumentPreview } from '@/engines/local/documents/preview';
import {renderRichProsePreview} from '@/engines/local/richProseHtml';
import type { SourceToolDocument } from '@/engines/local/documents/types';
import {prepareSourceBlocksForExport} from '@/services/sourceBlockReading';
import {LOCAL_TOOL_PREVIEW_CSS} from '@/engines/local/previewTypes';
import { nativeWord,type WorldDictionary } from '@/engines/dictionary/types';
import { safeDictionaryFont } from '@/engines/dictionary/fonts';
import type { DialogBlock,Scene } from '@/engines/dialog-scene/types';
import type { Note } from '@/engines/notes/types';
import type { BoardNode,BoardEdge,BoardLayer } from '@/engines/board/types';
import { compactTimelineLabel } from '@/engines/timeline/timelineSettings';
import { resolveWorldCalendar } from '@/engines/timeline/worldCalendarStore';
import type { LocalMediaAsset } from '@/engines/media/types';
import { encodeLocalMedia } from '@/engines/media/portability';
import { modelReaderMarkup } from '@/engines/model-viewer/readerMarkup';
import type { ModelAsset } from '@/engines/model-viewer/portable';
import { prepareModelReaderRuntime,modelReaderExportScript } from '@/engines/model-viewer/offlineExport';
import { toolTarget } from '@/components/editor/toolBlocks/model';
import { extractFootnotesFromHtml,renderEndnotesHtml } from '@/components/editor/footnotes/footnoteModel';
import { boardImage } from './board';
import { esc,fields,image,raster,safeProse,svg,table,IMAGE_STYLE } from './markup';
import type { DocumentImageRequest,DocumentImageResult } from './types';

type Framing=DocumentImageResult['framing'];
interface Context {scope:WorldEraScope;project:Project;width:number;locale:'es'|'en';active:Set<string>;versions:Map<string,string>;entries?:CodexEntry[]}
const rows=<T>(document:EraDocument,key:string)=>document.children[key] as unknown as T[]??[];
const title=(root:Record<string,unknown>)=>String(root.title??root.name??String(root.text??'').split('\n')[0]??'');
const heading=(name:string,body:string)=>`<section><h2>${esc(name)}</h2>${body}</section>`;
async function entries(ctx:Context){return ctx.entries??=await listEraRows<CodexEntry>(ctx.scope,'codexEntries');}

async function prose(source:string,ctx:Context):Promise<string>{
  const doc=safeProse(await prepareSourceBlocksForExport(source,ctx.scope.projectId,ctx.locale,{eraId:ctx.scope.eraId}));
  for(const block of doc.querySelectorAll<HTMLElement>('figure[data-wh-tool-block="true"], [data-wh-codex-block="true"], [data-wh-media-block="true"]')){
    if(!doc.body.contains(block))continue;
    const target=block.dataset.whToolBlock?toolTarget({projectId:block.dataset.projectId,kind:block.dataset.toolKind,documentId:block.dataset.documentId,namespace:block.dataset.namespace,presentation:block.dataset.presentation}):{projectId:block.dataset.projectId,kind:block.dataset.whMediaBlock?'media':'codex',documentId:block.dataset.assetId??block.dataset.entryId,namespace:undefined};
    const kind=target?.kind==='relation-tree'?'genealogy':target?.kind;
    const section=doc.createElement('section');
    if(target?.projectId!==ctx.scope.projectId||!kind||!target?.documentId||!(eraDocumentKinds as readonly string[]).includes(kind))section.textContent=ctx.locale==='es'?'Documento vinculado no disponible.':'Linked document unavailable.';
    else try{const child=await renderPart(ctx,kind as EraDocumentKind,target.documentId,undefined,target.namespace);section.innerHTML=heading(child.title,child.html);}catch{section.textContent=ctx.locale==='es'?'Documento vinculado no disponible.':'Linked document unavailable.';}
    block.replaceWith(section);
  }
  const notes=extractFootnotesFromHtml(source);if(notes.length)doc.body.insertAdjacentHTML('beforeend',renderEndnotesHtml(notes,{heading:ctx.locale==='es'?'Notas':'Notes',style:'numbers',backlinks:false}));
  return doc.body.innerHTML;
}

async function media(asset:LocalMediaAsset,ctx:Context):Promise<string>{
  const portable=await encodeLocalMedia(asset),transcript=asset.voiceMemo?.transcript;
  let visual='';
  if(asset.kind==='video')visual=`<video src="${esc(portable.dataUrl)}" preload="auto" muted></video><p class="meta">${ctx.locale==='es'?'Fotograma inicial · sin reproducción':'Initial frame · playback paused'}</p>`;
  else{
    const audio=new AudioContext();
    try{
      const buffer=await audio.decodeAudioData(await asset.blob.arrayBuffer()),data=buffer.getChannelData(0),count=768;
      const bins=Array.from({length:count},(_,index)=>{const start=Math.floor(index*data.length/count),end=Math.floor((index+1)*data.length/count);let square=0;for(let i=start;i<end;i++)square+=data[i]*data[i];return Math.sqrt(square/Math.max(1,end-start));});
      const max=Math.max(.001,...bins);
      visual=`<svg class="waveform" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 768 200"><rect width="768" height="200" fill="#222a27"/>${bins.map((value,index)=>`<path d="M${index} ${100-value/max*90}V${100+value/max*90}" stroke="#d5b575"/>`).join('')}</svg><p class="meta">${buffer.duration.toFixed(3)} s · ${buffer.numberOfChannels} channels · ${buffer.sampleRate} Hz · complete waveform</p>`;
    }finally{await audio.close();}
  }
  return visual+fields({kind:asset.kind,mime:asset.mime,bytes:asset.size,notes:asset.notes,tags:asset.tags.join(', ')})+(transcript?heading('Transcript',transcript.segments.map(segment=>`<p><span class="meta">${segment.start.toFixed(2)}–${segment.end.toFixed(2)} s</span> ${esc(segment.text)}</p>`).join('')):'');
}

async function renderPart(ctx:Context,kind:EraDocumentKind,id:string,view?:DocumentImageRequest['view'],namespace?:string):Promise<{title:string;html:string;framing:Framing}>{
  const key=JSON.stringify([kind,id]);
  const read=await readWorldDocument(ctx.scope,kind,id);if(!read)throw new Error('document_not_found');
  if(kind==='local-tool'&&namespace!==undefined&&read.document.root.namespace!==namespace)throw new Error('document_not_found');
  const document={...read.document,children:Object.fromEntries(Object.entries(read.document.children).map(([table,data])=>[table,data.filter(row=>row.projectId===undefined||row.projectId===ctx.scope.projectId)]))},root=document.root,name=title(root);ctx.versions.set(key,read.version);
  if(ctx.active.has(key))return{title:name,html:`<p>${ctx.locale==='es'?'Enlace circular a un documento ya incluido.':'Circular link to a document already included.'}</p>`,framing:{mode:'complete-flow'}};
  ctx.active.add(key);
  let html='',framing:Framing={mode:'complete-flow'};
  try{
    if(view&&!['board','genealogy','maps','worldgen'].includes(kind))throw new Error('view_not_supported_for_flow');
    switch(kind){
      case 'codex':{
        const entry=root as unknown as CodexEntry,projected=projectCodexEntry(entry,ctx.project.codexTemplates),names=new Map((await entries(ctx)).map(row=>[row.id,row.title]));
        html=image(entry.avatar,entry.title)+`<dl>${Object.values(projected.properties).map(property=>`<div><dt>${esc(property.label)}</dt><dd>${codexPropertyHtml(property)}</dd></div>`).join('')}</dl>`+await prose(entry.content,ctx)+fields({tags:entry.tags.join(', ')})+table(['Relation','Target'],entry.relations.map(relation=>[relation.type,names.get(relation.targetId)??'Unavailable']));
        break;
      }
      case 'writings':html=await prose(String(root.content??''),ctx);break;
      case 'local-tool':html=renderRichProsePreview(sourceDocumentPreview(root as unknown as SourceToolDocument,ctx.locale),false);break;
      case 'notes':{const note=root as unknown as Note;html=(note.richHtml!==undefined?await prose(note.richHtml,ctx):`<div style="white-space:pre-wrap">${esc(note.text)}</div>`)+fields({kind:note.kind,source:note.source,tags:note.tags.join(', ')});break;}
      case 'dialog-scene':{
        const scene=root as unknown as Scene,blocks=rows<DialogBlock>(document,'dialogBlocks').sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id)),seen=new Set<string>();
        const block=async(item:DialogBlock)=>`<div class="${esc(item.type)}">${item.type==='dialog'?`<b>${esc(item.characterName)}</b>${item.parenthetical?`<i>${esc(item.parenthetical)}</i>`:''}`:''}${await prose(item.content,ctx)}</div>`;
        html=fields({setting:scene.setting,description:scene.description,omitted:scene.isOmitted??false,tags:scene.tags.join(', ')})+table(['Cast','Shortcut'],rows<{characterName:string;shortcut?:string}>(document,'sceneCasts').map(cast=>[cast.characterName,cast.shortcut]));
        for(const item of blocks){if(item.dualGroupId){if(seen.has(item.dualGroupId))continue;seen.add(item.dualGroupId);html+=`<div class="dual">${(await Promise.all(blocks.filter(other=>other.dualGroupId===item.dualGroupId).map(block))).join('')}</div>`;}else html+=await block(item);}
        break;
      }
      case 'dictionary':{
        const dictionary=root as unknown as WorldDictionary,font=safeDictionaryFont(dictionary.font);
        html=(font?`<style>@font-face{font-family:document-dictionary;src:url('${font.dataUrl}')}[data-native-word]{font-family:document-dictionary}</style>`:'')+`<p>${esc(dictionary.description)}</p><pre>${esc(dictionary.scriptMapping)}</pre>`+`<table><thead><tr>${['Word','Native form','Pronunciation','Part of speech','Meaning','Examples','Phrases','Derivatives','Origin'].map(value=>`<th>${value}</th>`).join('')}</tr></thead><tbody>${dictionary.words.map(word=>`<tr><td>${esc(word.word)}</td><td data-native-word>${esc(nativeWord(word,dictionary.scriptMapping))}</td>${[word.pronunciation,word.partOfSpeech,word.meaning,word.examples,word.phrases,word.derivatives,word.origin].map(value=>`<td>${esc(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
        break;
      }
      case 'tables':{
        const source=root as unknown as WorldTable,all=await entries(ctx),names=new Map(all.map(entry=>[entry.id,entry.title]));
        const projected=projectWorldTable(source,all,ctx.project.codexTemplates),columns=source.mode==='sheet'?source.columns:projected.columns,data=source.mode==='sheet'?source.rows:projected.displayRows;
        const values=source.mode==='sheet'?sheetValues(source):undefined;
        html=table(columns.map(column=>column.name),data.map((row,r)=>columns.map((column,c)=>{const value=String(values?.get(cellKey(c,r))??row.cells[column.id]??'');return column.kind==='reference'&&value?names.get(projected.rows[r]?.cells[column.id]??value)??'Unavailable':value;})));
        break;
      }
      case 'character-sheets':{
        html=sheetPaper(root as unknown as CharacterSheet,ctx.locale).svg;
        break;
      }
      case 'maps':{
        const map=root as unknown as WorldMap,pins=rows<MapPin>(document,'mapPins');
        let ratio=.5625;if(raster(map.backgroundImage)){const source=new Image();source.src=map.backgroundImage;await source.decode();ratio=source.naturalHeight/source.naturalWidth;}
        const w=ctx.width-64,h=Math.round(w*ratio),crop=view?{x:view.x*w/100,y:view.y*h/100,w:view.w*w/100,h:view.h*h/100}:undefined;
        html=svg(exportMapSvg(raster(map.backgroundImage)?map.backgroundImage:'',w,h,map.features??[],pins,map.layerVisibility??DEFAULT_MAP_LAYERS,map.layers),crop)+table(['Pin','Description','X','Y'],pins.map(pin=>[pin.name,pin.description,pin.position.x,pin.position.y]));
        framing={mode:view?'view':'fit-content',coordinateSpace:'map-percent',view:view??{x:0,y:0,w:100,h:100}};break;
      }
      case 'worldgen':{
        const {whRenderWorldMap}=await import('@/services/aiBridge/tools/worldgen');
        const args={projectId:ctx.scope.projectId,eraId:ctx.scope.eraId,worldId:id,width:ctx.width-64,theme:'relief',view};
        let result=await whRenderWorldMap(args) as {dataUrl?:string;view?:DocumentImageRequest['view']};
        const deadline=Date.now()+150000;
        while(!result.dataUrl&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,200));result=await whRenderWorldMap(args) as typeof result;}
        if(!result.dataUrl)throw new Error('world_generation_pending');
        if((await readWorldDocument(ctx.scope,kind,id))?.version!==read.version)throw new Error('document_changed_during_export');
        html=image(result.dataUrl,name);framing={mode:view?'view':'fit-content',coordinateSpace:'world-cells',view:result.view};break;
      }
      case 'genealogy':{
        const tree=root as unknown as RelationTreeDocument,names=new Map((await entries(ctx)).map(entry=>[entry.id,entry.title]));
        html=svg(exportRelationTreeSvg(tree,names),view)+table(['Person','Linked card','Deceased'],tree.nodes.map(node=>[node.label,node.codexEntryId?names.get(node.codexEntryId)??'Unavailable':'',Boolean(node.deceased)]));framing={mode:view?'view':'fit-content',coordinateSpace:'tree-flow',view};break;
      }
      case 'radar':{
        const chart=root as unknown as RadarChartDocument,all=await entries(ctx),resolved=chart.series.map(series=>resolveRadarSeries(series,chart.axes,all,ctx.scope.projectId));
        html=svg(await exportRadarSvgComplete(chart,resolved))+`<p>${esc(chart.description)}</p>`+table(['Series',...chart.axes.map(axis=>axis.label)],resolved.map(series=>[series.name,...chart.axes.map(axis=>series.values[axis.id])]));break;
      }
      case 'timeline':{
        const timeline=root as unknown as Timeline,calendar=await resolveWorldCalendar(ctx.scope.projectId,id,ctx.scope.eraId),events=rows<TimelineEvent>(document,'timelineEvents').sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id)),names=new Map(events.map(event=>[event.id,event.title]));
        html=`<p>${esc(timeline.description)}</p>`;
        for(const event of events)html+=`<section style="border-left:3px solid ${/^#[\da-f]{6}$/i.test(event.color)?event.color:'#8c7449'};padding-left:20px"><h2>${esc(event.title)}</h2><p class="meta">${esc(compactTimelineLabel(event,calendar?.calendar,timeline.displayPrecision,ctx.locale))} · ${esc(event.lane)} · ${esc(event.eventType)}</p>${image(event.image,event.title)}${await prose(event.description,ctx)}</section>`;
        html+=heading('Connections',table(['Source','Target','Label'],rows<TimelineConnection>(document,'timelineConnections').map(edge=>[names.get(edge.sourceEventId)??edge.sourceEventId,names.get(edge.targetEventId)??edge.targetEventId,edge.label])));break;
      }
      case 'board':{const board=await boardImage(ctx.scope,rows<BoardNode>(document,'boardNodes'),rows<BoardEdge>(document,'boardEdges'),rows<BoardLayer>(document,'boardLayers'),ctx.width,view,String(root.surface??'cork'),ctx.locale);html=board.html;framing={mode:view?'view':'fit-content',coordinateSpace:'board-flow',view:board.view};break;}
      case 'model-viewer':await prepareModelReaderRuntime();html=modelReaderMarkup(root as unknown as ModelAsset,ctx.locale)+`<p class="meta">Framed orbit camera · rest pose · animation paused</p>`;break;
      case 'media':html=await media(root as unknown as LocalMediaAsset,ctx);break;
    }
    return{title:name,html,framing};
  }finally{ctx.active.delete(key);}
}

export async function buildDocumentImage(request:DocumentImageRequest){
  const width=request.width??1440,pixelRatio=request.pixelRatio??1,pageHeight=request.pageHeight??2048;
  if(!(eraDocumentKinds as readonly string[]).includes(request.kind)||!Number.isInteger(width)||width<320||!Number.isInteger(pageHeight)||pageHeight<320||![1,2,3,4].includes(pixelRatio)||width*pixelRatio>16000||pageHeight*pixelRatio>16000)throw new Error('invalid_image_geometry');
  if(request.view&&(!Object.values(request.view).every(Number.isFinite)||request.view.w<=0||request.view.h<=0))throw new Error('invalid_image_view');
  const scope={projectId:request.projectId,eraId:request.eraId},project=await getEraProject(scope),ctx:Context={scope,project,width,locale:request.locale??'en',active:new Set(),versions:new Map()};
  const part=await renderPart(ctx,request.kind,request.entityId,request.view),nonce=crypto.randomUUID().replaceAll('-','');
  const html=`<!doctype html><html lang="${ctx.locale}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';img-src data: blob:;media-src data: blob:;font-src data:;style-src 'unsafe-inline';script-src 'nonce-${nonce}';connect-src data: blob:;base-uri 'none'"><title>${esc(part.title)}</title><style>${IMAGE_STYLE}${LOCAL_TOOL_PREVIEW_CSS}${noteImageLayoutCss(part.html)}</style></head><body><header><h1>${esc(part.title)}</h1><p class="meta">${esc(project.title)} · ${esc(request.kind)} · ${esc(request.eraId??'Shared base')}</p></header>${part.html}${modelReaderExportScript(part.html,nonce)}</body></html>`;
  return{html,width,pixelRatio,pageHeight,title:part.title,framing:part.framing,sourceVersion:ctx.versions.get(JSON.stringify([request.kind,request.entityId]))!,dependencies:Object.fromEntries(ctx.versions)};
}
