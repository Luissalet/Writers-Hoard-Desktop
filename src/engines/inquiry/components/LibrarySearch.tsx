import { useState } from 'react';
import { Library, Search } from 'lucide-react';
import { toast } from '@/components/common/toast';
import { useTranslation } from '@/i18n/useTranslation';
import { FAMILY_APPS, type FamilyApp, type FamilyHit } from '../familySearch';
import { fileFamilyHits, FamilySearchError, searchFamilyLibrary, type FamilyLibrarySearch } from '../library';
import { buttonClass, cardClass, fieldClass, fill, primaryClass } from './styles';

/**
 * Ask the user's other local apps for documents. Nothing is filed until the
 * writer picks a hit; a filed hit is an ungraded source whose excerpt is only
 * the preview the search returned.
 */
export default function LibrarySearch({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [apps, setApps] = useState<FamilyApp[]>([...FAMILY_APPS]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FamilyLibrarySearch | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [filed, setFiled] = useState<Set<string>>(new Set());

  async function search() {
    setBusy(true); setProblem(null); setResult(null); setFiled(new Set());
    try {
      setResult(await searchFamilyLibrary(projectId, query, { apps }));
    } catch (error) {
      setProblem(error instanceof FamilySearchError ? error.code : 'unavailable');
    } finally {
      setBusy(false);
    }
  }

  async function add(hits: FamilyHit[]) {
    if (!result || !hits.length) return;
    try {
      const done = await fileFamilyHits(projectId, hits, result.query);
      setFiled(current => new Set([...current, ...done.map(item => item.hit.ref)]));
      toast.success(fill(t('inquiry.library.added'), { n: done.filter(item => item.created).length }));
    } catch {
      toast.error(t('inquiry.error.unknown'));
    }
  }

  const toggle = (app: FamilyApp) => setApps(current => current.includes(app) ? current.filter(row => row !== app) : [...current, app]);
  const allHits = result ? Object.values(result.apps).flatMap(row => (row?.status === 'ok' ? row.hits : [])) : [];

  return (
    <section className={`${cardClass} space-y-3 p-4`} aria-label={t('inquiry.library.title')} data-testid="library-search">
      <div>
        <h3 className="flex items-center gap-2 font-serif text-sm font-semibold text-text-primary"><Library size={14} /> {t('inquiry.library.title')}</h3>
        <p className="mt-1 text-xs text-text-dim">{t('inquiry.library.hint')}</p>
      </div>
      <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); void search(); }}>
        <input className={`${fieldClass} min-w-0 flex-1`} value={query} maxLength={200} placeholder={t('inquiry.library.query')} aria-label={t('inquiry.library.query')} onChange={event => setQuery(event.target.value)} />
        {FAMILY_APPS.map(app => (
          <label key={app} className="flex items-center gap-1.5 text-xs text-text-dim">
            <input type="checkbox" checked={apps.includes(app)} onChange={() => toggle(app)} /> {t(`inquiry.library.app.${app}`)}
          </label>
        ))}
        <button type="submit" className={primaryClass} disabled={busy || !query.trim() || apps.length === 0}><Search size={14} /> {t('inquiry.entities.search')}</button>
        <button type="button" className={buttonClass} onClick={onClose}>{t('common.close')}</button>
      </form>

      {problem && <p role="alert" className="text-sm text-amber-400">{t(`inquiry.library.error.${problem}`)}</p>}

      {result && (
        <div className="space-y-3" data-testid="library-results">
          {result.redacted.length > 0 && <p role="status" className="text-xs text-text-dim">{fill(t('inquiry.library.redacted'), { names: result.redacted.join(', ') })}</p>}
          {FAMILY_APPS.map(app => {
            const outcome = result.apps[app];
            if (!outcome) return null;
            return (
              <div key={app} data-app={app}>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-text-dim">{t(`inquiry.library.app.${app}`)}</h4>
                {outcome.status === 'unavailable'
                  ? <p role="status" className="mt-1 text-sm text-amber-400">{t(`inquiry.library.problem.${outcome.code}`)}</p>
                  : outcome.hits.length === 0
                    ? <p className="mt-1 text-sm text-text-dim">{t('inquiry.library.noHits')}</p>
                    : (
                      <ul className="mt-1 space-y-2">
                        {outcome.hits.map(hit => (
                          <li key={hit.ref} className="rounded-lg border border-border p-3" data-hit={hit.ref}>
                            <p className="text-sm font-medium text-text-primary">{hit.title}</p>
                            {hit.excerpt && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-text-dim">{hit.excerpt}</p>}
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <button type="button" className={buttonClass} disabled={filed.has(hit.ref)} onClick={() => void add([hit])}>
                                {filed.has(hit.ref) ? t('inquiry.library.filed') : t('inquiry.library.add')}
                              </button>
                              <span className="text-xs text-text-dim">{hit.ref}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
              </div>
            );
          })}
          {allHits.length > 1 && <button type="button" className={buttonClass} onClick={() => void add(allHits.filter(hit => !filed.has(hit.ref)))}>{t('inquiry.library.addAll')}</button>}
          {allHits.length > 0 && <p className="text-xs text-text-dim">{t('inquiry.library.previewNote')}</p>}
        </div>
      )}
    </section>
  );
}
