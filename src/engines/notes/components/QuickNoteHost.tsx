// ============================================
// Quick note host — mounted once in MainLayout
// ============================================
//
// Three jobs, all of them about capture arriving from outside the Notes tab:
//
//  1. Tell the Electron main process which project the user is looking at, so
//     the floating Ctrl+Shift+N window can offer it as a target.
//  2. Receive notes relayed from that floating window and write them. The
//     floating window never opens Dexie itself — this is the single writer.
//  3. Open an in-app composer when the shortcut fires while the app is focused
//     (Electron's globalShortcut swallows the keydown before the page sees it,
//     so the main process tells us instead). Browsers keep the keydown, hence
//     the DOM listener too — Ctrl+Alt+N, since Chrome reserves Ctrl+Shift+N.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Modal from '@/components/common/Modal';
import { toast } from '@/components/common/toast';
import { useTranslation } from '@/i18n/useTranslation';
import { useLocaleStore } from '@/stores/localeStore';
import { useProject } from '@/hooks/useProjects';
import { captureNote } from '../operations';
import { notifyNotesChanged } from '../hooks';
import { GLOBAL_NOTES_SCOPE } from '../types';
import NoteComposer, { type NoteDraft } from './NoteComposer';

function activeProjectIdFrom(pathname: string): string | null {
  const match = pathname.match(/^\/project\/([^/]+)/);
  return match ? match[1] : null;
}

export default function QuickNoteHost() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const locale = useLocaleStore((s) => s.locale);
  const projectId = useMemo(() => activeProjectIdFrom(pathname), [pathname]);
  const { project } = useProject(projectId ?? undefined);
  const [open, setOpen] = useState(false);
  const [toProject, setToProject] = useState(true);

  const save = useCallback(
    async (scopeId: string, draft: NoteDraft) => {
      const note = await captureNote({
        projectId: scopeId,
        text: draft.text,
        kind: draft.kind,
        source: draft.source,
      });
      if (!note) return;
      notifyNotesChanged();
      toast.success(
        scopeId === GLOBAL_NOTES_SCOPE
          ? t('notes.savedToInbox')
          : `${t('notes.savedTo')} ${project?.title ?? ''}`.trim(),
      );
    },
    [project?.title, t],
  );

  // 1. Report context to the main process.
  useEffect(() => {
    window.electronAPI?.quickNote.setContext({
      projectId,
      projectTitle: project?.title ?? null,
      locale,
    });
  }, [projectId, project?.title, locale]);

  // 2. Notes relayed from the floating window.
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    return api.quickNote.onCapture((payload) => {
      void save(payload.projectId ?? GLOBAL_NOTES_SCOPE, {
        kind: payload.kind,
        text: payload.text,
        tags: [],
      });
    });
  }, [save]);

  // 3a. Shortcut relayed from the main process (app focused).
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    return api.quickNote.onOpenInline(() => {
      setToProject(true);
      setOpen(true);
    });
  }, []);

  // 3b. Same combo bound in the page, for when the OS-level registration
  // didn't happen (web build, or another app already owns the accelerator).
  // Deliberately NOT accepting a Ctrl+Alt variant: on Windows that is AltGr,
  // and swallowing AltGr keystrokes would break typing.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const combo =
        (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n';
      if (!combo) return;
      e.preventDefault();
      setToProject(true);
      setOpen((v) => !v);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const targetId = toProject && projectId ? projectId : GLOBAL_NOTES_SCOPE;

  return (
    <Modal open={open} onClose={() => setOpen(false)} title={t('notes.quickCapture')}>
      <div className="space-y-3">
        {projectId && project && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-dim mr-1">{t('notes.saveIn')}</span>
            <button
              onClick={() => setToProject(true)}
              className={`px-2.5 py-1 rounded-full text-xs border transition truncate max-w-[14rem] ${
                toProject
                  ? 'border-accent-gold text-accent-gold bg-accent-gold/10'
                  : 'border-border text-text-muted hover:text-text-primary hover:bg-elevated'
              }`}
            >
              {project.title}
            </button>
            <button
              onClick={() => setToProject(false)}
              className={`px-2.5 py-1 rounded-full text-xs border transition ${
                !toProject
                  ? 'border-accent-gold text-accent-gold bg-accent-gold/10'
                  : 'border-border text-text-muted hover:text-text-primary hover:bg-elevated'
              }`}
            >
              {t('notes.inbox')}
            </button>
          </div>
        )}
        <NoteComposer
          bare
          autoFocus
          onSubmit={(draft) => {
            void save(targetId, draft);
            setOpen(false);
          }}
        />
      </div>
    </Modal>
  );
}
