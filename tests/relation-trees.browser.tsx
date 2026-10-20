import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import type { CodexEntry, Project } from '@/types';
import RelationTreesWorkspace from '@/engines/genealogy/components/RelationTreesWorkspace';
import { relationTreeCopy } from '@/engines/genealogy/relationTreeCopy';
import { saveRelationTree, RelationTreeConflict, deleteRelationTree } from '@/engines/genealogy/relationTreeStore';
import { copyCanonicalTree, duplicateRelationTree } from '@/engines/genealogy/relationTrees';
import { makeTreeStroke } from '@/engines/genealogy/relationTreeAnnotations';
import { linkToRow } from '@/engines/genealogy/genealogyStore';
import { deleteProject, exportProjectData, importProjectData, notifyProjectsChanged } from '@/db/operations';
import { createLocalDraftStore } from '@/hooks/localDraftStore';
import { t } from '@/i18n/useTranslation';
import { useLocaleStore } from '@/stores/localeStore';

const P = 'test-independent-relation-trees';
const copy = relationTreeCopy(useLocaleStore.getState().locale);
const pause = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function text(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function choose(select: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function testRelationTrees(): Promise<string[]> {
  const host = document.getElementById('root'); assert(host, 'Missing root');
  // The focused runner deliberately skips CSS imports; supply the layout
  // primitives React Flow needs to exercise its real drag implementation.
  const css = document.createElement('style');
  css.textContent = '[data-testid=relation-tree-canvas]{width:850px;height:620px}.react-flow{width:100%;height:100%;position:relative;overflow:hidden}.react-flow__renderer,.react-flow__pane,.react-flow__viewport{position:absolute;inset:0}.react-flow__viewport{transform-origin:0 0;pointer-events:none}.react-flow__node{position:absolute;pointer-events:all;width:200px;min-height:75px}.react-flow__edges{position:absolute;overflow:visible}.react-flow__nodes{position:absolute}.react-flow__handle{position:absolute;width:12px;height:12px}.react-flow__edge{pointer-events:all}';
  document.head.appendChild(css);
  let root = createRoot(host);
  let cloneId: string | undefined;
  const project: Project = { id: P, title: 'Independent trees', mode: 'custom', type: 'standalone', color: '#000', description: '', status: 'draft', enabledEngines: ['genealogy', 'codex'], engineOrder: ['genealogy', 'codex'], createdAt: 1, updatedAt: 1 };
  const entries: CodexEntry[] = ['Ada', 'Berta'].map((title, index) => ({ id: `${P}-person-${index}`, projectId: P, type: 'character', title, fields: {}, content: '', tags: [], relations: [], createdAt: 1, updatedAt: 1 }));
  const canonical = [{ id: 'canonical-parent', from: entries[0].id, to: entries[1].id, kind: 'biological_parent' as const }];
  const passed: string[] = [];
  const waitFor = async (name: string, condition: () => boolean) => {
    const end = Date.now() + 6000;
    while (!condition() && Date.now() < end) await act(async () => { await pause(); });
    assert(condition(), `Timed out: ${name}; visible ${host.textContent?.slice(0, 500)}`);
  };
  const render = async () => { await act(async () => { root.render(<StrictMode><MemoryRouter><RelationTreesWorkspace projectId={P} canonical={<p data-testid="canonical-view">Canonical genealogy</p>} /></MemoryRouter></StrictMode>); await pause(); }); };
  const click = async (target: Element | undefined | null, name: string) => { assert(target, `Missing ${name}`); await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); await pause(); }); await act(async () => { await pause(80); }); };
  const button = (name: string, scope: ParentNode = document) => [...scope.querySelectorAll('button')].find(button => button.textContent?.trim() === name);
  const input = (label: string) => { const node = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`); assert(node, `Missing input ${label}`); return node; };
  const select = (label: string) => { const node = document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`); assert(node, `Missing select ${label}`); return node; };
  try {
    await db.projects.put(project); await db.codexEntries.bulkPut(entries); await db.genealogyLinks.bulkPut(canonical.map(link => linkToRow(P, link)));
    const canonicalBefore = JSON.stringify(await db.genealogyLinks.where('projectId').equals(P).toArray());
    await render();
    await waitFor('project loaded', () => !!button(copy.copyCanonical) && !button(copy.copyCanonical)?.hasAttribute('disabled'));
    await click(button(copy.copyCanonical), 'Copy canonical');
    await waitFor('editable canonical snapshot', () => !!host.querySelector('[data-testid="relation-tree-editor"]'));
    let tree = (await db.projects.get(P))!.relationTrees![0];
    assert(tree.nodes.length === 2 && tree.edges[0].kind === 'biological_parent', 'Copy lost canonical graph data');
    const treeId = tree.id;
    await act(async () => { text(input(copy.name), 'Lineage <future>'); await pause(); });
    await click(host.querySelector(`.react-flow__node[data-id="${tree.nodes[0].id}"]`), 'Select copied node');
    await waitFor('node inspector', () => !!host.querySelector('[data-testid="relation-tree-node-inspector"]'));
    await click(host.querySelector('[data-testid="relation-tree-node-inspector"] input[type="checkbox"]'), 'Mark deceased');
    await act(async () => { text(input(copy.x), '375'); text(input(copy.y), '125'); await pause(); });
    await act(async () => { text(input(copy.nodeName), 'Free node 世界'); await pause(); });
    await click(button(copy.addNode), 'Add free node');
    const nodeOptions = [...select(copy.from).options].filter(option => option.value);
    const freeId = nodeOptions.find(option => option.text === 'Free node 世界')?.value;
    assert(freeId, 'Independent free node missing');
    await act(async () => { choose(select(copy.from), tree.nodes[1].id); choose(select(copy.to), tree.nodes[0].id); choose(select(copy.kind), 'adoptive_parent'); await pause(); });
    await click(button(copy.addEdge), 'Attempt parent cycle');
    assert(host.textContent?.includes(copy.cycle), 'Parent cycle was not rejected in the UI');
    await act(async () => { choose(select(copy.kind), 'custom'); await pause(); });
    await click(button(copy.addEdge), 'Add custom cycle');
    await waitFor('custom relation inspector', () => !!host.querySelector('[data-testid="relation-tree-edge-inspector"]'));
    await act(async () => { text(input(copy.label), 'Rivalidad → alianza'); choose(select(copy.style), 'dotted'); await pause(); });
    await click(button(copy.save), 'Save authored tree');
    await waitFor('saved state', () => button(copy.save)?.hasAttribute('disabled') === true);
    tree = (await db.projects.get(P))!.relationTrees!.find(row => row.id === treeId)!;
    assert(tree.nodes[0].deceased && tree.nodes[0].position.x === 375 && tree.nodes[0].position.y === 125, 'Node state or authored positions not saved');
    assert(tree.nodes.some(node => node.label === 'Free node 世界' && !node.codexEntryId) && tree.edges.some(edge => edge.kind === 'custom' && edge.style === 'dotted' && edge.label === 'Rivalidad → alianza'), 'Free node or custom relation data not saved');
    assert(JSON.stringify(await db.genealogyLinks.where('projectId').equals(P).toArray()) === canonicalBefore, 'Authored tree changed canonical genealogy');
    passed.push('editable canonical snapshots preserve canonical data; free nodes, deceased marks, positions and custom line styles persist');

    await click(button(copy.variant), 'Duplicate named variant');
    await waitFor('variant created', () => select(copy.document).value !== treeId);
    const variantId = select(copy.document).value;
    await act(async () => { text(input(copy.name), 'Independent future'); await pause(); });
    await click(button(copy.save), 'Save variant');
    await waitFor('saved variant', () => button(copy.save)?.hasAttribute('disabled') === true);
    const docs = (await db.projects.get(P))!.relationTrees!;
    assert(docs.find(row => row.id === treeId)?.title === 'Lineage <future>' && docs.find(row => row.id === variantId)?.title === 'Independent future', 'Variant edits mutated the source document');
    await act(async () => { root.unmount(); await pause(); }); root = createRoot(host); await render();
    await waitFor('remounted documents', () => select(copy.document).options.length === 3);
    await act(async () => { choose(select(copy.document), treeId); await pause(); });
    await waitFor('saved tree reopened', () => !!host.querySelector('[data-testid="relation-tree-editor"]'));
    assert(input(copy.name).value === 'Lineage <future>', 'Tree name did not persist across remount');
    passed.push('named variants remain independent and complete document state survives remount/reopen');

    // Exercise React Flow's actual mouse drag, not only a stored position patch.
    await act(async () => { await pause(120); });
    let card = host.querySelector<HTMLElement>(`.react-flow__node[data-id="${tree.nodes[0].id}"]`);
    assert(card, 'Missing draggable person');
    const beforeDrag = card.style.transform;
    const box = card.getBoundingClientRect();
    await act(async () => { card!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1, clientX: box.x + 20, clientY: box.y + 20 })); await pause(); });
    await act(async () => { window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window, buttons: 1, clientX: box.x + 40, clientY: box.y + 35 })); await pause(); });
    await act(async () => { window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window, buttons: 1, clientX: box.x + 85, clientY: box.y + 65 })); await pause(); });
    await act(async () => { window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, button: 0, clientX: box.x + 85, clientY: box.y + 65 })); await pause(); });
    card = host.querySelector<HTMLElement>(`.react-flow__node[data-id="${tree.nodes[0].id}"]`);
    assert(card?.style.transform !== beforeDrag, `Real canvas drag did not move the person: before ${beforeDrag}, after ${card?.style.transform}, rect ${JSON.stringify(box)}, saved ${button(copy.save)?.disabled}`);
    await click(button(copy.save), 'Save dragged position');
    await waitFor('drag saved', () => button(copy.save)?.hasAttribute('disabled') === true);
    const moved = (await db.projects.get(P))!.relationTrees!.find(row => row.id === treeId)!;
    assert(moved.nodes[0].position.x !== 375 || moved.nodes[0].position.y !== 125, 'Dragged position was not persisted');
    passed.push('real React Flow mouse drag updates and saves node positions');

    // Keep a local edit, cause an external save, and preserve it as a variant.
    await act(async () => { text(input(copy.name), 'Local draft after remote'); await pause(); });
    const remoteBase = (await db.projects.get(P))!.relationTrees!.find(row => row.id === treeId)!;
    await act(async () => { await saveRelationTree(P, { ...remoteBase, title: 'Newer remote tree' }, remoteBase.revision); await pause(); });
    await click(button(copy.save), 'Attempt stale UI save');
    assert(host.textContent?.includes(copy.conflict) && input(copy.name).value === 'Local draft after remote', 'Conflict did not retain the staged tree');
    await click(button(copy.variant), 'Preserve local draft as variant');
    await waitFor('stale draft variant', () => select(copy.document).value !== treeId);
    assert((await db.projects.get(P))!.relationTrees!.some(row => row.title.includes('Local draft after remote') && row.id !== treeId), 'Stale UI draft was not preserved as independent variant');
    passed.push('stale edit UI retains local content and can save it as an independent variant');

    const editableVariantId = select(copy.document).value;
    const editableVariant = (await db.projects.get(P))!.relationTrees!.find(row => row.id === editableVariantId)!;
    const customEdge = editableVariant.edges.find(edge => edge.kind === 'custom')!;
    await waitFor('rendered custom edge', () => !!host.querySelector(`[data-testid="rf__edge-${customEdge.id}"]`));
    await click(host.querySelector(`[data-testid="rf__edge-${customEdge.id}"]`), 'Select custom edge');
    await waitFor('edge inspector for rewiring', () => !!host.querySelector('[data-testid="relation-tree-edge-inspector"]'));
    await act(async () => { choose(select(`${copy.to} · ${copy.selection}`), freeId); await pause(); });
    await click(button(copy.save), 'Save rewired relationship');
    await waitFor('rewired save', () => button(copy.save)?.hasAttribute('disabled') === true);
    assert((await db.projects.get(P))!.relationTrees!.find(row => row.id === editableVariantId)!.edges.find(edge => edge.id === customEdge.id)?.target === freeId, 'Editing relationship endpoints did not persist');
    await click(host.querySelector(`.react-flow__node[data-id="${freeId}"]`), 'Select independent node');
    await click(button(copy.removeNode), 'Remove independent node');
    let dialog = document.querySelector('[role="dialog"]'); assert(dialog, 'Missing node removal confirmation');
    await click(button(t('common.cancel'), dialog), 'Cancel node removal');
    assert(host.querySelector(`.react-flow__node[data-id="${freeId}"]`), 'Cancelling removal deleted the node');
    await click(button(copy.removeNode), 'Confirm independent node removal');
    dialog = document.querySelector('[role="dialog"]'); assert(dialog, 'Missing removal confirmation');
    await click(button(t('common.delete'), dialog), 'Confirm removal');
    await click(button(copy.save), 'Save node and attached edge removal');
    await waitFor('removal saved', () => button(copy.save)?.hasAttribute('disabled') === true);
    const afterRemoval = (await db.projects.get(P))!.relationTrees!.find(row => row.id === editableVariantId)!;
    assert(!afterRemoval.nodes.some(node => node.id === freeId) && !afterRemoval.edges.some(edge => edge.source === freeId || edge.target === freeId), 'Node deletion left attached edges');
    passed.push('relationship endpoint edits persist, and confirmed node removal cleans attached edges while cancellation preserves them');

    const base = (await db.projects.get(P))!.relationTrees!.find(row => row.id === treeId)!;
    await db.projects.update(P, { description: 'Concurrent unrelated metadata' });
    const changed = await saveRelationTree(P, { ...base, title: 'Remote revision' }, base.revision);
    let conflict = false;
    try { await saveRelationTree(P, { ...base, title: 'Stale overwrite' }, base.revision); } catch (error) { conflict = error instanceof RelationTreeConflict; }
    assert(conflict && (await db.projects.get(P))!.description === 'Concurrent unrelated metadata', 'Stale save overwrote tree or unrelated project metadata');
    const savedVariant = await saveRelationTree(P, duplicateRelationTree(base, `${treeId}-stale-copy`, 'Preserved stale draft', 3), null);
    assert(savedVariant.revision === 1 && (await db.projects.get(P))!.relationTrees!.find(row => row.id === treeId)?.title === changed.title, 'Conflict variant overwrote the newer source');
    let deleteConflict = false; try { await deleteRelationTree(P, treeId, base.revision); } catch (error) { deleteConflict = error instanceof RelationTreeConflict; }
    assert(deleteConflict, 'Stale deletion removed the newer tree');
    passed.push('tree-specific revision transactions preserve unrelated project updates and reject stale saves/deletes');

    // New document creation is independent of canonical content and scope.
    const emptyCopy = copyCanonicalTree('other-tree', 'Other', [], [], 1);
    await saveRelationTree(P, emptyCopy, null);
    assert(JSON.stringify(await db.genealogyLinks.where('projectId').equals(P).toArray()) === canonicalBefore, 'Additional document writes changed canonical links');
    assert((await db.codexEntries.get(entries[0].id))!.title === 'Ada', 'Tree edits changed linked Codex records');
    notifyProjectsChanged();
    passed.push('new tree documents and linked-node state never mutate canonical links or Codex records');

    await click(button(copy.addText), 'Add independent text annotation');
    await waitFor('text inspector', () => !!host.querySelector('[data-testid="tree-annotation-inspector"] textarea'));
    const annotationInput = host.querySelector<HTMLTextAreaElement>('[data-testid="tree-annotation-inspector"] textarea')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(annotationInput, 'Invierno 世界\n<annotation>'); annotationInput.dispatchEvent(new Event('input', { bubbles: true })); await pause(); });
    await act(async () => { text(input(copy.x), '-450'); text(input(copy.y), '-180'); text(input(copy.width), '320'); await pause(); });
    await click(button(copy.save), 'Save text annotation');
    await waitFor('annotation saved', () => button(copy.save)?.disabled === true);
    let annotated = (await db.projects.get(P))!.relationTrees!.find(row => row.id === editableVariantId)!;
    const note = annotated.annotations?.find(item => item.kind === 'text');
    assert(note?.kind === 'text' && note.text === 'Invierno 世界\n<annotation>' && note.position.x === -450 && note.size.width === 320, 'Text annotation Unicode, author positions or size did not persist');
    await click(button(copy.removeAnnotation), 'Remove annotation request');
    dialog = document.querySelector('[role="dialog"]'); assert(dialog, 'Missing annotation removal confirmation');
    await click(button(t('common.cancel'), dialog), 'Cancel annotation removal');
    assert(host.querySelector('[data-testid="tree-annotation-text"]'), 'Cancel removed the annotation');
    await click(button(copy.removeAnnotation), 'Remove annotation confirmation');
    await click(button(t('common.delete'), document.querySelector('[role="dialog"]')!), 'Confirm annotation removal');
    assert(!host.querySelector('[data-testid="tree-annotation-text"]'), 'Confirmed annotation remains rendered');
    await click(host.querySelector(`button[aria-label="${copy.undo}"]`), 'Undo whole annotation removal');
    assert(host.querySelector('[data-testid="tree-annotation-text"]'), 'Undo did not restore annotation');
    await click(button(copy.save), 'Save restored text');
    await waitFor('restored text saved', () => button(copy.save)?.disabled === true);
    annotated = (await db.projects.get(P))!.relationTrees!.find(row => row.id === editableVariantId)!;
    const stroke = makeTreeStroke('test-persisted-stroke', [{ x: -200, y: -80 }, { x: -100, y: 10 }, { x: 40, y: -60 }], '#00aabb', 5); assert(stroke, 'Missing bounded stroke');
    await act(async () => { await saveRelationTree(P, { ...annotated, annotations: [...annotated.annotations!, stroke] }, annotated.revision); await pause(); });
    await waitFor('live remote drawing', () => !!host.querySelector('[data-testid="tree-annotation-stroke"]'));
    await click(button(copy.variant), 'Copy annotated tree');
    await waitFor('annotated variant selected', () => select(copy.document).value !== editableVariantId);
    const annotatedVariant = (await db.projects.get(P))!.relationTrees!.find(row => row.id === select(copy.document).value)!;
    assert(annotatedVariant.annotations?.length === 2 && JSON.stringify(annotatedVariant.annotations) === JSON.stringify((await db.projects.get(P))!.relationTrees!.find(row => row.id === editableVariantId)!.annotations), 'Variant lost text or normalized drawing geometry');
    await act(async () => { root.unmount(); await pause(); }); root = createRoot(host); await render();
    await waitFor('annotation documents reopened', () => [...select(copy.document).options].some(option => option.value === annotatedVariant.id));
    await act(async () => { choose(select(copy.document), annotatedVariant.id); await pause(); });
    await waitFor('both annotations reopened', () => !!host.querySelector('[data-testid="tree-annotation-stroke"]') && !!host.querySelector('[data-testid="tree-annotation-text"]'));
    assert(JSON.stringify(await db.genealogyLinks.where('projectId').equals(P).toArray()) === canonicalBefore && (await db.codexEntries.get(entries[0].id))!.title === 'Ada', 'Annotations changed canonical graph or Codex');
    passed.push('text and stroke annotations preserve Unicode, bounds, confirmations, whole-operation undo, live refresh, variants and reopening independently of canonical/Codex data');

    await click(host.querySelector('[data-testid="tree-annotation-text"]'), 'Edit annotation draft');
    const editNote = host.querySelector<HTMLTextAreaElement>('[data-testid="tree-annotation-inspector"] textarea'); assert(editNote, 'Missing annotation text editor');
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(editNote, 'Unsaved branch note'); editNote.dispatchEvent(new Event('input', { bubbles: true })); await pause(); });
    await act(async () => { root.unmount(); await pause(); }); root = createRoot(host); await render();
    await waitFor('draft tree option', () => [...select(copy.document).options].some(option => option.value === annotatedVariant.id));
    await act(async () => { choose(select(copy.document), annotatedVariant.id); await pause(); });
    await waitFor('recovered annotation draft', () => host.textContent?.includes('Unsaved branch note') === true);
    const remoteTree = (await db.projects.get(P))!.relationTrees!.find(row => row.id === annotatedVariant.id)!;
    await act(async () => { await saveRelationTree(P, { ...remoteTree, annotations: remoteTree.annotations!.map(item => item.kind === 'text' ? { ...item, text: 'Remote branch note' } : item) }, remoteTree.revision); await pause(); });
    await click(button(copy.save), 'Reject stale annotation save');
    assert(host.textContent?.includes(copy.conflict) && host.textContent?.includes('Unsaved branch note'), 'Annotation conflict lost recovered local note');
    await click(button(copy.variant), 'Preserve recovered annotation separately');
    await waitFor('conflicted annotation copied', () => select(copy.document).value !== annotatedVariant.id);
    const preservedNote = (await db.projects.get(P))!.relationTrees!.find(row => row.id === select(copy.document).value)!.annotations!.find(item => item.kind === 'text');
    const remoteNote = (await db.projects.get(P))!.relationTrees!.find(row => row.id === annotatedVariant.id)!.annotations!.find(item => item.kind === 'text');
    assert(preservedNote?.kind === 'text' && preservedNote.text === 'Unsaved branch note' && remoteNote?.kind === 'text' && remoteNote.text === 'Remote branch note', 'Conflict variant overwrote remote annotation or lost local draft');
    passed.push('unsaved annotation journals recover after remount and stale saves preserve both remote notes and an independent local variant');

    const routedId = select(copy.document).value;
    const beforeRoute = (await db.projects.get(P))!.relationTrees!.find(row => row.id === routedId)!;
    const principal = beforeRoute.edges.find(edge => edge.kind === 'biological_parent')!;
    await waitFor('principal edge rendered', () => !!host.querySelector(`[data-testid="rf__edge-${principal.id}"]`));
    await click(host.querySelector(`[data-testid="rf__edge-${principal.id}"]`), 'Select relation for junction');
    await waitFor('relation inspector', () => !!host.querySelector('[data-testid="relation-tree-edge-inspector"]'));
    await act(async () => { choose(select(copy.icon), 'Heart'); choose(select(copy.anchorFrom), 'right'); choose(select(copy.anchorTo), 'left'); await pause(); });
    await click(button(copy.insertJunction), 'Insert junction into selected relation');
    await waitFor('junction inspector', () => !!host.querySelector('[data-testid="tree-junction-inspector"]'));
    await act(async () => { text(input(copy.x), '420'); text(input(copy.y), '190'); await pause(); });
    await click(button(copy.save), 'Save routed relation');
    await waitFor('junction saved', () => button(copy.save)?.disabled === true);
    const routedTree = (await db.projects.get(P))!.relationTrees!.find(row => row.id === routedId)!;
    const junction = routedTree.junctions![0], logical = routedTree.edges.find(edge => edge.id === principal.id)!;
    assert(routedTree.nodes.length === beforeRoute.nodes.length && routedTree.edges.length === beforeRoute.edges.length && logical.source === principal.source && logical.target === principal.target && logical.kind === principal.kind && logical.icon === 'Heart' && logical.via?.[0] === junction.id && junction.position.x === 420, 'Junction insertion changed logical relation identity or failed to preserve metadata/coordinates');
    await click(host.querySelector('aside details summary'), 'Expand connection controls');
    await act(async () => { choose(select(copy.from), junction.id); choose(select(copy.to), principal.source); choose(select(copy.kind), 'custom'); await pause(); });
    await click(button(copy.addEdge), 'Connect junction branch');
    await click(button(copy.save), 'Save junction branch');
    await waitFor('branch saved', () => button(copy.save)?.disabled === true);
    await click(host.querySelector('[data-testid="tree-junction"]'), 'Select junction');
    await click(button(copy.removeJunction), 'Request junction removal');
    await click(button(t('common.cancel'), document.querySelector('[role="dialog"]')!), 'Cancel junction removal');
    assert(host.querySelector('[data-testid="tree-junction"]'), 'Cancel removed junction');
    await click(button(copy.removeJunction), 'Remove junction');
    await click(button(t('common.delete'), document.querySelector('[role="dialog"]')!), 'Confirm junction removal');
    assert(!host.querySelector('[data-testid="tree-junction"]'), 'Confirmed junction remained');
    await click(host.querySelector(`button[aria-label="${copy.undo}"]`), 'Undo junction and attached branch removal');
    await click(button(copy.save), 'Save restored route');
    await waitFor('restored route saved', () => button(copy.save)?.disabled === true);
    const sourceTree = (await db.projects.get(P))!.relationTrees!.find(row => row.id === routedId)!;
    assert(sourceTree.junctions?.length === 1 && sourceTree.edges.some(edge => edge.source === junction.id && edge.kind === 'custom'), 'Undo lost junction or attached branch');
    cloneId = await importProjectData(await exportProjectData(P));
    const clonedTree = (await db.projects.get(cloneId))!.relationTrees!.find(row => row.title === sourceTree.title)!;
    const clonedJunction = clonedTree.junctions![0];
    assert(clonedTree.id !== sourceTree.id && clonedJunction.id !== junction.id && clonedTree.edges.some(edge => edge.icon === 'Heart' && edge.via?.[0] === clonedJunction.id) && clonedTree.edges.some(edge => edge.source === clonedJunction.id && edge.kind === 'custom'), 'Actual JSON clone did not remap junction endpoints/routes while preserving icon');
    assert(JSON.stringify(clonedTree.annotations) === JSON.stringify(sourceTree.annotations) && JSON.stringify(await db.genealogyLinks.where('projectId').equals(P).toArray()) === canonicalBefore, 'Clone lost annotations or modified source canonical genealogy');
    passed.push('junction authoring, icon/anchors, branch connections, cancel/undo and actual project JSON clone preserve logical relations and remap junction routes without altering canonical genealogy');
    return passed;
  } finally {
    await act(async () => { root.unmount(); await pause(); }); css.remove();
    await db.projects.delete(P); await db.codexEntries.where('projectId').equals(P).delete(); await db.genealogyLinks.where('projectId').equals(P).delete();
    if (cloneId) await deleteProject(cloneId);
    createLocalDraftStore(`wh.relation-trees.v1.${P}`, (value): value is object => !!value && typeof value === 'object').clear();
    assert(!document.querySelector('[role="dialog"]'), t('common.cancel'));
  }
}
