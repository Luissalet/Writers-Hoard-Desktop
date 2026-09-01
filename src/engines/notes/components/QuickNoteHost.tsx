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
import { getProject, updateProject } from '@/db/operations';
import { captureNote } from '../operations';
import { notifyNotesChanged } from '../hooks';
import { GLOBAL_NOTES_SCOPE } from '../types';
import NoteComposer, { type NoteDraft } from './NoteComposer';

const NOTES_ENGINE_ID = 'notes';

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

  /**
   * Write one captured note and say where it went. Resolves true when a row
   * was actually created — the floating window's "Saved" is derived from this
   * and from nothing else.
   *
   * The target project may not have the Notes engine on: `essentials`, the
   * mode flagged "Recommended" at project creation, enables only writings,
   * codex and outline and merely *suggests* notes. Writing there anyway files
   * the note behind a tab that does not exist — `/project/<id>/notes`
   * redirects to Overview, in-project Cmd+K filters by enabled engines, and
   * all the writer ever sees is a non-clickable "Notes: 1" on the Overview.
   *
   * So the capture turns the tab on instead of quietly re-routing the note.
   * The writer picked that project on the floating window; honouring the
   * target and telling them a tab appeared is a smaller surprise than
   * accepting the target, saying "Saved in My Novel" and filing it elsewhere.
   * Enabling touches only `enabledEngines`/`engineOrder` — no row is created
   * or moved — and EngineManager switches it back off if it isn't wanted.
   */
  const save = useCallback(
    async (scopeId: string, draft: NoteDraft): Promise<boolean> => {
      let targetId = scopeId;
      let targetTitle = '';
      let enabledNotesTab = false;

      if (scopeId !== GLOBAL_NOTES_SCOPE) {
        const target = await getProject(scopeId);
        if (target) {
          targetTitle = target.title;
          if (!target.enabledEngines.includes(NOTES_ENGINE_ID)) {
            await updateProject(target.id, {
              enabledEngines: [...new Set([...target.enabledEngines, NOTES_ENGINE_ID])],
              engineOrder: [...new Set([...target.engineOrder, NOTES_ENGINE_ID])],
            });
            enabledNotesTab = true;
          }
        } else {
          // The project was deleted while the floating window sat on the
          // desktop holding its id. The inbox is the one scope that always
          // exists, so the paragraph lands there rather than nowhere.
          targetId = GLOBAL_NOTES_SCOPE;
        }
      }

      const note = await captureNote({
        projectId: targetId,
        text: draft.text,
        kind: draft.kind,
        source: draft.source,
      });
      if (!note) return false;
      notifyNotesChanged();

      if (targetId === GLOBAL_NOTES_SCOPE) {
        toast.success(
          scopeId === GLOBAL_NOTES_SCOPE
            ? t('notes.savedToInbox')
            : t('notes.savedToInboxProjectGone'),
        );
      } else {
        const where = `${t('notes.savedTo')} ${targetTitle}`.trim();
        toast.success(enabledNotesTab ? `${where} · ${t('notes.notesTabEnabled')}` : where);
      }
      return true;
    },
    [t],
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
  //
  // The floating window is still open with the writer's paragraph in it,
  // waiting on this answer: it keeps the text and shows an error unless we
  // acknowledge the request id, and main fails the submit if we never do. A
  // swallowed rejection here (a quota error, a DatabaseClosedError mid-import)
  // is what used to turn a lost note into a green "Saved".
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    return api.quickNote.onCapture((payload) => {
      void (async () => {
        try {
          const written = await save(payload.projectId ?? GLOBAL_NOTES_SCOPE, {
            kind: payload.kind,
            text: payload.text,
            tags: [],
          });
          api.quickNote.ack({
            requestId: payload.requestId,
            ok: written,
            error: written ? undefined : 'empty',
          });
        } catch (error) {
          api.quickNote.ack({
            requestId: payload.requestId,
            ok: false,
            error: error instanceof Error ? error.message : 'write-failed',
          });
        }
      })();
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
      // Open only — never toggle. `Modal` unmounts its children on close, so
      // hitting the capture shortcut again out of habit while the composer was
      // already open threw away everything typed into it, with no warning and
      // no undo.
      setToProject(true);
      setOpen((v) => {
        if (v) return v;
        return true;
      });
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
            // The modal unmounts on close, so a rejected write has nowhere to
            // surface but a toast — silence here is the same lost note.
            void save(targetId, draft).catch(() => toast.error(t('notes.saveFailed')));
            setOpen(false);
          }}
        />
      </div>
    </Modal>
  );
}
