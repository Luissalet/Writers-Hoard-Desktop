import {useContext, useLayoutEffect, useState} from 'react';
import type {LocalToolClient, LocalToolHostContext} from './sdk';
import type {LocalToolCommandMount} from './undoCommands';
import {useLocalToolUndoProvider, type LocalToolUndoMode} from './undoProviders';
import type {LocalToolJson} from './stateTypes';
import {
  currentLocalToolUndoStep, nextLocalToolUndoStep, ToolUndoAnchorContext, ToolUndoContext,
  undoScopeContains, useLocalToolUndoController, type UndoAnchorScope, type UndoBoundaryScope,
} from './stateUndoContext';

export interface LocalToolUndoOperation {
  isCurrent(): boolean;
}

export interface LocalToolUndoableCommand<M extends object> {
  label: {en: string; es: string};
  undo(model: M, operation: LocalToolUndoOperation): Promise<boolean>;
  redo(model: M, operation: LocalToolUndoOperation): Promise<boolean>;
  isStale?(model: M, mode: LocalToolUndoMode): boolean;
  batchKey?: string;
}

export interface LocalToolUndoableCommandOptions {
  expose?: {id: string; label?: {en: string; es: string}};
}

interface Group<M extends object> {
  commands: LocalToolUndoableCommand<M>[];
  // The commands below this cursor are applied. The commands above it are undone.
  cursor: number;
  step: number;
  batchKey?: string;
}

interface Binding<M extends object> {
  model: M;
  mount: LocalToolCommandMount;
  boundary: UndoBoundaryScope;
  anchor: UndoAnchorScope | null;
  active: boolean;
  busy: boolean;
  error: string;
  undo: Group<M>[];
  redo: Group<M>[];
  partial?: LocalToolUndoMode;
  lastPushStep?: number;
  exposureId?: string;
  publish(): void;
}

function isCurrent<M extends object>(binding: Binding<M>) {
  if (!binding.active || !binding.mount.isCurrent()) return false;
  const target = binding.anchor ? binding.anchor.element.current : binding.boundary.root.current;
  return !!target && undoScopeContains(binding.boundary, binding.anchor, target);
}

function top<M extends object>(binding: Binding<M>, mode: LocalToolUndoMode) {
  if (!isCurrent(binding) || binding.partial && binding.partial !== mode) return undefined;
  return binding[mode].at(-1);
}

function push<M extends object>(binding: Binding<M>, command: LocalToolUndoableCommand<M>) {
  if (!isCurrent(binding) || binding.busy || binding.partial) return false;
  const {label, undo, redo, isStale, batchKey} = command;
  if (typeof label?.en !== 'string' || !label.en.trim() || typeof label?.es !== 'string' || !label.es.trim() ||
    typeof undo !== 'function' || typeof redo !== 'function' ||
    isStale !== undefined && typeof isStale !== 'function' || batchKey !== undefined && typeof batchKey !== 'string') return false;

  const captured = {label: {en: label.en, es: label.es}, undo, redo, isStale};
  const last = binding.undo.at(-1);
  const join = !!batchKey?.trim() && !!last && last.batchKey === batchKey &&
    last.step === binding.lastPushStep && last.step === currentLocalToolUndoStep();
  const step = nextLocalToolUndoStep();
  if (join) {
    last.commands.push(captured);
    last.cursor++;
    last.step = step;
  } else {
    binding.undo.push({commands: [captured], cursor: 1, step, batchKey});
  }
  binding.lastPushStep = step;
  binding.redo.length = 0;
  binding.error = '';
  binding.publish();
  return true;
}

