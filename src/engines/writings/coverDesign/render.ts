import type {ReaderPresentation} from '../readerPresentationTypes';
import {COVER_FONT_STACKS,COVER_HEIGHT,COVER_SPREAD,COVER_WIDTH,COVER_SPINE,coverFaceBox,coverRaster,coverContrast,validateReaderCover} from './model';
import type {CoverElement,CoverFace,CoverText} from './types';
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function lines(e:CoverText){
 const count=Math.max(1,Math.floor(e.width/(e.size*(e.font==='courier'?.61:.56))));
 return e.text.split('\n').flatMap(line=>{const chars=Array.from(line);if(chars.length<=count)return[line];const result:string[]=[];let rest=chars;while(rest.length>count){let at=rest.slice(0,count+1).lastIndexOf(' ');if(at<=0)at=count;result.push(rest.slice(0,at).join(''));rest=rest.slice(at+(rest[at]===' '?1:0));}result.push(rest.join(''));return result;});
}
export function coverElementSvg(e:CoverElement):string {
 let body='';if(e.kind==='image')body=`<image href="${esc(e.src)}" width="${e.width}" height="${e.height}" preserveAspectRatio="xMidYMid slice"/>`;
 else if(e.kind==='text'){const x=e.align==='left'?0:e.align==='center'?e.width/2:e.width;body=`<text xml:space="preserve" fill="${e.color}" font-family="${esc(COVER_FONT_STACKS[e.font])}" font-size="${e.size}" font-weight="${e.bold?700:400}" text-anchor="${e.align==='left'?'start':e.align==='center'?'middle':'end'}">${lines(e).map((line,i)=>`<tspan x="${x}" y="${e.size+i*e.size*1.2}">${esc(line)}</tspan>`).join('')}</text>`;}
 else{const points=e.points.map(p=>({x:p.x*e.width,y:p.y*e.height}));body=points.length===1?`<circle cx="${points[0].x}" cy="${points[0].y}" r="${e.weight/2}" fill="${e.color}"/>`:`<path d="${points.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' ')}" fill="none" stroke="${e.color}" stroke-width="${e.weight}" stroke-linecap="round" stroke-linejoin="round"/>`;}
 return`<g data-cover-id="${esc(e.id)}" data-cover-kind="${e.kind}" transform="translate(${e.x} ${e.y}) rotate(${e.rotation} ${e.width/2} ${e.height/2})">${e.kind==='ink'?body:`<svg width="${e.width}" height="${e.height}" overflow="hidden">${body}</svg>`}</g>`;
}
export function coverSpreadContents(title:string,artwork:string|undefined,cover:ReaderPresentation['cover']):string {
 validateReaderCover(cover);let body=`<rect width="${COVER_SPREAD}" height="${COVER_HEIGHT}" fill="${cover.color}"/>`;
 if(cover.artwork&&coverRaster(artwork))body+=`<image href="${esc(artwork)}" x="${COVER_WIDTH+COVER_SPINE}" width="${COVER_WIDTH}" height="${COVER_HEIGHT}" preserveAspectRatio="xMidYMid slice"/>`;
 if(cover.texture==='linen')body+=`<defs><pattern id="cover-cloth" width="9" height="9" patternUnits="userSpaceOnUse"><path d="M0 0H9M0 0V9" stroke="#fff" stroke-opacity=".08"/></pattern></defs><rect width="${COVER_SPREAD}" height="${COVER_HEIGHT}" fill="url(#cover-cloth)"/>`;
 if(cover.texture==='lines')body+=`<rect x="18" y="18" width="564" height="864" fill="none" stroke="#ffffff" stroke-opacity=".4"/><rect x="690" y="18" width="564" height="864" fill="none" stroke="#ffffff" stroke-opacity=".4"/>`;
 if(cover.jacket)body+=cover.jacket.elements.map(coverElementSvg).join('');
 else{const ink=coverContrast(cover.color);body+=coverElementSvg({id:'legacy-front',kind:'text',x:732,y:160,width:480,height:300,rotation:0,text:cover.artwork&&coverRaster(artwork)?'':title,font:'georgia',size:64,bold:true,align:'center',color:ink});body+=coverElementSvg({id:'legacy-spine',kind:'text',x:231,y:420,width:810,height:60,rotation:90,text:title,font:'georgia',size:30,bold:false,align:'center',color:ink});}
 return body;
}
export function renderCoverSvg(title:string,artwork:string|undefined,cover:ReaderPresentation['cover'],face:CoverFace='spread'):string {const b=coverFaceBox(face);return`<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="${b.height}" viewBox="${b.x} ${b.y} ${b.width} ${b.height}" role="img" aria-label="${esc(title)} · ${face}">${coverSpreadContents(title,artwork,cover)}</svg>`;}
