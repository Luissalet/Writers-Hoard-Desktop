import type {Node as PMNode} from '@tiptap/pm/model';
import type {LocalToolReplica} from '../convergence/types';
import type {RichRange} from '../convergence/richTypes';
/** Unknown/detached units hide. They never fall back to offsets or import document updates. */
export function presenceCaretPosition(replica:LocalToolReplica,doc:PMNode,point:RichRange):number|null {
 try{const resolved=replica.resolveRichPoint(point);if(resolved.detached)return null;let position:number|null=null;doc.descendants((node,pos)=>{if(node.isTextblock&&node.attrs.id===resolved.nodeId){if(resolved.offset<0||resolved.offset>node.content.size)return false;position=pos+1+resolved.offset;return false;}});return position;}catch{return null;}
}
