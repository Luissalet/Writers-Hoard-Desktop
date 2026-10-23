import {voiceReadingMarkup,installVoiceReading,VOICE_READING_CSS} from '@/engines/media/voiceReading';
import { privateTemplateIds } from '@/engines/codex/templateHierarchy';
import {mediaFilename} from '@/engines/media/types';
import {composeWikiLayout,WIKI_PROFILE_CSS} from '@/services/wikiProfiles/layout';
import {wikiAppearanceStyle,validateWikiAppearance,wikiFooterMarkup} from '@/services/wikiProfiles/appearance';
import {wikiTerminalActive,wikiTerminalStyle,wikiTerminalBoot,wikiTerminalOpening,wikiTerminalScript} from '@/services/wikiProfiles/terminal';
import {wikiConsoleMarkup,wikiConsoleScript,WIKI_CONSOLE_CSS} from '@/services/wikiProfiles/console';
import {entryNames} from '@/services/codexReference/matcher';
import { codexPropertyHtml, projectCodexEntry } from '@/engines/codex/properties';
import {captureWikiSnapshot,wikiSource} from '@/services/wikiProfiles/snapshot';
import {admittedWikiDocuments,wikiDocumentHidden,wikiRefKey} from '@/services/wikiProfiles/policy';
import {prepareStandaloneWikiPages,wikiDocumentCatalog,wikiDocumentArticleId,wikiDocumentLabels,type WikiStandalonePage} from '@/services/wikiProfiles/documents';
import type {ReaderSource} from '@/engines/writings/readerSource';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { downloadTextFile, sanitizeFilename } from '@/engines/writings/manuscriptExport';
import type { CodexEntry, CodexEntryType, InspirationImage, MapPin, Project, Timeline, TimelineEvent, WorldMap } from '@/types';
import { eventMatches, normalizeTimelineViews } from '@/engines/timeline/timelineFilter';
import es from '@/locales/es';
import en from '@/locales/en';
import { createMentionIndex, type MentionIndex } from '@/services/codexReference/indexedMentions';
import { fogOf, pinRevealed, shapeRevealed } from '@/components/maps/mapExploration';
import { fogWikiHtml, partyWikiHtml } from '@/components/maps/mapExplorationSvg';
import { clampMapCoordinate, DEFAULT_MAP_LAYERS, mapFeatureCenter, mapItemVisible, minimumMapPoints } from '@/components/maps/mapGeometry';
import { effectiveCodexTemplate } from '@/engines/codex/templateHierarchy';
import { encodeLocalMedia, type PortableLocalMedia } from '@/engines/media/portability';
import { mediaKind } from '@/engines/media/types';
import { wikiMapsActive, wikiMapFrame, wikiMapScript, WIKI_MAP_CSS } from '@/services/wikiProfiles/mapExperience';
import { usableMapArtwork, MAP_ARTWORK_LIMITS, MAP_AMBIENCE_DEFAULT } from '@/engines/maps/mapArtwork';
import { resolveToolPreview,sanitizeToolPreviewHtml,type ToolPreview } from '@/components/editor/toolBlocks/preview';
import { toolTarget } from '@/components/editor/toolBlocks/model';
import { modelReaderMarkup } from '@/engines/model-viewer/readerMarkup';
import { prepareModelReaderRuntime, modelReaderExportScript } from '@/engines/model-viewer/offlineExport';
import { EDITORIAL_PROSE_BASE_CSS, PREP_BLOCKS_CSS } from '@/components/editor/advanced/proseStyle';
import { sheetPaper } from '@/engines/character-sheets/paper';
import {findLocalToolBlocksInHtml} from '@/engines/local/blocks/types';
import {sourceBlockPreviewHtml} from '@/services/sourceBlockReading';
import {LOCAL_TOOL_PREVIEW_CSS} from '@/engines/local/previewTypes';

export const WIKI_TYPES: CodexEntryType[] = ['character', 'location', 'item', 'faction', 'concept', 'magic', 'custom'];
export const wikiCopy = (locale: 'es' | 'en') => locale === 'es' ? {
  export: 'Exportar wiki', title: 'Wiki sin conexión', description: 'Crea un archivo HTML navegable con búsqueda, categorías, etiquetas y enlaces. Se abre en cualquier navegador sin instalar Writer.',
  contents: 'Contenido', all: 'Todo', search: 'Buscar en esta wiki', category: 'Categoría', tag: 'Etiqueta', entries: 'entradas', maps: 'Mapas', images: 'Incluir imágenes locales',
  mapOption: 'Incluir mapas y marcadores', download: 'Descargar HTML', busy: 'Preparando wiki…', done: 'Wiki descargada. Puedes abrir el archivo HTML sin conexión.',
  error: 'No se pudo exportar la wiki. Vuelve a intentarlo.', emptySelection: 'Selecciona alguna categoría o incluye mapas.',
  relations: 'Conexiones', timelines: 'Cronologías', events: 'sucesos', backlinks: 'Enlaces a esta entrada', missing: 'Entrada no incluida', gallery: 'Imágenes vinculadas', noResults: 'No hay resultados con estos filtros.',
  home: 'Inicio', print: 'Imprimir', offline: 'Archivo local · Sin conexión', close: 'Cerrar', types: { character: 'Personajes', location: 'Lugares', item: 'Objetos', faction: 'Facciones', concept: 'Conceptos', magic: 'Magia', custom: 'Otros' },
} : {
  export: 'Export wiki', title: 'Offline wiki', description: 'Create a browsable HTML file with search, categories, tags and links. Open it in any browser without installing Writer.',
  contents: 'Contents', all: 'All', search: 'Search this wiki', category: 'Category', tag: 'Tag', entries: 'entries', maps: 'Maps', images: 'Include local images',
  mapOption: 'Include maps and markers', download: 'Download HTML', busy: 'Preparing wiki…', done: 'Wiki downloaded. You can open the HTML file offline.',
  error: 'The wiki could not be exported. Try again.', emptySelection: 'Select at least one category or include maps.',
  relations: 'Connections', timelines: 'Timelines', events: 'events', backlinks: 'Links to this entry', missing: 'Entry not included', gallery: 'Linked images', noResults: 'No results match these filters.',
  home: 'Home', print: 'Print', offline: 'Local file · Offline', close: 'Close', types: { character: 'Characters', location: 'Locations', item: 'Items', faction: 'Factions', concept: 'Concepts', magic: 'Magic', custom: 'Other' },
};

