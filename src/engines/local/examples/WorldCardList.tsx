import type { LocalToolWorldBlockProps } from '../blocks/definitions';
import { useLocalToolWorldList } from '../useLocalToolWorld';
import { useTranslation } from '@/i18n/useTranslation';

export default function WorldCardList({ client }: LocalToolWorldBlockProps) {
  const { locale } = useTranslation(), { rows, loading, error, retry } = useLocalToolWorldList(client, 'codex');
  return <div className="space-y-2">
    {error && <div className="space-y-2"><p role="alert">{error}</p><button type="button" className="min-h-10 rounded border border-border px-3 text-sm" onClick={retry}>{locale === 'es' ? 'Reintentar lectura' : 'Retry reading'}</button></div>}
    {loading && <p role="status">{locale === 'es' ? 'Leyendo fichas…' : 'Reading cards…'}</p>}
    <ul className="m-0 list-none space-y-2 p-0">{rows.map(({ document: { root } }) => <li key={root.id}><button type="button" className="min-h-10 rounded border border-border px-3 text-sm" onClick={() => void client.openDocument('codex', root.id)}>{String(root.title)}</button></li>)}</ul>
    {!loading && !error && !rows.length && <p role="status">{locale === 'es' ? 'No hay fichas en este contexto.' : 'No cards in this context.'}</p>}
  </div>;
}
