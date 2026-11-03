import type * as Y from 'yjs';
import {JsonMap,convergenceCanonical} from './json';
import type {LocalToolConvergenceIdentity} from './formatTypes';
/** Finite table grammar declaration, including capable fields absent from data. */
export function readTableFields(doc:Y.Doc,identity:LocalToolConvergenceIdentity,rich:readonly string[],blocks:readonly string[],links:readonly string[],expected?:readonly string[]):Set<string> {
 const fields=new JsonMap<string[]>(doc.getMap('table-fields')).get('value')??[];
 if(!Array.isArray(fields)||fields.some(field=>typeof field!=='string'||!field)||new Set(fields).size!==fields.length||convergenceCanonical(fields)!==convergenceCanonical([...fields].sort())||fields.some(field=>!rich.includes(field)||!blocks.includes(field)||!links.includes(field))||['5','6','7'].includes(identity.engine.version)&&!fields.length||!['5','6','7'].includes(identity.engine.version)&&fields.length||expected&&convergenceCanonical(fields)!==convergenceCanonical(expected))throw Error('local_tool_table_fields_invalid');
 return new Set(fields);
}
export function readTableAxisFields(doc:Y.Doc,identity:LocalToolConvergenceIdentity,tables:readonly string[],expected?:readonly string[]):Set<string> {
 const fields=new JsonMap<string[]>(doc.getMap('table-axis-fields')).get('value')??[];
 if(!Array.isArray(fields)||fields.some(field=>typeof field!=='string'||!field)||new Set(fields).size!==fields.length||convergenceCanonical(fields)!==convergenceCanonical([...fields].sort())||fields.some(field=>!tables.includes(field))||['6','7'].includes(identity.engine.version)&&!fields.length||!['6','7'].includes(identity.engine.version)&&fields.length||expected&&convergenceCanonical(fields)!==convergenceCanonical(expected))throw Error('local_tool_table_axis_fields_invalid');
 return new Set(fields);
}
export function readTableWidthFields(doc:Y.Doc,identity:LocalToolConvergenceIdentity,axes:ReadonlySet<string>,expected?:readonly string[]):Set<string> {
 const fields=doc.share.has('table-width-fields')?new JsonMap<string[]>(doc.getMap('table-width-fields')).get('value'):[];
 if(!Array.isArray(fields)||fields.some(field=>typeof field!=='string'||!axes.has(field))||new Set(fields).size!==fields.length||convergenceCanonical(fields)!==convergenceCanonical([...fields].sort())||identity.engine.version==='7'&&!fields.length||identity.engine.version!=='7'&&doc.share.has('table-width-fields')||expected&&convergenceCanonical(fields)!==convergenceCanonical(expected))throw Error('local_tool_table_width_fields_invalid');
 return new Set(fields);
}
