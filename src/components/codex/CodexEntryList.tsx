import { useWorldEraScope } from '@/services/worldEras/hooks';
import { projectCodexEntry, propertyDefinitions } from '@/engines/codex/properties';
import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { Plus, Search, User, HelpCircle, Image as ImageIcon, X } from 'lucide-react';
import { db } from '@/db';
import { loadCodexAppearances, type CodexAppearance } from '@/services/projectIntelligence';
import type { CodexEntry, CodexEntryType, InspirationImage } from '@/types';
import Modal from '@/components/common/Modal';
import CodexEntryForm from './CodexEntryForm';
import CharacterConnections from './CharacterConnections';
import EmptyState from '@/components/common/EmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { sanitizedHtml } from '@/utils/sanitizeRichHtml';
import { ConfirmDialog, useDeepLinkParam } from '@/engines/_shared';
import { deleteWithDraftCleanup } from '@/hooks/localDraftStore';
import { codexDraftStore } from './codexDrafts';
import AnnotationSurface from '@/engines/annotations/components/AnnotationSurface';
import { SendToProsperoButton, ScheherazadeButtons } from '@/components/family/FamilyHandoff';
import { codexTypeIcons as typeIcons, codexTypeColors as typeColors } from './codexTypeMeta';
import { searchEntries } from '@/services/codexReference/matcher';
import { isAliasField, readAliases } from '@/services/codexReference/aliases';
import { useProject } from '@/hooks/useProjects';
import CodexTemplateManager from './CodexTemplateManager';
import { templateFromEntry, type CodexTemplate } from '@/engines/codex/templates';
import { effectiveCodexTemplate, effectiveTemplatePresentation,selectableCodexTemplates, templateIsWithin, templatePath } from '@/engines/codex/templateHierarchy';
import {ProjectIcon} from '@/components/common/ProjectIcon';
import {templatePresentationCopy} from '@/engines/codex/templatePresentationCopy';
import { generateId } from '@/utils/idGenerator';

interface CodexEntryListProps {
  projectId: string;
  entries: CodexEntry[];
  onAdd: (entry: CodexEntry) => Promise<void>;
  onEdit: (id: string, changes: Partial<CodexEntry>, base?: CodexEntry) => Promise<void>;
  onDelete: (id: string) => void | Promise<unknown>;
  focusEntryId?: string | null;
}

/**
 * The images linked to ONE entry, read through the `*linkedEntryIds` multi-entry
 * index when the detail modal opens. Taking the whole gallery as a prop held the
 * Codex tab behind a spinner until every base64 payload in the project had been
 * deserialised, to show a handful of thumbnails for a single record.
 */
function LinkedImages({
  projectId,
  entryId,
  onOpen,
}: {
  projectId: string;
  entryId: string;
  onOpen: (src: string) => void;
}) {
  const { t } = useTranslation();
  const [images, setImages] = useState<InspirationImage[]>([]);
  useEffect(() => {
    const subscription = liveQuery(() =>
      db.inspirationImages.where('linkedEntryIds').equals(entryId).toArray(),
    ).subscribe({
      next: rows => setImages(rows.filter(row => row.projectId === projectId)),
      error: error => {
        console.error('Linked codex images could not be loaded', error);
        setImages([]);
      },
    });
    return () => subscription.unsubscribe();
  }, [projectId, entryId]);

  if (images.length === 0) return null;
  return (
    <div>
      <h4 className="flex items-center gap-2 text-sm font-semibold text-text-primary mb-3">
        <ImageIcon size={14} className="text-accent-gold" />
        {t('codex.gallery')} ({images.length})
      </h4>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
        {images.map(img => (
          <button
            key={img.id}
            onClick={() => onOpen(img.imageData)}
            className="aspect-square rounded-lg overflow-hidden border border-border hover:border-accent-gold/40 transition"
          >
            <img
              src={img.thumbnailData ?? img.imageData}
              alt=""
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
            />
          </button>
        ))}
      </div>
    </div>
  );
}

