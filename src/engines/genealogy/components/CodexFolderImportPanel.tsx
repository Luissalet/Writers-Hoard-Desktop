import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { FolderOpen, Files, Undo2 } from 'lucide-react';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { useTranslation } from '@/i18n/useTranslation';
import type { CodexFolderInput, CodexFolderPreview as Preview, CodexImportFormat as ImportFormat, CodexImportDecision } from '../codexFolderImport';
import type { CodexEntryType } from '@/types';
import { useEraProject, useWorldEraScope } from '@/services/worldEras/hooks';
import { selectableCodexTemplates, templatePath } from '@/engines/codex/templateHierarchy';
import WorldFolderImportPanel from '@/components/import/WorldFolderImportPanel';
type SourceFile = CodexFolderInput['files'][number];
type ImportReply = {
  preview?: Preview;
  applyId?: string;
  createdIds?: string[];
  removedIds?: string[];
};

export default function CodexFolderImportPanel({ projectId, onChanged }: {
  projectId: string;
  onChanged: () => void;
}) {
  const { t, locale } = useTranslation();
  const scope = useWorldEraScope(projectId), project = useEraProject(projectId), templates = project?.codexTemplates ?? [];
  const copy = locale === 'es' ? { include: 'Incluir', title: 'Título de destino', category: 'Categoría', template: 'Plantilla', none: 'Sin plantilla', content: 'Revisar contenido', plan: 'Revisa títulos y tipos antes de importar. Los originales se conservan completos.' } : { include: 'Include', title: 'Destination title', category: 'Category', template: 'Template', none: 'No template', content: 'Review content', plan: 'Review titles and types before importing. Complete original sources are retained.' };
  const formatId = useId();
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const [format, setFormat] = useState<ImportFormat>('obsidian');
  const [sources, setSources] = useState<SourceFile[]>([]);
  const [unsupported, setUnsupported] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [decisions, setDecisions] = useState<Record<string, CodexImportDecision>>({});
  const edit = (id: string, patch: Partial<CodexImportDecision>) => setDecisions(current => ({ ...current, [id]: { ...current[id], id, ...patch } }));
  const included = preview?.additions.filter(entry => decisions[entry.id]?.include !== false) ?? [];
  const invalidTitle = included.some(entry => !(decisions[entry.id]?.title ?? entry.title).trim());
  const [busy, setBusy] = useState<'reading' | 'working' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<{ applyId: string; count: number }[]>([]);
  const files = useMemo(() => sources.filter(file => /\.(md|markdown)$/i.test(file.path)
    || ((format === 'worldanvil' || format === 'campfire') && /\.json$/i.test(file.path))), [sources, format]);
  const omitted = unsupported + sources.length - files.length;

  useEffect(() => {
    generation.current++;
    setSources([]); setUnsupported(0); setPreview(null); setReceipts([]); setDecisions({});
    setBusy(null); setError(null); setStatus(null);
  }, [projectId, scope.eraId]);

  const readFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const current = ++generation.current;
    setBusy('reading'); setError(null); setStatus(null); setPreview(null); setDecisions({});
    const selected = Array.from(list);
    const supported = selected.filter(file => /\.(md|markdown|json)$/i.test(file.name));
    try {
      const read = await Promise.all(supported.map(async file => ({
        path: file.webkitRelativePath || file.name,
        text: await file.text(),
      })));
      if (generation.current !== current) return;
      setSources(read); setUnsupported(selected.length - supported.length);
    } catch (err) {
      if (generation.current === current) setError(`${t('genealogy.import.failure')}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (generation.current === current) setBusy(null);
    }
  };

  const perform = async (operation: 'preview' | 'apply' | 'undo') => {
    const current = generation.current;
    setBusy('working'); setError(null); setStatus(null);
    try {
      const reply = await runBridgeTool(`wh_codex_import_${operation}`, operation === 'undo'
        ? { projectId, eraId: scope.eraId, applyId: receipts.at(-1)?.applyId }
        : { projectId, eraId: scope.eraId, format, files, ...(operation === 'apply' ? { decisions: Object.values(decisions) } : {}) });
      if (generation.current !== current) return;
      if (!reply.ok) {
        setError(reply.code === 'stale_import' ? t('genealogy.import.stale') : `${t('genealogy.import.failure')}: ${reply.error || reply.code}`);
        return;
      }
      const result = reply.result as ImportReply;
      if (result.preview) setPreview(result.preview);
      if (operation === 'apply' && result.applyId) {
        const count = result.createdIds?.length ?? 0;
        setReceipts(previous => [...previous, { applyId: result.applyId!, count }]);
        setStatus(`${count} ${t('genealogy.import.added')}`);
        // A new preview reflects what is now stored; never offer the old additions twice.
        setPreview(null); setDecisions({});
        onChanged();
      }
      if (operation === 'undo') {
        setReceipts(previous => previous.slice(0, -1));
        setPreview(null);
        setStatus(`${result.removedIds?.length ?? 0} ${t('genealogy.import.removed')}`);
        onChanged();
      }
    } catch (err) {
      if (generation.current === current) setError(`${t('genealogy.import.failure')}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (generation.current === current) setBusy(null);
    }
  };

  return (
    <section className="codex-folder-import" aria-labelledby={`${formatId}-title`} data-testid="codex-folder-import">
      <header>
        <h3 id={`${formatId}-title`}>{t('genealogy.import.title')}</h3>
        <p>{t('genealogy.import.help')}</p>
      </header>
      <div className="codex-import-source">
        <label htmlFor={formatId}>{t('genealogy.import.format')}</label>
        <select id={formatId} value={format} disabled={!!busy} data-testid="codex-import-format" onChange={event => {
          generation.current++; setFormat(event.target.value as ImportFormat); setPreview(null); setDecisions({}); setError(null); setStatus(t('genealogy.import.changed'));
        }}>
          <option value="obsidian">Obsidian</option><option value="notion">Notion</option>
          <option value="worldanvil">World Anvil</option><option value="campfire">Campfire</option>
        </select>
        <button type="button" disabled={!!busy} onClick={() => folderInput.current?.click()}><FolderOpen size={16} aria-hidden="true" />{t('genealogy.import.folder')}</button>
        <button type="button" disabled={!!busy} onClick={() => filesInput.current?.click()}><Files size={16} aria-hidden="true" />{t('genealogy.import.files')}</button>
        <input ref={folderInput} type="file" multiple {...{ webkitdirectory: '' }} tabIndex={-1} className="codex-import-file-input" data-testid="codex-import-folder-files" aria-label={t('genealogy.import.folder')} disabled={!!busy} onChange={event => { void readFiles(event.target.files); event.target.value = ''; }} />
        <input ref={filesInput} type="file" multiple accept=".md,.markdown,.json" tabIndex={-1} className="codex-import-file-input" data-testid="codex-import-files" aria-label={t('genealogy.import.files')} disabled={!!busy} onChange={event => { void readFiles(event.target.files); event.target.value = ''; }} />
      </div>
      <div className="codex-import-actions">
        <span data-testid="codex-import-file-count">{files.length} {t('genealogy.import.selected')}{omitted > 0 && ` · ${omitted} ${t(omitted === 1 ? 'genealogy.import.skippedOne' : 'genealogy.import.skipped')}`}</span>
        <button type="button" disabled={!!busy || files.length === 0} data-testid="codex-import-preview" onClick={() => void perform('preview')}>{t('genealogy.import.preview')}</button>
        {receipts.length > 0 && <button type="button" disabled={!!busy} data-testid="codex-import-undo" onClick={() => void perform('undo')}><Undo2 size={16} aria-hidden="true" />{t('genealogy.import.undo')} ({receipts.at(-1)!.count})</button>}
      </div>
      {sources.length > 0 && files.length === 0 && <p className="codex-import-feedback">{t('genealogy.import.empty')}</p>}
      {busy && <p role="status" className="codex-import-feedback">{t(busy === 'reading' ? 'genealogy.import.reading' : 'genealogy.import.working')}</p>}
      {error && <p role="alert" className="codex-import-error" data-testid="codex-import-error">{error}</p>}
      {status && <p role="status" className="codex-import-feedback" data-testid="codex-import-status">{status}</p>}
      {preview && <>
        <p className="text-sm text-text-muted">{copy.plan}</p>
        <div className="codex-import-summary" data-testid="codex-import-summary">
          <span>{t('genealogy.import.additions')}: <strong data-testid="codex-import-additions-count">{preview.additions.length}</strong></span>
          <span>{t('genealogy.import.duplicates')}: <strong data-testid="codex-import-duplicates-count">{preview.duplicates.length}</strong></span>
          <span>{t('genealogy.import.conflicts')}: <strong data-testid="codex-import-conflicts-count">{preview.conflicts.length}</strong></span>
          <span>{t('genealogy.import.issues')}: <strong data-testid="codex-import-issues-count">{preview.issues.length}</strong></span>
        </div>
        <ul className="codex-import-preview-list" data-editable-plan data-testid="codex-import-preview-list">
          {preview.additions.map(entry => {
            const decision = decisions[entry.id], include = decision?.include !== false;
            return <li key={`add:${entry.path}:${entry.id}`} data-testid="codex-import-plan-row">
              <div className="flex w-full min-w-0 items-center gap-3"><input type="checkbox" checked={include} disabled={!!busy} onChange={event => edit(entry.id, { include: event.target.checked })} aria-label={`${copy.include} ${entry.path}`} /><span className="min-w-0 flex-1 break-words">{entry.path}</span></div>
              <div className="grid w-full min-w-0 gap-3 sm:grid-cols-2">
                <label className="min-w-0 text-xs text-text-muted">{copy.title}<input type="text" className="mt-1 w-full min-w-0 rounded border border-border bg-elevated px-2.5 py-2 text-sm text-text-primary focus:outline-accent-gold" aria-label={`${copy.title}: ${entry.path}`} value={decision?.title ?? entry.title} required disabled={!include || !!busy} onChange={event => edit(entry.id, { title: event.target.value })} /></label>
                <label className="min-w-0 text-xs text-text-muted">{copy.category}<select className="mt-1 w-full min-w-0" aria-label={`${copy.category}: ${entry.path}`} disabled={!include || !!busy} value={decision?.type ?? entry.type} onChange={event => edit(entry.id, { type: event.target.value as CodexEntryType, templateId: '' })}>{(['character','location','item','faction','concept','magic','custom'] as const).map(type => <option key={type} value={type}>{t(`codex.types.${type}`)}</option>)}</select></label>
                {!!templates.length && <label className="min-w-0 text-xs text-text-muted sm:col-span-2">{copy.template}<select className="mt-1 w-full min-w-0" aria-label={`${copy.template}: ${entry.path}`} value={decision?.templateId ?? ''} disabled={!include || !!busy} onChange={event => { const template = templates.find(row => row.id === event.target.value); edit(entry.id, { templateId: event.target.value, ...(template ? { type: template.category } : {}) }); }}><option value="">{copy.none}</option>{selectableCodexTemplates(templates, decision?.templateId).map(template => <option key={template.id} value={template.id}>{templatePath(template, templates)}</option>)}</select></label>}
              </div>
              <details className="w-full min-w-0 text-xs text-text-muted"><summary className="cursor-pointer py-1 focus-visible:outline-accent-gold">{copy.content}</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-body text-sm text-text-primary">{entry.body}</pre></details>
            </li>;
          })}
          {preview.duplicates.map((entry, index) => <li key={`dup:${index}`}><strong>{t('genealogy.import.duplicates')}</strong><span>{entry.path}</span></li>)}
          {preview.conflicts.map((entry, index) => <li key={`conflict:${index}`}><strong>{t('genealogy.import.conflicts')}</strong><span>{entry.path} · {entry.reason === 'source_changed_or_id_occupied' ? t('genealogy.import.conflictSource') : entry.reason}</span></li>)}
          {preview.issues.map((issue, index) => <li key={`issue:${index}`}><strong>{t('genealogy.import.issues')}</strong><span>{issue.path || `#${issue.index + 1}`} · {issue.message === 'Unclosed Markdown frontmatter.' ? t('genealogy.import.frontmatterOpen') : issue.message}</span></li>)}
        </ul>
        <button type="button" className="codex-import-apply" disabled={!!busy || included.length === 0 || invalidTitle} data-testid="codex-import-apply" onClick={() => void perform('apply')}>{t('genealogy.import.apply')} ({included.length})</button>
      </>}
      <p className="codex-import-source-note">{t('genealogy.import.source')}</p>
      <details className="mt-5 border-t border-border pt-4"><summary className="cursor-pointer py-2 font-display text-lg text-accent-gold">{locale==='es'?'Importar capítulos, tablas y cronologías':'Import chapters, tables and timelines'}</summary><div className="mt-3"><WorldFolderImportPanel projectId={projectId} onChanged={onChanged}/></div></details>
    </section>
  );
}
