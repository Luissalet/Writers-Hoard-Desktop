import {validateRelationTree,type RelationTreeDocument,type RelationTreeEdge,type RelationTreeNode,type RelationVocabulary} from './relationTrees';
export type TreeSide='top'|'bottom'|'left'|'right';
const opposite:Record<TreeSide,TreeSide>={top:'bottom',bottom:'top',left:'right',right:'left'};
export function addTreeNeighbor(tree:RelationTreeDocument,parentId:string,side:TreeSide,node:Pick<RelationTreeNode,'id'|'label'|'codexEntryId'>,edgeId:string,relation:Partial<Pick<RelationTreeEdge,'kind'|'label'|'icon'|'style'>>={},reverse=false):RelationTreeDocument{
 const parent=tree.nodes.find(item=>item.id===parentId);if(!parent||!opposite[side])throw Error('missing_neighbor_node');
 const direction=side==='top'?[0,-160]:side==='bottom'?[0,160]:side==='left'?[-280,0]:[280,0];let position={x:parent.position.x+direction[0],y:parent.position.y+direction[1]};
 // Move only the new node; keep all authored positions and annotations intact.
 while(tree.nodes.some(item=>Math.abs(item.position.x-position.x)<220&&Math.abs(item.position.y-position.y)<95))position={x:position.x+(direction[0]===0?240:0),y:position.y+(direction[0]===0?0:150)};
 const edge:RelationTreeEdge={id:edgeId,source:reverse?node.id:parentId,target:reverse?parentId:node.id,sourceHandle:reverse?opposite[side]:side,targetHandle:reverse?side:opposite[side],kind:relation.kind??'custom',style:relation.style??'solid',label:relation.label??(relation.kind===undefined||relation.kind==='custom'?'':undefined),icon:relation.icon};
 const next={...tree,nodes:[...tree.nodes,{...node,position}],edges:[...tree.edges,edge]};validateRelationTree(next);return next;
}
/** Reconnect a logical outer endpoint, never a projected segment or its route. */
export function reconnectTreeEdge(tree:RelationTreeDocument,edgeId:string,end:'source'|'target',nodeId:string,handle:TreeSide):RelationTreeDocument{
 const edge=tree.edges.find(item=>item.id===edgeId);if(!edge)throw Error('missing_edge');const key=end==='source'?'sourceHandle':'targetHandle';
 if(edge[end]===nodeId&&(edge[key]??(end==='source'?'bottom':'top'))===handle)return tree;
 const next={...tree,edges:tree.edges.map(item=>item.id===edgeId?{...item,[end]:nodeId,[key]:handle}:item)};validateRelationTree(next);return next;
}
export function saveTreeVocabulary(tree:RelationTreeDocument,value:RelationVocabulary):RelationTreeDocument{const next={...tree,relationVocabulary:[...(tree.relationVocabulary??[]).filter(item=>item.id!==value.id),{...value,name:value.name.trim()}]};validateRelationTree(next);return next;}
export function removeTreeVocabulary(tree:RelationTreeDocument,id:string):RelationTreeDocument{if(!tree.relationVocabulary?.some(item=>item.id===id))return tree;return{...tree,relationVocabulary:tree.relationVocabulary.filter(item=>item.id!==id)};}
export function applyTreeVocabulary(tree:RelationTreeDocument,edgeId:string,value:RelationVocabulary):RelationTreeDocument{if(!tree.edges.some(item=>item.id===edgeId))throw Error('missing_edge');const next={...tree,edges:tree.edges.map(item=>item.id===edgeId?{...item,kind:value.kind,label:value.label??(value.kind==='custom'?'':undefined),icon:value.icon,style:value.style}:item)};validateRelationTree(next);return next;}
