import {boxOfNode} from './graph/geometry';
import type {BoardNode} from './types';
import {nodesInsideFrame} from './graph/mutations';
export const ARRANGEMENTS=['left','center-x','right','top','center-y','bottom','distribute-x','distribute-y'] as const;
export type CanvasArrangement=typeof ARRANGEMENTS[number];
type PositionPatch={id:string;changes:{position:{x:number;y:number}}};
/** A frame carries contained unlocked nodes for keyboard and arrangement, too. */
export function expandFrameMoves(nodes:BoardNode[],patches:PositionPatch[],movable:(node:BoardNode)=>boolean):PositionPatch[]{
  const result=new Map(patches.map(patch=>[patch.id,patch]));
  for(const patch of patches){const frame=nodes.find(node=>node.id===patch.id);if(frame?.kind!=='frame')continue;const dx=patch.changes.position.x-frame.position.x,dy=patch.changes.position.y-frame.position.y;for(const child of nodesInsideFrame(frame,nodes))if(!result.has(child.id)&&movable(child))result.set(child.id,{id:child.id,changes:{position:{x:child.position.x+dx,y:child.position.y+dy}}});}
  return [...result.values()];
}
export function arrangeCanvasNodes(nodes:BoardNode[],mode:CanvasArrangement):Array<{id:string;changes:{position:{x:number;y:number}}}>{
  if(nodes.length<2)return [];
  if(mode==='distribute-x'||mode==='distribute-y'){
    if(nodes.length<3)return [];
    const axis=mode==='distribute-x'?'x':'y',size=axis==='x'?'width':'height',sorted=[...nodes].sort((a,b)=>a.position[axis]-b.position[axis]);
    const first=sorted[0],last=sorted.at(-1)!,gap=(last.position[axis]+last.size[size]-first.position[axis]-sorted.reduce((sum,node)=>sum+node.size[size],0))/(sorted.length-1);let cursor=first.position[axis];
    return sorted.map(node=>{const position={...node.position,[axis]:cursor};cursor+=node.size[size]+gap;return{id:node.id,changes:{position}};});
  }
  const boxes=nodes.map(node=>({node,box:boxOfNode(node)})),minX=Math.min(...boxes.map(({box})=>box.x)),maxX=Math.max(...boxes.map(({box})=>box.x+box.width)),minY=Math.min(...boxes.map(({box})=>box.y)),maxY=Math.max(...boxes.map(({box})=>box.y+box.height));
  return boxes.map(({node,box})=>{const position={...node.position};if(mode==='left')position.x=minX;if(mode==='right')position.x=maxX-box.width;if(mode==='center-x')position.x=(minX+maxX-box.width)/2;if(mode==='top')position.y=minY;if(mode==='bottom')position.y=maxY-box.height;if(mode==='center-y')position.y=(minY+maxY-box.height)/2;return{id:node.id,changes:{position}};});
}
