// ============================================
// The shortcuts sheet — what the keyboard does, where
// ============================================
//
// Everything in this panel comes out of `shortcuts.ts`; nothing is written
// down here. That is the whole point: the sheet and the handlers are supposed
// to be the same list seen from two sides, and a panel with its own copy of
// the keys would be wrong within a month.
//
// Same module-singleton shape as `toast`: `<ShortcutsPanel/>` is mounted once
// in MainLayout, and anything that wants to open it — the top bar's button,
// for the writers who never find a key — calls `openShortcutsPanel()` without
// needing a context or a prop drilled through the router.

/* eslint-disable react-refresh/only-export-components --
   the opener and the panel it opens belong in one file, the way `toast` and
   `ToastHost` do. */

import { useEffect, useState } from 'react';
import Modal from './Modal';
import { useTranslation } from '@/i18n/useTranslation';
import { useAppStore } from '@/stores/appStore';
import {
  SHORTCUTS_PANEL_SHORTCUT,
  SHORTCUT_SCOPES,
  chordCaps,
  matchesShortcut,
  shortcutChords,
  shortcutsInScope,
  type Shortcut,
} from './shortcuts';

type Listener = (open: boolean) => void;

let panelOpen = false;
const listeners = new Set<Listener>();

function setPanelOpen(next: boolean): void {
  if (panelOpen === next) return;
  panelOpen = next;
  for (const listener of listeners) listener(panelOpen);
}

/** Opens the sheet from anywhere. */
export function openShortcutsPanel(): void {
  // The command palette is drawn above every modal in the app (z-60 against
  // z-50), so a sheet opened while the palette is up would appear underneath
  // it — which reads exactly like a shortcut that does nothing. Whoever asked
  // for the key list has finished with the palette.
  const { searchOpen, setSearchOpen } = useAppStore.getState();
  if (searchOpen) setSearchOpen(false);
  setPanelOpen(true);
}

/** The keys of one shortcut, printed the way the top bar prints ⌘K. */
function ShortcutKeys({ shortcut }: { shortcut: Shortcut }) {
  const { t } = useTranslation();
  return (
    <>
      {shortcutChords(shortcut).map((chord, chordIndex) => (
        <span key={chord} className="flex items-center gap-1">
          {/* Alternatives, not a sequence: either key does the same thing. */}
          {chordIndex > 0 && <span className="text-[10px] text-text-dim px-0.5">/</span>}
          {chordCaps(chord).map((cap, capIndex) => (
            <kbd
              key={`${chord}-${capIndex}`}
              className="px-1.5 py-0.5 bg-deep border border-border rounded text-[10px] font-mono text-text-muted whitespace-nowrap"
            >
              {cap.localeKey ? t(cap.localeKey) : cap.text}
            </kbd>
          ))}
        </span>
      ))}
    </>
  );
}

/** Mount exactly once (MainLayout). */
export default function ShortcutsPanel() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(panelOpen);

  useEffect(() => {
    listeners.add(setOpen);
    return () => {
      listeners.delete(setOpen);
    };
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.repeat || !matchesShortcut(event, SHORTCUTS_PANEL_SHORTCUT)) return;
      event.preventDefault();
      // Toggling, like the palette: the key that opened it is the one already
      // under the writer's fingers when they have read enough.
      if (panelOpen) setPanelOpen(false);
      else openShortcutsPanel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <Modal open={open} onClose={() => setPanelOpen(false)} title={t('shortcuts.title')} wide>
      <div className="space-y-6">
        <p className="text-xs text-text-muted">{t('shortcuts.subtitle')}</p>

        {SHORTCUT_SCOPES.map((scope) => {
          const rows = shortcutsInScope(scope.id);
          if (rows.length === 0) return null;
          return (
            <section key={scope.id}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-accent-gold">
                {t(scope.titleKey)}
              </h3>
              {/* Where the group's keys are live. Without this line a sheet is
                  a list of promises the app only sometimes keeps. */}
              <p className="mt-0.5 text-[11px] text-text-dim">{t(scope.whereKey)}</p>
              <dl className="mt-2 border-t border-border">
                {rows.map((shortcut) => (
                  <div
                    key={shortcut.id}
                    className="flex items-baseline justify-between gap-4 py-1.5 border-b border-border/50"
                  >
                    <dt className="text-sm text-text-primary min-w-0">
                      {t(shortcut.descriptionKey)}
                    </dt>
                    <dd className="flex items-center gap-1 flex-shrink-0">
                      <ShortcutKeys shortcut={shortcut} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
