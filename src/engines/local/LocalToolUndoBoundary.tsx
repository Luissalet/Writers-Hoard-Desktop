import {useCallback, useRef, type HTMLAttributes, type KeyboardEvent} from 'react';
import {ToolUndoContext, type ControllerReader} from './stateUndoContext';

/** Reuse state receipts; never take native text editing away from a field. */
export function LocalToolUndoBoundary({children, ...props}: HTMLAttributes<HTMLDivElement>) {
  const readers = useRef(new Set<ControllerReader>());
  const register = useCallback((read: ControllerReader) => {
    readers.current.add(read);
    return () => { readers.current.delete(read); };
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    props.onKeyDown?.(event);
    if (event.defaultPrevented || event.repeat || event.nativeEvent.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    const mode = key === 'z' ? (event.shiftKey ? 'redo' : 'undo') : key === 'y' && event.ctrlKey && !event.shiftKey ? 'redo' : undefined;
    if (!mode) return;
    // Only this tool's Undo belongs here; host shortcuts still reach the shell.
    event.stopPropagation();
    const target = event.target;
    const textField = target instanceof HTMLElement ? target.closest('textarea,[role="textbox"]') : null;
    if (target instanceof HTMLElement && (target.isContentEditable || textField && event.currentTarget.contains(textField) || target instanceof HTMLInputElement && !['button','submit','reset','checkbox','radio','range','color','file'].includes(target.type))) return;
    const field = mode === 'undo' ? 'undoStep' : 'redoStep';
    const ready = [...readers.current].map(read => read()).filter(controller => controller[field] !== undefined).sort((a, b) => b[field]! - a[field]!)[0];
    if (!ready) return;
    event.preventDefault();
    void ready[mode]();
  };
  return <ToolUndoContext.Provider value={register}><div {...props} data-local-tool-undo-boundary onKeyDown={onKeyDown}>{children}</div></ToolUndoContext.Provider>;
}
