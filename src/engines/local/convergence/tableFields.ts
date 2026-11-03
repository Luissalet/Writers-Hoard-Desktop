import type * as Y from 'yjs';
import {JsonMap,convergenceCanonical} from './json';
import type {LocalToolConvergenceIdentity} from './formatTypes';
/** Finite table grammar declaration, including capable fields absent from data. */
export function readTableFields(doc:Y.Doc,identity:LocalToolConvergenceIdentity,rich:readonly string[],blocks:readonly string[],links:readonly string[],expected?:readonly string[]):Set<string> {
 const fields=new JsonMap<string[]>(doc.getMap('table-fields')).get('value')??[];
 if(!Array.isArray(fields)||fields.some(field=>typeof field!=='string'||!field)||new Set(fields).size!==fields.length||convergenceCanonical(fields)!==convergenceCanonical([...fields].sort())||fields.some(field=>!rich.includes(field)||!blocks.includes(field)||!links.includes(field))||identity.engine.version==='5'&&!fields.length||identity.engine.version!=='5'&&fields.length||expected&&convergenceCanonical(fields)!==convergenceCanonical(expected))throw Error('local_tool_table_fields_invalid');
 return new Set(fields);
}
