import { useCallback, useEffect } from 'react';
import { requestGhostContinuation } from '@/services/ghostText/ghostTextService';
import { useAiStore } from '@/stores/aiStore';
import { useGhostTextStore } from '@/stores/ghostTextStore';
import type { GhostTextHost } from './GhostTextExtension';

/** What a host hands the editor to switch ghost text on for its document. */
export interface GhostTextBinding {
  /** On only when the writer asked for it AND the app's AI is not switched off. */
  enabled: boolean;
  request: GhostTextHost['request'];
  /** The toolbar button. Absent: the setting is only in Settings. */
  onToggle?: () => void;
}

/** Ghost text for the chapter editors of one project. */
export function useGhostText(projectId: string): GhostTextBinding {
  const chosen = useGhostTextStore((state) => state.enabled);
  const load = useGhostTextStore((state) => state.load);
  const setEnabled = useGhostTextStore((state) => state.setEnabled);
  const aiOn = useAiStore((state) => state.config.enabled);

  useEffect(() => {
    void load();
  }, [load]);

  const request = useCallback<GhostTextHost['request']>(
    ({ before, signal }) => requestGhostContinuation({ projectId, before, signal }),
    [projectId],
  );
  const onToggle = useCallback(() => {
    void setEnabled(!chosen);
  }, [chosen, setEnabled]);

  return { enabled: chosen && aiOn, request, onToggle };
}