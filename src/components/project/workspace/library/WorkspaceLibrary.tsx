import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDown, ArrowUp, Columns2, FileText, Folder, FolderPlus, Search } from 'lucide-react';
import { db } from '@/db';
import { useTranslation } from '@/i18n/useTranslation';
import ConfirmDialog from '@/engines/_shared/components/ConfirmDialog';
import { listWorkspaceDocuments } from './catalog';
import { folderPath, folderTree, readWorkspaceLibrary, sortWorkspaceDocuments, WorkspaceLibraryConflict, WorkspaceLibraryInvalidAction, type WorkspaceLibraryAction } from './model';
import { updateWorkspaceLibrary } from './store';
import { workspaceDocumentKey, type WorkspaceDocument } from './types';
import { libraryCopy } from './copy';

const button = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50';
const input = 'min-h-10 min-w-0 rounded-lg border border-border bg-deep px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold';
export interface WorkspaceLibraryProps { projectId: string; enabledEngineIds: readonly string[]; onOpen: (route: string, destination: 'main' | 'beside') => Promise<boolean>; onManage: () => Promise<boolean>; onBusyChange?: (busy: boolean) => void }

export default function WorkspaceLibrary({ projectId, enabledEngineIds, onOpen, onManage, onBusyChange }: WorkspaceLibraryProps) {
  const { locale, t } = useTranslation(), copy = libraryCopy[locale];
  const [refresh, setRefresh] = useState(0), [folderId, setFolderId] = useState('*'), [query, setQuery] = useState(''), [type, setType] = useState('');
  const [name, setName] = useState(''), [renameName, setRenameName] = useState(''), [destination, setDestination] = useState(''), [selection, setSelection] = useState<Set<string>>(new Set()), [limit, setLimit] = useState(100);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirmRemove, setConfirmRemove] = useState(false); const locked = useRef(false);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const data = useLiveQuery(async () => { try { const project = await db.projects.get(projectId); if (!project) throw new Error('Missing project'); return { project, documents: await listWorkspaceDocuments(projectId, project) }; } catch { return { failed: true as const }; } }, [projectId, refresh]);
  const project = data && 'project' in data ? data.project : undefined, documents = useMemo<WorkspaceDocument[]>(() => data && 'documents' in data ? data.documents ?? [] : [], [data]);
  const library = useMemo(() => readWorkspaceLibrary(project ?? {}), [project]);
  const tree = useMemo(() => folderTree(library.folders), [library.folders]);
  const placements = useMemo(() => new Map(library.placements.map(item => [workspaceDocumentKey(item), item])), [library.placements]);
  const folder = library.folders.find(item => item.id === folderId), activeFolder = folder?.id;
  const engineName = (id: string) => { const label = t(`engines.${id}.name`); return label === `engines.${id}.name` ? id : label; };
  const filtered = sortWorkspaceDocuments(documents.filter(document => (folderId === '*' || placements.get(workspaceDocumentKey(document))?.folderId === activeFolder) && (!type || document.engineId === type) && (!query.trim() || document.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))), library.placements);
  const visible = filtered.slice(0, limit), catalogKeys = new Set(documents.map(workspaceDocumentKey)), missing = library.placements.filter(item => !catalogKeys.has(workspaceDocumentKey(item))).length;
  const selected = documents.filter(document => selection.has(workspaceDocumentKey(document)));
  const run = async (action: WorkspaceLibraryAction, success?: () => void) => {
    if (locked.current) return; locked.current = true; setBusy(true); setError('');
    try { await updateWorkspaceLibrary(projectId, library.revision, action); success?.(); }
    catch (failure) { setError(failure instanceof WorkspaceLibraryConflict ? copy.conflict : failure instanceof WorkspaceLibraryInvalidAction ? copy.invalid : copy.failed); setRefresh(value => value + 1); }
    finally { locked.current = false; setBusy(false); }
  };
  const open = async (route?: string, beside = false) => { if (locked.current) return; locked.current = true; setBusy(true); setError(''); try { if (!(await (route ? onOpen(route, beside ? 'beside' : 'main') : onManage()))) setError(copy.failed); } catch { setError(copy.failed); } finally { locked.current = false; setBusy(false); } };
  const changeFolder = (id: string) => { setFolderId(id); setRenameName(library.folders.find(item => item.id === id)?.name ?? ''); setLimit(100); };
  const options = <><option value="">{copy.root}</option>{tree.map(({ folder: item }) => <option key={item.id} value={item.id}>{folderPath(library.folders, item.id)}</option>)}</>;
  if (!data) return <p className="p-5 text-text-muted">{copy.loading}</p>;
  if ('failed' in data) return <div className="space-y-3 p-5"><p role="alert">{copy.loadFailure}</p><button className={button} onClick={() => setRefresh(value => value + 1)}>{copy.retry}</button></div>;
  return <section className="space-y-4 p-4 sm:p-6" data-testid="workspace-library">
    <p className="max-w-prose text-sm text-text-muted">{copy.help}</p>
    {error && <p role="alert" className="rounded-lg border border-danger p-3 text-sm text-danger">{error}</p>}
    <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="min-w-0 space-y-3" aria-label={copy.folders}>
        <nav className="max-h-80 space-y-1 overflow-auto rounded-xl border border-border bg-deep p-2">
          {[{ id: '*', label: copy.all }, { id: '', label: copy.root }, ...tree.map(item => ({ id: item.folder.id, label: item.folder.name, depth: item.depth }))].map(item => <button key={item.id} type="button" data-library-folder={item.id} aria-current={folderId === item.id ? 'page' : undefined} className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${folderId === item.id ? 'bg-elevated text-accent-gold' : 'text-text-primary hover:bg-elevated'}`} style={'depth' in item ? { paddingLeft: `${12 + Math.min(item.depth ?? 0, 6) * 14}px` } : undefined} title={item.id && item.id !== '*' ? folderPath(library.folders, item.id) : item.label} onClick={() => changeFolder(item.id)}><Folder size={15} className="shrink-0" aria-hidden="true" /><span className="truncate">{item.label}</span></button>)}
        </nav>
        <form className="space-y-2 rounded-xl border border-border p-3" onSubmit={event => { event.preventDefault(); void run({ kind: 'create-folder', id: crypto.randomUUID(), name, parentId: activeFolder }, () => setName('')); }}>
          <label className="block space-y-1 text-xs text-text-muted">{copy.folderName}<input data-testid="library-folder-name" className={`${input} w-full`} maxLength={120} value={name} onChange={event => setName(event.target.value)} required disabled={busy} /></label>
          <button className={`${button} w-full`} disabled={busy || !name.trim()}><FolderPlus size={15} aria-hidden="true" />{copy.create}</button>
        </form>
        {folder && <details className="rounded-xl border border-border p-3" key={folder.id}><summary className="cursor-pointer text-sm text-text-primary">{copy.folderSettings}</summary><div className="mt-3 space-y-3">
          <label className="block space-y-1 text-xs text-text-muted">{copy.rename}<input className={`${input} w-full`} maxLength={120} value={renameName} onChange={event => setRenameName(event.target.value)} /></label><button type="button" className={button} disabled={busy || !renameName.trim()} onClick={() => void run({ kind: 'rename-folder', id: folder.id, name: renameName })}>{copy.save}</button>
          <label className="block space-y-1 text-xs text-text-muted">{copy.destination}<select data-testid="library-folder-destination" className={`${input} w-full`} value={destination} onChange={event => setDestination(event.target.value)}>{options}</select></label>
          <button type="button" className={button} disabled={busy} onClick={() => void run({ kind: 'move-folder', id: folder.id, parentId: destination || undefined })}>{copy.moveFolder}</button>
          <div className="flex flex-wrap gap-2">{([-1, 1] as const).map(direction => <button key={direction} type="button" className={button} disabled={busy} aria-label={direction < 0 ? copy.up : copy.down} onClick={() => void run({ kind: 'order-folder', id: folder.id, direction })}>{direction < 0 ? <ArrowUp size={15} /> : <ArrowDown size={15} />}</button>)}<button type="button" className={button} disabled={busy} onClick={() => setConfirmRemove(true)}>{copy.remove}</button></div>
        </div></details>}
      </aside>
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-end gap-3"><label className="min-w-40 flex-1 space-y-1 text-xs text-text-muted"><span className="flex items-center gap-1"><Search size={13} aria-hidden="true" />{copy.search}</span><input data-testid="library-search" className={`${input} w-full`} value={query} onChange={event => { setQuery(event.target.value); setLimit(100); }} /></label><label className="space-y-1 text-xs text-text-muted">{copy.type}<select data-testid="library-type" className={`${input} block max-w-full`} value={type} onChange={event => { setType(event.target.value); setLimit(100); }}><option value="">{copy.allTypes}</option>{[...new Set(documents.map(document => document.engineId))].sort().map(id => <option key={id} value={id}>{engineName(id)}</option>)}</select></label></div>
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-deep p-3"><span className="text-xs text-text-muted" aria-live="polite">{selected.length} {copy.selected}</span><label className="sr-only" htmlFor="library-destination">{copy.destination}</label><select id="library-destination" data-testid="library-destination" className={`${input} max-w-full flex-1`} value={destination} onChange={event => setDestination(event.target.value)}>{options}</select><button type="button" className={button} data-testid="library-move" disabled={busy || !selected.length} onClick={() => void run({ kind: 'place', documents: selected, folderId: destination || undefined }, () => setSelection(new Set()))}>{copy.move}</button>{selection.size > 0 && <button type="button" className={button} onClick={() => setSelection(new Set())}>{copy.clear}</button>}</div>
        <p className="text-xs text-text-muted" aria-live="polite">{visible.length} {copy.shown} {copy.of} {filtered.length} · {folderId === '*' ? copy.all : folder ? folderPath(library.folders, folder.id) : copy.root}</p>
        <label className="flex items-center gap-2 text-xs text-text-muted"><input type="checkbox" checked={visible.length > 0 && visible.every(document => selection.has(workspaceDocumentKey(document)))} onChange={event => setSelection(previous => { const next = new Set(previous); for (const document of visible) { if (event.target.checked) next.add(workspaceDocumentKey(document)); else next.delete(workspaceDocumentKey(document)); } return next; })} />{copy.selectAll}</label>
        <ul className="divide-y divide-border rounded-xl border border-border" data-testid="library-documents">{visible.map(document => { const key = workspaceDocumentKey(document), placement = placements.get(key), enabled = enabledEngineIds.includes(document.engineId); return <li key={key} data-library-document={key} className="flex flex-wrap items-center gap-3 p-3">
          <input type="checkbox" aria-label={`${copy.select}: ${document.title || copy.untitled}`} checked={selection.has(key)} onChange={event => setSelection(previous => { const next = new Set(previous); if (event.target.checked) next.add(key); else next.delete(key); return next; })} />
          <FileText size={17} className="shrink-0 text-text-muted" aria-hidden="true" /><div className="min-w-24 flex-1"><p className="break-words text-sm font-medium text-text-primary">{document.title || copy.untitled}</p><p className="break-words text-xs text-text-muted">{engineName(document.engineId)} · {placement?.folderId ? folderPath(library.folders, placement.folderId) : copy.root}{!enabled && ` · ${copy.disabled}`}</p></div>
          <div className="flex flex-wrap gap-1">{enabled ? <><button type="button" className={button} data-library-open="main" disabled={busy} onClick={() => void open(document.route)}>{copy.main}</button><button type="button" className={button} data-library-open="beside" disabled={busy} aria-label={`${copy.beside}: ${document.title || copy.untitled}`} title={copy.beside} onClick={() => void open(document.route, true)}><Columns2 size={15} aria-hidden="true" /></button></> : <button type="button" className={button} disabled={busy} onClick={() => void open()}>{copy.manage}</button>}{folderId !== '*' && !query && !type && ([-1, 1] as const).map(direction => <button key={direction} type="button" className={button} disabled={busy} aria-label={`${direction < 0 ? copy.up : copy.down}: ${document.title || copy.untitled}`} onClick={() => void run({ kind: 'order-document', document, direction })}>{direction < 0 ? <ArrowUp size={14} /> : <ArrowDown size={14} />}</button>)}</div>
        </li>; })}</ul>
        {!filtered.length && <p className="py-8 text-center text-sm text-text-muted">{copy.empty}</p>}{visible.length < filtered.length && <button type="button" className={button} onClick={() => setLimit(value => value + 100)}>{copy.more}</button>}
        {missing > 0 && <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted"><span>{copy.missing}: {missing}</span><button type="button" className={button} disabled={busy} onClick={() => void run({ kind: 'prune' })}>{copy.clean}</button></div>}
      </div>
    </div>
    <ConfirmDialog open={confirmRemove && !!folder} title={copy.remove} message={copy.removeHelp} confirmLabel={copy.remove} onCancel={() => setConfirmRemove(false)} onConfirm={async () => { if (folder) await run({ kind: 'delete-folder', id: folder.id }, () => { setConfirmRemove(false); changeFolder(folder.parentId ?? ''); }); }} />
  </section>;
}
