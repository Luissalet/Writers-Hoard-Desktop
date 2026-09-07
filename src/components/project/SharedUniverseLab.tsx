import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Download,
  ExternalLink,
  Globe2,
  Link2,
  Loader2,
  Plus,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import { db } from '@/db';
import Modal from '@/components/common/Modal';
import { toast } from '@/components/common/toast';
import type { CausalEntityReference } from '@/services/causalGraph';
import {
  bindSharedCanonEntity,
  createSharedCanonEntity,
  createSharedUniverse,
  deleteSharedCanonEntity,
  exportSharedUniverseArchive,
  importSharedUniverseArchive,
  linkProjectToSharedUniverse,
  previewDeleteSharedCanonEntity,
  previewSharedUniverseImport,
  updateSharedCanonEntity,
  updateSharedEntityOverride,
  type SharedCanonEntity,
  type SharedCanonEntityKind,
  type SharedEntityBinding,
  type SharedEntityDeletionPreview,
  type SharedEntitySource,
  type SharedUniverseArchive,
  type SharedUniverseImportPreview,
} from '@/services/sharedUniverse';

interface SharedUniverseLabProps {
  projectId: string;
  locale: 'es' | 'en';
  onOpenEntity: (entity: CausalEntityReference & { projectId?: string }) => void;
}

interface LocalCandidate extends Omit<SharedEntitySource, 'projectId'> {
  kind: SharedCanonEntityKind;
}

const KINDS: SharedCanonEntityKind[] = [
  'character', 'location', 'item', 'faction', 'world-rule', 'event', 'concept',
];

function copyFor(locale: 'es' | 'en') {
  if (locale === 'en') return {
    title: 'Shared universe',
    description: 'One stable identity across books, with local versions that never overwrite series canon.',
    noUniverse: 'This project is not part of a shared universe yet.',
    createTitle: 'Create a universe', create: 'Create and join', universeName: 'Universe name',
    existing: 'Join an existing universe', join: 'Join universe', choose: 'Choose…',
    archive: 'Universe archive', export: 'Export', import: 'Import',
    importTitle: 'Import shared universe', importConfirm: 'Import archive', replace: 'Replace existing shared layer',
    importSummary: (entities: number, bindings: number) => `${entities} identities · ${bindings} book links`,
    missingMembers: (count: number) => `${count} archived books are not present here; their links will remain recoverable.`,
    newIdentity: 'Promote a local entity to series canon', source: 'Local source',
    kind: 'Kind', sharedTitle: 'Shared identity', summary: 'Series truth', tags: 'Tags, comma separated',
    promote: 'Create shared identity', identities: 'Shared identities', empty: 'No identities yet. Promote one from this book’s Codex or Timeline.',
    base: 'Series canon', local: 'This book', unbound: 'Not linked to this book', bind: 'Link to this book',
    saveBase: 'Save series canon', saveLocal: 'Save local version', localTitle: 'Local title (optional)',
    localSummary: 'What is different in this book (optional)', stale: 'Series canon changed after this local version. Review before saving.',
    origin: 'Open origin', remove: 'Delete shared identity', deleteTitle: 'Delete shared identity?',
    deleteBody: (count: number) => `This removes the shared layer and ${count} book link(s). It never deletes the original Codex or Timeline entities.`,
    cancel: 'Cancel', confirmDelete: 'Delete shared layer', saved: 'Saved', created: 'Shared identity created', joined: 'Project linked',
    imported: 'Universe imported', exported: 'Universe archive exported', invalidArchive: 'That file is not a valid universe archive.',
    kindLabels: { character: 'Character', location: 'Location', item: 'Item', faction: 'Faction', 'world-rule': 'World rule', event: 'Event', concept: 'Concept' } as Record<SharedCanonEntityKind, string>,
  };
  return {
    title: 'Universo compartido',
    description: 'Una identidad estable entre libros, con versiones locales que nunca pisan el canon de la saga.',
    noUniverse: 'Este proyecto todavía no pertenece a un universo compartido.',
    createTitle: 'Crear un universo', create: 'Crear y unir', universeName: 'Nombre del universo',
    existing: 'Unirse a un universo existente', join: 'Unir proyecto', choose: 'Elige…',
    archive: 'Archivo del universo', export: 'Exportar', import: 'Importar',
    importTitle: 'Importar universo compartido', importConfirm: 'Importar archivo', replace: 'Sustituir la capa compartida existente',
    importSummary: (entities: number, bindings: number) => `${entities} identidades · ${bindings} enlaces con libros`,
    missingMembers: (count: number) => `${count} libros del archivo no existen aquí; sus enlaces seguirán siendo recuperables.`,
    newIdentity: 'Promover una entidad local al canon de la saga', source: 'Fuente local',
    kind: 'Tipo', sharedTitle: 'Identidad compartida', summary: 'Verdad de la saga', tags: 'Etiquetas, separadas por comas',
    promote: 'Crear identidad compartida', identities: 'Identidades compartidas', empty: 'Aún no hay identidades. Promueve una desde el Códice o la Cronología de este libro.',
    base: 'Canon de la saga', local: 'Este libro', unbound: 'Sin enlazar con este libro', bind: 'Enlazar con este libro',
    saveBase: 'Guardar canon de la saga', saveLocal: 'Guardar versión local', localTitle: 'Nombre local (opcional)',
    localSummary: 'Qué cambia en este libro (opcional)', stale: 'El canon de la saga cambió después de esta versión local. Revísala antes de guardar.',
    origin: 'Abrir origen', remove: 'Borrar identidad compartida', deleteTitle: '¿Borrar identidad compartida?',
    deleteBody: (count: number) => `Esto borra la capa compartida y ${count} enlace(s) con libros. Nunca elimina las entidades originales del Códice o la Cronología.`,
    cancel: 'Cancelar', confirmDelete: 'Borrar capa compartida', saved: 'Guardado', created: 'Identidad compartida creada', joined: 'Proyecto enlazado',
    imported: 'Universo importado', exported: 'Archivo del universo exportado', invalidArchive: 'Ese archivo no es un universo compartido válido.',
    kindLabels: { character: 'Personaje', location: 'Lugar', item: 'Objeto', faction: 'Facción', 'world-rule': 'Regla del mundo', event: 'Evento', concept: 'Concepto' } as Record<SharedCanonEntityKind, string>,
  };
}