export interface WorldWikiData { project: Project; entries: CodexEntry[]; maps: WorldMap[]; pins: MapPin[]; images: InspirationImage[]; timelines?: Timeline[]; timelineEvents?: TimelineEvent[]; media?: PortableLocalMedia[]; standalone?:{policy:string;pages:WikiStandalonePage[]}; toolPreviews?: {policy:string;blocks:Record<string,ToolPreview>} }
import type { WorldWikiOptions } from '@/types/worldWiki';
export type { WorldWikiOptions } from '@/types/worldWiki';
export async function loadWorldWikiData(projectId:string,options:WorldWikiOptions={},captured?:ReaderSource&{images:InspirationImage[]}):Promise<WorldWikiData>{
 const source=captured??wikiSource(await captureWikiSnapshot({projectId,eraId:options.eraId}));if(source.project.id!==projectId)throw Error('wiki_source_scope_invalid');
 const project=source.project,entries=source.rows('codexEntries'),maps=options.includeMaps===false?[]:source.rows('worldMaps'),pins=options.includeMaps===false?[]:source.rows('mapPins'),images=options.includeImages===false?[]:source.images;
 const admitted=admittedWikiDocuments(entries,maps,options),excludedMapIds=maps.filter(map=>!admitted.maps.some(item=>item.id===map.id)).map(map=>map.id),blocks:Record<string,ToolPreview>={},mediaIds=new Set<string>();
 const excludedDocuments=[...(options.excludedDocuments??[]),...wikiDocumentCatalog(source).filter(doc=>wikiDocumentHidden(doc.ref,doc.ref.kind,options)).map(doc=>doc.ref)];
 const privateTypes=privateTemplateIds(project.codexTemplates??[]);admitted.entries=admitted.entries.filter(entry=>!entry.templateId||!privateTypes.has(entry.templateId));
 for(const entry of admitted.entries){const template=document.createElement('template');template.innerHTML=sanitizeRichHtml(entry.content);template.content.querySelectorAll('[data-wh-wiki-hidden="true"]').forEach(node=>node.remove());
  for(const block of template.content.querySelectorAll<HTMLElement>('figure[data-wh-source-block="true"]')){try{const span=findLocalToolBlocksInHtml(block.outerHTML)[0];if(!span||span.projectId!==projectId)continue;blocks[JSON.stringify(['source-block',entry.id,span.envelope.id])]={title:'',html:await sourceBlockPreviewHtml(span.envelope,projectId,options.locale??'es',{...options,excludedDocuments,excludedEntryIds:entries.filter(row=>!admitted.entries.some(item=>item.id===row.id)).map(row=>row.id),excludedMapIds,source},true),truncated:false};}catch{/* Invalid atoms remain unavailable. */}}
  if(options.includeMedia!==false)for(const block of template.content.querySelectorAll('[data-wh-media-block="true"]'))if(block.getAttribute('data-project-id')===projectId&&block.getAttribute('data-asset-id'))mediaIds.add(block.getAttribute('data-asset-id')!);
  for(const block of template.content.querySelectorAll<HTMLElement>('figure[data-wh-tool-block="true"]')){const target=toolTarget({projectId:block.dataset.projectId,kind:block.dataset.toolKind,documentId:block.dataset.documentId,label:block.dataset.label,namespace:block.dataset.namespace,presentation:block.dataset.presentation});if(!target||target.projectId!==projectId)continue;const key=JSON.stringify([target.kind,target.documentId,...(target.kind==='local-tool'?[target.namespace]:[])]);if(blocks[key])continue;
   const preview=await resolveToolPreview(target,projectId,options.locale??'es',{...options,excludedDocuments,excludedEntryIds:entries.filter(row=>!admitted.entries.some(item=>item.id===row.id)).map(row=>row.id),excludedMapIds,source});if(preview)blocks[key]=preview;
  }
 }
 if(options.mapAmbience&&options.includeMedia!==false){const shown=new Set(admitted.maps.map(map=>map.id));for(const map of admitted.maps)if(map.ambience?.assetId)mediaIds.add(map.ambience.assetId);for(const pin of pins)if(shown.has(pin.mapId)&&pin.ambience?.assetId)mediaIds.add(pin.ambience.assetId);}
 const mediaRows=source.rows('localMediaAssets').filter(asset=>mediaIds.has(asset.id)&&asset.projectId===projectId);
 const privateIds=entries.filter(entry=>!admitted.entries.some(item=>item.id===entry.id)).map(entry=>entry.id);
 const standalone=await prepareStandaloneWikiPages(source,options,{...options,excludedDocuments,excludedEntryIds:privateIds,excludedMapIds,source});
 if(Object.values(blocks).some(preview=>preview.model)||standalone.some(page=>page.preview.model))await prepareModelReaderRuntime();
 return{project,entries,maps,pins,images,standalone:{policy:toolPolicyKey(projectId,admitted.entries,admitted.maps,options),pages:standalone},...(options.includeTimelines||options.additionalDocuments?.some(ref=>ref.kind==='timeline')?{timelines:source.rows('timelines') as unknown as Timeline[],timelineEvents:source.rows('timelineEvents') as unknown as TimelineEvent[]}:{}),media:await Promise.all(mediaRows.map(encodeLocalMedia)),toolPreviews:{policy:toolPolicyKey(projectId,admitted.entries,admitted.maps,options),blocks}};
}

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const key = (kind: 'entry' | 'map' | 'timeline', id: string) => `${kind}-${[...new TextEncoder().encode(id)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
const raster = (url: string | undefined): url is string => !!url && /^data:image\/(?:avif|bmp|gif|jpe?g|png|webp);base64,[a-z0-9+/=\s]+$/i.test(url);
const byTitle = <T extends { title: string; id: string }>(a: T, b: T) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
const toolPolicyKey=(projectId:string,entries:{id:string}[],maps:{id:string}[],options:WorldWikiOptions)=>JSON.stringify([projectId,entries.map(row=>row.id).sort(),maps.map(row=>row.id).sort(),options.includeImages!==false,options.includeMaps!==false,options.includeMedia!==false,options.eraId??null,options.locale??'es',[...(options.excludedFields??[])].sort(),...(options.additionalDocuments||options.excludedDocuments||options.sections?.some(section=>section.parentId||section.documents.some(ref=>ref.kind!=='entry'&&ref.kind!=='map')||section.category&&Object.hasOwn(wikiDocumentLabels('en'),section.category))?[options.additionalDocuments??[],options.excludedDocuments??[],options.onlyRevealed??false,options.sections??[]]:[])]);

/** No remote links or media: every navigable URL resolves inside this snapshot. */
function rich(content: string, entries: Map<string, CodexEntry>, includeImages: boolean, locale: 'es' | 'en', currentEntryId: string, mentionIndex: MentionIndex, media: Map<string, PortableLocalMedia>,toolPreviews:Record<string,ToolPreview>,projectId:string): string {
  const doc = new DOMParser().parseFromString(sanitizeRichHtml(content), 'text/html');
  // Omitted prose is removed before indexing or serializing, including any nested media.
  doc.querySelectorAll('[data-wh-wiki-hidden="true"]').forEach(element => element.remove());
  const toolBlocks=[...doc.querySelectorAll<HTMLElement>('figure[data-wh-tool-block="true"]')].map(element=>({element,target:toolTarget({projectId:element.dataset.projectId,kind:element.dataset.toolKind,documentId:element.dataset.documentId,namespace:element.dataset.namespace,presentation:element.dataset.presentation})}));
  const sourceBlocks=[...doc.querySelectorAll<HTMLElement>('figure[data-wh-source-block="true"]')].map(element=>{try{const span=findLocalToolBlocksInHtml(element.outerHTML)[0];return{element,key:span?.projectId===projectId?JSON.stringify(['source-block',currentEntryId,span.envelope.id]):''};}catch{return{element,key:''};}});
  const voiceFigures:Array<{figure:HTMLElement;asset:PortableLocalMedia}>=[];
  for (const block of doc.querySelectorAll('[data-wh-media-block="true"]')) {
    const asset = media.get(block.getAttribute('data-asset-id') ?? '');
    if (!asset || asset.projectId !== block.getAttribute('data-project-id') || !mediaKind(asset.mime) || !/^data:(?:audio|video)\/[a-z0-9.+-]+(?:;codecs=[a-z0-9., -]+)?;base64,[a-z0-9+/=]+$/i.test(asset.dataUrl)) { block.remove(); continue; }
    const figure = doc.createElement('figure'); const caption = doc.createElement('figcaption'); caption.textContent = asset.title;
    const player = doc.createElement(mediaKind(asset.mime) === 'video' ? 'video' : 'audio'); player.controls = true; player.preload = 'metadata'; player.src = asset.dataUrl;
    figure.append(caption, player);voiceFigures.push({figure,asset}); block.replaceWith(figure);
  }
  // Live blocks resolve only against the export's admitted entries. Their
  // persisted title fallback must not reveal the name of an excluded card.
  for (const block of doc.querySelectorAll('[data-wh-codex-block="true"]')) {
    const id = block.getAttribute('data-entry-id') ?? '';
    const target = entries.get(id);
    if (!target || target.projectId !== block.getAttribute('data-project-id')) { block.remove(); continue; }
    const paragraph = doc.createElement('p'); const anchor = doc.createElement('a');
    anchor.setAttribute('href', `#${key('entry', target.id)}`); anchor.textContent = target.title;
    paragraph.append(anchor); block.replaceWith(paragraph);
  }
  const spoilers = [...doc.querySelectorAll('[data-wh-wiki-spoiler="true"]')];
  doc.body.querySelectorAll('*').forEach(element => {
    for (const attribute of [...element.attributes]) {
      if (['id', 'name', 'class', 'hidden', 'tabindex', 'is'].includes(attribute.name) || attribute.name.startsWith('data-') || attribute.name.startsWith('on')) element.removeAttribute(attribute.name);
    }
    if (element.tagName === 'IMG' && (!includeImages || !raster(element.getAttribute('src') ?? undefined))) element.remove();
    // Remove all URL-bearing attributes except the admitted embedded raster.
    const href = element.tagName === 'A' ? element.getAttribute('href') : null;
    for (const attribute of ['href', 'src', 'poster', 'background', 'cite', 'ping', 'srcset', 'xlink:href', 'longdesc', 'usemap']) {
      if (!(['IMG', 'AUDIO', 'VIDEO'].includes(element.tagName) && attribute === 'src')) element.removeAttribute(attribute);
    }
    if (href) {
      let target: string | null = null;
      try {
        if (href.startsWith('#entry-')) target = [...entries.keys()].find(id => `#${key('entry', id)}` === href) ?? null;
        else {
          const url = new URL(href, 'https://writer.invalid');
          if (url.origin === 'https://writer.invalid' && url.pathname.endsWith('/codex')) target = url.searchParams.get('entry');
        }
      } catch { /* An invalid URL remains readable plain text. */ }
      if (target && entries.has(target)) element.setAttribute('href', `#${key('entry', target)}`);
    }
  });
  for (const element of spoilers) {
    if (!doc.body.contains(element)) continue;
    const wrapper = doc.createElement('span'); wrapper.className = 'wiki-spoiler';
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = locale === 'es' ? 'Revelar spoiler' : 'Reveal spoiler'; button.setAttribute('aria-expanded', 'false'); button.setAttribute('data-wiki-reveal', 'true');
    const body = doc.createElement('span'); body.hidden = true;
    while (element.firstChild) body.append(element.firstChild);
    wrapper.append(button, body); element.replaceWith(wrapper);
  }
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (!node.parentElement?.closest('a,code,pre,button')) textNodes.push(node as Text);
  for (const node of textNodes) {
    const matches = mentionIndex.find(node.data).filter(match => !match.ambiguous && match.entryIds.length === 1 && match.entryIds[0] !== currentEntryId);
    if (!matches.length) continue;
    const fragment = doc.createDocumentFragment(); let offset = 0;
    for (const match of matches) {
      fragment.append(node.data.slice(offset, match.from));
      const link = doc.createElement('a'); link.setAttribute('href', `#${key('entry', match.entryIds[0])}`); link.textContent = node.data.slice(match.from, match.to); fragment.append(link); offset = match.to;
    }
    fragment.append(node.data.slice(offset)); node.replaceWith(fragment);
  }
  // Inject after prose sanitization/attribute stripping/mention replacement so
  // safe SVG survives and text inside SVG never gains HTML anchors.
  for(const block of toolBlocks){
    if(!doc.body.contains(block.element))continue;
    const target=block.target,preview=target?.projectId===projectId?toolPreviews[JSON.stringify([target.kind,target.documentId,...(target.kind==='local-tool'?[target.namespace]:[])])]:undefined;
    const section=doc.createElement('section');
    if(preview&&typeof preview.title==='string'&&typeof preview.html==='string'){
      try{section.innerHTML=`<h3>${esc(preview.title.slice(0,300))}</h3>${preview.model?modelReaderMarkup(preview.model,locale):preview.sheet?sheetPaper(preview.sheet,locale).svg:sanitizeToolPreviewHtml(preview.html)}`;}
      catch{section.textContent=locale==='es'?'Modelo no disponible.':'Model unavailable.';}
    }
    else section.textContent=locale==='es'?'Documento vinculado no incluido.':'Linked document not included.';
    block.element.replaceWith(section);
  }
  for(const {figure,asset}of voiceFigures)if(doc.body.contains(figure))figure.insertAdjacentHTML('beforeend',voiceReadingMarkup(asset,locale,{url:asset.dataUrl,filename:mediaFilename(asset)}));
  for(const block of sourceBlocks){if(!doc.body.contains(block.element))continue;const section=doc.createElement('section'),preview=toolPreviews[block.key];if(preview)section.innerHTML=sanitizeToolPreviewHtml(preview.html);else section.textContent=locale==='es'?'Bloque local no disponible.':'Local block unavailable.';block.element.replaceWith(section);}
  return doc.body.innerHTML;
}