async function reverse<M extends object>(binding: Binding<M>, mode: LocalToolUndoMode, providerOperation?: LocalToolUndoOperation) {
  if (binding.busy || !top(binding, mode)) return false;
  binding.busy = true;
  binding.error = '';
  binding.publish();
  const operation = {isCurrent: () => isCurrent(binding) && (!providerOperation || providerOperation.isCurrent())};
  try {
    if (!providerOperation && !await binding.mount.checkAccess()) return false;
    if (!operation.isCurrent()) return false;
    const stack = binding[mode];
    const opposite = binding[mode === 'undo' ? 'redo' : 'undo'];
    while (operation.isCurrent()) {
      const group = stack.at(-1);
      if (!group) return false;
      const resumed = binding.partial === mode;
      let applied = false;
      while (mode === 'undo' ? group.cursor > 0 : group.cursor < group.commands.length) {
        if (!operation.isCurrent()) return false;
        const index = mode === 'undo' ? group.cursor - 1 : group.cursor;
        const command = group.commands[index];
        const stale = command.isStale?.(binding.model, mode) ?? false;
        if (!operation.isCurrent()) return false;
        if (stale) {
          group.commands.splice(index, 1);
          if (mode === 'undo') group.cursor--;
          continue;
        }
        const succeeded = await command[mode](binding.model, operation);
        if (!operation.isCurrent()) return false;
        if (succeeded !== true) {
          binding.error = 'local_tool_undoable_command_declined';
          return false;
        }
        applied = true;
        group.cursor += mode === 'undo' ? -1 : 1;
        binding.partial = mode;
      }
      stack.pop();
      binding.partial = undefined;
      binding.lastPushStep = undefined;
      if (group.commands.length) {
        group.step = nextLocalToolUndoStep();
        opposite.push(group);
        return applied || resumed;
      }
    }
    return false;
  } catch (reason) {
    if (operation.isCurrent()) binding.error = reason instanceof Error ? reason.message : String(reason);
    return false;
  } finally {
    binding.busy = false;
    if (operation.isCurrent()) binding.publish();
  }
}

/** Record an inverse after an author has changed its own session model. */
export function useLocalToolUndoableCommand<T extends LocalToolJson, M extends object>(
  client: LocalToolClient<T> | null,
  context: LocalToolHostContext | undefined,
  model: M | null,
  {expose}: LocalToolUndoableCommandOptions = {},
) {
  const boundary = useContext(ToolUndoContext);
  const anchor = useContext(ToolUndoAnchorContext);
  const mount = context?.undoCommands;
  const exposureId = expose?.id;
  const offered = !!client && !!model && !!boundary && !!context?.canEdit && mount?.client === client;
  const [binding, setBinding] = useState<Binding<M>>();
  const [, refresh] = useState(0);
  useLayoutEffect(() => {
    if (!offered || !model || !boundary || !mount || !mount.isCurrent()) return;
    const next: Binding<M> = {
      model, mount, boundary, anchor, exposureId, active: true, busy: false, error: '', undo: [], redo: [],
      publish: () => refresh(value => value + 1),
    };
    setBinding(next);
    return () => { next.active = false; };
  }, [offered, model, boundary, anchor, mount, exposureId]);

  const current = offered && binding && binding.model === model && binding.boundary === boundary &&
    binding.anchor === anchor && binding.mount === mount && binding.exposureId === exposureId &&
    isCurrent(binding) ? binding : undefined;
  const provider = useLocalToolUndoProvider(client, context, current && expose ? {
    ...expose,
    model: current,
    canUndo: journal => !!top(journal, 'undo'),
    canRedo: journal => !!top(journal, 'redo'),
    lastStep: (journal, mode) => top(journal, mode)?.step,
    undo: (journal, operation) => reverse(journal, 'undo', operation),
    redo: (journal, operation) => reverse(journal, 'redo', operation),
  } : null);
  const exposed = expose !== undefined;
  const available = !!current && (!exposed || provider.available);
  const execute = async (mode: LocalToolUndoMode) => {
    if (!current || !available) return false;
    if (!exposed) return reverse(current, mode);
    try { return (await provider[mode]()).applied; }
    catch { return false; }
  };
  useLocalToolUndoController(() => ({
    undoStep: current ? top(current, 'undo')?.step : undefined,
    redoStep: current ? top(current, 'redo')?.step : undefined,
    undo: () => execute('undo'),
    redo: () => execute('redo'),
  }), !exposed);
  return {
    available,
    canUndo: available && !!current && !!top(current, 'undo'),
    canRedo: available && !!current && !!top(current, 'redo'),
    get busy() { return !!current?.busy || provider.busy; },
    error: current?.error || provider.error,
    push: (command: LocalToolUndoableCommand<M>) => !!current && available && !provider.busy && push(current, command),
    undo: () => execute('undo'),
    redo: () => execute('redo'),
  };
}
