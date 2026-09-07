import { ArrowRight, Lightbulb, Network, Plus, Compass } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useProject } from '@/hooks/useProjects';
import { useTranslation } from '@/i18n/useTranslation';
import { openQuickNote } from '@/engines/notes/quickCapture';

/** Entry points into the existing creative tools, kept alongside project context. */
export default function CreativeLaunchpad({ projectId, onDevelop, onOrganize, onManage }: {
  projectId: string;
  onDevelop: () => void;
  onOrganize: () => void;
  onManage: () => void;
}) {
  const { t } = useTranslation();
  const { project } = useProject(projectId);
  const navigate = useNavigate();
  const openEngine = (id: string) => {
    if (!project?.enabledEngines.includes(id)) { onManage(); return; }
    navigate(`/project/${encodeURIComponent(projectId)}/${id}`);
  };
  const actions = [
    { id: 'develop', icon: Lightbulb, title: t('creative.develop'), detail: t('creative.developDetail'), run: onDevelop },
    { id: 'connect', icon: Network, title: t('creative.connect'), detail: t(project?.enabledEngines.includes('board') ? 'creative.connectDetail' : 'creative.enableBoard'), run: () => openEngine('board') },
    { id: 'world', icon: Compass, title: t('creative.world'), detail: t(project?.enabledEngines.includes('worldgen') ? 'creative.worldDetail' : 'creative.enableWorld'), run: () => openEngine('worldgen') },
  ];
  return (
    <section aria-label={t('creative.title')} className="grid gap-7 rounded-xl bg-surface p-6 lg:grid-cols-[1.1fr_1fr] lg:gap-12 lg:p-8">
      <div className="flex flex-col items-start justify-center">
        <h3 className="max-w-lg font-serif text-3xl leading-tight text-text-primary">{t('creative.title')}</h3>
        <p className="mt-3 max-w-lg text-sm leading-relaxed text-text-muted">{t('creative.description')}</p>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button type="button" onClick={openQuickNote} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent-gold px-4 text-sm font-semibold text-deep transition hover:brightness-110">
            <Plus size={17} aria-hidden="true" />{t('creative.capture')}
          </button>
          <button type="button" onClick={onOrganize} className="inline-flex min-h-11 items-center gap-2 text-sm text-text-muted hover:text-text-primary">{t('creative.organize')}<ArrowRight size={15} aria-hidden="true" /></button>
        </div>
      </div>
      <div className="divide-y divide-border">
        {actions.map(action => (
          <button key={action.id} type="button" onClick={action.run} className="group flex min-h-20 w-full items-center gap-4 py-4 text-left">
            <action.icon size={21} className="shrink-0 text-accent-gold" aria-hidden="true" />
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-text-primary group-hover:text-accent-gold">{action.title}</span><span className="mt-1 block text-sm leading-relaxed text-text-muted">{action.detail}</span></span>
            <ArrowRight size={16} className="shrink-0 text-text-dim group-hover:text-accent-gold" aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}
