import {useContext, useMemo, useRef, type HTMLAttributes, type KeyboardEvent} from 'react';
import {ToolUndoAnchorContext, ToolUndoContext, undoScopeContains, type UndoAnchorScope, type UndoBoundaryScope, type ControllerReader} from './stateUndoContext';

/** Give controllers mounted below this element a local keyboard undo scope. */
export function LocalToolUndoAnchor(props: HTMLAttributes<HTMLDivElement>) {
  const parent = useContext(ToolUndoAnchorContext);
  const element = useRef<HTMLDivElement>(null);
  const anchor = useMemo<UndoAnchorScope>(() => ({element, parent, depth: (parent?.depth ?? 0) + 1}), [parent]);
  return <ToolUndoAnchorContext.Provider value={anchor}><div {...props} ref={element} /></ToolUndoAnchorContext.Provider>;
}

/** Reuse state receipts; never take native text editing away from a field. */
export function LocalToolUndoBoundary({children, ...props}: HTMLAttributes<HTMLDivElement>) {
  const root = useRef<HTMLDivElement>(null);
  const readers = useRef(new Map<ControllerReader, UndoAnchorScope | null>());
  const boundary = useMemo<UndoBoundaryScope>(() => ({
    root,
    register(read, anchor) {
      readers.current.set(read, anchor);
      return () => { readers.current.delete(read); };
    },
  }), []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    props.onKeyDown?.(event);
    if (event.defaultPrevented || event.repeat || event.nativeEvent.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    const mode = key === 'z' ? (event.shiftKey ? 'redo' : 'undo') : key === 'y' && event.ctrlKey && !event.shiftKey ? 'redo' : undefined;
    if (!mode) return;
    const target = event.target;
    if (!(target instanceof Node) || !event.currentTarget.contains(target)) return;
    // Only this tool's Undo belongs here; host shortcuts still reach the shell.
    event.stopPropagation();
    const textField = target instanceof HTMLElement ? target.closest('textarea,[role="textbox"]') : null;
    if (target instanceof HTMLElement && (target.isContentEditable || textField && event.currentTarget.contains(textField) || target instanceof HTMLInputElement && !['button','submit','reset','checkbox','radio','range','color','file'].includes(target.type))) return;
    const field = mode === 'undo' ? 'undoStep' : 'redoStep';
    const unranked = mode === 'undo' ? 'unrankedUndo' : 'unrankedRedo';
    const candidates = [...readers.current]
      .filter(([, anchor]) => undoScopeContains(boundary, anchor, target))
      .map(([read, anchor]) => ({controller: read(), depth: anchor?.depth ?? 0}))
      .filter(({controller}) => controller[unranked] || controller[field] !== undefined);
    candidates.sort((a, b) => b.depth - a.depth ||
      Number(!!b.controller[unranked]) - Number(!!a.controller[unranked]) ||
      (b.controller[field] ?? 0) - (a.controller[field] ?? 0));
    const ready = candidates[0]?.controller;
    if (!ready) return;
    event.preventDefault();
    // Author providers retain their own error feedback; a failed attempt never cascades.
    void ready[mode]().catch(() => undefined);
  };
  return <ToolUndoContext.Provider value={boundary}>
    <ToolUndoAnchorContext.Provider value={null}>
      <div {...props} ref={root} data-local-tool-undo-boundary onKeyDown={onKeyDown}>{children}</div>
    </ToolUndoAnchorContext.Provider>
  </ToolUndoContext.Provider>;
}
