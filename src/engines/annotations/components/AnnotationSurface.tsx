// ============================================
// AnnotationSurface — one-line annotation integration for any engine
// ============================================
//
// Every engine that registers an `AnchorAdapter` is a candidate for mounting
// the annotation layer on its detail views. Before this wrapper existed, each
// engine duplicated ~13 lines of JSX to render `<MarginPanel>` + `<BacklinksSection>`
// in a sticky right column. This wrapper collapses that to a single line:
//
//   <AnnotationSurface projectId={pid} engineId="codex" entityId={entry.id} />
//
// Two layout modes cover every host shape we've seen:
//
//   layout="sidebar"  — 320px sticky right column, used by Tiptap-pane views
//                       (writings). Host wraps this in the outer grid.
//   layout="stack"    — full-width vertical stack, used inside modals or
//                       narrow panes (codex detail, seed card, map pin).
//
// The wrapper stays dumb about state: if a host needs to stage a
// text-range `pendingAnchor` (writings editor selection → annotation), it
// passes it through untouched. Hosts without text-range support (codex,
// seeds, maps, yarnboard) simply omit the prop.
//
// Why a wrapper and not direct usage?
//   1. Layout consistency — the `space-y-5 lg:sticky lg:top-4` pattern is
//      duplicated everywhere; easy to drift if each engine re-invents it.
//   2. Future expansion — if we add more annotation surfaces (e.g. a
//      per-engine "Pinned notes" filter, or a collapse toggle), they land
//      here once instead of fanning out across 5+ engines.
//   3. Template-first mandate — 5 engines × 13 lines of identical JSX is
//      exactly the kind of spaghetti the project principles forbid.

import type { ReactNode } from 'react';
import MarginPanel from './MarginPanel';
import BacklinksSection from './BacklinksSection';
import type { AnnotationAnchor } from '../types';

export type AnnotationSurfaceLayout = 'sidebar' | 'stack';

export interface AnnotationSurfaceProps {
  projectId: string;
  engineId: string;
  entityId: string;
  /**
   * Sidebar = 320px sticky right column (writings/Tiptap style).
   * Stack   = full-width vertical stack (modal/detail-pane style).
   * Default: 'sidebar'.
   */
  layout?: AnnotationSurfaceLayout;
  /**
   * Optional text-range anchor the host has staged from a selection.
   * Only writings needs this today; other engines pass nothing.
   */
  pendingAnchor?: AnnotationAnchor | null;
  onPendingAnchorConsumed?: () => void;
  /**
   * Optional custom title for the margin panel header.
   */
  marginTitle?: string;
  /**
   * Optional extra element rendered between MarginPanel and BacklinksSection
   * (e.g. a future "Pinned" filter widget). Kept deliberately open-ended.
   */
  betweenSlot?: ReactNode;
  /** Extra class on the outer wrapper. */
  className?: string;
}

export default function AnnotationSurface({
  projectId,
  engineId,
  entityId,
  layout = 'sidebar',
  pendingAnchor,
  onPendingAnchorConsumed,
  marginTitle,
  betweenSlot,
  className = '',
}: AnnotationSurfaceProps) {
  // Sidebar layout — sticky 320px column, used by writings.
  // Stack layout — flows full-width, used inside modals / narrow panes.
  const layoutClasses =
    layout === 'sidebar'
      ? 'space-y-5 lg:sticky lg:top-4'
      : 'space-y-4';

  return (
    <div className={`${layoutClasses} ${className}`.trim()}>
      <MarginPanel
        projectId={projectId}
        engineId={engineId}
        entityId={entityId}
        pendingAnchor={pendingAnchor}
        onPendingAnchorConsumed={onPendingAnchorConsumed}
        title={marginTitle}
      />
      {betweenSlot}
      <BacklinksSection engineId={engineId} entityId={entityId} />
    </div>
  );
}
