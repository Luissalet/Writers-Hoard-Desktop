import type { BoardNode,BoardEdge,BoardLayer } from '@/engines/board/types';
import { visibleCanvasNodes, pileItemCount } from '@/engines/board/graph/membership';
import { boundsOfNodes,boxOfNode,computeEdgeGeometry } from '@/engines/board/graph/geometry';
import { boardShapePath } from '@/engines/board/shapes';
import { strokeOutline } from '@/engines/board/freehand';
import { resolveBoardTile } from '@/engines/board/entityTiles';
import type { WorldEraScope } from '@/services/worldEras/types';
import type { DocumentImageRect } from './types';
import { esc,image,safeProse,table } from './markup';

export async function boardImage(scope:WorldEraScope,allNodes:BoardNode[],allEdges:BoardEdge[],layers:BoardLayer[],width:number,requested?:DocumentImageRect,surface='cork',locale:'es'|'en'='en'){
  const visible=(id?:string)=>!id||layers.find(layer=>layer.id===id)?.visible!==false;
  const nodes=visibleCanvasNodes(allNodes).filter(node=>visible(node.layerId));
  const edges=allEdges.filter(edge=>visible(edge.layerId)),bounds=boundsOfNodes(nodes,40)??{x:0,y:0,width:800,height:450};
  const geometry=computeEdgeGeometry(edges,new Map(nodes.map(node=>[node.id,boxOfNode(node)])));
  // Bézier curves stay within their control-point hull; include that hull and
  // label extents so fit-content does not cut authored relations at the edge.
  let left=bounds.x,top=bounds.y,right=left+bounds.width,bottom=top+bounds.height;
  for(const edge of edges){const g=geometry.get(edge.id);if(!g)continue;for(const leg of g.legs){const coordinates=leg.d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number)??[];for(let i=0;i+1<coordinates.length;i+=2){left=Math.min(left,coordinates[i]-20);right=Math.max(right,coordinates[i]+20);top=Math.min(top,coordinates[i+1]-20);bottom=Math.max(bottom,coordinates[i+1]+20);}}const half=(edge.label??edge.kind).length*4;left=Math.min(left,g.mid.x-half-12);right=Math.max(right,g.mid.x+half+12);top=Math.min(top,g.mid.y-32);bottom=Math.max(bottom,g.mid.y+16);}
  const view=requested??{x:left,y:top,w:right-left,h:bottom-top},scale=(width-64)/view.w;
  const lines=edges.map(edge=>{const g=geometry.get(edge.id);if(!g)return'';return`<g fill="none" stroke="${esc(edge.color)}" stroke-width="${edge.width||Math.max(1,edge.weight*2)}" opacity="${edge.certainty}"${edge.style!=='solid'?` stroke-dasharray="${edge.style==='dashed'?'8 5':'2 5'}"`:''}>${g.legs.map(leg=>`<path d="${leg.d}"${edge.direction==='forward'||edge.direction==='both'?' marker-end="url(#image-arrow)"':''}${edge.direction==='backward'||edge.direction==='both'?' marker-start="url(#image-arrow)"':''}/>`).join('')}</g><text x="${g.mid.x}" y="${g.mid.y-8}" text-anchor="middle" fill="#292b29" font-size="13">${esc(edge.label??edge.kind)}</text>`;}).join('');
  const cards=await Promise.all([...nodes].sort((a,b)=>a.zIndex-b.zIndex||a.id.localeCompare(b.id)).map(async node=>{
    const opacity=layers.find(layer=>layer.id===node.layerId)?.opacity??1,style=`left:${node.position.x}px;top:${node.position.y}px;width:${node.size.width}px;height:${node.size.height}px;opacity:${opacity};`;
    if(node.freehand)return`<svg style="position:absolute;${style}" viewBox="0 0 ${node.size.width} ${node.size.height}" preserveAspectRatio="none"><path d="${strokeOutline(node.freehand.points.map(point=>({...point,x:point.x*node.size.width/100,y:point.y*node.size.height/100})),node.freehand.width)}" fill="${esc(node.color)}" fill-opacity="${node.freehand.opacity??(node.freehand.tool==='marker'?.32:1)}"/></svg>`;
    if(node.kind==='shape')return`<svg style="position:absolute;${style}" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${boardShapePath(node.shape??'rectangle')}" fill="${['line','arrow'].includes(node.shape??'')?'none':esc(node.color)}" fill-opacity=".18" stroke="${esc(node.color)}" stroke-width="2" vector-effect="non-scaling-stroke"/><text x="50" y="50" text-anchor="middle" fill="#eee9dc" font-size="9">${esc(node.title)}</text></svg>`;
    if(node.kind==='frame')return`<div class="board-node" style="${style}padding:0;background:transparent;border:2px dashed ${esc(node.color)}"><h3 style="padding:8px;background:${esc(node.color)};color:#15151a">${esc(node.title)}</h3>${node.collapsed?`<p style="padding:0 8px 8px;color:#eee9dc">${pileItemCount(node,allNodes)} ${locale==='es'?'elementos':'items'}</p>`:''}</div>`;
    const live=node.ref?await resolveBoardTile(scope,node.ref):null;
    const background=node.kind==='postit'?node.color:node.kind==='text'?'transparent':'#23232b',ink=node.kind==='postit'?'#231d10':'#eee9dc';
    return`<div class="board-node" style="${style}background:${/^#[\da-f]{6}$/i.test(background)||background==='transparent'?background:'#23232b'};color:${ink};border-color:${node.kind==='text'?'transparent':esc(node.color)}"><h3>${esc(live?.title??node.title)}</h3>${image(live?.thumbnail??node.image)}${live?.mapSvg??''}<div>${safeProse(live?.content??node.richContent??node.content).body.innerHTML}</div>${live?.properties?live.properties.map(row=>`<p><b>${esc(row.label)}</b> ${esc(row.value)}</p>`).join(''):''}</div>`;
  }));
  const background=surface==='blueprint'?'#142a40':surface==='slate'?'#202127':surface==='grid'?'#17191d':surface==='white'?'#ffffff':surface==='lined'?'#fbf8ef':surface==='chalk'?'#1f3b2d':'#3e3429';
  const content=await Promise.all(nodes.filter(node=>node.kind!=='frame'&&!node.freehand).map(async node=>{const live=node.ref?await resolveBoardTile(scope,node.ref):null;return`<section><h2>${esc(live?.title??node.title)}</h2>${safeProse(live?.content??node.richContent??node.content).body.innerHTML}${live?.properties?table(['Property','Value'],live.properties.map(row=>[row.label,row.value])):''}</section>`;}));
  return {view,html:`<div class="scene-box" style="background:${background};width:${width-64}px;height:${view.h*scale}px"><div style="position:absolute;left:${-view.x*scale}px;top:${-view.y*scale}px;transform:scale(${scale});transform-origin:top left;width:${view.w}px;height:${view.h}px"><svg style="position:absolute;overflow:visible" width="${view.w}" height="${view.h}"><defs><marker id="image-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"><path d="M0 0L8 4L0 8Z" fill="context-stroke"/></marker></defs>${lines.replaceAll('fill="#292b29"','fill="#eee9dc"')}</svg>${cards.join('')}</div></div>${content.join('')}`};
}
