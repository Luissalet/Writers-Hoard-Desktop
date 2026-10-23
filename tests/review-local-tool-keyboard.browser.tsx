import {act, StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {LocalToolUndoBoundary} from '@/engines/local/LocalToolUndoBoundary';
import {useLocalToolState} from '@/engines/local/useLocalToolState';
import type {LocalToolClient, LocalToolSnapshot} from '@/engines/local/sdk';
import {COMMAND_CENTRE_SHORTCUT, matchesShortcut} from '@/components/common/shortcuts';

const assert: (value: unknown, message: string) => asserts value = (value, message) => { if (!value) throw Error(message); };
const tick = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
type Value = {value: number};
function fixture(name: string, initial: number) {
  let snapshot: LocalToolSnapshot<Value> = {revision: 0, updatedAt: 1, data: {value: initial}}, next = 0;
  const undo = new Map<string, number>(), redo = new Map<string, number>(), calls: string[] = [];
  const saved = (value: number) => snapshot = {revision: snapshot.revision! + 1, updatedAt: 1, data: {value}};
  const client = {read: async () => structuredClone(snapshot), state: {
    apply: async (_baseline: LocalToolSnapshot<Value>, actions: readonly {value?: unknown}[]) => {
      const receiptId = name + '-' + ++next; undo.set(receiptId, snapshot.data.value);
      calls.push(name + ':apply'); return {snapshot: saved(Number(actions[0].value)), receiptId};
    },
    undo: async (id: string) => {assert(undo.has(id), 'Wrong undo receipt for ' + name);const before = undo.get(id)!; undo.delete(id);const receiptId = name + '-' + ++next;redo.set(receiptId, snapshot.data.value);calls.push(name + ':undo');return {snapshot: saved(before), receiptId};},
    redo: async (id: string) => {assert(redo.has(id), 'Wrong redo receipt for ' + name);const before = redo.get(id)!;redo.delete(id);const receiptId = name + '-' + ++next;undo.set(receiptId, snapshot.data.value);calls.push(name + ':redo');return {snapshot: saved(before), receiptId};},
  }} as unknown as LocalToolClient<Value>;
  return {client, calls, value: () => snapshot.data.value};
}
type State = ReturnType<typeof useLocalToolState<Value>>;
const states = new Map<string, State>();
function Probe({id, client, draft = false}: {id: string; client: LocalToolClient<Value>; draft?: boolean}) {
  const state = useLocalToolState(client, {hasDraft: draft}); states.set(id, state);
  return <section data-probe={id}><button>{id}</button><input/><textarea/><div role="textbox"><button>Nested text button</button></div><output>{state.snapshot?.data.value}</output></section>;
}
async function key(id: string, target = 'button', init: KeyboardEventInit = {}) {
  const node = document.querySelector(`[data-probe="${id}"] ${target}`)!;
  const event = new KeyboardEvent('keydown', {bubbles: true, cancelable: true, ctrlKey: true, key: 'z', ...init});
  await act(async () => {node.dispatchEvent(event);}); await tick();return event;
}
export async function reviewLocalToolKeyboard() {
  const root = createRoot(document.getElementById('root')!), a = fixture('A', 0), b = fixture('B', 100), passed: string[] = [];
  const render = async (draft = false) => {await act(async () => {root.render(<StrictMode><LocalToolUndoBoundary><Probe id="A" client={a.client} draft={draft}/><Probe id="B" client={b.client}/></LocalToolUndoBoundary></StrictMode>);});await tick();};
  try {
    await render();
    await act(async () => {await states.get('A')!.apply([{type: 'set', field: 'value', value: 1}]);});
    await act(async () => {await states.get('B')!.apply([{type: 'set', field: 'value', value: 101}]);});
    assert((await key('A')).defaultPrevented && b.value() === 100 && a.value() === 1, 'Shared boundary did not undo most recent controller');
    await key('B');assert(a.value() === 0, 'Shared boundary did not then undo preceding controller');
    await key('B', 'button', {shiftKey: true});assert(a.value() === 1 && b.value() === 100, 'Redo chronology incorrect');
    await key('A', 'button', {key: 'y'});assert(b.value() === 101, 'Ctrl+Y chronology incorrect');
    passed.push('Two hook instances use chronological command receipt order inside one tool boundary under StrictMode');
    for (const selector of ['input', 'textarea', '[role="textbox"] button']) assert(!(await key('A', selector)).defaultPrevented, 'Native text target intercepted: ' + selector);
    await key('A', 'button', {metaKey: true, ctrlKey: false});assert(b.value() === 100, 'Meta+Z unsupported');
    await render(true);assert(!(await key('A')).defaultPrevented && a.value() === 1, 'Draft controller was undone');
    passed.push('Input/textarea/local textbox retain native Undo; Meta+Z works and unsaved draft disables its controller');
    return passed;
  } finally {await act(async () => {root.unmount();});states.clear();}
}

export async function reviewLocalToolKeyboardRetarget() {
  const root = createRoot(document.getElementById('root')!), a = fixture('old', 0), b = fixture('new', 100);
  const apply = a.client.state!.apply;
  let release!: () => void;
  const hold = new Promise<void>(resolve => {release = resolve;});
  a.client.state!.apply = async (...args) => {await hold;return apply(...args);};
  const render = async (client: LocalToolClient<Value>) => {await act(async () => {root.render(<LocalToolUndoBoundary><Probe id="retarget" client={client}/></LocalToolUndoBoundary>);});await tick();};
  try {
    await render(a.client);
    let pending!: Promise<boolean>;
    await act(async () => {pending = states.get('retarget')!.apply([{type: 'set', field: 'value', value: 1}]);});
    await render(b.client);assert(states.get('retarget')!.snapshot?.data.value === 100, 'New client did not load');
    await act(async () => {release();await pending;});await tick();
    assert(states.get('retarget')!.snapshot?.data.value === 100, 'Late result from old client replaced new client snapshot');
    const event = await key('retarget');assert(!event.defaultPrevented && b.calls.length === 0, 'Old receipt reached new client keyboard Undo');
    return ['Retargeting during an in-flight command never publishes its old snapshot/receipt into the new client'];
  } finally {release();await act(async () => {root.unmount();});states.clear();}
}

export async function reviewLocalToolKeyboardLateFailure() {
  const root = createRoot(document.getElementById('root')!), a = fixture('old-error', 0), b = fixture('new-busy', 100);
  let rejectOld!: () => void, finishNew!: () => void;
  const oldHold = new Promise<void>(resolve => {rejectOld = resolve;}), newHold = new Promise<void>(resolve => {finishNew = resolve;});
  const newApply = b.client.state!.apply;
  a.client.state!.apply = async () => {await oldHold;throw Error('old-client-refused');};
  b.client.state!.apply = async (...args) => {await newHold;return newApply(...args);};
  const render = async (client: LocalToolClient<Value>) => {await act(async () => {root.render(<StrictMode><LocalToolUndoBoundary><Probe id="failure" client={client}/></LocalToolUndoBoundary></StrictMode>);});await tick();};
  let oldPending: Promise<boolean> | undefined, newPending: Promise<boolean> | undefined;
  try {
    await render(a.client);
    await act(async () => {oldPending = states.get('failure')!.apply([{type: 'set', field: 'value', value: 1}]);});
    await render(b.client);
    assert(!states.get('failure')!.busy, 'Old operation kept new client busy');
    await act(async () => {newPending = states.get('failure')!.apply([{type: 'set', field: 'value', value: 101}]);});
    assert(states.get('failure')!.busy, 'New operation was not allowed to start');
    await act(async () => {rejectOld();await oldPending;});await tick();
    assert(!states.get('failure')!.error && states.get('failure')!.busy, 'Old rejection contaminated new error/busy state');
    await act(async () => {finishNew();assert(await newPending, 'New operation was refused');});await tick();
    assert(!states.get('failure')!.busy && states.get('failure')!.snapshot?.data.value === 101, 'New operation did not finish normally');
    assert((await key('failure')).defaultPrevented && b.value() === 100, 'New receipt was not undoable after old rejection');
    return ['Old client rejection cannot clear a new in-flight command or inject its error; new receipt remains undoable'];
  } finally {rejectOld();finishNew();await Promise.all([oldPending, newPending]);await act(async () => {root.unmount();});states.clear();}
}

export async function reviewLocalToolKeyboardGlobal() {
  const root = createRoot(document.getElementById('root')!), a = fixture('global-shortcuts', 0);
  let paletteRequests = 0;
  // GlobalSearch listens on window bubble using this actual shortcut matcher.
  const listener = (event: KeyboardEvent) => {if (matchesShortcut(event, COMMAND_CENTRE_SHORTCUT)) {event.preventDefault();paletteRequests++;}};
  window.addEventListener('keydown', listener);
  try {
    await act(async () => {root.render(<LocalToolUndoBoundary><Probe id="global" client={a.client}/></LocalToolUndoBoundary>);});await tick();
    for (const selector of ['button', 'input']) {
      const before = paletteRequests;
      await key('global', selector, {key: 'k'});
      assert(paletteRequests === before + 1, 'Source tool swallowed the global command-centre shortcut from ' + selector);
    }
    return ['Source tool keyboard Undo isolation preserves the global command-centre shortcut on window bubble'];
  } finally {window.removeEventListener('keydown', listener);await act(async () => {root.unmount();});states.clear();}
}
