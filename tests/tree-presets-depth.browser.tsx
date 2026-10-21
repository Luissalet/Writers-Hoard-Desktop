import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { deleteProject, exportProjectData, importProjectData } from '@/db/operations';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import RelationTreesWorkspace from '@/engines/genealogy/components/RelationTreesWorkspace';
import { createTreePreset, snapTreePoint, TREE_PRESETS } from '@/engines/genealogy/treePresets';
import { validateRelationTree } from '@/engines/genealogy/relationTrees';
import { getEraProject, saveWorldEra } from '@/services/worldEras/store';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { useLocaleStore } from '@/stores/localeStore';
import type { RelationTreeDocument } from '@/engines/genealogy/relationTrees';
import { resolveToolPreview } from '@/components/editor/toolBlocks/preview';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const channel = window as unknown as { __want: unknown; __sizeAck?: number; __shot: unknown; __shotDone?: string; __native: unknown; __nativeAck?: number };
const pause = () => new Promise(resolve => setTimeout(resolve, 40)); let sequence = 0;
async function wait(check: () => boolean) { for (let i = 0; i < 200; i++) { if (check()) return; await pause(); } throw Error('Tree UI handshake timed out'); }
async function settle(check: () => boolean) { for (let i = 0; i < 200; i++) { if (check()) return; await act(async () => { await pause(); }); } throw Error('Tree UI did not settle'); }
async function native(events: unknown[]) { const n = ++sequence; await act(async () => { channel.__native = { n, events }; await wait(() => channel.__nativeAck === n); await pause(); }); }
async function click(node: HTMLElement) { node.scrollIntoView({ block: 'center' }); const r = node.getBoundingClientRect(), p = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), button: 'left', clickCount: 1 }; await native([{ type: 'mouseMove', x: p.x, y: p.y }, { type: 'mouseDown', ...p }, { type: 'mouseUp', ...p }]); }
const keys = (keyCode: string) => [{ type: 'keyDown', keyCode }, { type: 'keyUp', keyCode }];

