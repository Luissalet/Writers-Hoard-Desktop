import {createContext, useContext, useLayoutEffect, useRef, type RefObject} from 'react';

interface ToolUndoController {
  undoStep?: number;
  redoStep?: number;
  unrankedUndo?: boolean;
  unrankedRedo?: boolean;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
}
export type ControllerReader = () => ToolUndoController;
export interface UndoAnchorScope {
  element: RefObject<HTMLDivElement | null>;
  parent: UndoAnchorScope | null;
  depth: number;
}
export interface UndoBoundaryScope {
  root: RefObject<HTMLDivElement | null>;
  register(read: ControllerReader, anchor: UndoAnchorScope | null): () => void;
}
export const ToolUndoContext = createContext<UndoBoundaryScope | null>(null);
export const ToolUndoAnchorContext = createContext<UndoAnchorScope | null>(null);
let step = 0;
export const nextLocalToolUndoStep = () => ++step;
export const currentLocalToolUndoStep = () => step;

export function undoScopeContains(boundary: UndoBoundaryScope, anchor: UndoAnchorScope | null, target: Node) {
  const root = boundary.root.current;
  if (!root?.isConnected || !root.contains(target)) return false;
  for (let scope = anchor; scope; scope = scope.parent) {
    const element = scope.element.current;
    if (!element?.contains(target)) return false;
    target = element;
  }
  return root.contains(target);
}

export function useLocalToolUndoController(controller: ToolUndoController | ControllerReader, enabled = true) {
  const boundary = useContext(ToolUndoContext);
  const anchor = useContext(ToolUndoAnchorContext);
  const current = useRef(controller);
  useLayoutEffect(() => { current.current = controller; });
  useLayoutEffect(() => {
    if (!enabled) return;
    return boundary?.register(
      () => typeof current.current === 'function' ? current.current() : current.current,
      anchor,
    );
  }, [boundary, anchor, enabled]);
}
