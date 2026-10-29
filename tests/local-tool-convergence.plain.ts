import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {defineLocalTool, createLocalToolReplica, type LocalToolDefinition, type LocalToolJson, type LocalToolReplica, type LocalToolConvergenceCheckpoint, type LocalToolConvergenceUpdate, type LocalToolStateAction} from '@/engines/local/sdk';
import {createFakeLocalToolHost} from '@/engines/local/testing';

type Data = {text?: string; legacy: string; labels: Record<string, string>; opaque: {literal: string}};
type Range = {format: string; identity: object; field: string; afterPlacementId: string | null; deleteIds: string[]};
type Sink = (name: string, value: unknown) => void;
const clone = <T>(value: T): T => structuredClone(value);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const units = (text: string) => Array.from({length: text.length}, (_, i) => text.charCodeAt(i));
const initial = (text?: string): Data => ({...(text === undefined ? {} : {text}), legacy: 'Whole-field prose62 unchanged', labels: {kept: 'Literal'}, opaque: {literal: 'Opaque \u0000 Élodie 李明 \ud800'}});
const validate = (value: LocalToolJson): value is Data => !!value && typeof value === 'object' && !Array.isArray(value) && (!Object.hasOwn(value, 'text') || typeof value.text === 'string') && typeof value.legacy === 'string' && !!value.labels && typeof value.labels === 'object' && !Array.isArray(value.labels) && Object.values(value.labels).every(item => typeof item === 'string') && !!value.opaque && typeof value.opaque === 'object' && !Array.isArray(value.opaque) && typeof value.opaque.literal === 'string';