// This script is constant. User-authored data never enters a JavaScript literal.
const WIKI_SCRIPT = `(() => {
  const root = document.getElementById('wiki');
  const index = document.getElementById('index');
  const articles = [...root.querySelectorAll('article[data-category]')];
  const links = [...index.querySelectorAll('li[data-article-id]')];
  const search = document.getElementById('search');
  const category = document.getElementById('category');
  const tag = document.getElementById('tag');
  const empty = document.getElementById('empty');
  const count = document.getElementById('count');
  const normalize = value => value.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLocaleLowerCase();
  const text = articles.map(article => normalize(article.textContent || ''));
  function filter() {
    const words = normalize(search.value).trim().split(/\\s+/).filter(Boolean);
    let visible = 0;
    articles.forEach((article, i) => {
      const tags = JSON.parse(article.dataset.tags);
      const show = (!category.value || category.value === article.dataset.category) && (!tag.value || tags.includes(tag.value)) && words.every(word => text[i].includes(word));
      article.hidden = !show;
      links.filter(link => link.dataset.articleId === article.id).forEach(link => {link.hidden = !show;});
      const fold=article.closest('.wiki-document');if(fold){fold.hidden=!show;if(show&&words.length)fold.open=true;}
      if (show) visible++;
    });
    root.querySelectorAll('.wiki-section').forEach(section=>{section.hidden=![...section.querySelectorAll('article')].some(article=>!article.hidden);});
    index.querySelectorAll('.wiki-nav-section').forEach(section=>{section.hidden=![...section.querySelectorAll('li[data-article-id]')].some(link=>!link.hidden);});
    count.textContent = String(visible);
    empty.hidden = visible !== 0;
  }
  function reveal() {
    const id = location.hash.slice(1);
    const target = document.getElementById(id);
    const article = articles.find(item => item === target || (target && item.contains(target)));
    if (!article) return;
    search.value = ''; category.value = ''; tag.value = ''; filter();
    let parent=target.parentElement;while(parent&&parent!==root){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}
    target.scrollIntoView({block:'start'});
    article.querySelector('h2').focus({preventScroll:true});
  }
  [search, category, tag].forEach(control => control.addEventListener(control === search ? 'input' : 'change', filter));
  document.getElementById('print').addEventListener('click', () => window.print());
  let printFolds=[];window.addEventListener('beforeprint',()=>{printFolds=[...root.querySelectorAll('details')].filter(item=>!item.open);printFolds.forEach(item=>item.open=true);});window.addEventListener('afterprint',()=>{printFolds.forEach(item=>item.open=false);printFolds=[];});
  window.addEventListener('hashchange', reveal);
  document.addEventListener('click', event => {
    const revealButton = event.target.closest('[data-wiki-reveal]');
    if (revealButton) {
      const body = revealButton.nextElementSibling;
      const expanded = revealButton.getAttribute('aria-expanded') !== 'true';
      body.hidden = !expanded; revealButton.setAttribute('aria-expanded', String(expanded));
    }
    const link = event.target.closest('a');
    if (link && link.hash && link.hash === location.hash) reveal();
  });
  const slides=[...document.querySelectorAll('[data-wiki-slide]')];let selectedSlide=0;document.querySelectorAll('[data-wiki-carousel]').forEach(button=>button.addEventListener('click',()=>{selectedSlide=(selectedSlide+Number(button.dataset.wikiCarousel)+slides.length)%slides.length;slides.forEach((slide,index)=>{slide.hidden=index!==selectedSlide;});document.querySelector('[data-wiki-slide-count]').textContent=(selectedSlide+1)+' / '+slides.length;}));
  filter(); reveal();
})();`;

