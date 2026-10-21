import type {BoardNode} from '../types';
/** A group can contain groups. Malformed legacy cycles never recurse or hide every wrapper. */
export function frameMembers(frame:BoardNode,nodes:readonly BoardNode[]):BoardNode[]{
 const byId=new Map(nodes.filter(node=>node.projectId===frame.projectId&&node.boardId===frame.boardId).map(node=>[node.id,node])),found=new Map<string,BoardNode>(),visiting=new Set([frame.id]);
 const direct=(parent:BoardNode)=>parent.memberNodeIds?parent.memberNodeIds.map(id=>byId.get(id)).filter((node):node is BoardNode=>!!node):[...byId.values()].filter(node=>node.id!==parent.id&&node.position.x+node.size.width/2>=parent.position.x&&node.position.x+node.size.width/2<=parent.position.x+(parent.expandedSize?.width??parent.size.width)&&node.position.y+node.size.height/2>=parent.position.y&&node.position.y+node.size.height/2<=parent.position.y+(parent.expandedSize?.height??parent.size.height));
 const visit=(parent:BoardNode)=>{for(const node of direct(parent)){if(visiting.has(node.id)||node.id===frame.id)continue;found.set(node.id,node);if(node.kind==='frame'){visiting.add(node.id);visit(node);visiting.delete(node.id);}}};visit(frame);return[...found.values()];
}
export function pileSelection(ids:Iterable<string>,nodes:readonly BoardNode[]):BoardNode[]{const selected=new Set(ids);for(const node of nodes)if(selected.has(node.id)&&node.kind==='frame'&&node.memberNodeIds)frameMembers(node,nodes).forEach(child=>selected.add(child.id));return nodes.filter(node=>selected.has(node.id));}
export function hiddenCanvasNodeIds(nodes:readonly BoardNode[]):Set<string>{const hidden=new Set<string>();for(const frame of nodes.filter(node=>node.kind==='frame'&&node.collapsed)){if(hidden.has(frame.id))continue;frameMembers(frame,nodes).forEach(node=>hidden.add(node.id));}return hidden;}
export function visibleCanvasNodes(nodes:readonly BoardNode[]):BoardNode[]{const hidden=hiddenCanvasNodeIds(nodes);return nodes.filter(node=>!hidden.has(node.id));}
export function pileItemCount(frame:BoardNode,nodes:readonly BoardNode[]):number{const members=frameMembers(frame,nodes);return members.filter(node=>node.kind!=='frame').length||members.length;}