function parseTags(value: string): string[] {
  return value.split(',').map((tag) => tag.trim()).filter(Boolean);
}

function SharedIdentityCard({ entity, binding, projectId, canBind, copy, onOpen, onChanged, onDelete }: {
  entity: SharedCanonEntity;
  binding?: SharedEntityBinding;
  projectId: string;
  canBind: boolean;
  copy: ReturnType<typeof copyFor>;
  onOpen: () => void;
  onChanged: () => void;
  onDelete: () => void;
}) {
  const [baseTitle, setBaseTitle] = useState(entity.title);
  const [baseSummary, setBaseSummary] = useState(entity.summary);
  const [baseTags, setBaseTags] = useState(entity.tags.join(', '));
  const [localTitle, setLocalTitle] = useState(binding?.overrides.title ?? '');
  const [localSummary, setLocalSummary] = useState(binding?.overrides.summary ?? '');
  const [localTags, setLocalTags] = useState(binding?.overrides.tags?.join(', ') ?? '');
  const [busy, setBusy] = useState(false);

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await operation();
      toast.success(success);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-gold">{copy.kindLabels[entity.kind]}</span>
          <h4 className="mt-1 font-serif text-lg font-semibold text-text-primary">{binding?.overrides.title || entity.title}</h4>
          <p className="mt-1 text-xs text-text-muted">v{entity.version} · {binding ? copy.local : copy.unbound}</p>
        </div>
        <div className="flex gap-1">
          <button type="button" onClick={onOpen} className="rounded-lg p-2 text-text-muted hover:bg-elevated hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold" title={copy.origin} aria-label={copy.origin}>
            <ExternalLink size={16} aria-hidden="true" />
          </button>
          <button type="button" onClick={onDelete} className="rounded-lg p-2 text-text-muted hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger" title={copy.remove} aria-label={copy.remove}>
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <form onSubmit={(event) => { event.preventDefault(); void run(() => updateSharedCanonEntity(entity.id, entity.version, { title: baseTitle, summary: baseSummary, tags: parseTags(baseTags) }), copy.saved); }} className="space-y-3 rounded-lg border border-border bg-elevated/60 p-3">
          <h5 className="text-xs font-semibold uppercase tracking-wide text-text-muted">{copy.base}</h5>
          <input value={baseTitle} onChange={(event) => setBaseTitle(event.target.value)} aria-label={copy.sharedTitle} className="min-h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-primary" />
          <textarea value={baseSummary} onChange={(event) => setBaseSummary(event.target.value)} aria-label={copy.summary} rows={3} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary" />
          <input value={baseTags} onChange={(event) => setBaseTags(event.target.value)} aria-label={copy.tags} className="min-h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-primary" />
          <button disabled={busy || !baseTitle.trim()} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-accent-gold/40 px-3 text-sm text-accent-gold disabled:opacity-40"><Save size={14} aria-hidden="true" />{copy.saveBase}</button>
        </form>

        {canBind && (!binding ? (
          <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-border p-4 text-center">
            <p className="text-sm text-text-muted">{copy.unbound}</p>
            <button type="button" disabled={busy} onClick={() => void run(() => bindSharedCanonEntity({ sharedEntityId: entity.id, projectId }), copy.saved)} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent-gold px-3 text-sm font-semibold text-deep disabled:opacity-40"><Link2 size={14} aria-hidden="true" />{copy.bind}</button>
          </div>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); void run(() => updateSharedEntityOverride(binding.id, entity.version, { title: localTitle, summary: localSummary, tags: parseTags(localTags) }), copy.saved); }} className="space-y-3 rounded-lg border border-border bg-elevated/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <h5 className="text-xs font-semibold uppercase tracking-wide text-text-muted">{copy.local}</h5>
              {binding.baseVersion !== entity.version && <span className="rounded-full bg-warning/10 px-2 py-1 text-[11px] text-warning">{copy.stale}</span>}
            </div>
            <input value={localTitle} onChange={(event) => setLocalTitle(event.target.value)} placeholder={copy.localTitle} aria-label={copy.localTitle} className="min-h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-primary" />
            <textarea value={localSummary} onChange={(event) => setLocalSummary(event.target.value)} placeholder={copy.localSummary} aria-label={copy.localSummary} rows={3} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary" />
            <input value={localTags} onChange={(event) => setLocalTags(event.target.value)} placeholder={copy.tags} aria-label={copy.tags} className="min-h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-primary" />
            <button disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-accent-gold/40 px-3 text-sm text-accent-gold disabled:opacity-40"><Save size={14} aria-hidden="true" />{copy.saveLocal}</button>
          </form>
        ))}
      </div>
    </article>
  );
}