const WIKI_STYLE = `:root{color-scheme:light;--paper:#faf8f2;--ink:#272b2b;--muted:#5e625f;--line:#d8d5cb;--accent:#755516}*{box-sizing:border-box}html{scroll-padding-top:24px}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 Georgia,'Times New Roman',serif}a{color:var(--accent);text-underline-offset:3px;overflow-wrap:anywhere}button,input,select{font:inherit}button,select{cursor:pointer}button,input,select{border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink);padding:9px 12px;min-height:42px}button:hover{background:#eee9dd}a:hover{text-decoration-thickness:2px}:focus-visible{outline:3px solid var(--accent);outline-offset:3px}::selection{background:#ead9ad;color:#272b2b}input{width:100%;caret-color:var(--accent)}input::placeholder{color:var(--muted)}header{border-bottom:1px solid var(--line);padding:36px max(24px,calc((100vw - 1280px)/2));background:#eee9dd}header h1{font-size:clamp(30px,4vw,52px);line-height:1.1;margin:0 0 14px;overflow-wrap:anywhere}header p{max-width:70ch;white-space:pre-wrap}header small{font:13px/1.5 system-ui;color:var(--muted)}.layout{max-width:1280px;margin:auto;display:grid;grid-template-columns:260px minmax(0,1fr);gap:56px;padding:32px 24px}nav{position:sticky;top:24px;align-self:start;max-height:calc(100vh - 48px);overflow:auto;font:14px/1.5 system-ui;padding:0 8px 16px 0;scrollbar-color:#b8ad95 transparent}nav h2{font:600 18px/1.4 system-ui;margin:0 0 16px}label{display:block;margin:14px 0 5px;font:600 13px/1.4 system-ui}select{width:100%}#index{padding:0;list-style:none;margin:20px 0}#index li{border-top:1px solid var(--line);padding:9px 0}#index a{display:block;text-decoration:none}#index small{display:block;color:var(--muted);font-size:11px}main{min-width:0}article{padding:0 0 40px;margin:0 0 40px;border-bottom:1px solid var(--line);display:flow-root;overflow-wrap:anywhere}article h2{font-size:32px;line-height:1.2;margin:0 0 12px}article h3{font-size:21px;margin:24px 0 8px}.meta{font:13px/1.5 system-ui;color:var(--muted);margin:0 0 22px}.prose{max-width:72ch}.prose :first-child{margin-top:0}.prose table{border-collapse:collapse;width:100%}.prose td,.prose th{border:1px solid var(--line);padding:8px}.prose pre{overflow:auto;padding:16px;background:#eee9dd}.prose blockquote{margin-left:0;padding-left:20px;border-left:1px solid var(--accent)}img{max-width:100%;height:auto}.portrait{float:right;max-width:180px;max-height:220px;object-fit:contain;margin:0 0 24px 24px;border-radius:6px}dl{font:14px/1.6 system-ui;display:grid;grid-template-columns:minmax(90px,1fr) 3fr;gap:8px 20px;margin:24px 0}dt{font-weight:600}dd{margin:0;white-space:pre-wrap}.relations{clear:both}.gallery{display:flex;flex-wrap:wrap;gap:16px}.gallery figure{margin:0;width:180px}.gallery img{max-height:180px;object-fit:contain}.gallery figcaption{font:12px/1.5 system-ui;color:var(--muted);white-space:pre-wrap}.map-wrap{position:relative}.map-wrap>img{width:100%;display:block}.pin{position:absolute;transform:translate(-50%,-50%);width:26px;height:26px;line-height:22px;border:2px solid white;border-radius:50%;background:#755516;color:white;text-align:center;font-family:system-ui;text-decoration:none}.map-list{font:14px/1.6 system-ui}.map-list p{white-space:pre-wrap}footer{clear:both;font:12px/1.5 system-ui;color:var(--muted);margin-top:24px}#empty{font:16px/1.6 system-ui}[hidden]{display:none!important}@media(max-width:760px){.layout{display:block;padding:24px 20px}nav{position:static;max-height:none;margin-bottom:32px;padding:0}#index{max-height:200px;overflow:auto}.portrait{max-width:120px;margin-left:16px}article h2{font-size:28px}header{padding:28px 20px}dl{display:block}dd{margin-bottom:12px}}@media print{header{padding:0;background:white}.layout{display:block;max-width:none;padding:0}nav,#empty{display:none}article[hidden]{display:flow-root!important}article{break-before:page}a{color:inherit}body{background:white;font-size:11pt}.map-wrap,.gallery figure{break-inside:avoid}}`;

