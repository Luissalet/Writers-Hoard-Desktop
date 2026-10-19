import { lazy, Suspense, useEffect, useState } from 'react';
import { LibraryBig, Power } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useProjects } from '@/hooks/useProjects';
import { publishingFetch } from './transport';
import { publishingContext } from './context';
import { nativeWindow, setNativeRoute } from './navigation';

const NativeSurface = lazy(() => import('./NativeSurface'));
type Status = Awaited<ReturnType<NonNullable<Window['electronAPI']>['publishing']['status']>>;
const names = {
  es: { library: 'Biblioteca', links: 'Lecturas y enlaces', paperwork: 'Documentos y trámites', publishing: 'Maquetación' },
  en: { library: 'Library', links: 'Reading and links', paperwork: 'Documents and paperwork', publishing: 'Publishing' },
};

export default function PublishingEngine() {
  const { locale } = useTranslation();
  const [status, setStatus] = useState<Status | null>(null);
  const [selected, setSelected] = useState('library');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { projects } = useProjects();
  const [projectId, setProjectId] = useState('');
  const [results, setResults] = useState<Array<{ module: string; kind: string; object_id: string; title: string; artifact?: { route?: string } }>>([]);
  const bridge = window.electronAPI?.publishing;
  const text = names[locale];
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void publishingFetch('/api/agent/call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'wh_publishing_project_results', arguments: { projectId } }) }).then(reply => reply.json()).then(value => { if (active) setResults(value.results || []); }).catch(error => { if (active) setError(String(error)); });
    return () => { active = false; };
  }, [projectId]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('writer:publishing-module', { detail: { module: selected, enabled: status?.enabled.includes(selected) ?? false } }));
  }, [selected, status]);
  useEffect(() => {
    if (!bridge) return;
    let active = true;
    const refresh = () => bridge.status().then(value => { if (active) setStatus(value); }).catch(error => { if (active) setError(String(error)); });
    void refresh();
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [bridge]);
  const retained = (module: string) => status?.modules.find(item => item.id === module)?.state === 'error';
  async function toggle(module: string, enabled: boolean, automatic?: boolean) {
    if (!bridge) return;
    setBusy(true); setError('');
    try { setStatus(await bridge.setModule(module, enabled, automatic)); if (enabled) setSelected(module); }
    catch (error) { setError(String(error)); setStatus(await bridge.status()); }
    finally { setBusy(false); }
  }
  async function linkCurrent() {
    setError('');
    try {
      const context = await publishingContext(selected, locale);
      if (!context.active_objects.length) throw new Error(locale === 'es' ? 'Abre un documento, lectura o publicación para vincularlo.' : 'Open a document, reading or publication to link it.');
      for (const object of context.active_objects) {
        const reply = await publishingFetch('/api/agent/call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'wh_publishing_link_project', arguments: { projectId, module: selected, kind: object.kind, object_id: object.object_id, title: object.title || object.object_id, artifact: { ...object, route: nativeWindow(selected).location.hash } } }) });
        if (!reply.ok) throw new Error(await reply.text());
        setResults((await reply.json()).results);
      }
    } catch (error) { setError(String(error)); }
  }
  async function openResult(result: typeof results[number]) {
    if (!status?.enabled.includes(result.module)) await toggle(result.module, true);
    setSelected(result.module);
    const id = encodeURIComponent(result.object_id);
    setNativeRoute(result.module, result.artifact?.route || (result.module === 'library' ? `#/biblioteca/${id}` : result.module === 'links' ? `#/link/${id}` : result.module === 'paperwork' ? `#/documentos/${id}` : `#/publication/${id}`));
  }
  return <section className="flex h-full min-h-0 flex-col bg-bg-deep text-text-primary">
    <header className="border-b border-border px-6 py-4">
      <h1 className="flex items-center gap-3 font-serif text-xl"><LibraryBig size={22} />{locale === 'es' ? 'Biblioteca y publicación' : 'Library and publishing'}</h1>
      <div className="mt-3 flex flex-wrap gap-2">{Object.entries(text).map(([module, label]) => <div key={module} className="flex rounded border border-border">
        <button className={`px-3 py-2 text-sm ${selected === module ? 'text-accent-gold' : ''}`} onClick={() => setSelected(module)}>{label}</button>
        <button type="button" role="switch" aria-label={retained(module) ? (locale === 'es' ? 'Reintentar cierre: ' : 'Retry OFF: ') + label : label} title={retained(module) ? (locale === 'es' ? 'Reintentar cierre' : 'Retry OFF') : label} aria-checked={status?.enabled.includes(module) ?? false} disabled={!status || busy} className="inline-flex min-h-11 min-w-11 items-center gap-2 border-l border-border px-3 disabled:opacity-50" onClick={() => void toggle(module, retained(module) ? false : !status?.enabled.includes(module))}><Power size={16} />{retained(module) && <span>{locale === 'es' ? 'Reintentar cierre' : 'Retry OFF'}</span>}</button>
      </div>)}</div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <select aria-label={locale === 'es' ? 'Proyecto de Writer' : 'Writer project'} value={projectId} onChange={event => { setProjectId(event.target.value); setResults([]); }} className="rounded border border-border bg-bg-surface px-2 py-1"><option value="">{locale === 'es' ? 'Proyecto de Writer…' : 'Writer project…'}</option>{projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</select>
        <button disabled={!projectId || !status?.enabled.includes(selected)} onClick={() => void linkCurrent()} className="rounded border border-border px-3 py-1 disabled:opacity-40">{locale === 'es' ? 'Vincular lo abierto' : 'Link current objects'}</button>
        {status && <label className="flex items-center gap-2"><input type="checkbox" checked={status.modules.find(module => module.id === selected)?.automatic ?? false} disabled={busy || retained(selected)} onChange={event => void toggle(selected, status.enabled.includes(selected), event.target.checked)} />{locale === 'es' ? 'Automatismos de esta función' : 'Background jobs for this function'}</label>}
      </div>
      {projectId && results.length > 0 && <details className="mt-2 text-sm"><summary>{locale === 'es' ? 'Fuentes y resultados vinculados' : 'Linked sources and outputs'} ({results.length})</summary><ul className="mt-2 space-y-1">{results.map(result => <li key={`${result.module}:${result.kind}:${result.object_id}`}><span className="text-text-muted">{text[result.module as keyof typeof text]} · </span><button onClick={() => void openResult(result)} className="underline">{result.title || result.object_id}</button></li>)}</ul></details>}
      {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
    </header>
    {status?.enabled.includes(selected)
      ? <Suspense fallback={<p aria-busy="true" className="p-6">…</p>}><NativeSurface key={selected} module={selected} /></Suspense>
      : <p className="m-auto max-w-xl p-8 text-center text-text-muted">{!bridge ? (locale === 'es' ? 'Disponible en Writer Desktop.' : 'Available in Writer Desktop.') : locale === 'es' ? 'Activa la función que quieras utilizar. Los motores y automatismos permanecen apagados hasta que los solicitas.' : 'Enable the function you want to use. Engines and background jobs stay off until requested.'}</p>}
  </section>;
}
