import { useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import { Download, Loader2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { buildWorldBible, saveWorldBibleArtifact, loadBibleData, bibleCopy, BIBLE_SECTIONS, type BibleData, type BibleSection, type BibleSelection } from '@/services/worldBible';
import { worldBiblePanelCopy } from '@/services/worldBible/copy';
import { canExportPdf } from '@/engines/writings/manuscriptExport';

export default function WorldBiblePanel({ projectId }: { projectId: string }) {
  const { locale } = useTranslation();
  const lang = locale === 'es' ? 'es' : 'en';
  const copy = bibleCopy(lang);
  const ui = worldBiblePanelCopy(lang);
  const [state, setState] = useState<{ projectId: string; data?: BibleData; error?: boolean }>({ projectId });
  const [selection, setSelection] = useState<BibleSelection>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  useEffect(() => {
    const subscription = liveQuery(() => loadBibleData(projectId)).subscribe({ next: data => setState({ projectId, data }), error: () => setState({ projectId, error: true }) });
    return () => subscription.unsubscribe();
  }, [projectId]);
  const data = state.projectId === projectId ? state.data : undefined;
  const artifact = useMemo(() => {
    if (!data) return null;
    // Deleted rows leave the selection clean without accidentally selecting others.
    const clean: BibleSelection = { ...selection, locale: lang };
    for (const [key, rows] of [['entryIds', data.entries], ['timelineIds', data.timelines], ['mapIds', data.maps], ['relationshipIds', data.relationships]] as const) {
      if (clean[key]) clean[key] = clean[key]!.filter(id => rows.some(row => row.id === id));
    }
    return { document: buildWorldBible(data, clean), selection: clean };
  }, [data, selection, lang]);
  async function save(format: 'html' | 'pdf') {
    if (!artifact) return;
    setBusy(true); setNotice(undefined);
    try {
      const result = await saveWorldBibleArtifact(artifact.document, format);
      setNotice({ text: result.ok ? ui.saved : 'canceled' in result && result.canceled ? ui.canceled : ui.failed, error: !result.ok && !('canceled' in result && result.canceled) });
    } catch { setNotice({ text: ui.failed, error: true }); }
    finally { setBusy(false); }
  }
  function toggleSection(section: BibleSection, checked: boolean) {
    const previous = selection.sections ?? [...BIBLE_SECTIONS];
    setSelection({ ...selection, sections: checked ? [...previous, section] : previous.filter(value => value !== section) });
  }
  function toggleRow(key: 'entryIds' | 'timelineIds' | 'mapIds' | 'relationshipIds', rows: { id: string }[], id: string, checked: boolean) {
    const previous = selection[key] ?? rows.map(row => row.id);
    setSelection({ ...selection, [key]: checked ? [...previous, id] : previous.filter(value => value !== id) });
  }
  if (state.projectId === projectId && state.error) return <p role="alert">{ui.error}</p>;
  if (!data || !artifact) return <p role="status">{ui.loading}</p>;
  const groups = [
    { section: 'codex' as const, key: 'entryIds' as const, rows: data.entries.map(row => ({ id: row.id, title: row.title })) },
    { section: 'timeline' as const, key: 'timelineIds' as const, rows: data.timelines.map(row => ({ id: row.id, title: row.title })) },
    { section: 'maps' as const, key: 'mapIds' as const, rows: data.maps.map(row => ({ id: row.id, title: row.title })) },
    { section: 'relationships' as const, key: 'relationshipIds' as const, rows: data.relationships.filter(row => selection.includeSecrets || row.state !== 'secret').map(row => ({ id: row.id, title: `${row.entityAName} ${row.directional ? '→' : '↔'} ${row.entityBName}${row.state === 'secret' ? ` (${copy.secret})` : ''}` })) },
  ];
  return <section aria-label={copy.title} className="rounded-xl border border-border bg-surface p-5">
    <h3 className="font-serif font-semibold text-text-primary">{copy.title}</h3>
    <p className="mt-1 text-sm text-text-muted">{ui.detail}</p>
    <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)]">
      <div>
        <fieldset disabled={busy}><legend className="mb-3 text-sm font-medium">{ui.select}</legend>
          {groups.map(group => <div key={group.section} className="mb-3 rounded-lg border border-border p-3">
            <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={(selection.sections ?? BIBLE_SECTIONS).includes(group.section)} onChange={event => toggleSection(group.section, event.target.checked)} />{copy[group.section]} ({artifact.document.counts[group.section]})</label>
            <details className="mt-2"><summary className="cursor-pointer text-xs text-text-muted">{copy[group.section]} · {group.rows.length}</summary>
              <div className="mt-2 max-h-52 space-y-2 overflow-auto">{group.rows.map(row => <label key={row.id} className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={selection[group.key] === undefined || selection[group.key]!.includes(row.id)} onChange={event => toggleRow(group.key, group.rows, row.id, event.target.checked)} /><span className="break-words">{row.title}</span></label>)}{!group.rows.length && <p className="text-xs text-text-muted">{ui.empty}</p>}</div>
            </details>
          </div>)}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={!!selection.includeSecrets} onChange={event => setSelection({ ...selection, includeSecrets: event.target.checked })} />{ui.secrets}</label>
        </fieldset>
        <p className="mt-3 text-xs text-text-muted">{ui.caveat}</p>
      </div>
      <div className="min-w-0">
        <iframe title={ui.preview} sandbox="" srcDoc={artifact.document.html.replace('<head>', '<head><base href="about:srcdoc">')} className="h-[32rem] w-full rounded-lg border border-border bg-white" />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void save('html')} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">{busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}{ui.html}</button>
          <button type="button" disabled={busy || !canExportPdf()} onClick={() => void save('pdf')} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"><Download size={15} />{ui.pdf}</button>
        </div>
        {!canExportPdf() && <p className="mt-2 text-xs text-text-muted">{ui.pdfDetail}</p>}
        {notice && <p role={notice.error ? 'alert' : 'status'} className="mt-2 text-sm">{notice.text}</p>}
      </div>
    </div>
  </section>;
}