export function buildWorldWiki(data: WorldWikiData, options: WorldWikiOptions = {}) {
  validateWikiAppearance(options);
  const locale = options.locale === 'en' ? 'en' : 'es';
  const copy = wikiCopy(locale);
  const labels: Record<string, string> = locale === 'es' ? es : en;
  const types = options.types ?? WIKI_TYPES;
  if (!Array.isArray(types) || types.some(type => !WIKI_TYPES.includes(type))) throw new Error('Invalid wiki categories');
  const includeImages = options.includeImages !== false;
  const scoped = <T extends { projectId: string }>(rows: T[]) => rows.filter(row => row.projectId === data.project.id);
  const excludedFields = new Set(options.excludedFields ?? []);
  const admitted=admittedWikiDocuments(scoped(data.entries),scoped(data.maps),options);
  // Cards of a private type never reach a published page.
  const unpublished = privateTemplateIds(data.project.codexTemplates ?? []);
  const entries = admitted.entries.filter(entry => !entry.templateId || !unpublished.has(entry.templateId)).sort(byTitle);
  const entryMap = new Map(entries.map(entry => [entry.id, entry]));
  const media = new Map((options.includeMedia === false ? [] : scoped(data.media ?? [])).map(asset => [asset.id, asset]));
  const mentionIndex = createMentionIndex(entries);
  const backlinkMap = new Map<string, Set<CodexEntry>>();
  for (const source of entries) for (const target of [...source.relations.map(relation => relation.targetId), ...Object.entries(source.referenceFields ?? {}).filter(([name]) => !excludedFields.has(name)).flatMap(([, ids]) => ids)]) {
    if (target === source.id) continue;
    const sources = backlinkMap.get(target) ?? new Set<CodexEntry>(); sources.add(source); backlinkMap.set(target, sources);
  }
  const maps = admitted.maps.sort(byTitle);
  const pins = scoped(data.pins);
  const images = includeImages ? scoped(data.images) : [];
  const link = (id: string, title: string) => {void title;return entryMap.has(id) ? `<a href="#${key('entry', id)}">${esc(entryMap.get(id)!.title)}</a>` : `<small>${copy.missing}</small>`;};
  const tags = [...new Set(entries.flatMap(entry => entry.tags))].sort((a, b) => a.localeCompare(b));
  const toolPreviews=data.toolPreviews?.policy===toolPolicyKey(data.project.id,entries,maps,options)?data.toolPreviews.blocks:{};
  const richContent = new Map(entries.map(entry => [entry.id, rich(entry.content, entryMap, includeImages, locale, entry.id, mentionIndex, media,toolPreviews,data.project.id)]));
  const entryKeys = new Map(entries.map(entry => [`#${key('entry', entry.id)}`, entry.id]));
  for (const source of entries) {
    const content = new DOMParser().parseFromString(richContent.get(source.id)!, 'text/html');
    for (const anchor of content.querySelectorAll('a[href]')) {
      const target = entryKeys.get(anchor.getAttribute('href')!); if (!target || target === source.id) continue;
      const sources = backlinkMap.get(target) ?? new Set<CodexEntry>(); sources.add(source); backlinkMap.set(target, sources);
    }
  }
  const index: string[] = [];
  const articles = entries.map(entry => {
    const entryKey = key('entry', entry.id);
    index.push(`<li data-article-id="${entryKey}"><a href="#${entryKey}">${esc(entry.title)}<small>${copy.types[entry.type]}</small></a></li>`);
    const avatar = includeImages && raster(entry.avatar) ? `<img class="portrait" src="${esc(entry.avatar)}" alt="${esc(entry.title)}">` : '';
    const relations = entry.relations.map(relation => !entryMap.has(relation.targetId)?`<li>${copy.missing}</li>`:`<li>${link(relation.targetId, relation.targetTitle)}${relation.type ? ` · ${esc(relation.type)}` : ''}${relation.description ? `<p>${esc(relation.description)}</p>` : ''}</li>`);
    const backlinks = [...backlinkMap.get(entry.id) ?? []];
    const gallery = images.filter(image => (image.linkedEntryIds ?? [image.linkedEntryId]).includes(entry.id) && raster(image.imageData));
    const ownTemplate = data.project.codexTemplates?.find(template => template.id === entry.templateId);
    const template = ownTemplate ? effectiveCodexTemplate(ownTemplate, data.project.codexTemplates ?? []) : undefined;
    const projection = projectCodexEntry(entry, data.project.codexTemplates ?? []);
    const fields = Object.entries(projection.fields).filter(([name, value]) => value && !excludedFields.has(name));
    const references = Object.entries(entry.referenceFields ?? {}).filter(([name]) => !excludedFields.has(name)).map(([name, ids]) => `<dt>${esc(template?.referenceFieldDefinitions?.find(field => field.key === name)?.label ?? name)}</dt><dd>${ids.map(id => link(id, copy.missing)).join(' · ')}</dd>`).join('');
    return `<article id="${entryKey}" data-category="${entry.type}" data-tags="${esc(JSON.stringify(entry.tags))}">
      <h2 tabindex="-1">${esc(entry.title)}</h2><p class="meta">${esc(template?.name ?? copy.types[entry.type])}${entry.tags.length ? ` · ${entry.tags.map(esc).join(' · ')}` : ''}</p>${avatar}
      ${fields.length || references ? `<dl>${fields.map(([name, value]) => `<dt>${esc((template?.propertyDefinitions ?? entry.propertyDefinitions)?.find(item => item.key === name)?.label ?? labels[`codex.field.${name}`] ?? name)}</dt><dd>${projection.properties[name] ? codexPropertyHtml(projection.properties[name]) : esc(value)}</dd>`).join('')}${references}</dl>` : ''}
      <div class="prose">${richContent.get(entry.id)}</div>
      ${relations.length ? `<section class="relations"><h3>${copy.relations}</h3><ul>${relations.join('')}</ul></section>` : ''}
      ${backlinks.length ? `<section><h3>${copy.backlinks}</h3><ul>${backlinks.map(other => `<li>${link(other.id, other.title)}</li>`).join('')}</ul></section>` : ''}
      ${gallery.length ? `<section><h3>${copy.gallery}</h3><div class="gallery">${gallery.map(image => `<figure><img src="${esc(image.imageData)}" alt="${esc(image.notes)}" loading="lazy"><figcaption>${esc(image.notes)}</figcaption></figure>`).join('')}</div></section>` : ''}
      <footer><a href="#top">${copy.home}</a></footer></article>`;
  });
  // Map extras (pan/zoom, artwork layers, clouds, ambience) exist only when the profile asks for them; otherwise the map block below is the unchanged static one.
  const mapUi = wikiMapsActive(options), ambienceIds = new Map<string, string>();
  let ambienceBytes = 0;
  const ambient = (assetId: string | undefined) => {
    if (!mapUi || !options.mapAmbience || options.includeMedia === false || !assetId) return undefined;
    const known = ambienceIds.get(assetId); if (known) return known;
    const asset = media.get(assetId);
    if (!asset || mediaKind(asset.mime) !== 'audio' || asset.size > MAP_ARTWORK_LIMITS.ambienceBytes || ambienceBytes + asset.size > MAP_ARTWORK_LIMITS.ambienceTotalBytes || !/^data:audio\/[a-z\d.+-]+(?:;[a-z\d=.+-]+)*;base64,/i.test(asset.dataUrl.slice(0, 200))) return undefined;
    ambienceBytes += asset.size; const id = `wiki-amb-${ambienceIds.size}`; ambienceIds.set(assetId, id); return id;
  };
  const level = (value: number | undefined) => Number(Math.max(0, Math.min(1, Number.isFinite(value) ? value! : MAP_AMBIENCE_DEFAULT.volume)).toFixed(2));
  let mapFrames = 0;
  for (const map of maps) {
    const mapKey = key('map', map.id);
    const visibility = { ...DEFAULT_MAP_LAYERS, ...map.layerVisibility };
    const namedLayers = map.layers ?? [];
    // Only with the "exploredFog" option, and only for a map whose fog is on: unexplored places leave the page (picture overlay, pins, shapes and their list).
    const fog = options.exploredFog ? fogOf(map.exploration) : null;
    const mapPins = visibility.pins ? pins.filter(pin => pin.mapId === map.id && mapItemVisible(pin, namedLayers)&&(!pin.linkedEntryId||entryMap.has(pin.linkedEntryId))&&(!fog||pinRevealed(fog, pin))) : [];
    const features = (map.features ?? []).filter(feature => (!feature.linkedEntryId||entryMap.has(feature.linkedEntryId))&&(!fog||shapeRevealed(fog, feature))&& ['region', 'path', 'label'].includes(feature.kind) && visibility[feature.kind] && mapItemVisible(feature, namedLayers) && feature.points.length >= minimumMapPoints(feature.kind) && feature.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
    const vectors = features.map((feature, i) => {
      const color = /^#[0-9a-f]{6}$/i.test(feature.color) ? feature.color : '#d5b575';
      const points = feature.points.map(point => `${clampMapCoordinate(point.x)},${clampMapCoordinate(point.y)}`).join(' ');
      const center = mapFeatureCenter(feature.points);
      const shape = feature.kind === 'region' ? `<polygon points="${points}" fill="${color}" fill-opacity="${Math.min(1, Math.max(0, Number.isFinite(feature.opacity) ? feature.opacity! : .22))}" stroke="${color}" vector-effect="non-scaling-stroke"/>` : feature.kind === 'path' ? `<polyline points="${points}" fill="none" stroke="${color}" vector-effect="non-scaling-stroke"/>` : '';
      return `<a href="#${mapKey}-feature-${i}" aria-label="${esc(feature.name)}"><title>${esc(feature.name)}</title>${shape}<text x="${clampMapCoordinate(center.x)}" y="${clampMapCoordinate(center.y)}" fill="${color}" text-anchor="middle">${esc(feature.name)}</text></a>`;
    }).join('');
    index.push(`<li data-article-id="${mapKey}"><a href="#${mapKey}">${esc(map.title)}<small>${copy.maps}</small></a></li>`);
    const pinAmbience = (pin: MapPin) => { const id = ambient(pin.ambience?.assetId); return id ? ` data-amb="${id}" data-amb-r="${Number(Math.max(2, Math.min(60, Number.isFinite(pin.ambience?.radius) ? pin.ambience!.radius! : MAP_AMBIENCE_DEFAULT.radius)).toFixed(1))}" data-amb-v="${level(pin.ambience?.volume)}"` : ''; };
    const markers = mapPins.flatMap((pin, i) => Number.isFinite(pin.position.x) && Number.isFinite(pin.position.y) ? [`<a class="pin" href="#${mapKey}-pin-${i}" style="left:${Math.max(0, Math.min(100, pin.position.x))}%;top:${Math.max(0, Math.min(100, pin.position.y))}%" aria-label="${esc(pin.name)}"${pinAmbience(pin)}>${i + 1}</a>`] : []).join('');
    // The fog of exploration (only with exploredFog) sits over the picture with the party on top.
    const fogged = `${fog ? fogWikiHtml(fog, mapKey) : ''}${markers}${fog ? partyWikiHtml(fog) : ''}`;
    articles.push(`<article id="${mapKey}" data-category="maps" data-tags="[]"><h2 tabindex="-1">${esc(map.title)}</h2><p class="meta">${copy.maps}</p>${includeImages && raster(map.backgroundImage) ? (mapUi ? (mapFrames++, wikiMapFrame({ key: mapKey, title: map.title, image: map.backgroundImage, vectors, markers: fogged, options, locale, artwork: usableMapArtwork(map.artwork), ambience: (() => { const id = ambient(map.ambience?.assetId); return id ? { domId: id, volume: level(map.ambience?.volume) } : undefined; })(), pinAmbience: markers.includes(' data-amb="'), esc })) : `<div class="map-wrap"><img src="${esc(map.backgroundImage)}" alt="${esc(map.title)}">${vectors ? `<svg class="map-vectors" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="${esc(map.title)}">${vectors}</svg>` : ''}${fogged}</div>`) : ''}<ol class="map-list">${mapPins.map((pin, i) => `<li id="${mapKey}-pin-${i}"><strong>${pin.linkedEntryId ? link(pin.linkedEntryId, pin.name) : esc(pin.name)}</strong>${pin.description ? `<p>${esc(pin.description)}</p>` : ''}</li>`).join('')}${features.map((feature, i) => `<li id="${mapKey}-feature-${i}"><strong>${feature.linkedEntryId ? link(feature.linkedEntryId, feature.name) : esc(feature.name)}</strong>${feature.description ? `<p>${esc(feature.description)}</p>` : ''}</li>`).join('')}</ol><footer><a href="#top">${copy.home}</a></footer></article>`);
  }

  const nonce = [...crypto.getRandomValues(new Uint8Array(18))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const palettes = {
    parchment: ['#faf8f2', '#272b2b', '#5e625f', '#d8d5cb', '#755516'],
    paper: ['#ffffff', '#24272a', '#555d63', '#d4d7da', '#695017'],
    night: ['#1a1b1c', '#e3dbca', '#b4b1a8', '#454640', '#e0c079'],
    forest: ['#f0f3ed', '#23382d', '#4c6556', '#bfcdbf', '#286441'],
  };
  const palette = palettes[options.theme ?? 'parchment'] ?? palettes.parchment;
  const accent = /^#[0-9a-f]{6}$/i.test(options.accent ?? '') ? options.accent : palette[4];
  const presentation = `${mapUi ? WIKI_MAP_CSS : ''}audio,video{display:block;width:100%;max-height:32rem}figcaption{margin-bottom:.5rem}.map-vectors{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.map-vectors a{pointer-events:all}.map-vectors polygon,.map-vectors polyline{stroke-width:2px}.map-vectors text{font:2px Georgia,serif;paint-order:stroke;stroke:#17191a;stroke-width:.25px}.map-vectors a:focus{outline:2px solid var(--accent)}:root{color-scheme:${options.theme === 'night' ? 'dark' : 'light'};--paper:${palette[0]};--ink:${palette[1]};--muted:${palette[2]};--line:${palette[3]};--accent:${accent}}button,input,select,header,.prose pre{background:var(--paper);color:var(--ink)}button:hover{background:color-mix(in srgb,var(--ink) 8%,var(--paper))}body{font-family:${options.font === 'sans' ? 'system-ui,sans-serif' : "Georgia,'Times New Roman',serif"}}.pin{background:var(--accent);color:var(--paper)}.cover{display:block;width:100%;max-height:320px;object-fit:cover;margin-bottom:24px}.wiki-spoiler{display:inline}.wiki-spoiler button{font:inherit;padding:1px 6px;min-height:0;margin-right:4px}.wiki-spoiler button[aria-expanded=true]{font-size:0}.wiki-spoiler button[aria-expanded=true]::after{content:'−';font-size:16px}button:focus-visible{outline:3px solid var(--accent)}${options.layout === 'journal' ? '.layout{display:block;max-width:900px}nav{position:static;max-height:none;margin-bottom:40px}#index{columns:2}#index li{break-inside:avoid}article{padding-top:20px}@media(max-width:600px){#index{columns:1}}' : ''}`;
  const extraLabels=wikiDocumentLabels(locale);
  const selectedRefs=new Set((options.additionalDocuments??[]).map(wikiRefKey));
  const extraPages=(data.standalone?.policy===toolPolicyKey(data.project.id,entries,maps,options)?data.standalone.pages:[]).filter(page=>selectedRefs.has(wikiRefKey(page.ref))&&page.ref.kind!=='entry'&&page.ref.kind!=='map'&&(!options.onlyRevealed||page.ref.kind==='timeline')&&!wikiDocumentHidden(page.ref,page.ref.kind,options));
  const extraDocuments=extraPages.map(page=>{
    const id=wikiDocumentArticleId(page.ref),preview=page.preview;
    const body=preview.model?modelReaderMarkup(preview.model,locale):preview.sheet?sheetPaper(preview.sheet,locale).svg.replace(/sheet-ink-[0-9a-f-]{36}/g,'sheet-ink-'+id):sanitizeToolPreviewHtml(preview.html,'wiki-'+id+'-',page.ref.kind==='notes'&&includeImages);
    const html=`<article id="${id}" data-category="${esc(page.ref.kind)}" data-tags="[]"><h2 tabindex="-1">${esc(page.title)}</h2><p class="meta">${esc(extraLabels[page.ref.kind]??page.ref.kind)}</p><div class="prose">${body}</div>${preview.truncated?`<p>${locale==='es'?'Vista parcial del documento.':'Partial document view.'}</p>`:''}<footer><a href="#top">${copy.home}</a></footer></article>`;
    articles.push(html);
    return{ref:page.ref,id,title:page.title,html,index:`<li data-article-id="${id}"><a href="#${id}">${esc(page.title)}<small>${esc(extraLabels[page.ref.kind]??page.ref.kind)}</small></a></li>`};
  });
  const selectedTimelines=new Set((options.additionalDocuments??[]).filter(ref=>ref.kind==='timeline').map(ref=>ref.id));
  const curated=!!(options.additionalDocuments||options.excludedDocuments||options.sections?.some(section=>section.parentId));
  // Timelines: one article each, events in their order; an event kept out of the wiki never shows, and a saved view narrows the rest.
  const view = options.timelineViewId ? normalizeTimelineViews(data.project.timelineViews).find(item => item.id === options.timelineViewId) : undefined;
  // With onlyRevealed an event shows only when it is tied to at least one card and every card it is tied to is admitted.
  const shownEvents = () => scoped(data.timelineEvents ?? []).filter(event => {
    if (event.hideFromWiki) return false;
    if (!options.onlyRevealed) return true;
    const linked = [...new Set([...(event.linkedEntryIds ?? []), ...(event.linkedEntryId ? [event.linkedEntryId] : [])])];
    return linked.length > 0 && linked.every(id => entryMap.has(id));
  });
  const timelineArticles = options.includeTimelines||selectedTimelines.size ? scoped(data.timelines ?? []).filter(timeline=>(options.includeTimelines||selectedTimelines.has(timeline.id))&&!wikiDocumentHidden({kind:'timeline',id:timeline.id},'timeline',options)).sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id)).flatMap(timeline => {
    const shown = shownEvents().filter(event => event.timelineId === timeline.id && (!view || eventMatches(event, view.filter))).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    if (!shown.length) return [];
    const timelineKey = key('timeline', timeline.id), tagsHere = [...new Set(shown.flatMap(event => event.tags ?? []))];
    const color = (value: string) => /^#[0-9a-f]{6}$/i.test(value) ? value : '#d5b575';
    const rows = shown.map(event => `<li class="wiki-event" style="border-left:3px solid ${color(event.color)};padding-left:10px;margin:0 0 14px;list-style:none"><p class="meta">${esc(event.date)}${event.lane ? ` · ${esc(event.lane)}` : ''}</p><h3 style="margin:2px 0">${esc(event.title)}</h3>${event.description ? `<p>${esc(event.description)}</p>` : ''}${(event.tags ?? []).length ? `<p class="meta">${(event.tags ?? []).map(tag => `#${esc(tag)}`).join(' ')}</p>` : ''}${[...new Set([...(event.linkedEntryIds ?? []), ...(event.linkedEntryId ? [event.linkedEntryId] : [])])].filter(id => entryMap.has(id)).map(id => link(id, '')).join(' · ')}</li>`).join('');
    return [{ index: `<li data-article-id="${timelineKey}"><a href="#${timelineKey}">${esc(timeline.title)}<small>${copy.timelines}</small></a></li>`, html: `<article id="${timelineKey}" data-category="timelines" data-tags="${esc(JSON.stringify(tagsHere))}"><h2 tabindex="-1">${esc(timeline.title)}</h2><p class="meta">${copy.timelines} · ${shown.length} ${copy.events}${view ? ` · ${esc(view.name)}` : ''}</p>${timeline.description ? `<p>${esc(timeline.description)}</p>` : ''}<ol class="wiki-timeline" style="padding:0">${rows}</ol><footer><a href="#top">${copy.home}</a></footer></article>` }];
  }) : [];
  const timelineDocuments=curated?timelineArticles.map(article=>{const id=/article id="([^"]+)"/.exec(article.html)![1];const timeline=(data.timelines??[]).find(row=>key('timeline',row.id)===id)!;return{ref:{kind:'timeline' as const,id:timeline.id},id,title:timeline.title,html:article.html,index:article.index};}):[];
  const documents=[...entries.map(entry=>({ref:{kind:'entry' as const,id:entry.id},id:key('entry',entry.id),title:entry.title,image:includeImages&&raster(entry.avatar)?entry.avatar:undefined})),...maps.map(map=>({ref:{kind:'map' as const,id:map.id},id:key('map',map.id),title:map.title,image:includeImages&&raster(map.backgroundImage)?map.backgroundImage:undefined}))].map((doc,position)=>({...doc,html:articles[position],index:index[position]}));
  const composed=composeWikiLayout([...documents,...extraDocuments,...timelineDocuments],entries,maps,options,{...copy.types,maps:copy.maps,...extraLabels},locale);
  const tailTimelines=curated?[]:timelineArticles;
  const publishedTimelines=new Set(timelineArticles.map(article=>/article id="([^"]+)"/.exec(article.html)![1]));
  const allTags = [...new Set([...tags, ...timelineArticles.length ? shownEvents().filter(event=>!curated||publishedTimelines.has(key('timeline',event.timelineId))).flatMap(event => event.tags ?? []) : []])].sort((a, b) => a.localeCompare(b));
  const banner=options.home?.banner??(options.includeCover?data.project.coverImage:undefined);
  const cover = includeImages && raster(banner) ? `<img class="cover" src="${esc(banner)}" alt="">` : '';
  const hasModels = articles.join('').includes('data-wh-model-reader="true"');
  // The prep-block look is only added when a published article holds one, so other exports keep their exact bytes.
  const hasPrepBlocks = /data-wh-prep="/.test(composed.home + composed.html + timelineArticles.map(item => item.html).join(''));
  const branding=options.branding;
  const brand=branding?.name||includeImages&&raster(branding?.mark)?`<div class="wiki-brand">${includeImages&&raster(branding?.mark)?`<img class="wiki-mark" src="${esc(branding.mark)}" alt="">`:''}${branding?.name?`<span>${esc(branding.name)}</span>`:''}</div>`:'';
  const consoleDocuments=[...entries.map(entry=>({id:key('entry',entry.id),names:[entry.title,...entryNames({...entry,fields:Object.fromEntries(Object.entries(entry.fields).filter(([name])=>!excludedFields.has(name)))})].filter((name,i,all)=>all.indexOf(name)===i)})),...maps.map(map=>({id:key('map',map.id),names:[map.title]})),...extraDocuments.map(doc=>({id:doc.id,names:[doc.title]})),...timelineDocuments.map(doc=>({id:doc.id,names:[doc.title]}))];
  const console=options.layout==='shell',terminal=wikiTerminalActive(options);
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:${hasModels?' blob:':''}; media-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; connect-src ${hasModels?"data: blob:":"'none'"}">
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(options.home?.title??data.project.title)} · ${copy.title}</title><style>${WIKI_STYLE}${LOCAL_TOOL_PREVIEW_CSS}${VOICE_READING_CSS}${EDITORIAL_PROSE_BASE_CSS}${hasPrepBlocks?PREP_BLOCKS_CSS:''}${WIKI_PROFILE_CSS}${presentation}${wikiAppearanceStyle(options)}${console?WIKI_CONSOLE_CSS:''}${terminal?wikiTerminalStyle(terminal):''}</style></head>
    <body id="top"><header>${terminal?wikiTerminalBoot(terminal):''}${brand}${cover}<h1>${esc(options.home?.title??data.project.title)}</h1><p>${esc(options.home?.intro??data.project.description)}</p><small>${copy.offline}</small></header>${composed.home}${console?wikiConsoleMarkup(locale,terminal?wikiTerminalOpening(terminal,locale):''):''}
    <div class="layout"><nav aria-label="${copy.contents}"><h2>${copy.title}</h2>
      <label for="search">${copy.search}</label><input id="search" type="search" placeholder="${copy.search}">
      <label for="category">${copy.category}</label><select id="category"><option value="">${copy.all}</option>${[...new Set(entries.map(entry => entry.type))].map(type => `<option value="${type}">${copy.types[type]}</option>`).join('')}${maps.length ? `<option value="maps">${copy.maps}</option>` : ''}${[...new Set(extraPages.map(page=>page.ref.kind))].map(kind=>`<option value="${kind}">${esc(extraLabels[kind]??kind)}</option>`).join('')}${timelineArticles.length ? `<option value="timelines">${copy.timelines}</option>` : ''}</select>
      <label for="tag">${copy.tag}</label><select id="tag"><option value="">${copy.all}</option>${allTags.map(tag => `<option value="${esc(tag)}">${esc(tag)}</option>`).join('')}</select>
      <p role="status" aria-live="polite"><span id="count">${articles.length + timelineArticles.length}</span> / ${articles.length + timelineArticles.length}</p><button id="print" type="button">${copy.print}</button><ol id="index">${composed.index}${tailTimelines.map(item => item.index).join('')}</ol></nav>
      <main><p id="empty" hidden>${copy.noResults}</p><div id="wiki">${composed.html}${tailTimelines.map(item => item.html).join('')}</div></main></div>${wikiFooterMarkup(branding)}<script nonce="${nonce}">${WIKI_SCRIPT}${console?wikiConsoleScript(consoleDocuments,locale):''}${terminal?wikiTerminalScript(terminal,console):''};(${installVoiceReading.toString()})(document);</script>${modelReaderExportScript(articles.join(''),nonce)}${mapFrames ? `${[...ambienceIds].map(([assetId, id]) => `<audio id="${id}" data-map-audio loop preload="none" style="display:none" src="${esc(media.get(assetId)!.dataUrl)}"></audio>`).join('')}${wikiMapScript(nonce, ambienceIds.size > 0)}` : ''}</body></html>`;
  return { html, filename: `${sanitizeFilename(data.project.title)}-wiki.html`, counts: { entries: entries.length, maps: maps.length, timelines: timelineArticles.length,...(extraPages.length?{documents:extraPages.length}:{}) } };
}

export async function exportWorldWiki(projectId: string, options: WorldWikiOptions = {}) {
  const artifact = buildWorldWiki(await loadWorldWikiData(projectId, options), options);
  downloadTextFile(artifact.html, artifact.filename, 'text/html');
  return artifact;
}