export default function CodexEntryList({ projectId, entries, onAdd, onEdit, onDelete, focusEntryId }: CodexEntryListProps) {
  const { t,locale } = useTranslation();
  const { project } = useProject(projectId);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateSeed, setTemplateSeed] = useState<CodexTemplate | undefined>();
  const [formTemplate, setFormTemplate] = useState<CodexTemplate | undefined>();
  const [filterTemplate, setFilterTemplate] = useState('');
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [savingForm, setSavingForm] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const scope = useWorldEraScope(projectId);
  const [drafts] = useState(() => codexDraftStore(projectId, scope.eraId));
  const [editEntry, setEditEntry] = useState<CodexEntry | null>(null);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<CodexEntryType | 'all'>('all');
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const selectedEntry = entries.find(entry => entry.id === selectedEntryId && entry.projectId === projectId) ?? null;

  const selectedProjection = selectedEntry ? projectCodexEntry(selectedEntry, project?.codexTemplates ?? []) : undefined;
  const selectedTemplateSource = project?.codexTemplates?.find(template => template.id === selectedEntry?.templateId);
  const selectedTemplate = selectedTemplateSource ? effectiveCodexTemplate(selectedTemplateSource, project?.codexTemplates ?? []) : undefined;

  // Deep link: `/project/:id/codex?entry=<id>` — how global search, Cmd+K and
  // annotation backlinks arrive here. Opens the detail modal on the record
  // instead of dumping the author on the grid.
  //
  // Render-adjust rather than an effect (same pattern as CompileModal): the
  // selection is applied while rendering and marked as applied, so closing the
  // modal doesn't get undone by the next unrelated re-render.
  const routedEntryId = useDeepLinkParam('entry');
  const deepLinkedEntryId = routedEntryId;
  const [appliedDeepLink, setAppliedDeepLink] = useState<string | null>(null);
  if (deepLinkedEntryId && deepLinkedEntryId !== appliedDeepLink) {
    const target = entries.find((e) => e.id === deepLinkedEntryId);
    if (target) {
      setAppliedDeepLink(deepLinkedEntryId);
      setSelectedEntryId(target.id);
    }
  }
  // A graph-open request is consumed once. Keeping it separate from route
  // requests allows later search/backlink navigation to open another card.
  const [appliedFocus, setAppliedFocus] = useState<string | null>(null);
  if (focusEntryId && focusEntryId !== appliedFocus) {
    const target = entries.find(entry => entry.id === focusEntryId && entry.projectId === projectId);
    if (target) { setAppliedFocus(focusEntryId); setSelectedEntryId(target.id); }
  }
  const [pendingDeleteEntry, setPendingDeleteEntry] = useState<CodexEntry | null>(null);

  // Which chapters each character is named in. The scan reads every writing in
  // the project, so it runs ONCE per visit to this tab and only once a character
  // is actually opened — not on mount for a writer who came here for a location,
  // and never per entry or per render. Holding the result in state is the guard:
  // an index already here is an instant no-op, and `loadCodexAppearances` shares
  // one scan between the two mounts StrictMode makes (tasks/lessons.md #19).
  // Leaving the tab and coming back remounts this list, which is what picks up
  // the chapters written in between.
  const [appearanceScan, setAppearanceScan] = useState<{
    projectId: string;
    index: Map<string, CodexAppearance[]>;
  } | null>(null);
  const appearanceIndex = appearanceScan?.projectId === projectId ? appearanceScan.index : null;
  const characterOpened = selectedEntry?.type === 'character';

  useEffect(() => {
    if (!characterOpened || appearanceIndex) return;
    let cancelled = false;
    loadCodexAppearances(projectId)
      .then(index => {
        if (!cancelled) setAppearanceScan({ projectId, index });
      })
      .catch(error => console.error('Codex appearances could not be scanned', error));
    return () => {
      cancelled = true;
    };
  }, [projectId, characterOpened, appearanceIndex]);

  const typeEntries = entries.filter(e => (filterType === 'all' || e.type === filterType) && (!filterTemplate || templateIsWithin(e.templateId, filterTemplate, project?.codexTemplates ?? [])));
  const filtered = search.trim() ? searchEntries(search, typeEntries.map(entry => ({ ...entry, fields: projectCodexEntry(entry, project?.codexTemplates ?? []).fields })), typeEntries.length).map(found => typeEntries.find(entry => entry.id === found.id)!) : typeEntries;

  const types: (CodexEntryType | 'all')[] = ['all', 'character', 'location', 'item', 'faction', 'concept', 'magic', 'custom'];

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px] relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('codex.searchEntries')}
            className="w-full pl-9 pr-4 py-2 bg-elevated border border-border rounded-lg text-text-primary text-sm outline-none focus:border-accent-gold transition"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {types.map((ty) => (
            <button
              key={ty}
              onClick={() => setFilterType(ty)}
              className={`px-2.5 py-1.5 rounded-lg text-xs transition ${
                filterType === ty
                  ? 'bg-accent-gold/20 text-accent-gold'
                  : 'text-text-muted hover:text-text-primary hover:bg-elevated'
              }`}
            >
              {ty === 'all' ? t('codex.types.all') : t(`codex.types.${ty}`)}
            </button>
          ))}
        </div>
        <ScheherazadeButtons projectId={projectId} />
        <button type="button" onClick={() => { setTemplateSeed(undefined); setShowTemplates(true); }} className="px-3 py-2 rounded-lg border border-border text-sm text-text-primary hover:bg-elevated">{t('codex.templates.title')}</button>
        {!!project?.codexTemplates?.length && <select aria-label={t('codex.templates.template')} value={filterTemplate} onChange={event => setFilterTemplate(event.target.value)} className="px-2 py-2 rounded-lg border border-border bg-elevated text-sm text-text-primary"><option value="">{t('codex.types.all')}</option>{selectableCodexTemplates(project.codexTemplates,filterTemplate).map(template => <option key={template.id} value={template.id}>{templatePath(template, project.codexTemplates!)}{effectiveTemplatePresentation(template,project.codexTemplates??[]).hiddenFromPickers?` (${templatePresentationCopy[locale].hiddenTag})`:''}</option>)}</select>}
        <button
          onClick={() => { setFormTemplate(undefined); setShowForm(true); }}
          className="flex items-center gap-1.5 px-4 py-2 bg-accent-gold text-deep font-semibold text-sm rounded-lg hover:bg-accent-amber transition"
        >
          <Plus size={16} />
          {t('codex.newEntry')}
        </button>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<User size={40} />}
          title={t('codex.noEntries.title')}
          message={t('codex.noEntries.message')}
          action={{ label: t('codex.createEntry'), onClick: () => setShowForm(true) }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(entry => {
            const Icon = typeIcons[entry.type] || HelpCircle;
            const entryTemplate=project?.codexTemplates?.find(template=>template.id===entry.templateId),appearance=effectiveTemplatePresentation(entryTemplate,project?.codexTemplates??[]);
            const color = appearance.color??typeColors[entry.type];
            const imageSize=appearance.imageLayout==='portrait'?'w-10 h-14':appearance.imageLayout==='landscape'?'w-16 h-10':'w-10 h-10';
            return (
              <button
                key={entry.id}
                onClick={() => setSelectedEntryId(entry.id)}
                className="text-left p-4 bg-surface border border-border rounded-xl hover:border-accent-gold/40 transition group"
              >
                <div className="flex items-start gap-3">
                  <div className={`${entry.avatar&&appearance.imageLayout!=='none'?imageSize:'w-10 h-10'} rounded-lg flex items-center justify-center flex-shrink-0`} style={{ backgroundColor: `${color}20` }}>
                    {entry.avatar&&appearance.imageLayout!=='none' ? (
                      <img src={entry.avatar} alt="" className={`${imageSize} rounded-lg object-cover`} />
                    ) : (
                      <ProjectIcon name={appearance.icon} fallback={Icon} size={20} style={{ color }} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-serif font-bold text-text-primary group-hover:text-accent-gold transition truncate">
                      {entry.title}
                    </h3>
                    <p className="text-xs mt-0.5 flex items-center gap-1.5" style={{ color }}>{entryTemplate&&<ProjectIcon name={appearance.icon} fallback={Icon} size={12}/>}<span>{entryTemplate?.name??t(`codex.types.${entry.type}`)}</span></p>
                    {entry.tags.length > 0 && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {entry.tags.slice(0, 3).map(tag => (
                          <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-elevated rounded text-text-dim">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal open={showForm || !!editEntry} busy={savingForm} dismissible={!formDirty} onClose={() => { setShowForm(false); setEditEntry(null); }} title={editEntry ? t('codex.editEntry') : t('codex.newCodexEntry')} wide>
        <CodexEntryForm
          key={editEntry?.id ?? 'new'}
          projectId={projectId}
          entry={editEntry || undefined}
          template={editEntry ? undefined : formTemplate}
          onPendingChange={setSavingForm}
          onDirtyChange={setFormDirty}
          onSave={async (entry, base) => {
            if (editEntry) {
              await onEdit(entry.id, entry, base);
            } else {
              await onAdd(entry);
              // Open the freshly created entry instead of dumping the user
              // back on the grid to hunt for it.
              setSelectedEntryId(entry.id);
            }
            setShowForm(false);
            setEditEntry(null);
          }}
          onCancel={() => { setShowForm(false); setEditEntry(null); }}
        />
      </Modal>
      <CodexTemplateManager key={templateSeed?.id ?? 'templates'} projectId={projectId} open={showTemplates} initial={templateSeed} onClose={() => setShowTemplates(false)} onUse={template => { setFormTemplate(template); setShowTemplates(false); setSelectedEntryId(null); setEditEntry(null); setShowForm(true); }} />

      {/* Detail View Modal */}
      <Modal open={!!selectedEntry} onClose={() => setSelectedEntryId(null)} title={selectedEntry?.title} wide>
        {selectedEntry && (
          <div className="space-y-4">
            <div className="flex items-start gap-4 mb-4">
              {selectedEntry.avatar&&selectedTemplate?.imageLayout!=='none' && (
                <button
                  type="button"
                  onClick={() => setLightboxSrc(selectedEntry.avatarOriginal || selectedEntry.avatar || null)}
                  className="flex-shrink-0 rounded-xl hover:opacity-90 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold"
                  aria-label={t('gallery.lightbox.title')}
                  title={t('gallery.lightbox.title')}
                >
                  <img src={selectedEntry.avatar} alt="" className={`${selectedTemplate?.imageLayout==='portrait'?'w-24 h-36':selectedTemplate?.imageLayout==='landscape'?'w-48 h-28':'w-24 h-24'} rounded-xl object-cover border border-border`} />
                </button>
              )}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs px-2 py-1 rounded inline-flex items-center gap-1.5" style={{ backgroundColor: `${selectedTemplate?.color??typeColors[selectedEntry.type]}20`, color: selectedTemplate?.color??typeColors[selectedEntry.type] }}>
                  <ProjectIcon name={selectedTemplate?.icon} fallback={typeIcons[selectedEntry.type]} size={14}/>
                  {t(`codex.types.${selectedEntry.type}`)}
                </span>
                {selectedEntry.tags.map(tag => (
                  <span key={tag} className="text-xs px-2 py-1 bg-elevated rounded text-text-muted">
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {readAliases(selectedEntry.fields).length > 0 && (
              <p className="text-sm text-text-muted break-words"><span className="font-semibold">{t('codex.aliases')}:</span> {readAliases(selectedEntry.fields).join(' · ')}</p>
            )}
            {selectedEntry.templateId && <p className="text-sm text-text-muted">{t('codex.templates.template')}: {project?.codexTemplates?.find(template => template.id === selectedEntry.templateId)?.name ?? t('codex.templates.retired')}</p>}
            {Object.entries(selectedEntry.referenceFields ?? {}).map(([key, ids]) => <div key={key}><h4 className="text-sm text-text-muted mb-1">{selectedTemplate?.referenceFieldDefinitions?.find(definition => definition.key === key)?.label ?? key}</h4><div className="flex flex-wrap gap-2">{ids.map(id => { const target = entries.find(entry => entry.id === id); return target ? <button key={id} type="button" onClick={() => setSelectedEntryId(target.id)} className="text-sm text-accent-gold underline underline-offset-2">{target.title}</button> : <span key={id} className="text-xs text-text-dim">{t('codex.fields.missingReference')}</span>; })}</div></div>)}

            {/* Fields */}
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(selectedProjection?.fields ?? selectedEntry.fields).filter(([key, v]) => v && !isAliasField(key)).map(([key, value]) => (
                <div key={key} className="p-3 bg-elevated rounded-lg">
                  <div className="text-xs text-text-muted mb-1 capitalize">{selectedProjection?.properties[key]?.label ?? key.replace(/([A-Z])/g, ' $1')}</div>
                  <div className="text-sm text-text-primary">{selectedProjection?.properties[key]?.displayValue??value}</div>
                </div>
              ))}
            </div>

            {/* Content */}
            {selectedEntry.content && (
              <div className="tiptap-editor border border-border rounded-lg p-4 bg-elevated">
                <div dangerouslySetInnerHTML={sanitizedHtml(selectedEntry.content)} />
              </div>
            )}

            {/* Linked Images Gallery */}
            <LinkedImages
              projectId={projectId}
              entryId={selectedEntry.id}
              onOpen={setLightboxSrc}
            />

            {/* Character web — arcs, relationships, scene appearances */}
            {selectedEntry.type === 'character' && (
              <CharacterConnections
                projectId={projectId}
                entry={selectedEntry}
                appearances={appearanceIndex?.get(selectedEntry.id)}
              />
            )}

            {/* Annotation surface — margin notes + backlinks */}
            <div className="pt-2 border-t border-border">
              <AnnotationSurface
                projectId={projectId}
                engineId="codex"
                entityId={selectedEntry.id}
                layout="stack"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => { const source = project?.codexTemplates?.find(template => template.id === selectedEntry.templateId); const seed = templateFromEntry(selectedEntry, generateId('codex-template'), selectedEntry.title, Date.now(), source ? propertyDefinitions(effectiveCodexTemplate(source, project?.codexTemplates ?? [])) : selectedEntry.propertyDefinitions); setTemplateSeed({ ...seed, ...effectiveTemplatePresentation(source,project?.codexTemplates??[]),referenceFieldDefinitions: source ? effectiveCodexTemplate(source, project?.codexTemplates ?? []).referenceFieldDefinitions : seed.referenceFieldDefinitions }); setShowTemplates(true); }} className="px-3 py-2 rounded-lg border border-border text-sm text-text-primary hover:bg-elevated">{t('codex.templates.fromEntry')}</button>
              <button
                onClick={() => { setSelectedEntryId(null); setEditEntry(selectedEntry); }}
                className="flex-1 py-2.5 bg-accent-gold text-deep font-semibold rounded-lg hover:bg-accent-amber transition"
              >
                {t('common.edit')}
              </button>
              {selectedEntry.type === 'character' && (
                <SendToProsperoButton kind="character" projectId={projectId} id={selectedEntry.id} className="inline-flex items-center gap-1.5 px-4 py-2.5 border border-border text-text-primary rounded-lg hover:border-accent-gold transition disabled:opacity-60 disabled:cursor-wait" />
              )}
              <button
                onClick={() => setPendingDeleteEntry(selectedEntry)}
                className="px-6 py-2.5 border border-danger/50 text-danger rounded-lg hover:bg-danger/10 transition"
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={pendingDeleteEntry !== null}
        destructive
        message={t('codex.confirmDelete').replace('{name}', pendingDeleteEntry?.title ?? '')}
        onConfirm={() => {
          const entry = pendingDeleteEntry;
          setPendingDeleteEntry(null);
          if (!entry) return;
          setSelectedEntryId(null);
          // A deleted entry leaves no edit to recover.
          void deleteWithDraftCleanup(drafts, [entry.id], async () => onDelete(entry.id))
            .catch(error => console.error('Codex entry could not be deleted', error));
        }}
        onCancel={() => setPendingDeleteEntry(null)}
      />

      {/* Image lightbox — a stacked modal: an inline overlay sat under the
          detail dialog's inert background and could be neither clicked nor escaped. */}
      <Modal open={lightboxSrc !== null} onClose={() => setLightboxSrc(null)} ariaLabel={t('gallery.lightbox.title')} fullscreen>
        <div className="relative flex min-h-[70vh] items-center justify-center px-12 py-8">
          <button
            type="button"
            onClick={() => setLightboxSrc(null)}
            className="absolute top-2 right-2 p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X size={24} className="text-white" aria-hidden="true" />
          </button>
          {lightboxSrc && <img src={lightboxSrc} alt="" className="max-w-[90vw] max-h-[80vh] rounded-lg shadow-2xl" />}
        </div>
      </Modal>
    </div>
  );
}