export default function SharedUniverseLab({ projectId, locale, onOpenEntity }: SharedUniverseLabProps) {
  const copy = copyFor(locale);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [refresh, setRefresh] = useState(0);
  const [universeTitle, setUniverseTitle] = useState('');
  const [selectedSeriesId, setSelectedSeriesId] = useState('');
  const [sourceKey, setSourceKey] = useState('');
  const [kind, setKind] = useState<SharedCanonEntityKind>('character');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [deletePreview, setDeletePreview] = useState<SharedEntityDeletionPreview | null>(null);
  const [importCandidate, setImportCandidate] = useState<{ archive: SharedUniverseArchive; preview: SharedUniverseImportPreview } | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const data = useLiveQuery(async () => {
    const project = await db.projects.get(projectId);
    const [sagas, codex, events] = await Promise.all([
      db.projects.where('type').equals('saga').toArray(),
      db.codexEntries.where('projectId').equals(projectId).toArray(),
      db.timelineEvents.where('projectId').equals(projectId).toArray(),
    ]);
    const series = project?.type === 'saga'
      ? project
      : project?.parentId ? await db.projects.get(project.parentId) : undefined;
    const [entities, bindings] = series ? await Promise.all([
      db.sharedCanonEntities.where('seriesId').equals(series.id).sortBy('title'),
      db.sharedEntityBindings.where('projectId').equals(projectId).toArray(),
    ]) : [[], []];
    const sources: LocalCandidate[] = [
      ...codex.map((entry): LocalCandidate => ({
        engineId: 'codex', entityType: entry.type, entityId: entry.id, title: entry.title,
        kind: entry.type === 'magic' ? 'world-rule' : entry.type === 'custom' ? 'concept' : entry.type,
      })),
      ...events.map((event): LocalCandidate => ({
        engineId: 'timeline', entityType: 'timeline-event', entityId: event.id, title: event.title, kind: 'event',
      })),
    ].sort((a, b) => a.title.localeCompare(b.title));
    return { project, sagas, series, entities, bindings, sources };
  }, [projectId, refresh]);

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await operation();
      setRefresh((value) => value + 1);
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const submitIdentity = async (event: FormEvent) => {
    event.preventDefault();
    const source = data?.sources.find((candidate) => `${candidate.engineId}:${candidate.entityId}` === sourceKey) ?? data?.sources[0];
    if (!data?.series || !source) return;
    const selectedKind = sourceKey ? kind : source.kind;
    await run(async () => {
      await createSharedCanonEntity({
        seriesId: data.series!.id, projectId, kind: selectedKind, title: title || source.title, summary,
        tags: parseTags(tags), source,
      });
      setTitle(''); setSummary(''); setTags('');
    }, copy.created);
  };

  const exportArchive = async () => {
    if (!data?.series) return;
    await run(async () => {
      const archive = await exportSharedUniverseArchive(data.series!.id);
      const blob = new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${data.series!.title.replace(/[^a-z0-9_-]+/gi, '-') || 'universe'}.writers-hoard-universe.json`;
      link.click();
      URL.revokeObjectURL(url);
    }, copy.exported);
  };

  const readArchive = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const archive = JSON.parse(await file.text()) as SharedUniverseArchive;
      const preview = await previewSharedUniverseImport(archive);
      setImportCandidate({ archive, preview });
    } catch {
      toast.error(copy.invalidArchive);
    }
  };

  if (!data) return <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-accent-gold" aria-label="Loading" /></div>;

  const effectiveSourceKey = sourceKey || (data.sources[0] ? `${data.sources[0].engineId}:${data.sources[0].entityId}` : '');
  const effectiveSource = data.sources.find((source) => `${source.engineId}:${source.entityId}` === effectiveSourceKey);
  const effectiveKind = sourceKey ? kind : effectiveSource?.kind ?? kind;
  const bindingByEntity = new Map(data.bindings.map((binding) => [binding.sharedEntityId, binding]));

  return (
    <section className="space-y-5">
      <header className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-start gap-3"><Globe2 className="mt-0.5 text-accent-gold" aria-hidden="true" /><div><h4 className="font-serif text-xl font-semibold text-text-primary">{copy.title}</h4><p className="mt-1 max-w-3xl text-sm leading-relaxed text-text-muted">{copy.description}</p></div></div>
      </header>

      {!data.series ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <form onSubmit={(event) => { event.preventDefault(); void run(() => createSharedUniverse(universeTitle, projectId), copy.joined); }} className="space-y-3 rounded-xl border border-border bg-surface p-5">
            <h5 className="font-medium text-text-primary">{copy.createTitle}</h5><p className="text-sm text-text-muted">{copy.noUniverse}</p>
            <label className="block text-sm text-text-muted"><span className="mb-1 block">{copy.universeName}</span><input required value={universeTitle} onChange={(event) => setUniverseTitle(event.target.value)} className="min-h-11 w-full rounded-lg border border-border bg-elevated px-3 text-text-primary" /></label>
            <button disabled={busy || !universeTitle.trim()} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent-gold px-4 text-sm font-semibold text-deep disabled:opacity-40"><Plus size={16} aria-hidden="true" />{copy.create}</button>
          </form>
          <form onSubmit={(event) => { event.preventDefault(); if (selectedSeriesId) void run(() => linkProjectToSharedUniverse(projectId, selectedSeriesId), copy.joined); }} className="space-y-3 rounded-xl border border-border bg-surface p-5">
            <h5 className="font-medium text-text-primary">{copy.existing}</h5>
            <select value={selectedSeriesId} onChange={(event) => setSelectedSeriesId(event.target.value)} aria-label={copy.existing} className="min-h-11 w-full rounded-lg border border-border bg-elevated px-3 text-text-primary"><option value="">{copy.choose}</option>{data.sagas.map((saga) => <option key={saga.id} value={saga.id}>{saga.title}</option>)}</select>
            <button disabled={busy || !selectedSeriesId} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-accent-gold/40 px-4 text-sm text-accent-gold disabled:opacity-40"><Link2 size={16} aria-hidden="true" />{copy.join}</button>
          </form>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent-gold/30 bg-accent-gold/5 p-4">
            <div><p className="text-xs uppercase tracking-wider text-text-muted">{copy.title}</p><p className="font-serif text-lg font-semibold text-accent-gold">{data.series.title}</p></div>
            <div className="flex gap-2"><button type="button" onClick={() => void exportArchive()} disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm text-text-primary"><Download size={15} aria-hidden="true" />{copy.export}</button><button type="button" onClick={() => importInputRef.current?.click()} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm text-text-primary"><Upload size={15} aria-hidden="true" />{copy.import}</button><input ref={importInputRef} type="file" accept="application/json,.json" onChange={(event) => void readArchive(event)} className="sr-only" /></div>
          </div>

          {data.project?.type !== 'saga' && <form onSubmit={(event) => void submitIdentity(event)} className="grid gap-3 rounded-xl border border-border bg-surface p-5 md:grid-cols-2 lg:grid-cols-4">
            <h5 className="md:col-span-2 lg:col-span-4 font-medium text-text-primary">{copy.newIdentity}</h5>
            <label className="text-sm text-text-muted"><span className="mb-1 block">{copy.source}</span><select disabled={!data.sources.length} value={effectiveSourceKey} onChange={(event) => { setSourceKey(event.target.value); const source = data.sources.find((item) => `${item.engineId}:${item.entityId}` === event.target.value); if (source) { setKind(source.kind); setTitle(source.title); } }} className="min-h-11 w-full rounded-lg border border-border bg-elevated px-3 text-text-primary">{data.sources.map((source) => <option key={`${source.engineId}:${source.entityId}`} value={`${source.engineId}:${source.entityId}`}>{source.title}</option>)}</select></label>
            <label className="text-sm text-text-muted"><span className="mb-1 block">{copy.kind}</span><select value={effectiveKind} onChange={(event) => { setSourceKey(effectiveSourceKey); setKind(event.target.value as SharedCanonEntityKind); }} className="min-h-11 w-full rounded-lg border border-border bg-elevated px-3 text-text-primary">{KINDS.map((value) => <option key={value} value={value}>{copy.kindLabels[value]}</option>)}</select></label>
            <label className="text-sm text-text-muted"><span className="mb-1 block">{copy.sharedTitle}</span><input required value={title || effectiveSource?.title || ''} onChange={(event) => setTitle(event.target.value)} className="min-h-11 w-full rounded-lg border border-border bg-elevated px-3 text-text-primary" /></label>
            <label className="text-sm text-text-muted"><span className="mb-1 block">{copy.tags}</span><input value={tags} onChange={(event) => setTags(event.target.value)} className="min-h-11 w-full rounded-lg border border-border bg-elevated px-3 text-text-primary" /></label>
            <label className="text-sm text-text-muted md:col-span-2 lg:col-span-3"><span className="mb-1 block">{copy.summary}</span><textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={2} className="w-full rounded-lg border border-border bg-elevated px-3 py-2 text-text-primary" /></label>
            <button disabled={busy || !effectiveSource || !(title || effectiveSource.title).trim()} className="inline-flex min-h-11 self-end items-center justify-center gap-2 rounded-lg bg-accent-gold px-4 text-sm font-semibold text-deep disabled:opacity-40"><Plus size={16} aria-hidden="true" />{copy.promote}</button>
          </form>}

          <div className="space-y-3"><h5 className="font-medium text-text-primary">{copy.identities}</h5>{data.entities.length === 0 ? <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-text-muted">{copy.empty}</p> : data.entities.map((entity) => <SharedIdentityCard key={`${entity.id}:${entity.version}:${bindingByEntity.get(entity.id)?.updatedAt ?? 0}`} entity={entity} binding={bindingByEntity.get(entity.id)} projectId={projectId} canBind={data.project?.type !== 'saga'} copy={copy} onOpen={() => onOpenEntity({ engineId: entity.origin.engineId, entityType: entity.origin.entityType, entityId: entity.origin.entityId, title: entity.origin.title, subtitle: copy.base, projectId: entity.origin.projectId })} onChanged={() => setRefresh((value) => value + 1)} onDelete={() => { void previewDeleteSharedCanonEntity(entity.id).then(setDeletePreview).catch((error) => toast.error(error instanceof Error ? error.message : String(error))); }} />)}</div>
        </>
      )}

      <Modal open={Boolean(deletePreview)} onClose={() => setDeletePreview(null)} title={copy.deleteTitle} initialFocusRef={cancelRef} busy={busy}>
        <p className="text-sm leading-relaxed text-text-muted">{deletePreview && copy.deleteBody(deletePreview.bindings.length)}</p><div className="mt-5 flex justify-end gap-2"><button ref={cancelRef} type="button" onClick={() => setDeletePreview(null)} className="min-h-10 rounded-lg border border-border px-4 text-sm text-text-primary">{copy.cancel}</button><button type="button" disabled={busy} onClick={() => { if (!deletePreview) return; void run(() => deleteSharedCanonEntity(deletePreview, deletePreview.confirmationToken), copy.saved).then(() => setDeletePreview(null)); }} className="min-h-10 rounded-lg bg-danger px-4 text-sm font-semibold text-white disabled:opacity-40">{copy.confirmDelete}</button></div>
      </Modal>

      <Modal open={Boolean(importCandidate)} onClose={() => setImportCandidate(null)} title={copy.importTitle} initialFocusRef={cancelRef} busy={busy}>
        {importCandidate && <div className="space-y-3"><p className="font-medium text-text-primary">{importCandidate.archive.seriesProject.title}</p><p className="text-sm text-text-muted">{copy.importSummary(importCandidate.preview.entityCount, importCandidate.preview.bindingCount)}</p>{importCandidate.preview.missingMemberProjectIds.length > 0 && <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">{copy.missingMembers(importCandidate.preview.missingMemberProjectIds.length)}</p>}{importCandidate.preview.collisions.length > 0 && <p className="rounded-lg bg-danger/10 p-3 text-sm text-danger">{copy.replace}</p>}<div className="flex justify-end gap-2"><button ref={cancelRef} type="button" onClick={() => setImportCandidate(null)} className="min-h-10 rounded-lg border border-border px-4 text-sm text-text-primary">{copy.cancel}</button><button type="button" disabled={busy} onClick={() => { const candidate = importCandidate; void run(() => importSharedUniverseArchive(candidate.archive, candidate.preview, candidate.preview.confirmationToken, candidate.preview.collisions.length > 0), copy.imported).then(() => setImportCandidate(null)); }} className="min-h-10 rounded-lg bg-accent-gold px-4 text-sm font-semibold text-deep disabled:opacity-40">{copy.importConfirm}</button></div></div>}
      </Modal>
    </section>
  );
}
