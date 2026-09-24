import { useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { navigateTo } from '@/engines/_shared/anchoring';
import { useProject } from '@/hooks/useProjects';
import { getArcBeatsForScene } from '@/engines/character-arc/operations';
import { arcBeatPath } from '@/engines/character-arc/beatLinks';
import { useTranslation } from '@/i18n/useTranslation';
import { toast } from '@/components/common/toast';

/**
 * The other half of an arc beat's scene link: which character turns land in
 * this scene. The arc editor could say "this happens in scene 12" and scene 12
 * never knew. Live query rather than a one-shot read — the beat is linked from
 * another tab, and a strip that only reads on mount goes stale the moment the
 * author relinks or deletes a beat.
 */
export default function SceneArcBeats({
  projectId,
  sceneId,
  beforeNavigate,
}: {
  projectId: string;
  sceneId: string;
  /** Flush the scene's buffered fields; `false` keeps the author here. */
  beforeNavigate: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const { project } = useProject(projectId);
  const [busy, setBusy] = useState(false);
  // A switched-off engine hides its data from the author (lesson #40): no
  // strip, and no query either.
  const enabled = project?.enabledEngines.includes('character-arc') ?? false;
  const entries = useLiveQuery(
    () => (enabled ? getArcBeatsForScene(projectId, sceneId) : []),
    [enabled, projectId, sceneId],
  );
  if (!enabled || !entries || entries.length === 0) return null;

  const open = async (path: string) => {
    if (busy) return;
    setBusy(true);
    try {
      if (await beforeNavigate()) navigateTo(path);
      else toast.error(t('dialogScene.arcBeats.navigationFailed'));
    } catch {
      toast.error(t('dialogScene.arcBeats.navigationFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="border-b border-border bg-elevated/10 px-6 py-2 flex flex-wrap items-center gap-2"
      aria-label={t('dialogScene.arcBeats.label')}
      role="group"
    >
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-dim">
        <TrendingUp size={11} className="text-accent-gold/70" aria-hidden="true" />
        {t('dialogScene.arcBeats.label')}
      </span>
      {entries.map(({ beat, arcTitle, arcColor }) => {
        const label = t('dialogScene.arcBeats.open').replace('{arc}', arcTitle).replace('{beat}', beat.title);
        return (
          <button
            key={beat.id}
            type="button"
            disabled={busy}
            onClick={() => { void open(arcBeatPath(projectId, beat.arcId, beat.id)); }}
            title={label}
            aria-label={label}
            className="flex max-w-[16rem] items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] text-text-muted hover:border-accent-gold/40 hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50 transition"
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0 bg-accent-gold"
              style={arcColor ? { backgroundColor: arcColor } : undefined}
              aria-hidden="true"
            />
            <span className="truncate">
              <span className="text-text-dim">{arcTitle} · </span>
              {beat.title}
            </span>
          </button>
        );
      })}
    </div>
  );
}
