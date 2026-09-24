// ============================================================================
// FocusChrome — the editor's toolbar while the page has the whole screen
// ============================================================================
//
// Word's Focus view keeps its ribbon behind the top edge: the page is all
// there is until the pointer goes up there, and then the controls slide in
// for as long as they are wanted. This is that, for the chapter editor's
// header row. It is shown once on arrival, long enough to read the hint that
// says how to get out, and from then on only while the pointer is at the top
// edge (an 8px strip that is nothing else) or a control in it has focus —
// Tab from the page reaches it, and it stays while it is being used.
//
// Pure CSS for the reveal — `:hover` and `:focus-within` on a named group —
// so there is no listener on every mouse move over a screen whose whole
// point is that nothing on it stirs.

import { useEffect, useState, type ReactNode } from 'react';

interface FocusChromeProps {
  /** One line under the controls on arrival: how to leave. */
  hint: string;
  children: ReactNode;
}

/** How long the strip stays on arrival, before the page is left alone. */
const PEEK_MS = 2800;

export default function FocusChrome({ hint, children }: FocusChromeProps) {
  const [peek, setPeek] = useState(true);
  useEffect(() => {
    const id = window.setTimeout(() => setPeek(false), PEEK_MS);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div className="group/chrome pointer-events-none fixed inset-x-0 top-0 z-20" data-focus-chrome>
      {/* The edge that wakes it. It has to take the pointer to be hovered;
          nothing else in the wrapper does, so the page under it is not
          shadowed by an invisible box. */}
      <div className="pointer-events-auto absolute inset-x-0 top-0 h-2" aria-hidden="true" />
      <div
        className={`pointer-events-auto border-b border-border bg-surface/95 px-6 py-2 shadow-lg backdrop-blur transition duration-200 ease-out group-hover/chrome:translate-y-0 group-hover/chrome:opacity-100 group-focus-within/chrome:translate-y-0 group-focus-within/chrome:opacity-100 ${
          peek ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'
        }`}
        data-focus-chrome-strip
        data-peek={peek || undefined}
      >
        <div className="mx-auto max-w-6xl">
          {children}
          {peek && (
            <p className="mt-1.5 text-center text-xs text-text-dim">{hint}</p>
          )}
        </div>
      </div>
    </div>
  );
}
