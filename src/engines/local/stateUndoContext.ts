import {createContext, useContext, useLayoutEffect, useRef} from 'react';

interface ToolUndoController {
  undoStep?: number;
  redoStep?: number;
  unrankedUndo?: boolean;
  unrankedRedo?: boolean;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
}
export type ControllerReader = () => ToolUndoController;
export const ToolUndoContext = createContext<((read: ControllerReader) => () => void) | null>(null);
let step = 0;
export const nextLocalToolUndoStep = () => ++step;


export function useLocalToolUndoController(controller: ToolUndoController | ControllerReader) {
  const register = useContext(ToolUndoContext), current = useRef(controller);
  useLayoutEffect(() => { current.current = controller; });
  useLayoutEffect(() => register?.(() => typeof current.current === 'function' ? current.current() : current.current), [register]);
}
