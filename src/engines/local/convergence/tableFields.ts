import * as Y from 'yjs';
import {JsonMap,convergenceCanonical} from './json';
import type {LocalToolConvergenceIdentity,RegisterVersion} from './formatTypes';
import {isRichImageEngine} from './imageFormat';
/** Finite table grammar declaration, including capable fields absent from data. */
export function readTableFields(doc:Y.Doc,identity:LocalToolConvergenceIdentity,rich:readonly string[],blocks:readonly string[],links:readonly string[],expected?:readonly string[]):Set<string> {
 const fields=new JsonMap<string[]>(doc.getMap('table-fields')).get('value')??[];
 if(!Array.isArray(fields)||fields.some(field=>typeof field!=='string'||!field)||new Set(fields).size!==fields.length||convergenceCanonical(fields)!==convergenceCanonical([...fields].sort())||fields.some(field=>!rich.includes(field)||!blocks.includes(field)||!links.includes(field))||['5','6','7','9','10'].includes(identity.engine.version)&&!fields.length||!['5','6','7','9','10'].includes(identity.engine.version)&&fields.length||expected&&convergenceCanonical(fields)!==convergenceCanonical(expected))throw Error('local_tool_table_fields_invalid');
 return new Set(fields);
}
export function readTableAxisFields(doc:Y.Doc,identity:LocalToolConvergenceIdentity,tables:readonly string[],expected?:readonly string[]):Set<string> {
 const fields=new JsonMap<string[]>(doc.getMap('table-axis-fields')).get('value')??[];
 if(!Array.isArray(fields)||fields.some(field=>typeof field!=='string'||!field)||new Set(fields).size!==fields.length||convergenceCanonical(fields)!==convergenceCanonical([...fields].sort())||fields.some(field=>!tables.includes(field))||['6','7','9','10'].includes(identity.engine.version)&&!fields.length||!['6','7','9','10'].includes(identity.engine.version)&&fields.length||expected&&convergenceCanonical(fields)!==convergenceCanonical(expected))throw Error('local_tool_table_axis_fields_invalid');
 return new Set(fields);
}
export function readTableWidthFields(doc:Y.Doc,identity:LocalToolConvergenceIdentity,axes:ReadonlySet<string>,expected?:readonly string[]):Set<string> {
 const fields=doc.share.has('table-width-fields')?new JsonMap<string[]>(doc.getMap('table-width-fields')).get('value'):[];
 if(!Array.isArray(fields)||fields.some(field=>typeof field!=='string'||!axes.has(field))||new Set(fields).size!==fields.length||convergenceCanonical(fields)!==convergenceCanonical([...fields].sort())||['7','9','10'].includes(identity.engine.version)&&!fields.length||!['7','9','10'].includes(identity.engine.version)&&doc.share.has('table-width-fields')||expected&&convergenceCanonical(fields)!==convergenceCanonical(expected))throw Error('local_tool_table_width_fields_invalid');
 return new Set(fields);
}
export function readImageFields(doc:Y.Doc,identity:LocalToolConvergenceIdentity,widths:ReadonlySet<string>,expected?:readonly string[],expectedAlignments?:readonly string[]){
 const root=doc.share.has('image-fields')?doc.getMap<string>('image-fields'):undefined;
 const fields=root?new JsonMap<string[]>(root).get('value'):[];
 const alignmentRoot=doc.share.has('image-alignment-fields')?doc.getMap<string>('image-alignment-fields'):undefined;
 const alignments=alignmentRoot?new JsonMap<string[]>(alignmentRoot).get('value'):[];
 if(!Array.isArray(fields)||fields.some(field=>typeof field!=='string'||!widths.has(field))||
    new Set(fields).size!==fields.length||convergenceCanonical(fields)!==convergenceCanonical([...fields].sort())||
    isRichImageEngine(identity.engine.version)&&!fields.length||!isRichImageEngine(identity.engine.version)&&root||
    expected&&convergenceCanonical(fields)!==convergenceCanonical(expected))throw Error('local_tool_image_fields_invalid');
 if(!Array.isArray(alignments)||alignments.some(field=>typeof field!=='string'||!fields.includes(field))||
    new Set(alignments).size!==alignments.length||convergenceCanonical(alignments)!==convergenceCanonical([...alignments].sort())||
    identity.engine.version==='10'&&(!alignments.length||alignmentRoot?.size!==1)||identity.engine.version!=='10'&&alignmentRoot||
    expectedAlignments&&convergenceCanonical(alignments)!==convergenceCanonical(expectedAlignments))throw Error('local_tool_image_alignment_fields_invalid');
 if(root){
  for(const items of doc.store.clients.values())for(const item of items)if(item instanceof Y.Item&&(item.parent===root||item.parent===alignmentRoot)&&item.deleted)throw Error('local_tool_image_fields_invalid');
  const roots=new Set(fields.flatMap(field=>['image-source','image-size'].map(channel=>'blocks3:'+JSON.stringify(field)+':'+channel)));
  for(const field of alignments)roots.add('blocks3:'+JSON.stringify(field)+':image-alignment');
  for(const version of new JsonMap<RegisterVersion>(doc.getMap('register-versions')).values()){
   if(typeof version?.root==='string'&&/^blocks3:.*:image-(source|size|alignment)$/s.test(version.root)&&!roots.has(version.root))throw Error('local_tool_image_fields_invalid');
  }
 }
 return {images:new Set(fields),alignments:new Set(alignments)};
}
