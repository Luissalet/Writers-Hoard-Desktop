import { createContext, useContext } from 'react';

export type OpenBesideGuard = () => boolean | Promise<boolean>;

export interface EnginePaneValue {
  instanceId: string;
  projectId?: string;
  eraId?: string;
  visible: boolean;
  primary?: boolean;
  navigate?: (to: string) => void;
  /** Open a fixed embedded editor’s link without retargeting its owner. */
  openBeside?: (to: string, isCurrent?: OpenBesideGuard) => void | Promise<boolean>;
  reportTitle?: (title: string | undefined) => void;
  width?: number;
  overlayTarget?: HTMLElement | null;
  /** Stable container for editors that coexist with another pane. */
  dialogTarget?: HTMLElement | null;
}
export const EnginePaneContext = createContext<EnginePaneValue | null>(null);
export const useEnginePane = () => useContext(EnginePaneContext);
let lastActivePane: string | undefined;
export interface ActiveEnginePaneScope { projectId: string; eraId?: string; navigate?: (to: string) => void; openBeside?: (to: string, isCurrent?: OpenBesideGuard) => Promise<boolean> }
const paneScopes = new Map<string, ActiveEnginePaneScope>();
/** Focus context for commands outside the pane tree, never a storage-wide active era. */
export function registerEnginePaneScope(instanceId: string, scope: ActiveEnginePaneScope): () => void {
  paneScopes.set(instanceId, scope);
  return () => { if (paneScopes.get(instanceId) === scope) paneScopes.delete(instanceId); };
}
export function getPrimaryEnginePaneOpenBeside(projectId: string) {
  return paneScopes.get(`primary:${projectId}`)?.openBeside;
}
export function getActiveEnginePaneScope(): ActiveEnginePaneScope | undefined {
  const scope = paneScopes.get(lastActivePane ?? '') ?? paneScopes.values().next().value;
  return scope ? { ...scope } : undefined;
}
export function activateEnginePane(instanceId: string) { lastActivePane = instanceId; }
export function getActiveEnginePaneId() { return lastActivePane; }
export function paneReferenceScope(scope: string | undefined, pane: EnginePaneValue | null): string | undefined {
  return scope && pane ? `${pane.instanceId}:${scope}` : scope;
}
/** Window shortcuts belong to the focused pane, including its portal dialogs. */
export function ownsEnginePaneEvent(pane: EnginePaneValue | null, event: Event): boolean {
  if (!pane) return true;
  if (!pane.visible) return false;
  const commandPane = (event as CustomEvent<{ enginePaneId?: string }>).detail?.enginePaneId;
  if (commandPane) return commandPane === pane.instanceId;
  const surface = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-engine-pane-id]') : null;
  const focused = document.activeElement?.closest<HTMLElement>('[data-engine-pane-id]');
  const instanceId = surface?.dataset.enginePaneId ?? focused?.dataset.enginePaneId ?? lastActivePane;
  return instanceId ? instanceId === pane.instanceId : Boolean(pane.primary);
}
export function dispatchEnginePaneCommand(pane: EnginePaneValue | null, name: string) {
  window.dispatchEvent(new CustomEvent(name, { detail: { enginePaneId: pane?.instanceId } }));
}
