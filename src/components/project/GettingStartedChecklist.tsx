// ============================================
// GettingStartedChecklist — onboarding widget for new projects
// ============================================
//
// Lives at the top of the writings list view (the default landing tab for
// Essentials-mode projects) and disappears in one of three ways:
//
//   1. User completes all three items → auto-dismiss permanently.
//   2. User clicks the × button → dismissed via localStorage.
//   3. User creates a project with a non-'essentials' mode → simply never renders
//      because it's only mounted where it's useful.
//
// Three items — intentionally the minimum for "feels alive, not overwhelming":
//   • Complete the project details (description is non-empty)
//   • Create a character in Codex (codexEntries count > 0)
//   • Write your first page (writings count > 0)
//
// Dismissal key is per-project: `gs-checklist-dismissed:{projectId}`. This
// means re-opening another essentials project still shows the checklist
// until that project's own items complete or are dismissed.
//
// The two dismissal tests come FIRST and the project data is read from a child
// that only mounts once they pass. WritingsView mounts this widget on every
// visit to the Writings tab of every project, and reading the manuscript to
// decide whether to render nothing is the most expensive way to render nothing.

import { useCallback, useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { CheckCircle2, ChevronRight, Circle, X, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/db';
import type { Project } from '@/types';
import { useTranslation } from '@/i18n/useTranslation';
import { useProject } from '@/hooks/useProjects';
import { updateProject } from '@/db/operations';
import EditProjectModal from './EditProjectModal';

interface GettingStartedChecklistProps {
  projectId: string;
}

function dismissKey(projectId: string): string {
  return `gs-checklist-dismissed:${projectId}`;
}

export default function GettingStartedChecklist({ projectId }: GettingStartedChecklistProps) {
  const { project } = useProject(projectId);

  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(dismissKey(projectId)) === '1';
    } catch {
      return false;
    }
  });

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(dismissKey(projectId), '1');
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }, [projectId]);

  if (dismissed) return null;
  // Only show in essentials-mode projects — other modes are for more
  // experienced users who've picked their own toolkit.
  if (project?.mode !== 'essentials') return null;

  return <Checklist projectId={projectId} project={project} onDismiss={dismiss} />;
}

function Checklist({
  projectId,
  project,
  onDismiss,
}: {
  projectId: string;
  project: Project;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [editingProject, setEditingProject] = useState(false);
  // Counts, not rows: the two data items only ask whether anything exists at
  // all, and `count()` answers that from the projectId index alone.
  const [progress, setProgress] = useState({ hasCodexEntry: false, hasWriting: false });

  useEffect(() => {
    const subscription = liveQuery(async () => ({
      hasCodexEntry: (await db.codexEntries.where('projectId').equals(projectId).count()) > 0,
      hasWriting: (await db.writings.where('projectId').equals(projectId).count()) > 0,
    })).subscribe({
      next: setProgress,
      error: error => console.error('Getting started progress could not be read', error),
    });
    return () => subscription.unsubscribe();
  }, [projectId]);

  // Cheap derivation — no manual useMemo (it made the compiler bail).
  const hasDetails = Boolean(project.description?.trim());
  const items = [
    { id: 'details', label: t('gettingStarted.nameWorld'), done: hasDetails, action: () => setEditingProject(true) },
    { id: 'character', label: t('gettingStarted.createCharacter'), done: progress.hasCodexEntry, action: () => navigate(`/project/${encodeURIComponent(projectId)}/codex`) },
    { id: 'writing', label: t('gettingStarted.firstPage'), done: progress.hasWriting, action: () => navigate(`/project/${encodeURIComponent(projectId)}/writings`) },
  ];

  const allDone = items.every((i) => i.done);
  const completed = items.filter((i) => i.done).length;

  // Auto-dismiss when all items complete — but only after a tick so the
  // user sees the "all ✓" state once.
  useEffect(() => {
    if (!allDone) return;
    const id = window.setTimeout(() => onDismiss(), 1500);
    return () => window.clearTimeout(id);
  }, [allDone, onDismiss]);

  return (
    <>
      <div className="relative rounded-xl border border-accent-gold/40 bg-accent-gold/5 p-4">
        <button
          onClick={onDismiss}
          className="absolute top-3 right-3 p-1 rounded-md text-text-dim hover:text-text-primary hover:bg-elevated transition"
          title={t('common.dismiss')}
          aria-label={t('common.dismiss')}
        >
          <X size={14} />
        </button>
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={16} className="text-accent-gold" />
          <h3 className="text-sm font-serif font-semibold text-text-primary">
            {t('gettingStarted.title')}
          </h3>
          <span className="ml-auto mr-6 text-[11px] text-text-dim">
            {completed}/{items.length}
          </span>
        </div>
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={item.action}
                className={`flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-sm transition hover:bg-elevated ${
                  item.done ? 'text-text-dim' : 'text-text-primary'
                }`}
              >
                {item.done ? (
                  <CheckCircle2 size={14} className="flex-shrink-0 text-accent-gold" />
                ) : (
                  <Circle size={14} className="flex-shrink-0 text-text-dim" />
                )}
                <span className={item.done ? 'line-through' : undefined}>{item.label}</span>
                <ChevronRight size={14} className="ml-auto text-text-dim" />
              </button>
            </li>
          ))}
        </ul>
      </div>
      {editingProject && (
        <EditProjectModal
          project={project}
          onClose={() => setEditingProject(false)}
          onSave={changes => updateProject(project.id, changes)}
        />
      )}
    </>
  );
}
