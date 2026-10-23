import {wikiDocumentLabels} from '@/services/wikiProfiles/documents';
import type { WikiProfileChanges } from '@/services/wikiProfiles/changes';

const button = 'min-h-9 rounded-lg border border-border bg-deep px-3 py-2 text-sm text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50';

/** Per-document list of what changed since the last local edition (added, changed, removed). */
export default function WikiChangesPanel({ result, loading, error, refresh, locale }: { result?: WikiProfileChanges; loading: boolean; error?: string; refresh: () => void; locale: 'es' | 'en' }) {
  const es = locale === 'es';
  const label = { added: es ? 'Nuevo' : 'Added', changed: es ? 'Cambiado' : 'Changed', removed: es ? 'Quitado' : 'Removed' } as const;
  const kind:Record<string,string> = { ...wikiDocumentLabels(locale),entry: es ? 'ficha' : 'card', map: es ? 'mapa' : 'map', timeline: es ? 'cronología' : 'timeline' } as const;
  return <div data-testid="wiki-changes-panel" className="space-y-2 rounded border border-border p-3">
    <div className="flex flex-wrap items-center gap-3">
      <h3 className="font-display text-base">{es ? 'Cambios desde la última edición' : 'Changes since the last edition'}</h3>
      {result?.lastEditionAt != null && <span className="text-xs text-text-muted">{new Date(result.lastEditionAt).toLocaleString(locale)}</span>}
      <button type="button" data-testid="wiki-changes-refresh" className={`${button} ml-auto`} disabled={loading} onClick={refresh}>{loading ? (es ? 'Revisando…' : 'Checking…') : (es ? 'Revisar cambios' : 'Check changes')}</button>
    </div>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {result && <>
      <p data-testid="wiki-changes-count" className="text-sm text-text-muted">{result.count === 0 && !result.configChanged ? (es ? 'Nada ha cambiado desde la última edición.' : 'Nothing changed since the last edition.') : `${result.count} ${es ? (result.count === 1 ? 'documento con cambios' : 'documentos con cambios') : (result.count === 1 ? 'document changed' : 'documents changed')}${result.configChanged ? (es ? ' · la configuración guardada también cambió' : ' · the saved configuration changed too') : ''}`}</p>
      {result.changes.length > 0 && <ul className="max-h-60 space-y-1 overflow-y-auto text-sm">{result.changes.map(item => <li key={`${item.kind}:${item.documentId}`} data-testid="wiki-changes-row" data-change={item.change} className="flex gap-2"><span className="w-20 shrink-0 text-text-muted">{label[item.change]}</span><span className="min-w-0 truncate">{item.title}</span><span className="ml-auto text-xs text-text-muted">{kind[item.kind]}</span></li>)}</ul>}
    </>}
  </div>;
}
