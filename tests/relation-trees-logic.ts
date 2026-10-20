import { copyCanonicalTree, duplicateRelationTree, exportRelationTreeSvg, validateRelationTree, RelationTreeValidationError, type RelationTreeDocument } from '@/engines/genealogy/relationTrees';
import { annotationIssues, annotationLines, makeTreeStroke, makeTreeText } from '@/engines/genealogy/relationTreeAnnotations';
import { insertTreeJunction, relationTreeSegments, removeTreeJunction } from '@/engines/genealogy/relationTreeRoutes';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export function runRelationTreeLogicTests(): string[] {
  const passed: string[] = [];
  const characters = [{ id: 'a', title: 'A & <parent>' }, { id: 'b', title: 'Child' }];
  const canonical = [{ id: 'parent', from: 'a', to: 'b', kind: 'biological_parent' as const }];
  const original = JSON.stringify({ characters, canonical });
  const tree = copyCanonicalTree('tree', 'Family <script>alert(1)</script>', characters, canonical, 1);
  validateRelationTree(tree);
  assert(tree.nodes.length === 2 && tree.edges.length === 1 && tree.nodes[0].position.y < tree.nodes[1].position.y, 'Canonical copy lost nodes/links or parent layout');
  const variant = duplicateRelationTree(tree, 'variant', 'Future', 2);
  variant.nodes[0].deceased = true; variant.nodes[0].position.x = 999;
  assert(!tree.nodes[0].deceased && tree.nodes[0].position.x !== 999 && JSON.stringify({ characters, canonical }) === original, 'Editing a variant mutated the source or canonical data');
  passed.push('canonical copies and variants are independent, positioned snapshots');

  const cycle: RelationTreeDocument = { ...tree, edges: [...tree.edges, { id: 'cycle', source: tree.nodes[1].id, target: tree.nodes[0].id, kind: 'adoptive_parent', style: 'solid' }] };
  let rejected = false;
  try { validateRelationTree(cycle); } catch (error) { rejected = error instanceof RelationTreeValidationError && error.issues.some(issue => issue.includes('cycle')); }
  assert(rejected, 'Parent ancestry cycle accepted');
  const custom = { ...tree, edges: [...tree.edges, { ...cycle.edges[1], kind: 'custom' as const, label: 'Reincarnation' }] };
  validateRelationTree(custom);
  passed.push('shared genealogy validation rejects parent cycles while custom cycles remain allowed');

  for (const corrupted of [
    { ...tree, nodes: [...tree.nodes, tree.nodes[0]] },
    { ...tree, nodes: [{ ...tree.nodes[0], position: { x: NaN, y: 0 } }, tree.nodes[1]] },
    { ...tree, edges: [{ ...tree.edges[0], target: 'missing' }] },
  ]) {
    let failed = false; try { validateRelationTree(corrupted); } catch { failed = true; }
    assert(failed, 'Invalid node identity, coordinate or reference accepted');
  }
  passed.push('node identities, finite positions and edge references are validated');

  const svg = exportRelationTreeSvg({ ...variant, edges: [{ ...variant.edges[0], label: '<img src=x onerror=alert(1)>', style: 'dotted' }] });
  assert(svg.includes('stroke-dasharray="2 5"') && svg.includes('text-decoration="line-through"') && svg.includes('translate(999 '), 'Export lost styles, deceased state or authored positions');
  assert(!svg.includes('<script>') && !svg.includes('<img ') && svg.includes('&lt;img'), 'SVG export interpolated executable author text');
  passed.push('portable SVG preserves positions, line styles and deceased marks while escaping author text');

  const note = makeTreeText('note', 'Pasado 世界\n<script>alert(1)</script>\u0001', { x: -900, y: -400 });
  const stroke = makeTreeStroke('stroke', [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 80, y: 90 }], '#c7a462', 4);
  assert(stroke && stroke.points.length === 2, 'Stroke simplification did not reuse line geometry');
  const annotated = { ...tree, annotations: [note, stroke] };
  validateRelationTree(annotated);
  const annotatedVariant = duplicateRelationTree(annotated, 'new-variant', 'Independent notes', 5);
  const copiedNote = annotatedVariant.annotations![0]; assert(copiedNote.kind === 'text', 'Copied note changed type'); copiedNote.text = 'Changed';
  annotatedVariant.annotations![1].position.x = 300;
  assert(note.text.startsWith('Pasado') && stroke.position.x !== 300 && annotated.nodes === tree.nodes, 'Annotation variants changed their source or canonical entities');
  const annotatedSvg = exportRelationTreeSvg(annotated);
  assert(annotatedSvg.includes('viewBox="-950 -450') && annotatedSvg.includes('<polyline ') && annotatedSvg.includes('&lt;script&gt;') && !annotatedSvg.includes('<script>') && !annotatedSvg.includes('\u0001'), 'SVG annotation bounds or inert escaping failed');
  assert(annotationLines({ ...note, text: '第一行\n\nlast', size: { width: 400, height: 200 } }).join('|') === '第一行||last', 'Multiline annotation wrapping lost blank or Unicode lines');
  passed.push('free text and simplified vector strokes remain independent across variants and export with bounds, multiline Unicode and escaped inert text');

  for (const bad of [
    [{ ...note, id: tree.nodes[0].id }], [note, note], [{ ...note, color: 'url(javascript:bad)' }], [{ ...note, fontSize: Infinity }], [{ ...note, size: { width: 0, height: 40 } }], [{ ...stroke, points: [{ x: 101, y: 3 }] }], [{ ...stroke, position: { x: Infinity, y: 0 } }], [{ ...note, text: 'x'.repeat(20001) }],
  ]) assert(annotationIssues(bad, new Set(tree.nodes.map(node => node.id))).length, 'Malformed, colliding or unbounded annotation accepted');
  assert(!makeTreeStroke('invalid', [{ x: NaN, y: 2 }], '#ffffff', 3) && !makeTreeStroke('bad-color', [{ x: 0, y: 0 }], 'red', 3), 'Invalid stroke generated data');
  const dot = makeTreeStroke('dot', [{ x: 3, y: 7 }], '#ffffff', 2);
  assert(dot && dot.points.length === 2 && !annotationIssues([dot], new Set()).length, 'Single-point pen gesture was lost');
  passed.push('annotation schema rejects unsafe colors, invalid geometry, duplicate identities and oversized text while preserving single-point marks');

  const decorated = { ...annotated, edges: annotated.edges.map(edge => ({ ...edge, label: 'Vínculo <ancestral>', icon: 'Heart' })) };
  const routed = insertTreeJunction(decorated, decorated.edges[0].id, 'junction'); validateRelationTree(routed);
  assert(!decorated.junctions && routed.nodes.length === decorated.nodes.length && routed.edges.length === decorated.edges.length && routed.edges[0].id === decorated.edges[0].id && routed.edges[0].target === decorated.edges[0].target && routed.edges[0].label === decorated.edges[0].label && routed.edges[0].icon === 'Heart', 'Inserting waypoint mutated graph identity, metadata or source');
  const segments = relationTreeSegments(routed);
  assert(segments.length === 2 && segments[0].target === 'junction' && segments[1].source === 'junction' && segments[0].icon === 'Heart' && !segments[1].icon && segments[1].last, 'Render segments duplicated metadata or lost endpoint paths');
  const branch = { id: 'branch', source: 'junction', target: tree.nodes[0].id, kind: 'custom' as const, style: 'dotted' as const };
  const branched = { ...routed, edges: [...routed.edges, branch] }; validateRelationTree(branched);
  const cleaned = removeTreeJunction(branched, 'junction'); validateRelationTree(cleaned);
  assert(!cleaned.junctions?.length && cleaned.edges.length === decorated.edges.length && !cleaned.edges[0].via?.length && cleaned.edges[0].target === decorated.edges[0].target && cleaned.annotations?.length === 2, 'Removing junction did not preserve direct logical relation or clean attached branches');
  const svgJunction = exportRelationTreeSvg(branched);
  assert(svgJunction.includes('<title>Heart</title>') && svgJunction.includes('<circle ') && svgJunction.includes('Vínculo &lt;ancestral&gt;'), 'Portable SVG lost bundled icon, waypoint or safe relationship label');
  passed.push('junction insertion, branching and removal preserve logical relationship identity, kind, labels, icons, annotations and portable SVG');

  const routedCycle = { ...routed, edges: [...routed.edges, { ...branch, source: tree.nodes[1].id, target: 'junction', kind: 'biological_parent' as const }] };
  let junctionCycle = false; try { validateRelationTree(routedCycle); } catch (error) { junctionCycle = error instanceof RelationTreeValidationError && error.issues.some(issue => issue.includes('cycle')); }
  assert(junctionCycle, 'Ancestry cycle through routed junction was accepted');
  for (const malformed of [
    { ...routed, edges: [{ ...routed.edges[0], via: ['missing'] }] },
    { ...routed, edges: [{ ...routed.edges[0], via: ['junction', 'junction'] }] },
    { ...routed, edges: [{ ...routed.edges[0], icon: '__proto__' }] },
    { ...routed, junctions: [{ id: tree.nodes[0].id, position: { x: 0, y: 0 } }] },
    { ...routed, junctions: [{ id: 'junction', position: { x: Infinity, y: 0 } }] },
  ]) { let failed = false; try { validateRelationTree(malformed); } catch { failed = true; } assert(failed, 'Unsafe icon, missing route, duplicate identity or invalid junction accepted'); }
  passed.push('ancestry cycles include routed junctions and validation rejects missing/repeated waypoints, icon injection and invalid geometry');
  return passed;
}
