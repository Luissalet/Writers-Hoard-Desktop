import { useState, useMemo } from 'react';
import { Network, Plus, Trash2, X, LayoutGrid, List } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { EngineComponentProps } from '@/engines/_types';
import { EngineSpinner } from '@/engines/_shared';
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
  const [viewMode, setViewMode] = useState<ViewMode>('matrix');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

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
        <div className="flex flex-col items-center justify-center py-16 text-text-dim">
          <Network size={36} className="mb-3 opacity-40" />
          <p className="text-sm">{t('relationships.needCharacters')}</p>
        </div>
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
          onDelete={async (id) => {
            if (confirm(t('relationships.confirmDelete'))) await removeRel(id);
          }}
        />
      )}
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
                        title={`${primary.entityAName} → ${primary.entityBName}\n${RELATIONSHIP_KIND_CONFIG[primary.kind]?.label}${primary.label ? ` — ${primary.label}` : ''}`}
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

function ListView({
  relationships,
  onEdit,
  onDelete,
}: {
  relationships: Relationship[];
  onEdit: (r: Relationship) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  if (relationships.length === 0) {
    return <p className="text-xs text-text-dim text-center py-8">{t('relationships.empty')}</p>;
  }
  return (
    <div className="space-y-2">
      {relationships.map((r) => {
        const cfg = RELATIONSHIP_KIND_CONFIG[r.kind];
        const state = RELATIONSHIP_STATE_CONFIG[r.state];
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
                  <span className="px-1.5 py-0.5 rounded" style={{ backgroundColor: `${cfg?.color}30`, color: cfg?.color }}>
                    {cfg?.label}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded ${state?.color}`}>{state?.label}</span>
                  <span>
                    {t('relationships.intensity')}: <span style={{ color: intensityColor(r.intensity) }}>{r.intensity > 0 ? '+' : ''}{r.intensity}</span>
                  </span>
                  {r.label && <span className="truncate">· {r.label}</span>}
                </div>
              </div>
            </button>
            <button
              onClick={async () => {
                await onDelete(r.id);
              }}
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
            {(Object.entries(RELATIONSHIP_KIND_CONFIG) as [RelationshipKind, { label: string; emoji: string }][]).map(([k, v]) => (
              <option key={k} value={k}>{v.emoji} {v.label}</option>
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

  const handleField = <K extends keyof Relationship>(key: K) => (value: Relationship[K]) => {
    onSave({ [key]: value, updatedAt: Date.now() } as Partial<Relationship>);
  };

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
              <div className="text-xs text-text-dim">{cfg?.label}</div>
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
                {(Object.entries(RELATIONSHIP_KIND_CONFIG) as [RelationshipKind, { label: string; emoji: string }][]).map(([k, v]) => (
                  <option key={k} value={k}>{v.emoji} {v.label}</option>
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
                {(Object.entries(RELATIONSHIP_STATE_CONFIG) as [Relationship['state'], { label: string }][]).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </label>
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
              value={r.label}
              onChange={(e) => handleField('label')(e.target.value)}
              placeholder={t('relationships.labelPlaceholder')}
              className="w-full px-3 py-1.5 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
            />
          </label>

          <label className="space-y-1 block">
            <span className="text-xs text-text-dim">{t('relationships.notes')}</span>
            <textarea
              value={r.notes}
              onChange={(e) => handleField('notes')(e.target.value)}
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
            onClick={async () => {
              if (confirm(t('relationships.confirmDelete'))) await onDelete();
            }}
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
    </div>
  );
}
