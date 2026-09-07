import { useState, useMemo, useRef } from 'react';
import { Network, Plus, Trash2, X, LayoutGrid, List } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { EngineComponentProps } from '@/engines/_types';
import { EngineSpinner, ConfirmDialog, useDebouncedField, useDeepLinkParam } from '@/engines/_shared';
import { navigateTo } from '@/engines/_shared/anchoring';
import ColorPicker from '@/components/common/ColorPicker';
import Modal from '@/components/common/Modal';
import EmptyState from '@/components/common/EmptyState';
import { useProject } from '@/hooks/useProjects';
import { useRelationships } from '../hooks';
import type { Relationship, RelationshipKind } from '../types';
import { RELATIONSHIP_KIND_CONFIG, RELATIONSHIP_STATE_CONFIG, intensityColor } from '../types';
import { useCodexEntries } from '@/engines/codex/hooks';
import { generateId } from '@/utils/idGenerator';
import { getRelationshipsCopy } from '../copy';
import { indexRelationships, relationshipPairKey } from '../matrix';
import { PairRelationships, RelationshipMatrix, type CharacterPair, type MatrixCharacter } from './RelationshipMatrix';

// ---------------------------------------------------------------------------
// RelationshipsEngine
// ---------------------------------------------------------------------------

type ViewMode = 'matrix' | 'list';

