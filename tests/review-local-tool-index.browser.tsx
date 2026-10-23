import '@/engines';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {defineLocalTool, type LocalToolJson} from '@/engines/local/sdk';
import {registerLocalToolModules} from '@/engines/local/registry';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {rememberLocalToolDefinition} from '@/engines/local/definitions';
import {pinLocalToolRelease} from '@/engines/local/releases';
import {queryLocalToolDocuments} from '@/engines/local/queryDocuments';
import {searchProjectContent} from '@/services/projectSearchIndex';
import {evaluateLocalToolIndex, queryLocalToolIndexRows, type LocalToolIndexSpec} from '@/engines/local/documentIndex';
import {remapSourceToolDocument} from '@/engines/local/documents/types';

const assert: (value: unknown, message: string) => asserts value = (value, message) => {if (!value) throw Error(message);};
export async function reviewLocalToolIndexSelection() {
  const P = 'review-index-selection', namespace = 'review.index-selection', marker = 'INDEXMARKERREMOVAL1095';
  const source = defineLocalTool({namespace, name: {en: 'Index selection', es: 'Selección de índice'}, description: {en: 'Independent selection review.', es: 'Revisión independiente.'}, document: {defaultTitle: {en: 'Document', es: 'Documento'}}, initialState: {items: [marker]}, validateState: (value: LocalToolJson): value is {items: string[]} => !!value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.items), component: () => null, index: {version: 1, fields: {item: {path: '$.items[*]', type: 'string[]', mode: 'all'}}}});
  registerLocalToolModules({['./installed/' + namespace + '/module.tsx']: {default: source}});
  try {
    await db.projects.put({id: P, title: 'Review selection', description: '', mode: 'custom', type: 'standalone', status: 'draft', color: '#777777', enabledEngines: ['local-tool-' + namespace], engineOrder: [], createdAt: 1, updatedAt: 1});
    const document = await createSourceToolDocument({projectId: P}, namespace, 'Selection document');
    assert((await queryLocalToolDocuments({projectId: P})).length === 1, 'Baseline index absent');
    assert((await searchProjectContent(marker, P)).some(row => row.id === document.id), 'Baseline normal search absent');
    const hash = 'd'.repeat(64), noIndex = defineLocalTool({...source, index: undefined});
    rememberLocalToolDefinition(noIndex, {format: 'writers-hoard-local-tool-source/1', apiVersion: 1, namespace, version: 'without-index', contentHash: hash, files: [{path: 'module.tsx', sha256: 'e'.repeat(64), bytes: 1}]});
    await pinLocalToolRelease(P, namespace, hash, null);
    const queried = await queryLocalToolDocuments({projectId: P}), searched = await searchProjectContent(marker, P);
    assert(!queried.some(row => row.id === document.id) && !searched.some(row => row.id === document.id), 'Selected compiled release without index reused the previous portable descriptor: ' + JSON.stringify({queried: queried.map(row => row.id), searched: searched.map(row => row.id)}));
    return ['Selecting compiled source with no index removes old index rows/search; portable fallback is reserved for unavailable source'];
  } finally {await deleteProject(P);}
}

export async function reviewLocalToolIndexBoundaries() {
  const P = 'review-portable-index', namespace = 'missing.review-index', marker = 'PORTABLEVISIBLE1095', secret = 'UNPROJECTEDSECRET1095';
  const index: LocalToolIndexSpec = {version: 1, fields: {values: {path: '$.values[*]', type: 'number[]', mode: 'all'}, shown: {path: '$.shown', type: 'string'}}, refs: [{kind: 'codex', path: '$.targets[*]'}]};
  const document = {id: 'portable-review-document', namespace, title: 'Portable review', revision: 1, createdAt: 1, updatedAt: 1, data: {values: [2, 20], shown: marker, hidden: secret, targets: ['linked-review-card', 'linked-review-card']}, index};
  try {
    await db.projects.put({id: P, title: 'Portable index', description: '', mode: 'custom', type: 'standalone', status: 'draft', color: '#777777', enabledEngines: [], engineOrder: [], createdAt: 1, updatedAt: 1, sourceToolDocuments: [document]});
    const rows = await queryLocalToolDocuments({projectId: P}, {namespace});
    assert(rows.length === 1 && rows[0].fields.shown === marker && rows[0].refs.length === 1, 'Unavailable-source portable descriptor did not project correctly');
    assert(!JSON.stringify(rows).includes(secret), 'Query returned undeclared raw authored data');
    assert(!(await searchProjectContent(secret, P)).some(row => row.id === document.id), 'Normal search indexed unprojected raw data');
    assert((await searchProjectContent(marker, P)).some(row => row.id === document.id), 'Normal search lost portable fallback when source code was absent');
    const cloned = remapSourceToolDocument(document, (id, prefix) => prefix + '-copy-' + id), clonedProjection = evaluateLocalToolIndex(index, cloned.data);
    assert(clonedProjection.refs.length === 1 && clonedProjection.refs[0].documentId === 'codex-copy-linked-review-card', 'Clone did not remap declared repeated references');
    assert((cloned.data as typeof document.data).hidden === secret && (cloned.data as typeof document.data).shown === marker, 'Clone changed opaque undeclared strings');
    assert(!queryLocalToolIndexRows(rows, {where: {values: {gte: 10, lte: 15}}}).length, 'Different array elements jointly satisfied one predicate');
    assert(!queryLocalToolIndexRows(rows, {where: {values: {eq: '20'}}}).length, 'Numeric field coerced string operand');
    assert(queryLocalToolIndexRows(rows, {where: {missing: {exists: false}, shown: {contains: 'VISIBLE'}}}).length === 1, 'Missing presence or case-sensitive string matching failed');
    assert(!queryLocalToolIndexRows(rows, {where: {shown: {contains: 'visible'}}}).length, 'Substring query silently changed case');
    return ['Unavailable-source portable index remains readable/searchable while undeclared raw data stays outside index results/search', 'Clone remaps declared repeated references and preserves opaque text; strict predicates cannot combine different array members or coerce types'];
  } finally {await deleteProject(P);}
}
