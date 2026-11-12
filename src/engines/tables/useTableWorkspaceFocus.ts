import { useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { WorkspaceFocusContext } from '@/components/project/workspace/workspaceFocus';
import { useEnginePane } from '@/engines/_shared/EnginePaneContext';
import type { LocalToolFocusMode } from '@/engines/local/focusMode';
import { useLocalToolFocusMode } from '@/engines/local/useLocalToolFocusMode';

export function useTableWorkspaceFocus(projectId: string, eraId: string | undefined, documentId: string | undefined) {
  const controller = useContext(WorkspaceFocusContext);
  const pane = useEnginePane(), instanceId = pane?.instanceId, visible = pane?.visible;
  const button = useRef<HTMLButtonElement>(null);
  const visibleRef = useRef(visible);
  useLayoutEffect(() => { visibleRef.current = visible; }, [visible]);
  const target = useMemo(() => controller && instanceId && documentId
    ? { projectId, eraId, namespace: 'tables', documentId, instanceId, exclusivePane: true }
    : undefined, [controller, instanceId, documentId, projectId, eraId]);
  const [binding, setBinding] = useState<{ target: typeof target; port: LocalToolFocusMode }>();

  useLayoutEffect(() => {
    if (!target || !controller) return;
    const bound = controller.bind(target, () => !!visibleRef.current, () => button.current?.focus({ preventScroll: true }));
    setBinding({ target, port: bound.port });
    return bound.dispose;
  }, [controller, target]);

  const focusMode = visible && binding?.target === target ? binding?.port : undefined;
  return { ...useLocalToolFocusMode({ focusMode }), button };
}
