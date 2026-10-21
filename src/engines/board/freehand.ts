import { makeNode } from './graph/mutations';
import type { BoardNode } from './types';
import { simplifyStroke as simplifyBoardStroke, type StrokePoint } from '@/utils/freehand';
export { simplifyStroke as simplifyBoardStroke } from '@/utils/freehand';
export type { StrokePoint } from '@/utils/freehand';

/** A stroke is an ordinary shape node: all existing undo/layer/backup tools work. */
export function makeFreehandNode(options: { projectId: string; boardId: string; title: string; color: string; width: number; points: StrokePoint[]; layerId?: string; tolerance?: number; tool?:'pen'|'marker' }): BoardNode | null {
  const points = simplifyBoardStroke(options.points, options.tolerance);
  if (!points.length) return null;
  const width = Number.isFinite(options.width) ? Math.max(1, Math.min(24, options.width)) : 3;
  const padding = width * 2;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) { minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y); }
  const spanX = maxX - minX, spanY = maxY - minY;
  const size = { width: Math.max(60, spanX + padding * 2), height: Math.max(60, spanY + padding * 2) };
  const position = { x: minX - padding - (size.width - spanX - padding * 2) / 2, y: minY - padding - (size.height - spanY - padding * 2) / 2 };
  const normalized = points.map(point => ({ x: (point.x - position.x) * 100 / size.width, y: (point.y - position.y) * 100 / size.height, ...(point.pressure===undefined?{}:{pressure:Math.max(0,Math.min(1,point.pressure))}) }));
  if (normalized.length === 1) normalized.push({ x: normalized[0].x + .01, y: normalized[0].y });
  return { ...makeNode({ projectId: options.projectId, boardId: options.boardId, title: options.title, kind: 'shape', position, size, color: options.color, layerId: options.layerId }), freehand: { points: normalized, width,tool:options.tool??'pen',opacity:options.tool==='marker'?.32:1 } };
}

/** Filled outline with per-sample pressure. One polygon avoids darker joins in marker strokes. */
export function strokeOutline(points:StrokePoint[],width:number):string {
  if(!points.length)return '';
  const left:StrokePoint[]=[],right:StrokePoint[]=[];
  for(let i=0;i<points.length;i++){
    const point=points[i],before=points[Math.max(0,i-1)],after=points[Math.min(points.length-1,i+1)];
    const dx=after.x-before.x,dy=after.y-before.y,length=Math.hypot(dx,dy)||1;
    const radius=width/2*(.25+1.5*Math.max(0,Math.min(1,point.pressure??.5)));
    left.push({x:point.x-dy/length*radius,y:point.y+dx/length*radius});right.push({x:point.x+dy/length*radius,y:point.y-dx/length*radius});
  }
  const fmt=(p:StrokePoint)=>`${p.x.toFixed(3)} ${p.y.toFixed(3)}`;
  const start=points[0],end=points[points.length-1],radius=(p:StrokePoint)=>width/2*(.25+1.5*Math.max(0,Math.min(1,p.pressure??.5)));
  if(points.every(p=>Math.hypot(p.x-start.x,p.y-start.y)<.1)){const r=radius(start);return `M ${start.x-r} ${start.y} a ${r} ${r} 0 1 0 ${r*2} 0 a ${r} ${r} 0 1 0 ${-r*2} 0 Z`;}
  return `M ${fmt(left[0])} ${left.slice(1).map(p=>`L ${fmt(p)}`).join(' ')} A ${radius(end)} ${radius(end)} 0 0 0 ${fmt(right[right.length-1])} ${right.slice(0,-1).reverse().map(p=>`L ${fmt(p)}`).join(' ')} A ${radius(start)} ${radius(start)} 0 0 0 ${fmt(left[0])} Z`;
}
function distance(point:StrokePoint,a:StrokePoint,b:StrokePoint){const dx=b.x-a.x,dy=b.y-a.y,t=dx||dy?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy))):0;return Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy);}
function intersects(a:StrokePoint,b:StrokePoint,c:StrokePoint,d:StrokePoint){const cross=(p:StrokePoint,q:StrokePoint,r:StrokePoint)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);return cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0&&Math.max(a.x,b.x)>=Math.min(c.x,d.x)&&Math.max(c.x,d.x)>=Math.min(a.x,b.x)&&Math.max(a.y,b.y)>=Math.min(c.y,d.y)&&Math.max(c.y,d.y)>=Math.min(a.y,b.y);}
/** Whole-object eraser follows the swept gesture, including between sparse pointer events. */
export function erasedNodeIds(nodes:BoardNode[],path:StrokePoint[],radius:number):string[]{
  if(!path.length)return [];
  const segments=path.length===1?[[path[0],path[0]]]:path.slice(1).map((p,i)=>[path[i],p]);
  return nodes.filter(node=>{
    const pts=node.freehand?node.freehand.points.map(p=>({x:node.position.x+p.x*node.size.width/100,y:node.position.y+p.y*node.size.height/100})):null;
    const lines=pts?pts.slice(1).map((p,i)=>[pts[i],p]):[[{x:node.position.x,y:node.position.y},{x:node.position.x+node.size.width,y:node.position.y}],[{x:node.position.x+node.size.width,y:node.position.y},{x:node.position.x+node.size.width,y:node.position.y+node.size.height}],[{x:node.position.x+node.size.width,y:node.position.y+node.size.height},{x:node.position.x,y:node.position.y+node.size.height}],[{x:node.position.x,y:node.position.y+node.size.height},{x:node.position.x,y:node.position.y}]];
    if(!pts&&node.kind!=='frame'&&path.some(p=>p.x>=node.position.x&&p.x<=node.position.x+node.size.width&&p.y>=node.position.y&&p.y<=node.position.y+node.size.height))return true;
    const threshold=radius+(node.freehand?.width??0);
    return segments.some(([a,b])=>lines.some(([c,d])=>intersects(a,b,c,d)||Math.min(distance(a,c,d),distance(b,c,d),distance(c,a,b),distance(d,a,b))<=threshold));
  }).map(node=>node.id);
}
