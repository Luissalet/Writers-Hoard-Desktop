import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useProject } from '@/hooks/useProjects';
import { useTranslation } from '@/i18n/useTranslation';
import { deriveNextProjectMove, type DocumentGrowth, type ProjectCockpitData } from '@/services/projectIntelligence';
import { quickCreateEngines, quickCreateProjectDocument, type QuickCreateEngine } from '@/services/projectQuickCreate';
import { getAnchorAdapter } from '@/engines/_shared/anchoring';

export function DocumentGrowthPanel({ growth }: { growth: DocumentGrowth }) {
  const { t, locale } = useTranslation();
  const maximum = Math.max(1, ...growth.months.map(row => row.count));
  return (
    <section aria-label={t('home.growth')} className="rounded-xl border border-border bg-surface p-5">
      <h3 className="font-serif font-semibold text-text-primary">{t('home.growth')}</h3>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-muted">{t('home.growthDetail')}</p>
      {growth.months.length === 0 ? <p className="mt-4 text-sm text-text-muted">{t('home.growthEmpty')}</p> : (
        <div className="mt-4 max-h-64 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-text-muted"><tr><th className="pb-2 font-medium">{t('home.month')}</th><th className="pb-2 text-right font-medium">{t('home.documents')}</th></tr></thead>
            <tbody>{growth.months.map(row => <tr key={row.month}>
              <th scope="row" className="w-32 py-1.5 text-left font-normal text-text-primary">{new Date(`${row.month}-01T12:00:00`).toLocaleDateString(locale, { year: 'numeric', month: 'short' })}</th>
              <td className="py-1.5"><span className="flex items-center gap-3"><span className="h-2 min-w-0 flex-1 bg-elevated" aria-hidden="true"><span className="block h-2 bg-accent-gold" style={{ width: `${row.count / maximum * 100}%` }} /></span><span className="w-10 text-right tabular-nums text-text-primary">{row.count}</span></span></td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
      {growth.undated > 0 && <p className="mt-3 text-xs text-text-muted">{t('home.undated')}: {growth.undated}</p>}
    </section>
  );
}

/** Manual tips and a contextual next action; no background timer or new scheduler. */
export default function ProjectHomeTools({ projectId, data, onReview, onContinue }: {
  projectId: string; data: ProjectCockpitData; onReview: () => void; onContinue: () => void;
}) {
  const { t } = useTranslation(), { project } = useProject(projectId);
  const navigate = useNavigate();
  const [tip, setTip] = useState(0), [engine, setEngine] = useState<QuickCreateEngine | null>(null), [text, setText] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const busyRef = useRef(false);
  const engines = quickCreateEngines(project?.enabledEngines ?? []);
  const move = deriveNextProjectMove(project?.enabledEngines ?? [], data);
  const moveEngine = move === 'write' ? 'writings' : move === 'outline' ? 'outline' : move === 'notes' ? 'notes' : null;
  const choose = (id: QuickCreateEngine) => { setEngine(id); setError(false); };
  const create = async () => {
    if (!engine || !text.trim() || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(false);
    try {
      const created = await quickCreateProjectDocument({ projectId }, engine, text);
      setText(''); setEngine(null);
      const adapter = getAnchorAdapter(engine);
      if (adapter) adapter.navigateToEntity(created.id, projectId, navigate);
      else navigate(`/project/${encodeURIComponent(projectId)}/${engine}`);
    } catch { setError(true); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const control = 'min-h-10 rounded-lg border border-border px-3 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold disabled:opacity-50';
  const secondaryControl = `${control} hover:bg-elevated`;
  return (
    <section className="space-y-5 rounded-xl border border-border bg-surface p-5 text-text-primary">
      <div>
        <h3 className="font-serif font-semibold text-text-primary">{t('home.nextMove')}</h3>
        <p className="mt-2 text-sm text-text-muted">{t(`home.reason.${move}`)}</p>
        <button type="button" className={`${secondaryControl} mt-3`} onClick={() => moveEngine ? choose(moveEngine) : move === 'review' ? onReview() : onContinue()}>{t(`home.move.${move}`)}</button>
      </div>
      {(engines.length > 0 || engine) && <div className="border-t border-border pt-4">
        <div className="flex flex-wrap gap-2" aria-label={t('home.create')}>
          {engines.map(id => <button type="button" key={id} className={secondaryControl} aria-pressed={engine === id} disabled={busy} onClick={() => choose(id)}><span className="inline-flex items-center gap-1.5"><Plus size={14} aria-hidden="true" />{t(`engines.${id}.name`)}</span></button>)}
        </div>
        {engine && <form className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); void create(); }}>
          <label className="block text-sm text-text-muted" htmlFor="home-quick-create">{t('home.newTitle')} · {t(`engines.${engine}.name`)}</label>
          <input autoFocus id="home-quick-create" value={text} onChange={event => setText(event.target.value)} disabled={busy} className="min-h-10 w-full rounded-lg border border-border bg-deep px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-accent-gold" />
          <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy || !text.trim()} className={`${control} bg-accent-gold font-semibold text-deep hover:brightness-110`}>{t(busy ? 'home.creating' : 'home.create')}</button><button type="button" disabled={busy} className={secondaryControl} onClick={() => { setEngine(null); setError(false); }}>{t('home.cancel')}</button></div>
          {error && <p role="alert" className="text-sm text-amber-400">{t('home.createError')}</p>}
        </form>}
      </div>}
      <div className="border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-text-primary">{t('home.tips')}</h3><span className="flex items-center gap-1"><button type="button" aria-label={t('home.tipPrevious')} onClick={() => setTip(value => (value + 2) % 3)} className={secondaryControl}><ChevronLeft size={16} /></button><span className="px-1 text-xs tabular-nums text-text-muted">{tip + 1}/3</span><button type="button" aria-label={t('home.tipNext')} onClick={() => setTip(value => (value + 1) % 3)} className={secondaryControl}><ChevronRight size={16} /></button></span></div>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-muted" aria-live="polite">{t(`home.tip.${tip}`)}</p>
      </div>
    </section>
  );
}
