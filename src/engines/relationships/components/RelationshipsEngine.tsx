import { useState, useMemo } from 'react';
import { Network, Plus, Trash2, X, LayoutGrid, List } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { EngineComponentProps } from '@/engines/_types';
import { EngineSpinner, ConfirmDialog, useDebouncedField } from '@/engines/_shared';
import { navigateTo } from '@/engines/_shared/anchoring';
import ColorPicker from '@/components/common/ColorPicker';
import EmptyState from '@/components/common/EmptyState';
import { useProject } from '@/hooks/useProjects';
import { useRelationships } from '../hooks';
import type { Relationship, RelationshipKind } from '../types';
import { RELATIONSHIP_KIND_CONFIG, RELATIONSHIP_STATE_CONFIG, intensityColor } from '../types';
import { useCodexEntries } from '@/engines/codex/hooks';
import { generateId } from '@/utils/idGenerator';

// ---------------------------------------------------------------------------
// RelationshipsEngine
// ---------------------------------------------------------------------------

type ViewMode = 'matrix' | 'list';

export default function RelationshipsEngine({ projectId }: EngineComponentProps) {
  const { t } = useTranslation();
  const { items: relationships, loading, addItem: addRel, editItem: editRel, removeItem: removeRel } =
    useRelationships(projectId);
  const { items: codexEntries, loading: codexLoading } = useCodexEntries(projectId);
  const { project } = useProject(projectId);
  const [viewMode, setViewMode] = useState<ViewMode>('matrix');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [pendingDeleteRelId, setPendingDeleteRelId] = useState<string | null>(null);

  const characters = useMemo(
    () => codexEntries.filter((e) => e.type === 'character'),
    [codexEntries],
  );

  // Index: { 'aId:bId' → Relationship[] }
  const relationshipIndex = useMemo(() => {
    const map = new Map<string, Relationship[]>();
    for (const r of relationships) {
      const key1 = `${r.entityAId}:${r.entityBId}`;
      const key2 = `${r.entityBId}:${r.entityAId}`;
      if (!map.has(key1)) map.set(key1, []);
      map.get(key1)!.push(r);
      // For non-directional, also populate reverse key
      if (!r.directional) {
        if (!map.has(key2)) map.set(key2, []);
        map.get(key2)!.push(r);
      }
    }
    return map;
  }, [relationships]);

  if (loading || codexLoading) return <EngineSpinner />;

  const editing = editingId ? relationships.find((r) => r.id === editingId) : null;

  return (
    <div className="space-y-4">
      {/* --- Header --- */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-base font-serif font-semibold text-text-primary flex items-center gap-2">
          <Network size={15} className="text-accent-gold" />
          {t('relationships.title')}
        </h2>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-elevated border border-border overflow-hidden">
            <button
              onClick={() => setViewMode('matrix')}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs transition ${
                viewMode === 'matrix' ? 'bg-accent-gold/20 text-accent-gold' : 'text-text-dim hover:text-text-primary'
              }`}
              title={t('relationships.view.matrix')}
            >
              <LayoutGrid size={12} />
              {t('relationships.view.matrix')}
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs transition ${
                viewMode === 'list' ? 'bg-accent-gold/20 text-accent-gold' : 'text-text-dim hover:text-text-primary'
              }`}
              title={t('relationships.view.list')}
            >
              <List size={12} />
              {t('relationships.view.list')}
            </button>
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent-gold/10 text-accent-gold rounded-lg hover:bg-accent-gold/20 transition"
          >
            <Plus size={14} />
            {t('relationships.new')}
          </button>
        </div>
      </div>

      {/* --- New form --- */}
      {showNew && (
        <NewRelationshipForm
          projectId={projectId}
          characters={characters}
          onCreate={async (rel) => {
            await addRel(rel);
            setShowNew(false);
            setEditingId(rel.id);
          }}
          onCancel={() => setShowNew(false)}
        />
      )}

      {/* --- Editor dialog --- */}
      {editing && (
        <RelationshipEditor
          relationship={editing}
          onSave={(changes) => editRel(editing.id, changes)}
          onDelete={async () => {
            await removeRel(editing.id);
            setEditingId(null);
          }}
          onClose={() => setEditingId(null)}
        />
      )}

      {/* --- Main view --- */}
      {characters.length === 0 ? (
        // Nothing here can be created until the codex has people in it, so the
        // empty state carries the jump rather than making the writer find the
        // tab themselves. Guarded: a project that has switched the codex off
        // would be bounced back to Overview by the router.
        <EmptyState
          icon={<Network size={40} />}
          title={t('relationships.needCharacters.title')}
          message={t('relationships.needCharacters')}
          action={
            project?.enabledEngines?.includes('codex')
              ? { label: t('relationships.openCodex'), onClick: () => navigateTo(`/project/${projectId}/codex`) }
              : undefined
          }
        />
      ) : relationships.length === 0 ? (
        // Sits above the view switch on purpose. The matrix is the default
        // view, and with no ties yet it is a grid of blank cells that nothing
        // clicks — the emptiest screen in the engine, shown first.
        <EmptyState
          icon={<Network size={40} />}
          title={t('relationships.empty.title')}
          message={t('relationships.empty.message')}
          action={{ label: t('relationships.new'), onClick: () => setShowNew(true) }}
        />
      ) : viewMode === 'matrix' ? (
        <MatrixView
          characters={characters}
          relationshipIndex={relationshipIndex}
          onCellClick={(r) => setEditingId(r.id)}
        />
      ) : (
        <ListView
          relationships={relationships}
          onEdit={(r) => setEditingId(r.id)}
          onDelete={(id) => setPendingDeleteRelId(id)}
        />
      )}

      <ConfirmDialog
        open={pendingDeleteRelId !== null}
        destructive
        message={t('relationships.confirmDelete')}
        onConfirm={async () => {
          if (!pendingDeleteRelId) return;
          const id = pendingDeleteRelId;
          setPendingDeleteRelId(null);
          await removeRel(id);
        }}
        onCancel={() => setPendingDeleteRelId(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// MatrixView
// ---------------------------------------------------------------------------

function MatrixView({
  characters,
  relationshipIndex,
  onCellClick,
}: {
  characters: { id: string; title: string }[];
  relationshipIndex: Map<string, Relationship[]>;
  onCellClick: (r: Relationship) => void;
}) {
  const { t } = useTranslation();
  if (characters.length < 2) {
    return (
      <p className="text-xs text-text-dim text-center py-8">{t('relationships.matrix.needTwo')}</p>
    );
  }
  return (
    <div className="overflow-auto border border-border rounded-xl bg-surface/50">
      <table className="text-[11px] border-collapse">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-20 bg-surface p-2 border-b border-r border-border" />
            {characters.map((c) => (
              <th
                key={c.id}
                className="sticky top-0 z-10 bg-surface p-2 border-b border-border text-text-primary font-semibold"
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', minHeight: 80 }}
              >
                <span className="inline-block whitespace-nowrap">{c.title}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {characters.map((row) => (
            <tr key={row.id}>
              <th className="sticky left-0 z-10 bg-surface p-2 border-r border-border text-text-primary font-semibold text-left whitespace-nowrap">
                {row.title}
              </th>
              {characters.map((col) => {
                if (row.id === col.id) {
                  return (
                    <td
                      key={col.id}
                      className="w-12 h-12 border border-border/30 bg-elevated/40"
                    />
                  );
                }
                const rels = relationshipIndex.get(`${row.id}:${col.id}`) ?? [];
                const primary = rels[0];
                return (
                  <td
                    key={col.id}
                    className="w-12 h-12 border border-border/30 p-0.5"
                  >
                    {primary ? (
                      <button
                        onClick={() => onCellClick(primary)}
                        className="w-full h-full rounded flex items-center justify-center text-sm hover:ring-2 hover:ring-accent-gold transition"
                        style={{ backgroundColor: `${intensityColor(primary.intensity)}30`, borderColor: intensityColor(primary.intensity) }}
                        title={`${primary.entityAName} → ${primary.entityBName}\n${t(RELATIONSHIP_KIND_CONFIG[primary.kind]?.labelKey ?? '')}${primary.label ? ` — ${primary.label}` : ''}`}
                      >
                        {RELATIONSHIP_KIND_CONFIG[primary.kind]?.emoji}
                      </button>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ListView
// ---------------------------------------------------------------------------

// The empty case belongs to the engine, not here: it has to cover the matrix
// view too, and both views want the same sentence and the same button.
function ListView({
  relationships,
  onEdit,
  onDelete,
}: {
  relationships: Relationship[];
  onEdit: (r: Relationship) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      {relationships.map((r) => {
        const cfg = RELATIONSHIP_KIND_CONFIG[r.kind];
        const state = RELATIONSHIP_STATE_CONFIG[r.state];
        // Per-relationship override first, kind palette as the fallback —
        // the field was documented that way from the start.
        const chipColor = r.color ?? cfg?.color;
        return (
          <div key={r.id} className="group flex items-center gap-3 border border-border rounded-lg bg-elevated/40 p-3 hover:border-accent-gold/40 transition">
            <button
              onClick={() => onEdit(r)}
              className="flex-1 min-w-0 text-left flex items-center gap-3"
            >
              <span className="text-lg" aria-hidden>{cfg?.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-text-primary truncate">
                  {r.entityAName} <span className="text-text-dim">{r.directional ? '→' : '↔'}</span> {r.entityBName}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-text-dim">
                  <span className="px-1.5 py-0.5 rounded" style={{ backgroundColor: `${chipColor}30`, color: chipColor }}>
                    {cfg ? t(cfg.labelKey) : ''}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded ${state?.color}`}>{state ? t(state.labelKey) : ''}</span>
                  <span>
                    {t('relationships.intensity')}: <span style={{ color: intensityColor(r.intensity) }}>{r.intensity > 0 ? '+' : ''}{r.intensity}</span>
                  </span>
                  {r.label && <span className="truncate">· {r.label}</span>}
                </div>
              </div>
            </button>
            <button
              onClick={() => onDelete(r.id)}
              className="p-1.5 rounded text-text-dim opacity-0 group-hover:opacity-100 hover:text-danger hover:bg-danger/10 transition"
              title={t('common.delete')}
            >
              <Trash2 size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NewRelationshipForm
// ---------------------------------------------------------------------------

function NewRelationshipForm({
  projectId,
  characters,
  onCreate,
  onCancel,
}: {
  projectId: string;
  characters: { id: string; title: string }[];
  onCreate: (rel: Relationship) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [aId, setAId] = useState<string>(characters[0]?.id ?? '');
  const [bId, setBId] = useState<string>(characters[1]?.id ?? characters[0]?.id ?? '');
  const [kind, setKind] = useState<RelationshipKind>('friend');
  const [label, setLabel] = useState('');

  const canCreate = aId && bId && aId !== bId;

  const handleSubmit = async () => {
    if (!canCreate) return;
    const a = characters.find((c) => c.id === aId);
    const b = characters.find((c) => c.id === bId);
    if (!a || !b) return;
    const now = Date.now();
    const rel: Relationship = {
      id: generateId('rel'),
      projectId,
      entityAId: a.id,
      entityAType: 'codex-entry',
      entityAName: a.title,
      entityBId: b.id,
      entityBType: 'codex-entry',
      entityBName: b.title,
      kind,
      intensity: 0,
      label: label.trim(),
      notes: '',
      state: 'current',
      directional: false,
      createdAt: now,
      updatedAt: now,
    };
    await onCreate(rel);
  };

  return (
    <div className="border border-accent-gold/40 rounded-xl bg-surface/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-serif font-semibold text-accent-gold">{t('relationships.new')}</h3>
        <button onClick={onCancel} className="p-1 text-text-dim hover:text-text-primary transition" title={t('common.cancel')}>
          <X size={14} />
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-text-dim">{t('relationships.entityA')}</span>
          <select
            value={aId}
            onChange={(e) => setAId(e.target.value)}
            className="w-full px-3 py-1.5 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
          >
            {characters.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-text-dim">{t('relationships.entityB')}</span>
          <select
            value={bId}
            onChange={(e) => setBId(e.target.value)}
            className="w-full px-3 py-1.5 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
          >
            {characters.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-text-dim">{t('relationships.kind')}</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as RelationshipKind)}
            className="w-full px-3 py-1.5 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
          >
            {(Object.entries(RELATIONSHIP_KIND_CONFIG) as [RelationshipKind, { labelKey: string; emoji: string }][]).map(([k, v]) => (
              <option key={k} value={k}>{v.emoji} {t(v.labelKey)}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-text-dim">{t('relationships.label')}</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t('relationships.labelPlaceholder')}
            className="w-full px-3 py-1.5 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
          />
        </label>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs text-text-dim hover:text-text-primary transition">
          {t('common.cancel')}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canCreate}
          className="px-3 py-1.5 text-xs bg-accent-gold text-bg rounded-lg hover:bg-accent-gold/90 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {t('common.create')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RelationshipEditor
// ---------------------------------------------------------------------------

function RelationshipEditor({
  relationship: r,
  onSave,
  onDelete,
  onClose,
}: {
  relationship: Relationship;
  onSave: (changes: Partial<Relationship>) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const cfg = RELATIONSHIP_KIND_CONFIG[r.kind];
  const [pendingDelete, setPendingDelete] = useState(false);

  const handleField = <K extends keyof Relationship>(key: K) => (value: Relationship[K]) =>
    onSave({ [key]: value, updatedAt: Date.now() } as Partial<Relationship>);

  // Buffered. `relationships` sorts by `updatedAt desc`, so typing a note
  // reordered the list underneath on every character, and the controlled input
  // — bound to the refreshed row — swallowed keystrokes.
  const labelField = useDebouncedField(r.label, handleField('label'));
  const notesField = useDebouncedField(r.notes, handleField('notes'));

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-xl max-h-[90vh] overflow-auto border border-border rounded-xl bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-2xl" aria-hidden>{cfg?.emoji}</span>
            <div>
              <div className="text-sm font-semibold text-text-primary">
                {r.entityAName} {r.directional ? '→' : '↔'} {r.entityBName}
              </div>
              <div className="text-xs text-text-dim">{cfg ? t(cfg.labelKey) : ''}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-elevated text-text-dim hover:text-text-primary transition" title={t('common.close')}>
            <X size={16} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs text-text-dim">{t('relationships.kind')}</span>
              <select
                value={r.kind}
                onChange={(e) => handleField('kind')(e.target.value as RelationshipKind)}
                className="w-full px-3 py-1.5 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
              >
                {(Object.entries(RELATIONSHIP_KIND_CONFIG) as [RelationshipKind, { labelKey: string; emoji: string }][]).map(([k, v]) => (
                  <option key={k} value={k}>{v.emoji} {t(v.labelKey)}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-text-dim">{t('relationships.state')}</span>
              <select
                value={r.state}
                onChange={(e) => handleField('state')(e.target.value as Relationship['state'])}
                className="w-full px-3 py-1.5 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
              >
                {(Object.entries(RELATIONSHIP_STATE_CONFIG) as [Relationship['state'], { labelKey: string }][]).map(([k, v]) => (
                  <option key={k} value={k}>{t(v.labelKey)}</option>
                ))}
              </select>
            </label>
            <div className="space-y-1">
              <span className="text-xs text-text-dim block">{t('relationships.color')}</span>
              <div className="flex items-center gap-2">
                {/* The field was documented as an override of the kind's color
                    since day one; this is its first selector. */}
                <ColorPicker
                  value={r.color ?? cfg?.color ?? '#c4973b'}
                  onChange={(color) => handleField('color')(color)}
                  size="sm"
                />
                {r.color && (
                  <button
                    onClick={() => handleField('color')(undefined)}
                    className="p-1 rounded text-text-dim hover:text-text-primary hover:bg-elevated transition"
                    title={t('relationships.colorReset')}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="space-y-1 block">
              <span className="text-xs text-text-dim">
                {t('relationships.intensity')}
                <span className="ml-2" style={{ color: intensityColor(r.intensity) }}>
                  {r.intensity > 0 ? '+' : ''}{r.intensity}
                </span>
              </span>
              <input
                type="range"
                min={-5}
                max={5}
                step={1}
                value={r.intensity}
                onChange={(e) => handleField('intensity')(Number(e.target.value))}
                className="w-full accent-accent-gold"
              />
              <div className="flex justify-between text-[10px] text-text-dim">
                <span>-5 hate</span>
                <span>0 neutral</span>
                <span>+5 love</span>
              </div>
            </label>
          </div>

          <label className="space-y-1 block">
            <span className="text-xs text-text-dim">{t('relationships.label')}</span>
            <input
              value={labelField.value}
              onChange={(e) => labelField.onChange(e.target.value)}
              onBlur={labelField.onBlur}
              placeholder={t('relationships.labelPlaceholder')}
              className="w-full px-3 py-1.5 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
            />
          </label>

          <label className="space-y-1 block">
            <span className="text-xs text-text-dim">{t('relationships.notes')}</span>
            <textarea
              value={notesField.value}
              onChange={(e) => notesField.onChange(e.target.value)}
              onBlur={notesField.onBlur}
              rows={4}
              placeholder={t('relationships.notesPlaceholder')}
              className="w-full px-3 py-2 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition resize-none"
            />
          </label>

          <label className="flex items-center gap-2 text-xs text-text-dim cursor-pointer">
            <input
              type="checkbox"
              checked={r.directional}
              onChange={(e) => handleField('directional')(e.target.checked)}
              className="accent-accent-gold"
            />
            <span>{t('relationships.directional')}</span>
          </label>
        </div>
        <div className="flex items-center justify-between p-4 border-t border-border">
          <button
            onClick={() => setPendingDelete(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-danger hover:bg-danger/10 rounded-lg transition"
          >
            <Trash2 size={12} />
            {t('common.delete')}
          </button>
          <button onClick={onClose} className="px-3 py-1.5 text-xs bg-accent-gold text-bg rounded-lg hover:bg-accent-gold/90 transition">
            {t('common.done')}
          </button>
        </div>
      </div>

      {/* Stop-propagation wrapper: this dialog lives inside the editor's own
          backdrop, whose onClick closes the editor. Without it, clicking
          "Cancel" in the confirmation bubbled up and dismissed the relationship
          editor too — cancelling a delete threw away the edit session. */}
      <div onClick={(e) => e.stopPropagation()}>
        <ConfirmDialog
          open={pendingDelete}
          destructive
          message={t('relationships.confirmDelete')}
          onConfirm={async () => {
            setPendingDelete(false);
            await onDelete();
          }}
          onCancel={() => setPendingDelete(false)}
        />
      </div>
    </div>
  );
}
