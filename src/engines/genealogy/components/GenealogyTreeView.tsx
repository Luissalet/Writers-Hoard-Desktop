import { useEffect, useMemo, useState } from 'react';
import { useCodexEntries } from '@/engines/codex/hooks';
import { db } from '@/db';
import { loadGenealogyLinks } from '../genealogyRepo';
import { buildGenealogyTree, treeStats } from '../tree';
import { renderTreeSvg } from '../treeSvg';
import type { GenealogyTableLike } from '../genealogyRepo';
import type { GenealogyLinkRow } from '../genealogyStore';
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
  const { items: codexEntries, loading, error, refresh } = useCodexEntries(projectId);
  const [links, setLinks] = useState<Awaited<ReturnType<typeof loadGenealogyLinks>>>([]);
  const [linksError, setLinksError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      loadGenealogyLinks(genealogyTable(), projectId)
        .then((rows) => {
          if (!cancelled) setLinks(rows);
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
  }, [projectId]);

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

  if (loading) {
    return <div className="genealogy-loading">Cargando árbol genealógico…</div>;
  }
  if (error) {
    return <div className="genealogy-error">Error al cargar los personajes: {error.message}</div>;
  }
  if (linksError) {
    return <div className="genealogy-error">Error al cargar los enlaces: {linksError}</div>;
  }

  return (
    <div className="genealogy-tree-view">
      <div className="genealogy-tree-stats">
        {stats.characters} personajes · {stats.roots} raíces · profundidad {stats.depth} ·{' '}
        {stats.orphans} huérfanos · {stats.partnerships} parejas
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
