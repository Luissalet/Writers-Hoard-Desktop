import { useEffect, useId, useMemo, useState } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useCodexEntries } from '@/engines/codex/hooks';
import { db } from '@/db';
import { loadGenealogyLinks } from '../genealogyRepo';
import { buildGenealogyTree, treeStats } from '../tree';
import { renderTreeSvg } from '../treeSvg';
import type { GenealogyTableLike } from '../genealogyRepo';
import type { GenealogyLinkRow } from '../genealogyStore';
import { exportTreeDot, exportTreeText } from '../treeExport';
import CodexFolderImportPanel from './CodexFolderImportPanel';
import { useTranslation } from '@/i18n/useTranslation';
import { Download, RefreshCw, FolderOpen } from 'lucide-react';
import '@/styles/genealogy.css';

/**
 * Adapter from the real Dexie table to the minimal surface the pure repo
 * expects (Dexie's bulkPut overloads don't match a single-argument callable).
 */
function genealogyTable(): GenealogyTableLike {
  const table = db.genealogyLinks;
  return {
    where: (index: string) => table.where(index),
    bulkPut: (rows) => table.bulkPut(rows as GenealogyLinkRow[]),
    get: (id: string) => table.get(id),
    delete: (id: string) => table.delete(id),
  };
}

/**
 * Genealogy tree view (W3, piece 10).
 *
 * Loads the project's characters (codex entries of type 'character') and the
 * stored genealogy links, builds the ancestry tree and renders the pure SVG
 * produced by treeSvg.ts (which lays the tree out internally). Read-only in
 * this first version: the importers and the MCP apply/undo flow feed the same
 * table.
 */
export default function GenealogyTreeView({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const importPanelId = useId();
  const { items: codexEntries, loading, error, refresh } = useCodexEntries(projectId);
  const [links, setLinks] = useState<Awaited<ReturnType<typeof loadGenealogyLinks>>>([]);
  const [linksError, setLinksError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const reloadProject = () => {
    setReload(value => value + 1);
    void refresh();
  };
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      loadGenealogyLinks(genealogyTable(), projectId)
        .then((rows) => {
          if (!cancelled) { setLinks(rows); setLinksError(null); }
        })
        .catch((err: unknown) => {
          if (!cancelled) setLinksError(err instanceof Error ? err.message : String(err));
        });
    };
    load();
    // Re-read links when the window regains focus so links written through the
    // MCP flow while this view is open become visible without a manual reload.
    window.addEventListener('focus', load);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', load);
    };
  }, [projectId, reload]);

  const characters = useMemo(
    () =>
      codexEntries
        .filter((e) => e.type === 'character')
        .map((e) => ({ id: e.id, name: e.title })),
    [codexEntries],
  );

  const built = useMemo(() => buildGenealogyTree(characters, links), [characters, links]);
  const stats = useMemo(() => treeStats(built), [built]);
  const svg = useMemo(() => renderTreeSvg(characters, links), [characters, links]);

  const exportTree = (format: 'dot' | 'text') => {
    try {
      const input = { characters, links: links.map(link => ({ ...link, fromId: link.from, toId: link.to })) };
      const body = format === 'dot' ? exportTreeDot(input) : exportTreeText(input);
      const url = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `genealogy-${projectId}.${format === 'dot' ? 'dot' : 'txt'}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setExportStatus(t('genealogy.tree.exported'));
    } catch (err) {
      setExportStatus(`${t('genealogy.import.failure')}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (loading) {
    return <div className="genealogy-loading">{t('genealogy.tree.loading')}</div>;
  }
  if (error) {
    return <div className="genealogy-error">{t('genealogy.tree.charactersError')}: {error.message}</div>;
  }
  if (linksError) {
    return <div className="genealogy-error">{t('genealogy.tree.linksError')}: {linksError}</div>;
  }

  return (
    <div className="genealogy-tree-view">
      <div className="genealogy-toolbar">
        <button type="button" aria-expanded={importOpen} aria-controls={importPanelId} data-testid="codex-import-toggle" onClick={() => setImportOpen(value => !value)}><FolderOpen size={16} aria-hidden="true" />{t('genealogy.tree.import')}</button>
        <div className="genealogy-export-actions">
          <button type="button" data-testid="genealogy-export-dot" onClick={() => exportTree('dot')}><Download size={16} aria-hidden="true" />{t('genealogy.tree.exportDot')}</button>
          <button type="button" data-testid="genealogy-export-text" onClick={() => exportTree('text')}><Download size={16} aria-hidden="true" />{t('genealogy.tree.exportText')}</button>
          <button type="button" onClick={reloadProject}><RefreshCw size={16} aria-hidden="true" />{t('genealogy.tree.refresh')}</button>
        </div>
      </div>
      {exportStatus && <p className="genealogy-export-status" role="status">{exportStatus}</p>}
      <div id={importPanelId} hidden={!importOpen}>
        <CodexFolderImportPanel projectId={projectId} onChanged={reloadProject} />
      </div>
      <div className="genealogy-tree-stats">
        {t('genealogy.tree.stats')
          .replace('{characters}', String(characters.length))
          .replace('{roots}', String(stats.roots))
          .replace('{depth}', String(stats.depth))
          .replace('{orphans}', String(stats.orphans))
          .replace('{partners}', String(stats.partnerships))}
      </div>
      <div
        className="genealogy-tree-svg"
        // The SVG string comes from the pure renderer (treeSvg.ts), which
        // escapes names and labels; it is trusted markup by construction.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <button type="button" onClick={() => void refresh()}>
        Recargar
      </button>
    </div>
  );
}