/** SDK and author-kit acceptance only. No Source writer or plain implementation here. */
export async function run(save: Sink) {
  const groups: {name: string; ok: boolean; checks: string[]; failure: unknown}[] = [];
  const replicas = new Set<LocalToolReplica<Data>>(), packetObjects: {name: string; value: unknown; sha256: string}[] = [], files = new Set<string>();
  let created = 0, destroyed = 0, sequence = 0, groupName = '', phase = '', failed = false;
  const observe = (name: string, value: unknown) => save(groupName + '-' + name + '.json', clone(value));
  const keep = <T>(name: string, value: T): T => {
    const copy = clone(value), sha256 = hash(copy), file = 'PACKET-' + sha256 + '.json';
    if (!files.has(file)) { save(file, copy); files.add(file); }
    packetObjects.push({name, value: copy, sha256});
    return copy;
  };
  const reference = (value: unknown) => ({sha256: hash(value), file: 'PACKET-' + hash(value) + '.json'});
  const check = (value: unknown, name: string, checks: string[]) => { assert.ok(value, name); checks.push(name); };
  const same = (a: unknown, b: unknown, name: string, checks: string[]) => { assert.deepStrictEqual(a, b, name); checks.push(name); };
  const make = (checkpoint: LocalToolConvergenceCheckpoint, definition: LocalToolDefinition<Data>, author: string) => {
    const replica = createLocalToolReplica(checkpoint, {authorId: author, contract: {namespace: definition.namespace, codec: definition.codec!, validationId: checkpoint.validationId, schemaEpoch: checkpoint.schemaEpoch, validateState: definition.validateState}});
    replicas.add(replica); created++; return replica;
  };
  const state = (replica: LocalToolReplica<Data>) => {
    const checkpoint = keep('observed-checkpoint', replica.checkpoint());
    return {view: replica.inspect(), checkpoint: reference(checkpoint)};
  };
  const range = (replica: LocalToolReplica<Data>, from: number, to: number): Range => {
    const method = Reflect.get(replica, 'textRange'); assert.equal(typeof method, 'function', 'PUBLIC_SDK_REPLICA_TEXT_RANGE_MISSING');
    const value = Reflect.apply(method, replica, ['text', from, to]);
    assert.equal(value.format, 'writers-hoard-local-plain-range/1'); assert.equal(value.field, 'text');
    assert.equal(new Set(value.deleteIds).size, value.deleteIds.length); return clone(value);
  };
  const splice = (captured: Range, text = '') => ({type: 'text-splice', field: 'text', range: captured, text}) as unknown as LocalToolStateAction;
  const edit = (name: string, replica: LocalToolReplica<Data>, actions: LocalToolStateAction[]) => {
    const reply = replica.apply(actions); keep(name, reply.update); observe(name, {reply: {...reply, update: reference(reply.update)}, after: state(replica)}); return reply;
  };
  const receive = (name: string, replica: LocalToolReplica<Data>, update: LocalToolConvergenceUpdate) => {
    const reply = replica.receive(update); observe(name, {packet: reference(update), reply, after: state(replica)}); return reply;
  };
  const reverse = (name: string, replica: LocalToolReplica<Data>, mode: 'undo' | 'redo', receipt: string | null) => {
    assert.ok(receipt, 'MISSING_RECEIPT_' + name); const reply = replica[mode](receipt);
    keep(name, reply.update); observe(name, {reply: {...reply, update: reference(reply.update)}, after: state(replica)}); return reply;
  };
  async function seed(text?: string, maxLength?: number) {
    const namespace = 'tests.peer-plain-r-' + (++sequence), projectId = 'peer-plain-r-project-' + sequence, documentId = 'peer-plain-r-document-' + sequence;
    let preparedToken: string | null = null;
    const definition = defineLocalTool<Data>({namespace, name: {en: 'Own plain R acceptance', es: 'Aceptación R propia'}, description: {en: 'CPU author-kit fixture', es: 'Fixture RAM del kit'}, initialState: initial(text), codec: {version: 1, fields: {text: {kind: 'prose', collaboration: 'plain-utf16/1'}, legacy: {kind: 'prose'}, labels: {kind: 'map'}}} as unknown as LocalToolDefinition<Data>['codec'], validateState: (value): value is Data => validate(value) && (maxLength === undefined || typeof value.text === 'string' && value.text.length <= maxLength), component: () => null,
      operations: [{id: 'prepare_then_abort', description: {en: 'Prepare and abort', es: 'Preparar y abortar'}, writes: true, inputSchema: {type: 'object', properties: {receipt: {type: 'string'}}, additionalProperties: false}, run: async (input, client) => {
        if (input.receipt) { const reply = await client.state!.undo(String(input.receipt)); preparedToken = reply.receiptId; }
        else {
          const port = client.convergence!, method = Reflect.get(port, 'textRange'); assert.equal(typeof method, 'function', 'PUBLIC_CLIENT_TEXT_RANGE_MISSING');
          const captured = await Reflect.apply(method, port, ['text', 0, 0]);
          const reply = await client.state!.apply(captured.snapshot, [splice(captured.range, 'Uncommitted')]); preparedToken = reply.receiptId;
        }
        throw Error('peer_plain_r_intentional_abort_after_prepare');
      }}]});
    const host = createFakeLocalToolHost(definition, {projects: [{id: projectId, updatedAt: 1, sourceToolDocuments: [{id: documentId, namespace, title: 'Own R', generation: 'generation-' + documentId, revision: 1, createdAt: 1, updatedAt: 1, data: initial(text), codec: definition.codec}]}]}), scope = {projectId}, client = host.createClient(scope, false, documentId);
    const baseline = await client.read(), started = await client.convergence!.start(baseline), G = keep('G-' + sequence, started.checkpoint);
    observe('seed-' + sequence, {baseline, started: {...started, checkpoint: reference(G)}});
    assert.equal(G.engine.version, '2', 'PLAIN_MUST_USE_EXPLICIT_ENGINE2');
    return {definition, host, client, scope, documentId, G, preparedToken: () => preparedToken};
  }
  async function group(name: string, body: (checks: string[]) => Promise<void>) {
    if (failed) return;
    groupName = name; phase = 'begin'; const checks: string[] = []; let failure: unknown = null;
    save('PROGRESS.json', {group: name, phase});
    try { await body(checks); } catch (error) { failure = {phase, message: String(error), stack: (error as Error).stack}; failed = true; }
    const result = {name, ok: !failure, checks, failure}; groups.push(result); save(name + '-RESULT.json', result);
  }
  try {
    await group('g1-utf16-genesis', async checks => {
      const text = '\u0000\ud800A\udc00🙂e\u0301', s = await seed(text), a = make(s.G, s.definition, 'utf16-A'), before = a.checkpoint();
      phase = 'readonly-cold'; const selection = range(a, 0, text.length), opened = make(clone(s.G), s.definition, 'utf16-cold');
      const exported = keep('utf16-readonly-export', a.export()); a.read(); a.inspect();
      observe('readonly-cold', {selection, units: units(a.read().text!), opened: state(opened), exported: reference(exported), after: state(a)});
      same(units(a.read().text!), units(text), 'UTF16_UNITS_EXACT', checks); same(opened.read(), initial(text), 'COLD_UTF16_EXACT', checks);
      same(a.checkpoint(), before, 'READ_RANGE_EXPORT_NO_AUTHOR', checks); same(opened.checkpoint(), s.G, 'COLD_NO_IDS_OR_RESEED', checks);
      check(selection.deleteIds.length === text.length, 'RANGE_IS_UTF16_UNITS', checks);
      const empty = await seed(''), e = make(empty.G, empty.definition, 'empty'); same(range(e, 0, 0).deleteIds, [], 'INITIALIZED_EMPTY_RANGE', checks);
      const absent = await seed(), missing = make(absent.G, absent.definition, 'absent'), stable = missing.checkpoint(); let error = '';
      try { range(missing, 0, 0); } catch (caught) { error = String(caught); }
      observe('absent', {error, before: reference(keep('absent-before', stable)), after: state(missing)});
      check(!!error, 'ABSENT_RANGE_REFUSED', checks); same(missing.checkpoint(), stable, 'ABSENT_RANGE_NO_AUTHOR', checks);
    });
    await group('g2-overlap-undo-spans', async checks => {
      const s = await seed('abcdef'), a = make(s.G, s.definition, 'overlap-A'), b = make(s.G, s.definition, 'overlap-B'), original = range(a, 0, 6).deleteIds;
      phase = 'independent-deletes'; const A = edit('delete-A', a, [splice(range(a, 1, 4))]), B = edit('delete-B', b, [splice(range(b, 3, 5))]);
      const ab = make(s.G, s.definition, 'overlap-AB'), ba = make(s.G, s.definition, 'overlap-BA');
      receive('AB-A', ab, A.update); receive('AB-B', ab, B.update); receive('BA-B', ba, B.update); receive('BA-A', ba, A.update);
      const cold = make(ab.checkpoint(), s.definition, 'overlap-cold'), stable = ab.checkpoint(), replay = receive('replay-A', ab, A.update);
      same(ab.read().text, 'af', 'OVERLAP_AF', checks); same(ba.inspect(), ab.inspect(), 'OVERLAP_AB_BA', checks); same(cold.inspect(), ab.inspect(), 'OVERLAP_COLD', checks);
      check(!replay.causalChanged && !replay.changed, 'REPLAY_NO_NOVELTY', checks); same(ab.checkpoint(), stable, 'REPLAY_BYTES_EXACT', checks);
      receive('ownA-seesB', a, B.update); receive('ownB-seesA', b, A.update);
      phase = 'withdraw-and-reactivate'; const undoA = reverse('undo-A', a, 'undo', A.receiptId); receive('B-sees-undoA', b, undoA.update);
      same(a.read().text, 'abcf', 'UNDO_A_KEEPS_B', checks); const undoB = reverse('undo-B', b, 'undo', B.receiptId); receive('A-sees-undoB', a, undoB.update);
      same(a.read().text, 'abcdef', 'UNDO_B_RESTORES_ORIGINAL', checks); same(range(a, 0, 6).deleteIds, original, 'UNDO_B_ORIGINAL_IDS', checks);
      const redoA = reverse('redo-A', a, 'redo', undoA.receiptId); receive('B-sees-redoA', b, redoA.update); same(a.read().text, 'aef', 'REDO_A_SAME_CONTRIBUTION', checks);
      const redoB = reverse('redo-B', b, 'redo', undoB.receiptId); receive('A-sees-redoB', a, redoB.update); same(a.read().text, 'af', 'REDO_B_SAME_CONTRIBUTION', checks);
      const spans = make(s.G, s.definition, 'separate-spans'); edit('two-spans', spans, [splice(range(spans, 1, 2)), splice(range(spans, 4, 5))]); same(spans.read().text, 'acdf', 'DISCONTINUOUS_SPANS_KEEP_GAP', checks);
      const x = make(s.G, s.definition, 'same-delete-X'), y = make(s.G, s.definition, 'same-delete-Y'), X = edit('same-X', x, [splice(range(x, 1, 2))]), Y = edit('same-Y', y, [splice(range(y, 1, 2))]); receive('X-seesY', x, Y.update); receive('Y-seesX', y, X.update);
      const ux = reverse('same-undo-X', x, 'undo', X.receiptId); receive('Y-sees-undoX', y, ux.update); check(!ux.changed && ux.causalChanged && !!ux.receiptId, 'ECLIPSED_UNDO_IS_CAUSAL_AND_INVERTIBLE', checks); same(x.read().text, 'acdef', 'ECLIPSED_UNDO_KEEPS_REMOTE_DELETE', checks);
      const uy = reverse('same-undo-Y', y, 'undo', Y.receiptId); receive('X-sees-undoY', x, uy.update); same(range(x, 0, 6).deleteIds, original, 'TWO_DELETES_WITHDRAW_ORIGINAL_IDS', checks);
    });
    await group('g3-order-hidden-parent', async checks => {
      const s = await seed('abc'), a = make(s.G, s.definition, 'order-A'), b = make(s.G, s.definition, 'order-B');
      phase = 'same-point'; const A = edit('same-point-X', a, [splice(range(a, 1, 1), 'X')]), B = edit('same-point-Y', b, [splice(range(b, 1, 1), 'Y')]);
      const ab = make(s.G, s.definition, 'order-AB'), ba = make(s.G, s.definition, 'order-BA'); receive('AB-X', ab, A.update); receive('AB-Y', ab, B.update); receive('BA-Y', ba, B.update); receive('BA-X', ba, A.update);
      same(ab.inspect(), ba.inspect(), 'INSERT_ORDER_AB_BA', checks); check(['aXYbc', 'aYXbc'].includes(ab.read().text!), 'INSERTS_ONCE_PER_SHARED_POINT', checks);
      const replayBefore = ab.checkpoint(); receive('order-replay', ab, B.update); same(ab.checkpoint(), replayBefore, 'ORDER_REPLAY_EXACT', checks); same(make(ab.checkpoint(), s.definition, 'order-cold').inspect(), ab.inspect(), 'ORDER_COLD_EXACT', checks);
      const inside = await seed('abcdef'), middle = make(inside.G, inside.definition, 'inside-run'); edit('inside-run', middle, [splice(range(middle, 2, 2), 'M')]); same(middle.read().text, 'abMcdef', 'POINT_INSIDE_RUN_NOT_AFTER_BLOCK', checks);
      const d = make(s.G, s.definition, 'anchor-delete'), i = make(s.G, s.definition, 'anchor-insert'), D = edit('anchor-delete', d, [splice(range(d, 1, 2))]), I = edit('anchor-insert', i, [splice(range(i, 2, 2), 'X')]);
      const di = make(s.G, s.definition, 'anchor-DI'), id = make(s.G, s.definition, 'anchor-ID'); receive('DI-delete', di, D.update); receive('DI-insert', di, I.update); receive('ID-insert', id, I.update); receive('ID-delete', id, D.update); same(di.read().text, 'aXc', 'DELETE_ANCHOR_KEEPS_INSERT', checks); same(di.inspect(), id.inspect(), 'DELETED_ANCHOR_DELIVERY_ORDER', checks);
      phase = 'hide-parent'; const parent = make(s.G, s.definition, 'parent-A'), child = make(s.G, s.definition, 'child-B'), P = edit('insert-parent', parent, [splice(range(parent, 1, 1), 'PQ')]); receive('child-sees-parent', child, P.update);
      const parentIds = range(child, 1, 3).deleteIds, C = edit('insert-child-inside', child, [splice(range(child, 2, 2), 'z')]), childId = range(child, 2, 3).deleteIds; receive('parent-sees-child', parent, C.update);
      same(parent.read().text, 'aPzQbc', 'CHILD_INSIDE_PARENT', checks); const undoP = reverse('hide-parent-undo', parent, 'undo', P.receiptId); same(parent.read().text, 'azbc', 'HIDDEN_PARENT_KEEPS_REMOTE_CHILD', checks); same(range(parent, 1, 2).deleteIds, childId, 'REMOTE_CHILD_ID_RETAINED', checks);
      reverse('hide-parent-redo', parent, 'redo', undoP.receiptId); same(parent.read().text, 'aPzQbc', 'REDO_PARENT_KEEPS_CHILD', checks); same([range(parent, 1, 2).deleteIds[0], range(parent, 3, 4).deleteIds[0]], parentIds, 'REDO_PARENT_ORIGINAL_IDS', checks);
    });
    await group('g4-captured-range-pending-cold', async checks => {
      const s = await seed('abc'), author = make(s.G, s.definition, 'capture-A'); edit('capture-insert-XY', author, [splice(range(author, 1, 1), 'XY')]);
      const captured = range(author, 1, 4), original = clone(captured), other = make(author.checkpoint(), s.definition, 'capture-B'), I = edit('between-captured', other, [splice(range(other, 2, 2), '!')]);
      phase = 'apply-after-intervening-insert'; receive('capture-sees-intervening', author, I.update); edit('delete-captured-cross-runs', author, [splice(captured)]); observe('captured-literal', {captured, original, after: state(author)});
      same(author.read().text, 'a!c', 'CAPTURED_IDS_NOT_RECOMPUTED_OFFSETS', checks); same(captured, original, 'CAPTURE_OBJECT_IMMUTABLE', checks);
      phase = 'child-before-parent'; const p = make(s.G, s.definition, 'pending-parent'), c = make(s.G, s.definition, 'pending-child'), P = edit('pending-parent', p, [splice(range(p, 1, 1), 'UV')]); receive('pending-child-sees-parent', c, P.update);
      const C = edit('pending-child-global', c, [splice(range(c, 2, 2), 'z'), {type: 'map-set', field: 'labels', key: 'child-global', value: 'Depends on parent'}]);
      const early = make(s.G, s.definition, 'early-child'), reply = receive('child-before-parent', early, C.update), pendingCheckpoint = early.checkpoint(), cold = make(clone(pendingCheckpoint), s.definition, 'pending-cold'), coldReplay = receive('cold-replay-still-pending', cold, C.update);
      observe('pending-cold-before-parent', {reply, coldReplay, checkpoint: reference(keep('pending-checkpoint', pendingCheckpoint)), cold: state(cold)});
      check(reply.pending && coldReplay.pending && !coldReplay.causalChanged, 'MISSING_PARENT_PENDING_SURVIVES_COLD_AND_REPLAY', checks); same(early.read(), initial('abc'), 'PENDING_CHILD_TEXT_AND_MAP_NOT_MATERIALIZED', checks); same(cold.checkpoint(), pendingCheckpoint, 'PENDING_COLD_BYTES_EXACT', checks); same(cold.inspect(), early.inspect(), 'PENDING_COLD_ADMITTED_VIEW', checks);
      const completed = receive('cold-gets-parent', cold, P.update), natural = make(s.G, s.definition, 'in-order'); receive('natural-parent', natural, P.update); receive('natural-child', natural, C.update);
      check(!completed.pending, 'PARENT_RESOLVES_PENDING', checks); same(cold.inspect(), natural.inspect(), 'PENDING_COMPLETION_CONVERGES', checks); same(cold.read().text, 'aUzVbc', 'HISTORICAL_RUN_ANCHOR_COMPLETES', checks); same(cold.read().labels['child-global'], 'Depends on parent', 'GLOBAL_CONTEXT_AND_TEXT_COMMIT_TOGETHER', checks);
      const beforeReplay = cold.checkpoint(), replay = receive('completed-child-replay', cold, C.update); check(!replay.causalChanged && !Object.hasOwn(replay, 'receiptId'), 'COMPLETED_REPLAY_NO_AUTHOR_OR_LOCAL_RECEIPT', checks); same(cold.checkpoint(), beforeReplay, 'COMPLETED_REPLAY_BYTES_EXACT', checks);
    });
    await group('g5-p2-fallback-repair', async checks => {
      const s = await seed('abc', 4), a = make(s.G, s.definition, 'p2-A'), b = make(s.G, s.definition, 'p2-B'), A = edit('p2-X', a, [splice(range(a, 0, 0), 'X')]), B = edit('p2-Y', b, [splice(range(b, 3, 3), 'Y')]);
      phase = 'invalid-merge'; const ab = make(s.G, s.definition, 'p2-AB'), ba = make(s.G, s.definition, 'p2-BA'); receive('p2-AB-X', ab, A.update); receive('p2-AB-Y', ab, B.update); receive('p2-BA-Y', ba, B.update); receive('p2-BA-X', ba, A.update);
      const before = ab.inspect(), fallbackRange = range(ab, 0, before.data.text!.length), cold = make(ab.checkpoint(), s.definition, 'p2-cold'); observe('p2-before-repair', {view: before, fallbackRange, cold: state(cold)});
      check(!!before.conflict && (before.conflict.raw as Data).text === 'XabcY', 'RAW_INVALID_CONFLICT_EXPLICIT', checks); check(['Xabc', 'abcY'].includes(before.data.text!), 'AUTHORED_VALID_FALLBACK_ONLY', checks); same(ba.inspect(), before, 'P2_AB_BA_SAME_FALLBACK_AND_RAW', checks); same(cold.inspect(), before, 'P2_COLD_SAME_FALLBACK_AND_RAW', checks);
      check(fallbackRange.deleteIds.length === 4, 'RANGE_BINDS_ADMITTED_FOUR_NOT_RAW_FIVE', checks); same(range(cold, 0, 4), fallbackRange, 'P2_COLD_BINDINGS_EXACT', checks);
      const survivor = before.data.text === 'Xabc' ? 'Y' : 'X', removed = survivor === 'Y' ? 'X' : 'Y', cp = ab.checkpoint(); receive('p2-replay', ab, B.update); same(ab.checkpoint(), cp, 'P2_REPLAY_NO_AUTHORED_SNAPSHOT', checks);
      phase = 'repair-and-reverse'; const repair = edit('repair-admitted-captured', ab, [splice(fallbackRange, 'abc')]);
      check(ab.read().text!.length === 4 && ab.read().text!.split(survivor).length === 2 && !ab.read().text!.includes(removed), 'REPAIR_PRESERVES_UNOBSERVED_REMOTE_UNIT', checks); check(!ab.inspect().conflict, 'REPAIR_VALID_RAW_NO_CONFLICT', checks); const repairedView = ab.inspect();
      const undone = reverse('p2-undo-repair', ab, 'undo', repair.receiptId); same(ab.inspect(), before, 'UNDO_REPAIR_RESTORES_CONFLICT_AND_FALLBACK', checks); same(range(ab, 0, 4), fallbackRange, 'UNDO_REPAIR_RESTORES_BINDINGS', checks);
      reverse('p2-redo-repair', ab, 'redo', undone.receiptId); same(ab.inspect(), repairedView, 'REDO_REPAIR_SAME_ADMITTED_AND_RAW', checks); same(ab.read().opaque, initial('abc').opaque, 'P2_OPAQUE_EXACT', checks);
    });
    await group('g6-kit-save-abort-presence', async checks => {
      const s = await seed('aaaa'), beforeAbort = s.host.inspect(), beforeExport = await s.client.convergence!.export(); phase = 'kit-abort'; let abortError = '';
      try { await s.host.runOperation(s.scope, 'prepare_then_abort', {}, true, s.documentId); } catch (error) { abortError = String(error); }
      observe('kit-abort', {abortError, preparedToken: s.preparedToken(), beforeExport, afterExport: await s.client.convergence!.export(), hostAfter: s.host.inspect()});
      check(abortError.includes('peer_plain_r_intentional_abort_after_prepare'), 'ABORT_AFTER_REAL_KIT_PREPARATION', checks); same(s.host.inspect(), beforeAbort, 'KIT_ABORT_FIXTURE_EXACT', checks);
      same((await s.client.convergence!.export()).checkpoint, beforeExport.checkpoint, 'KIT_ABORT_CHECKPOINT_EXACT', checks); check(!!s.preparedToken(), 'TOKEN_WAS_PREPARED_BEFORE_ABORT', checks);
      const afterAbort = s.host.inspect(); let unavailable = ''; try { await s.client.state!.undo(s.preparedToken()!); } catch (error) { unavailable = String(error); }
      observe('aborted-token-refusal', {unavailable, after: s.host.inspect()}); check(unavailable.includes('receipt_unavailable'), 'ABORTED_TOKEN_NOT_PUBLISHED', checks); same(s.host.inspect(), afterAbort, 'ABORTED_TOKEN_REFUSAL_EXACT', checks);
      const replica = make(s.G, s.definition, 'save-original-ids'), ids = range(replica, 0, 4).deleteIds;
      phase = 'kit-commit-set'; const committed = await s.client.state!.apply(await s.client.read(), [{type: 'set', field: 'text', value: 'aaa'}]); observe('kit-committed-set', committed); check(!!committed.receiptId, 'COMMITTED_SET_RECEIPT', checks);
      let exported = await s.client.convergence!.export(); const setView = make(exported.checkpoint!, s.definition, 'set-reader'); same(range(setView, 0, 3).deleteIds, ids.slice(0, 3), 'SET_AAAA_TO_AAA_KEEPS_FIRST_THREE_IDS', checks);
      const beforeUndoAbort = s.host.inspect(); let undoAbortError = ''; try { await s.host.runOperation(s.scope, 'prepare_then_abort', {receipt: committed.receiptId!}, true, s.documentId); } catch (error) { undoAbortError = String(error); }
      observe('kit-undo-abort', {undoAbortError, after: s.host.inspect()}); check(undoAbortError.includes('peer_plain_r_intentional_abort_after_prepare'), 'UNDO_PREPARED_BEFORE_ABORT', checks); same(s.host.inspect(), beforeUndoAbort, 'UNDO_ABORT_FIXTURE_EXACT', checks);
      const undo = await s.client.state!.undo(committed.receiptId!); same(undo.snapshot.data.text, 'aaaa', 'TOKEN_SURVIVES_ABORT_AND_UNDO_ONCE', checks); const redo = await s.client.state!.redo(undo.receiptId!); same(redo.snapshot.data.text, 'aaa', 'KIT_REDO_EXACT', checks);
      phase = 'kit-save-cas'; const fresh = await seed('aaaa'), original = make(fresh.G, fresh.definition, 'save-ids'), originalIds = range(original, 0, 4).deleteIds, observed = await fresh.client.read();
      const saved = await fresh.client.save({...observed.data, text: 'aaa'}, observed.revision, observed.document!.version); observe('kit-save', saved); exported = await fresh.client.convergence!.export();
      const savedReader = make(exported.checkpoint!, fresh.definition, 'saved-reader'); same(range(savedReader, 0, 3).deleteIds, originalIds.slice(0, 3), 'SAVE_SAME_PRODUCER_FIRST_THREE_IDS', checks); same(saved.data.opaque, initial('aaaa').opaque, 'SAVE_OPAQUE_EXACT', checks);
      await fresh.client.save(saved.data, saved.revision, saved.document!.version); same((await fresh.client.convergence!.export()).checkpoint, exported.checkpoint, 'IDENTICAL_SAVE_CAUSAL_NOOP', checks);
      const stable = fresh.host.inspect(); let staleError = ''; try { await fresh.client.save(observed.data, observed.revision, observed.document!.version); } catch (error) { staleError = String(error); }
      observe('stale-save-refusal', {staleError, after: fresh.host.inspect()}); check(staleError.includes('conflict'), 'STALE_SAVE_CAS_REFUSED', checks); same(fresh.host.inspect(), stable, 'STALE_SAVE_KIT_EXACT', checks);
      phase = 'empty-unset-reopen'; const all = range(savedReader, 0, 3), removed = edit('delete-all', savedReader, [splice(all)]), emptyCold = make(savedReader.checkpoint(), fresh.definition, 'empty-cold'); same(emptyCold.read().text, '', 'DELETE_ALL_COLD_NO_RESEED', checks); same(range(emptyCold, 0, 0).deleteIds, [], 'DELETE_ALL_INITIALIZED_EMPTY', checks);
      edit('unset', savedReader, [{type: 'unset', field: 'text'}]); const unsetBefore = savedReader.checkpoint(); assert.throws(() => range(savedReader, 0, 0)); same(savedReader.checkpoint(), unsetBefore, 'UNSET_READ_RANGE_NO_RESEED', checks);
      edit('reopen', savedReader, [{type: 'set', field: 'text', value: 'aaa'}]); const reopened = range(savedReader, 0, 3); check(reopened.deleteIds.every(id => !originalIds.includes(id)), 'REOPEN_EXPLICIT_IDS_NOT_OLD_UNITS', checks); same(savedReader.read().legacy, initial('aaaa').legacy, 'LEGACY_PROSE_LITERAL', checks); same(savedReader.read().opaque, initial('aaaa').opaque, 'PRESENCE_OPAQUE_LITERAL', checks); keep('delete-all-reply-update', removed.update);
    });
  } finally {
    for (const replica of replicas) { replica.destroy(); destroyed++; } replicas.clear();
    save('CLEANUP.json', {publicReplicasCreated: created, publicReplicasDestroyed: destroyed, allOwnedPublicReplicasDestroyed: created === destroyed, noDBOpened: true, noSourceWriterClaim: true});
  }
  const packetStable = packetObjects.every(row => hash(row.value) === row.sha256);
  const result = {ok: groups.length === 6 && groups.every(group => group.ok) && packetStable && created === destroyed, groups, plannedGroups: 6, pendingGroups: 6 - groups.length, packetStable, packets: packetObjects.map(({name, sha256}) => ({name, sha256})), cleanup: {created, destroyed}, limitations: ['Public SDK replica + existing author-kit RAM only; not Source/Dexie/history/MCP/Native/Browser', 'Source B/C remain separate; no real RW/era/portable/presence-remote claim', 'No cost, rich binding, graphemes, IME, caret or network claim']};
  save('RESULT.json', result); return result;
}
