// Open/closed and width of the reference panel, remembered per browser.
import { useCallback, useState } from 'react';

const PREFS_KEY = 'writers-hoard:reference:panel';
export const MIN_WIDTH = 280;
export const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 340;
/** Below this window width the panel is a drawer over the editor. */
export const REFERENCE_NARROW_PX = 940;

export interface ReferencePrefs {
  open: boolean;
  width: number;
  setOpen: (open: boolean) => void;
  setWidth: (width: number) => void;
}

const clampWidth = (width: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));

function readPrefs(): { open: boolean; width: number } {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? '{}') as { open?: unknown; width?: unknown };
    return {
      open: parsed.open === true,
      width: typeof parsed.width === 'number' ? clampWidth(parsed.width) : DEFAULT_WIDTH,
    };
  } catch {
    return { open: false, width: DEFAULT_WIDTH };
  }
}

/** Open/closed and width of the panel, remembered per browser. */
export function useReferencePrefs(): ReferencePrefs {
  const [prefs, setPrefs] = useState(readPrefs);
  const update = useCallback((next: { open: boolean; width: number }) => {
    setPrefs(next);
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      // A blocked store only forgets the preference.
    }
  }, []);
  return {
    open: prefs.open,
    width: prefs.width,
    setOpen: (open) => update({ ...prefs, open }),
    setWidth: (width) => update({ ...prefs, width: clampWidth(width) }),
  };
}

