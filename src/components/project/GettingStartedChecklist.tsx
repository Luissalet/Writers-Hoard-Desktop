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

import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronRight, Circle, X, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/i18n/useTranslation';
import { useCodexEntries } from '@/engines/codex/hooks';
import { useWritings } from '@/engines/writings/hooks';
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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { project } = useProject(projectId);
  const { items: codex } = useCodexEntries(projectId);
  const { writings } = useWritings(projectId);

  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(dismissKey(projectId)) === '1';
    } catch {
      return false;
    }
  });
  const [editingProject, setEditingProject] = useState(false);

  // Cheap derivation — no manual useMemo (it made the compiler bail).
  const hasDetails = Boolean(project?.description?.trim());
  const items = [
    { id: 'details', label: t('gettingStarted.nameWorld'), done: hasDetails, action: () => setEditingProject(true) },
    { id: 'character', label: t('gettingStarted.createCharacter'), done: codex.length > 0, action: () => navigate(`/project/${encodeURIComponent(projectId)}/codex`) },
    { id: 'writing', label: t('gettingStarted.firstPage'), done: writings.length > 0, action: () => navigate(`/project/${encodeURIComponent(projectId)}/writings`) },
  ];

  const allDone = items.every((i) => i.done);
  const completed = items.filter((i) => i.done).length;

  // Auto-dismiss when all items complete — but only after a tick so the
  // user sees the "all ✓" state once.
  useEffect(() => {
    if (!allDone || dismissed) return;
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(dismissKey(projectId), '1');
      } catch {
        /* ignore */
      }
      setDismissed(true);
    }, 1500);
    return () => window.clearTimeout(id);
  }, [allDone, dismissed, projectId]);

  if (dismissed) return null;
  // Only show in essentials-mode projects — other modes are for more
  // experienced users who've picked their own toolkit.
  if (project?.mode !== 'essentials') return null;

  const handleDismiss = () => {
    try {
      localStorage.setItem(dismissKey(projectId), '1');
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <>
      <div className="relative rounded-xl border border-accent-gold/40 bg-accent-gold/5 p-4">
        <button
          onClick={handleDismiss}
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
      {editingProject && project && (
        <EditProjectModal
          project={project}
          onClose={() => setEditingProject(false)}
          onSave={changes => updateProject(project.id, changes)}
        />
      )}
    </>
  );
}