export default function RelationshipsEngine({ projectId }: EngineComponentProps) {
  const { t, locale } = useTranslation();
  const copy = getRelationshipsCopy(locale);
  const { items: relationships, loading, error, refresh, addItem: addRel, editItem: editRel, removeItem: removeRel } =
    useRelationships(projectId);
  const { items: codexEntries, loading: codexLoading, error: codexError, refresh: refreshCodex } = useCodexEntries(projectId);
  const { project } = useProject(projectId);
  const [viewMode, setViewMode] = useState<ViewMode>('matrix');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [pair, setPair] = useState<CharacterPair | null>(null);
  const [newPair, setNewPair] = useState<CharacterPair | null>(null);
  const [deleteError, setDeleteError] = useState(false);
  const [pendingDeleteRelId, setPendingDeleteRelId] = useState<string | null>(null);
  const linkedId = useDeepLinkParam('entity');
  const [appliedLink, setAppliedLink] = useState<string | null>(null);
  if (linkedId && linkedId !== appliedLink && relationships.some(row => row.id === linkedId)) {
    setAppliedLink(linkedId);
    setEditingId(linkedId);
  }

  const characters = useMemo(
    () => codexEntries.filter((e) => e.type === 'character'),
    [codexEntries],
  );

  const relationshipIndex = useMemo(() => indexRelationships(relationships), [relationships]);
  const currentPair = pair ? pair.map((entry) => characters.find((character) => character.id === entry.id) ?? entry) as CharacterPair : null;
  const openCharacter = (character: MatrixCharacter) => {
    if (!project?.enabledEngines?.includes('codex')) { navigateTo(`/project/${encodeURIComponent(projectId)}/overview?manage=1`); return; }
    navigateTo(`/project/${encodeURIComponent(projectId)}/codex?entry=${encodeURIComponent(character.id)}`);
  };

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
              aria-pressed={viewMode === 'matrix'}
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
              aria-pressed={viewMode === 'list'}
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
            onClick={() => { setNewPair(null); setShowNew(true); }}
            disabled={characters.length < 2}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent-gold/10 text-accent-gold rounded-lg hover:bg-accent-gold/20 transition"
          >
            <Plus size={14} />
            {t('relationships.new')}
          </button>
        </div>
      </div>

      {(((error || codexError) && !showNew && !editing) || deleteError) && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"><span>{deleteError ? copy.deleteFailed : copy.loadFailed}</span><button type="button" onClick={() => { setDeleteError(false); void refresh(); void refreshCodex(); }} className="rounded px-2 py-1 underline underline-offset-2">{copy.retry}</button></div>}

      {/* --- New form --- */}
      {showNew && (
        <NewRelationshipForm
          key={newPair ? relationshipPairKey(newPair[0].id, newPair[1].id) : 'new'}
          projectId={projectId}
          characters={characters}
          initialPair={newPair}
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
          key={editing.id}
          relationship={editing}
          onOpenCharacter={(id) => {
            const character = characters.find((entry) => entry.id === id);
            if (character) openCharacter(character);
          }}
          characters={characters}
          onSave={(changes) => editRel(editing.id, changes)}
          onDelete={async () => {
            await removeRel(editing.id);
            setEditingId(null);
          }}
          onClose={() => setEditingId(null)}
        />
      )}

      {/* --- Main view --- */}
      {characters.length < 2 && relationships.length === 0 ? (
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
              : { label: t('project.manageEngines'), onClick: () => navigateTo(`/project/${projectId}/overview?manage=1`) }
          }
        />
      ) : viewMode === 'list' && relationships.length === 0 ? (
        <EmptyState
          icon={<Network size={40} />}
          title={t('relationships.empty.title')}
          message={t('relationships.empty.message')}
          action={{ label: t('relationships.new'), onClick: () => setShowNew(true) }}
        />
      ) : viewMode === 'matrix' && characters.length >= 2 ? (
        <>
        {currentPair && <PairRelationships
          pair={currentPair}
          relationships={relationshipIndex.get(relationshipPairKey(currentPair[0].id, currentPair[1].id)) ?? []}
          onCreate={() => { setNewPair(currentPair); setShowNew(true); }}
          onEdit={(row) => setEditingId(row.id)}
          onClose={() => setPair(null)}
          onOpenCharacter={openCharacter}
        />}
        <RelationshipMatrix
          characters={characters}
          relationshipIndex={relationshipIndex}
          selectedPair={currentPair}
          onPair={(selectedPair, rows) => {
            setPair(selectedPair);
            if (rows.length === 0) { setNewPair(selectedPair); setShowNew(true); }
          }}
          onOpenCharacter={openCharacter}
        />
        </>
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
          try { await removeRel(id); setDeleteError(false); }
          catch { setDeleteError(true); }
        }}
        onCancel={() => setPendingDeleteRelId(null)}
      />
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

export function NewRelationshipForm({
  projectId,
  characters,
  initialPair,
  onCreate,
  onCancel,
}: {
  projectId: string;
  characters: { id: string; title: string }[];
  initialPair?: CharacterPair | null;
  onCreate: (rel: Relationship) => Promise<void>;
  onCancel: () => void;
}) {
  const { t, locale } = useTranslation();
  const copy = getRelationshipsCopy(locale);
  const [aId, setAId] = useState<string>(initialPair?.[0].id ?? characters[0]?.id ?? '');
  const [bId, setBId] = useState<string>(initialPair?.[1].id ?? characters[1]?.id ?? characters[0]?.id ?? '');
  const [kind, setKind] = useState<RelationshipKind>('friend');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState(false);
  const submitting = useRef(false);

  const canCreate = aId && bId && aId !== bId;

  const handleSubmit = async () => {
    if (!canCreate || submitting.current) return;
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
    submitting.current = true;
    setSaving(true);
    setCreateError(false);
    try { await onCreate(rel); }
    catch { setCreateError(true); }
    finally { submitting.current = false; setSaving(false); }
  };

  return (
    <form onSubmit={(event) => { event.preventDefault(); void handleSubmit(); }} aria-label={t('relationships.new')} aria-busy={saving} className="border border-accent-gold/40 rounded-xl bg-surface/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-serif font-semibold text-accent-gold">{t('relationships.new')}</h3>
        <button type="button" onClick={onCancel} disabled={saving} className="p-1 text-text-dim hover:text-text-primary transition" title={t('common.cancel')}>
          <X size={14} />
        </button>
      </div>
      <fieldset disabled={saving} className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t('relationships.labelPlaceholder')}
            className="w-full px-3 py-1.5 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
          />
        </label>
      </fieldset>
      {createError && <p role="alert" className="text-sm text-danger">{copy.createFailed}</p>}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} disabled={saving} className="px-3 py-1.5 text-xs text-text-dim hover:text-text-primary transition">
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          disabled={!canCreate || saving}
          className="px-3 py-1.5 text-xs bg-accent-gold text-bg rounded-lg hover:bg-accent-gold/90 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {saving ? copy.saving : t('common.create')}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// RelationshipEditor
// ---------------------------------------------------------------------------

export function RelationshipEditor({
  relationship: r,
  onSave,
  onDelete,
  onClose,
  onOpenCharacter,
  characters,
}: {
  relationship: Relationship;
  onSave: (changes: Partial<Relationship>) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
  onOpenCharacter: (id: string) => void;
  characters: MatrixCharacter[];
}) {
  const { t, locale } = useTranslation();
  const copy = getRelationshipsCopy(locale);
  const cfg = RELATIONSHIP_KIND_CONFIG[r.kind];
  const [pendingDelete, setPendingDelete] = useState(false);
  const [failedChanges, setFailedChanges] = useState<Partial<Relationship> | null>(null);
  const [deleteError, setDeleteError] = useState(false);
  const [closing, setClosing] = useState(false);
  const [immediateSaving, setImmediateSaving] = useState(0);

  const saveImmediate = (changes: Partial<Relationship>) => {
    setImmediateSaving((count) => count + 1);
    void onSave(changes)
      .then(() => setFailedChanges((current) => {
        if (!current) return current;
        const next = { ...current };
        for (const key of Object.keys(changes) as Array<keyof Relationship>) delete next[key];
        return Object.keys(next).length ? next : null;
      }))
      .catch(() => setFailedChanges((current) => ({ ...current, ...changes })))
      .finally(() => setImmediateSaving((count) => count - 1));
  };
  const handleField = <K extends keyof Relationship>(key: K) => (value: Relationship[K]) =>
    saveImmediate({ [key]: value } as Partial<Relationship>);

  // Buffered. `relationships` sorts by `updatedAt desc`, so typing a note
  // reordered the list underneath on every character, and the controlled input
  // — bound to the refreshed row — swallowed keystrokes.
  const labelField = useDebouncedField(r.label, (label) => onSave({ label }));
  const notesField = useDebouncedField(r.notes, (notes) => onSave({ notes }));
  const saveFailed = Boolean(failedChanges || labelField.error || notesField.error);
  const close = async () => {
    if (closing || immediateSaving > 0) return;
    setClosing(true);
    const saved = await Promise.all([labelField.flush(), notesField.flush()]);
    setClosing(false);
    if (saved.every(Boolean) && !failedChanges) onClose();
  };
  const retry = async () => {
    if (failedChanges) {
      try { await onSave(failedChanges); setFailedChanges(null); } catch { /* keep the retry payload */ }
    }
    if (labelField.error) await labelField.retry();
    if (notesField.error) await notesField.retry();
  };
  const aName = characters.find((character) => character.id === r.entityAId)?.title ?? r.entityAName;
  const bName = characters.find((character) => character.id === r.entityBId)?.title ?? r.entityBName;

  return (
    <Modal open onClose={() => void close()} title={`${aName} ${r.directional ? '→' : '↔'} ${bName}`} busy={closing || immediateSaving > 0}>
      <div>
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl" aria-hidden>{cfg?.emoji}</span>
            <div>
              <div className="text-sm font-semibold text-text-primary">
                {[{ id: r.entityAId, title: aName }, { id: r.entityBId, title: bName }].map((character) => <button type="button" key={character.id} disabled={closing || immediateSaving > 0 || !characters.some((entry) => entry.id === character.id)} onClick={async () => {
                  if (closing || immediateSaving > 0) return;
                  setClosing(true);
                  const saved = await Promise.all([labelField.flush(), notesField.flush()]);
                  setClosing(false);
                  if (saved.every(Boolean) && !failedChanges) onOpenCharacter(character.id);
                }} title={characters.some((entry) => entry.id === character.id) ? copy.openCharacter.replace('{name}', character.title) : copy.missingCharacter} className="mr-3 rounded text-accent-gold underline underline-offset-2 disabled:text-text-dim disabled:no-underline">{character.title}</button>)}
              </div>
              <div className="text-xs text-text-dim">{cfg ? t(cfg.labelKey) : ''}</div>
            </div>
          </div>
        </div>
        <div className="py-4 space-y-3">
          {(saveFailed || deleteError) && <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger"><p>{deleteError ? copy.deleteFailed : copy.saveFailed}</p>{saveFailed && <button type="button" onClick={() => void retry()} className="shrink-0 rounded px-2 py-1 underline underline-offset-2">{copy.retry}</button>}</div>}
          <div className="grid grid-cols-2 gap-3">
            {(['A', 'B'] as const).map((side) => {
              const id = side === 'A' ? r.entityAId : r.entityBId;
              const name = side === 'A' ? aName : bName;
              const otherId = side === 'A' ? r.entityBId : r.entityAId;
              const missing = !characters.some((character) => character.id === id);
              return <label key={side} className="space-y-1"><span className="text-xs text-text-muted">{t(`relationships.entity${side}`)}</span><select value={id} onChange={(event) => {
                const character = characters.find((entry) => entry.id === event.target.value);
                if (character) saveImmediate(side === 'A' ? { entityAId: character.id, entityAName: character.title, entityAType: 'codex-entry' } : { entityBId: character.id, entityBName: character.title, entityBType: 'codex-entry' });
              }} className="w-full rounded-lg border border-border bg-elevated px-3 py-1.5 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold">{missing && <option value={id}>{name}</option>}{characters.filter((character) => character.id !== otherId).map((character) => <option key={character.id} value={character.id}>{character.title}</option>)}</select>{missing && <span className="block text-xs text-warning">{copy.missingCharacter}</span>}</label>;
            })}
          </div>
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
                <span>{copy.negative}</span>
                <span>{copy.neutral}</span>
                <span>{copy.positive}</span>
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
          <button onClick={() => void close()} disabled={closing || immediateSaving > 0} className="px-3 py-1.5 text-xs bg-accent-gold text-bg rounded-lg hover:bg-accent-gold/90 transition">
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
            try { await onDelete(); }
            catch { setDeleteError(true); }
          }}
          onCancel={() => setPendingDelete(false)}
        />
      </div>
    </Modal>
  );
}