export async function testTreePresetDepth() {
  const results: string[] = [], P = `tree-start-${Date.now()}`, eraId = 'later', host = document.getElementById('root')!, root = createRoot(host); let mounted = true, cloneId: string | undefined;
  for (const preset of TREE_PRESETS) { const tree = createTreePreset(preset, preset, preset, 'en', 1); validateRelationTree(tree); assert(tree.nodes.length === (preset === 'blank' ? 0 : 4), 'Preset must contain meaningful editable roles'); if (preset !== 'family') assert(tree.edges.every(edge => edge.kind === 'custom'), 'A diagram start must not invent genealogical semantics'); }
  const example = createTreePreset('snap', 'Alignment', 'corporate', 'en', 1), moved = example.nodes[0];
  assert(snapTreePoint(example, moved.id, { x: 4, y: 71 }).x === 0, 'Near card edge did not align'); assert(snapTreePoint({ ...example, snapToNodes: false }, moved.id, { x: 4, y: 71 }).x === 4, 'Disabled alignment changed authored coordinates');
  results.push('Five native starts validate; corporate/military/court remain diagrams; alignment is optional');
  try {
    useLocaleStore.setState({ locale: 'es' }); await db.projects.put({ id: P, title: 'Synthetic relationship trees', mode: 'custom', type: 'standalone', enabledEngines: ['genealogy', 'codex'], createdAt: 1, updatedAt: 1 });
    await saveWorldEra(P, { id: eraId, name: 'Later', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    const read = () => getEraProject({ projectId: P, eraId });
    for (const width of [1440, 640]) {
      const n = ++sequence; await act(async () => { channel.__want = { w: width, h: 1100, n }; await wait(() => channel.__sizeAck === n); root.render(<MemoryRouter><EnginePaneContext.Provider value={{ instanceId: `tree-${width}`, projectId: P, eraId, visible: true, primary: true }}><main className="min-h-screen bg-deep p-4 text-text-primary"><RelationTreesWorkspace key={width} projectId={P} canonical={<p>Genealogía canónica independiente</p>} /></main></EnginePaneContext.Provider></MemoryRouter>); await pause(); });
      await settle(() => !!host.querySelector('select[aria-label="Modelo de árbol"]'));
      await click(host.querySelector<HTMLSelectElement>('select[aria-label="Modelo de árbol"]')!); await native([...keys('HOME'), ...keys('DOWN'), ...keys('ENTER')]);
      const previousTreeIds=new Set((await read()).relationTrees?.map(tree=>tree.id));
      await click([...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Nuevo árbol')!);
      await settle(() => host.querySelectorAll('.react-flow__node-person').length === 4);
      const createdTrees=(await read()).relationTrees!.filter(tree=>!previousTreeIds.has(tree.id));
      assert(createdTrees.length===1,'New tree identity must be distinct from every previous document');
      let tree = createdTrees[0]; assert(tree.preset === 'corporate' && tree.edges.every(edge => edge.label === 'Supervisa'), 'Normal preset creation did not persist its editable roles/relations');
      // A previous diagram remains mounted while creation refreshes the project.
      // Wait for the new document's actual IDs, rather than any four cards.
      await settle(() => host.querySelector<HTMLElement>('.react-flow__node-person')?.dataset.id === tree.nodes[0].id).catch(async () => { throw Error(`New tree did not become active: ${JSON.stringify({ expected: tree.id, nodes: [...host.querySelectorAll<HTMLElement>('.react-flow__node-person')].map(node => node.dataset.id), selects: [...host.querySelectorAll('select')].map(select => ({label:select.getAttribute('aria-label'), value:select.value})), trees:(await read()).relationTrees?.map(item => item.id), alerts:[...host.querySelectorAll('[role=alert]')].map(node => node.textContent) })}`); });
      const [first, second] = [...host.querySelectorAll<HTMLElement>('.react-flow__node-person')]; first.scrollIntoView({ block: 'center' });
      await settle(() => { const rect = first.getBoundingClientRect(); return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('.react-flow__node-person') === first; });
      let previousTransform = '', stableFrames = 0;
      await settle(() => { const transform = host.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform; stableFrames = transform === previousTransform ? stableFrames + 1 : 0; previousTransform = transform; return stableFrames >= 5 && transform !== 'translate(0px, 0px) scale(1)'; });
      const a = first.getBoundingClientRect(), b = second.getBoundingClientRect(), from = { x: Math.round(a.x + a.width / 2), y: Math.round(a.y + a.height / 2) }, to = { x: Math.round(b.x + a.width / 2 + 3), y: Math.round(a.y + a.height / 2 + 65) };
      const pointerMoves: { x: number; y: number }[] = []; const observePointer = (event: PointerEvent) => pointerMoves.push({ x: event.clientX, y: event.clientY }); document.addEventListener('pointermove', observePointer);
      assert(document.elementFromPoint(from.x, from.y)?.closest('.react-flow__node-person') === first, `Drag point is not on the intended card: ${JSON.stringify({ from, to, at: document.elementFromPoint(from.x, from.y)?.outerHTML.slice(0, 180) })}`);
      await native([{ type: 'mouseMove', ...from }, { type: 'mouseDown', ...from, button: 'left', clickCount: 1 }]);
      await native([{ type: 'mouseMove', x: from.x + 2, y: from.y + 2, button: 'left' }]);
      await settle(() => pointerMoves.some(point => point.x === from.x + 2 && point.y === from.y + 2));
      for (let index = 0; index < 12; index++) await native([{ type: 'mouseMove', x: Math.round(from.x + (to.x - from.x) * (index + 1) / 12), y: Math.round(from.y + (to.y - from.y) * (index + 1) / 12), button: 'left' }]);
      await settle(() => first.style.transform.startsWith('translate(0px,')).catch(()=>{throw Error('Snap diagnostic '+JSON.stringify({transform:first.style.transform,other:second.style.transform,from,to,moves:pointerMoves.slice(-4),viewport:host.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform,originalViewport:previousTransform}));});
      await native([{ type: 'mouseUp', ...to, button: 'left', clickCount: 1 }]);
      document.removeEventListener('pointermove', observePointer);
      const save = () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Guardar árbol')!;
      await settle(() => !save().disabled); await click(save()); await settle(() => save().disabled && host.querySelector('[data-testid="relation-tree-editor"]')?.getAttribute('aria-busy') !== 'true');
      tree = (await read()).relationTrees!.find(item => item.id === tree.id)!; assert(Math.abs(tree.nodes[0].position.x - tree.nodes[1].position.x) < .1 && tree.nodes[0].position.y !== 0, `Native pointer drag did not persist actual card alignment: ${JSON.stringify({ positions: tree.nodes.map(node => node.position), from, to, pointerMoves, a: { x:a.x,y:a.y,width:a.width,height:a.height }, viewport: previousTransform, after: host.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform })}`);
      await click(host.querySelector<HTMLButtonElement>('button[aria-label="Deshacer"]')!); await click(save()); await settle(() => save().disabled && host.querySelector('[data-testid="relation-tree-editor"]')?.getAttribute('aria-busy') !== 'true');
      tree = (await read()).relationTrees!.find(item => item.id === tree.id)!; assert(tree.nodes[0].position.x === 150 && tree.nodes[0].position.y === 0, 'Normal Undo did not restore the original layout');
      const currentNode = () => [...host.querySelectorAll<HTMLElement>('.react-flow__node-person')].find(node => node.dataset.id === tree.nodes[0].id)!;
      currentNode().focus(); await native(keys('ENTER'));
      await settle(() => !!host.querySelector('[data-testid="tree-node-image"]')).catch(() => { const rect = currentNode().getBoundingClientRect(); throw Error(`Node image inspector did not open: ${JSON.stringify({ rect, hit: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.outerHTML.slice(0, 150), inspectors: host.querySelectorAll('[data-testid="relation-tree-node-inspector"]').length })}`); });
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64; const context = canvas.getContext('2d')!; context.fillStyle = '#243c45'; context.fillRect(0, 0, 64, 64); context.fillStyle = '#d5b575'; context.fillRect(16, 12, 32, 40);
      const photo = canvas.toDataURL('image/png'), blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png')), transfer = new DataTransfer(); transfer.items.add(new File([blob], 'synthetic-node-art.png', { type: 'image/png' }));
      await act(async () => { const input = host.querySelector<HTMLInputElement>('[data-testid="tree-node-image"]')!; input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); await pause(); });
      await settle(() => !!currentNode().querySelector<HTMLImageElement>('img[src^="data:image/png"]')?.complete);
      await click(save()); await settle(() => save().disabled && host.querySelector('[data-testid="relation-tree-editor"]')?.getAttribute('aria-busy') !== 'true');
      tree = (await read()).relationTrees!.find(item => item.id === tree.id)!; assert(tree.nodes[0].image === photo, 'Local node artwork did not persist byte-identically in the named era');
      const exported = await runBridgeTool('wh_relation_tree_export', { projectId: P, eraId, treeId: tree.id }); assert(exported.ok && (exported.result as { svg: string }).svg.includes(photo), 'Tree SVG lost local node artwork');
      const noImages = await resolveToolPreview({ projectId: P, kind: 'relation-tree', documentId: tree.id, label: '' }, P, 'es', { eraId, includeImages: false }); assert(noImages && !noImages.html.includes(photo), 'Excluded tree artwork leaked into the export preview');
      window.scrollTo(0, 0); assert(document.documentElement.scrollWidth <= innerWidth + 1, 'Tree preset UI overflows horizontally');
      const shot = `tree-presets-${width}`; await act(async () => { channel.__shot = { name: shot }; await wait(() => channel.__shotDone === shot); });
      results.push(`Actual CSS ${width}px: native preset selection/create, pointer alignment, save/Undo and local node artwork in its named era`);
    }
    assert(!(await db.projects.get(P))?.relationTrees?.length && await db.codexEntries.where('projectId').equals(P).count() === 0, 'Creating/editing a diagram changed Base or Codex');
    await act(async () => root.unmount()); mounted = false;
    const created = await runBridgeTool('wh_relation_tree_create', { projectId: P, title: 'Court', preset: 'royal', locale: 'en' }); assert(created.ok, JSON.stringify(created));
    const tree = (created.result as { tree: RelationTreeDocument }).tree, changed = { ...tree, title: 'Edited court', edges: tree.edges.map(edge => ({ ...edge, label: 'Renamed relation' })) };
    const saved = await runBridgeTool('wh_relation_tree_save', { projectId: P, tree: changed, expectedRevision: tree.revision }); assert(saved.ok, JSON.stringify(saved));
    assert(!(await runBridgeTool('wh_relation_tree_save', { projectId: P, tree, expectedRevision: tree.revision })).ok, 'Stale tree write was accepted');
    const svg = await runBridgeTool('wh_relation_tree_export', { projectId: P, treeId: tree.id }); assert(svg.ok && (svg.result as { svg: string }).svg.includes('Renamed relation'), 'Native tree export lost editable relationships');
    cloneId = await importProjectData(await exportProjectData(P));
    const clone = await db.projects.get(cloneId), cloneEra = clone!.worldEras!.find(item => item.name === 'Later')!;
    const clonedTrees = (await getEraProject({ projectId: cloneId, eraId: cloneEra.id })).relationTrees!;
    const clonedCorporations = clonedTrees.filter(item => item.preset === 'corporate');
    assert(clonedCorporations.length === 2 && clonedCorporations.every(item => item.snapToNodes && item.nodes.some(node => node.image?.startsWith('data:image/png;base64,'))) && clonedTrees.some(item => item.preset === 'royal'), 'JSON clone lost tree presets, inherited Base documents, alignment or embedded node images');
    results.push('Registered native handlers preserve context, validate revision CAS and export authored relationships; JSON clone retains scoped geometry/artwork'); return results;
  } finally { if (mounted) await act(async () => root.unmount()); if (cloneId) await deleteProject(cloneId); await deleteProject(P); }
}
