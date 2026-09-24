import { useState, useMemo, useEffect, useRef } from 'react';
import { TrendingUp, Plus, Trash2, ArrowLeft, ChevronDown, ChevronRight, Sparkles, GripVertical, MessageSquare, ListTree } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
// `t` (module-level, non-reactive) is for `seedTemplateBeats`, which runs
// outside React and writes the resolved text into the DB. Components use the
// `useTranslation()` hook so they re-render when the locale changes.
import { t, useTranslation } from '@/i18n/useTranslation';
import type { EngineComponentProps } from '@/engines/_types';
import { EngineSpinner, ConfirmDialog, LinkSelect, useDebouncedField, useDeepLinkParam } from '@/engines/_shared';
import { navigateTo } from '@/engines/_shared/anchoring';
import { useProject } from '@/hooks/useProjects';
import { toast } from '@/components/common/toast';
import EmptyState from '@/components/common/EmptyState';
import AnnotationSurface from '@/engines/annotations/components/AnnotationSurface';
import { useScenes } from '@/engines/dialog-scene/hooks';
import { useAllProjectBeats } from '@/engines/outline/hooks';
import { useCharacterArcs, useArcBeats } from '../hooks';
import type { CharacterArc, ArcBeat, ArcTemplateId, ArcBeatStage, ArcStatus } from '../types';
import { ARC_TEMPLATES, ARC_STAGE_CONFIG, ARC_STATUS_CONFIG } from '../types';
import { generateId } from '@/utils/idGenerator';
import { useCodexEntries } from '@/engines/codex/hooks';
import { createBeat } from '../operations';
import { arcBeatLinks, type ArcBeatLink, type ArcBeatLinkCatalog } from '../beatLinks';

// ---------------------------------------------------------------------------
// CharacterArcEngine
// ---------------------------------------------------------------------------

export default function CharacterArcEngine({ projectId }: EngineComponentProps) {
  const { t } = useTranslation();
  const { items: arcs, loading, addItem: addArc, editItem: editArc, removeItem: removeArc } =
    useCharacterArcs(projectId);
  const [activeArcId, setActiveArcId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [pendingDeleteArcId, setPendingDeleteArcId] = useState<string | null>(null);

  // Deep link (?arc=<id>[&beat=<id>]): backlinks, global search and the scene
  // editor's arc strip navigate here. Render-adjust with an `applied` guard,
  // same as codex — arcs arrive async, and re-applying on every render would
  // drag the author back to the linked arc. The beat is kept as state, not
  // read from the URL, so Back and reopening the arc doesn't unfold it again.
  const deepLinkedArcId = useDeepLinkParam('arc');
  const deepLinkedBeatId = useDeepLinkParam('beat');
  const deepLinkKey = deepLinkedArcId ? `${deepLinkedArcId}:${deepLinkedBeatId ?? ''}` : null;
  const [appliedDeepLink, setAppliedDeepLink] = useState<string | null>(null);
  const [focusedBeatId, setFocusedBeatId] = useState<string | null>(null);
  if (deepLinkKey && deepLinkKey !== appliedDeepLink) {
    const target = arcs.find((a) => a.id === deepLinkedArcId);
    if (target) {
      setAppliedDeepLink(deepLinkKey);
      setActiveArcId(target.id);
      setFocusedBeatId(deepLinkedBeatId);
    }
  }

  if (loading) return <EngineSpinner />;

  // Editor view
  if (activeArcId) {
    const arc = arcs.find((a) => a.id === activeArcId);
    if (arc) {
      return (
        <ArcEditor
          key={arc.id}
          arc={arc}
          projectId={projectId}
          focusedBeatId={focusedBeatId}
          onBack={() => {
            setActiveArcId(null);
            setFocusedBeatId(null);
          }}
          onUpdate={(changes) => editArc(arc.id, changes)}
          onDelete={async () => {
            await removeArc(arc.id);
            setActiveArcId(null);
          }}
        />
      );
    }
  }

  // List view
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-serif font-semibold text-text-primary flex items-center gap-2">
          <TrendingUp size={15} className="text-accent-gold" />
          {t('characterArc.title')}
        </h2>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent-gold/10 text-accent-gold rounded-lg hover:bg-accent-gold/20 transition"
        >
          <Plus size={14} />
          {t('characterArc.newArc')}
        </button>
      </div>

      {showNew && (
        <NewArcForm
          projectId={projectId}
          onCreate={async (arc, templateId) => {
            await addArc(arc);
            if (templateId) await seedTemplateBeats(arc.id, projectId, templateId);
            setShowNew(false);
            setActiveArcId(arc.id);
          }}
          onCancel={() => setShowNew(false)}
        />
      )}

      {arcs.length === 0 && !showNew ? (
        <EmptyState
          icon={<TrendingUp size={40} />}
          title={t('characterArc.empty.title')}
          message={t('characterArc.empty.message')}
          action={{ label: t('characterArc.newArc'), onClick: () => setShowNew(true) }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {arcs.map((arc) => (
            <ArcCard
              key={arc.id}
              arc={arc}
              onOpen={() => setActiveArcId(arc.id)}
              onDelete={() => setPendingDeleteArcId(arc.id)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingDeleteArcId !== null}
        destructive
        message={t('characterArc.confirmDelete')}
        onConfirm={async () => {
          if (!pendingDeleteArcId) return;
          const id = pendingDeleteArcId;
          setPendingDeleteArcId(null);
          await removeArc(id);
        }}
        onCancel={() => setPendingDeleteArcId(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ArcCard
// ---------------------------------------------------------------------------

function ArcCard({ arc, onOpen, onDelete }: { arc: CharacterArc; onOpen: () => void; onDelete: () => void }) {
  const { t } = useTranslation();
  const status = ARC_STATUS_CONFIG[arc.status];
  return (
    <div className="group relative rounded-xl border-2 border-border bg-elevated hover:border-accent-gold/40 transition p-4 cursor-pointer">
      <button onClick={onOpen} className="w-full text-left space-y-2">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-serif font-semibold text-text-primary truncate">{arc.title}</h3>
            {arc.characterName && (
              <p className="text-xs text-text-dim truncate">{arc.characterName}</p>
            )}
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap ${status.color}`}>
            {t(status.labelKey)}
          </span>
        </div>
        {arc.summary && <p className="text-xs text-text-dim line-clamp-2">{arc.summary}</p>}
        <div className="flex items-center gap-2 text-[10px] text-text-dim pt-1">
          {arc.lie && <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">{t('characterArc.core.lie')}</span>}
          {arc.truth && <span className="px-1.5 py-0.5 rounded bg-green-500/10 text-green-400">{t('characterArc.core.truth')}</span>}
          {arc.want && <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">{t('characterArc.core.want')}</span>}
          {arc.need && <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">{t('characterArc.core.need')}</span>}
        </div>
      </button>
      <button
        onClick={onDelete}
        className="absolute top-2 right-2 p-1 rounded-full opacity-0 group-hover:opacity-100 text-text-dim hover:text-danger hover:bg-danger/10 transition"
        title={t('common.delete')}
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NewArcForm
// ---------------------------------------------------------------------------

function NewArcForm({
  projectId,
  onCreate,
  onCancel,
}: {
  projectId: string;
  onCreate: (arc: CharacterArc, templateId?: ArcTemplateId) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [characterId, setCharacterId] = useState<string | undefined>(undefined);
  const [templateId, setTemplateId] = useState<ArcTemplateId>('positive-change');
  const { items: codexEntries } = useCodexEntries(projectId);
  const characters = codexEntries.filter((e) => e.type === 'character');

  const handleSubmit = async () => {
    const name = title.trim();
    if (!name) return;
    const character = characters.find((c) => c.id === characterId);
    // eslint-disable-next-line react-hooks/purity -- submit handler: runs at event time, not during render
    const now = Date.now();
    const arc: CharacterArc = {
      id: generateId('arc'),
      projectId,
      title: name,
      characterId,
      characterName: character?.title,
      templateId,
      // Empty, NOT the template's prompts. Seeding these with
      // `template.prompts.*` wrote the questions themselves into the arc
      // ("What past event still haunts them?" as the ghost), so every new arc
      // was born pre-filled with English placeholder text that lit up the
      // Lie/Truth/Want/Need chips and got indexed by search. The prompts are
      // now shown as `placeholder` in the editor, where they belong.
      ghost: '',
      lie: '',
      truth: '',
      want: '',
      need: '',
      summary: '',
      status: 'planning',
      createdAt: now,
      updatedAt: now,
    };
    await onCreate(arc, templateId);
  };

  return (
    <div className="border border-accent-gold/40 rounded-xl bg-surface/60 p-4 space-y-3">
      <h3 className="text-sm font-serif font-semibold text-accent-gold">
        {t('characterArc.newArc')}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-text-dim">{t('characterArc.arcTitle')}</span>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('characterArc.arcTitlePlaceholder')}
            className="w-full px-3 py-1.5 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-text-dim">{t('characterArc.character')}</span>
          <select
            value={characterId ?? ''}
            onChange={(e) => setCharacterId(e.target.value || undefined)}
            className="w-full px-3 py-1.5 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
          >
            <option value="">{t('characterArc.unlinked')}</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-2">
        <span className="text-xs text-text-dim">{t('characterArc.template')}</span>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {ARC_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              onClick={() => setTemplateId(tpl.id)}
              className={`text-left rounded-lg border-2 p-3 transition ${
                templateId === tpl.id ? 'border-accent-gold bg-accent-gold/10' : 'border-border bg-elevated hover:border-accent-gold/40'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Sparkles size={11} className="text-accent-gold" />
                <span className="text-xs font-semibold text-text-primary">{t(tpl.nameKey)}</span>
              </div>
              <p className="text-[11px] text-text-dim mt-1 line-clamp-2">{t(tpl.descriptionKey)}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-text-dim hover:text-text-primary transition"
        >
          {t('common.cancel')}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!title.trim()}
          className="px-3 py-1.5 text-xs bg-accent-gold text-bg rounded-lg hover:bg-accent-gold/90 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {t('common.create')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ArcEditor
// ---------------------------------------------------------------------------

function ArcEditor({
  arc,
  projectId,
  focusedBeatId,
  onBack,
  onUpdate,
  onDelete,
}: {
  arc: CharacterArc;
  projectId: string;
  /** Beat named by a `?beat=` deep link: unfolded and scrolled into view. */
  focusedBeatId: string | null;
  onBack: () => void;
  onUpdate: (changes: Partial<CharacterArc>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { items: beats, addItem: addBeat, editItem: editBeat, removeItem: removeBeat, reorder: reorderBeats } = useArcBeats(arc.id);
  // A qué puede apuntar un beat del arco. `ArcBeat.linkedBeatId` y
  // `linkedSceneId` estaban declarados desde el principio y nadie los escribía,
  // pero `services/projectIntelligence.ts` SÍ lee el primero: cuenta cuántos
  // beats de arco cuelgan de cada beat del esquema (`arcBeatCount`). Al no
  // existir forma de rellenarlo, esa cuenta valía cero para siempre y no había
  // manera de que valiera otra cosa.
  const { items: outlineBeats } = useAllProjectBeats(projectId);
  const { items: scenes } = useScenes(projectId);
  // Links out of a beat only count when the author can follow them: the target
  // must still exist and its engine must be switched on (lesson #40).
  const { project } = useProject(projectId);
  const linkCatalog: ArcBeatLinkCatalog = { scenes, outlineBeats, enabledEngines: project?.enabledEngines ?? [] };
  const { items: codexEntries } = useCodexEntries(projectId);
  const characters = codexEntries.filter((e) => e.type === 'character');
  const [corePanelOpen, setCorePanelOpen] = useState(true);
  const [pendingDeleteArc, setPendingDeleteArc] = useState(false);

  // A name left over from a character that no longer exists: keep it selectable
  // so picking anything else — including "unlinked" — actually clears it.
  const orphanName = !arc.characterId && arc.characterName ? arc.characterName : undefined;

  const handleCharacter = (nextId: string) => {
    const character = characters.find((c) => c.id === nextId);
    // No `updatedAt` here: makeTableOps.update already stamps it, and calling
    // Date.now() in the component body is impure.
    onUpdate({
      characterId: character?.id,
      characterName: character?.title,
    });
  };

  // The template's questions, shown as placeholders in the six core fields.
  // `promptKeys` holds i18n keys, so resolve them here — otherwise the raw key
  // ('characterArc.template.positive-change.prompt.1') would be the placeholder.
  const promptKeys = ARC_TEMPLATES.find((tpl) => tpl.id === arc.templateId)?.promptKeys;
  const corePrompts = promptKeys
    ? {
        ghost: t(promptKeys.ghost),
        lie: t(promptKeys.lie),
        truth: t(promptKeys.truth),
        want: t(promptKeys.want),
        need: t(promptKeys.need),
      }
    : undefined;

  const handleField = (key: keyof CharacterArc) => (value: string) =>
    onUpdate({ [key]: value, updatedAt: Date.now() } as Partial<CharacterArc>);

  // Buffered. `characterArcs` sorts by `updatedAt desc`, so writing on every
  // keystroke made the arc being renamed jump to the top of the list letter by
  // letter — while the input, bound to the refreshed row, dropped characters.
  const titleField = useDebouncedField(arc.title, handleField('title'));

  const handleAddBeat = async () => {
    const now = Date.now();
    const beat: ArcBeat = {
      id: generateId('arc-beat'),
      arcId: arc.id,
      projectId,
      // max+1, not the count: after a delete the count can be lower than the
      // highest order and the new beat would sort before existing ones.
      order: beats.reduce((max, b) => Math.max(max, b.order), -1) + 1,
      stage: 'growth',
      title: t('characterArc.beat.newTitle'),
      description: '',
      status: 'planning',
      createdAt: now,
      updatedAt: now,
    };
    await addBeat(beat);
  };

  const groupedBeats = useMemo(() => {
    const sorted = [...beats].sort((a, b) => {
      const oa = ARC_STAGE_CONFIG[a.stage]?.order ?? 0;
      const ob = ARC_STAGE_CONFIG[b.stage]?.order ?? 0;
      if (oa !== ob) return oa - ob;
      return a.order - b.order;
    });
    const byStage = new Map<ArcBeatStage, ArcBeat[]>();
    for (const b of sorted) {
      if (!byStage.has(b.stage)) byStage.set(b.stage, []);
      byStage.get(b.stage)!.push(b);
    }
    return byStage;
  }, [beats]);

  // The grip used to be decoration: `reorderBeats` was wired into the hook and
  // nothing called it. Beats are grouped by stage, so a drag reorders inside
  // its stage only — moving a beat to another stage is the stage select's job,
  // and guessing it from a drop would change the arc without being asked.
  // Keyboard included, same as the outline: a mouse-only handle shuts out
  // whoever doesn't use one.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const moved = beats.find((b) => b.id === active.id);
    const target = beats.find((b) => b.id === over.id);
    if (!moved || !target || moved.stage !== target.stage) return;
    const group = (groupedBeats.get(moved.stage) ?? []).map((b) => b.id);
    const from = group.indexOf(moved.id);
    const to = group.indexOf(target.id);
    if (from < 0 || to < 0) return;
    // Renumber the whole arc top to bottom as it is drawn, so every `order`
    // grows down the page and no two stages share numbers.
    const orderedIds = (Object.keys(ARC_STAGE_CONFIG) as ArcBeatStage[]).flatMap((stage) =>
      stage === moved.stage ? arrayMove(group, from, to) : (groupedBeats.get(stage) ?? []).map((b) => b.id),
    );
    void reorderBeats(orderedIds);
  };

  return (
    <div className="space-y-4">
      {/* --- Header --- */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg text-text-dim hover:bg-elevated hover:text-text-primary transition"
            title={t('common.back')}
          >
            <ArrowLeft size={16} />
          </button>
          <div className="flex-1 min-w-0 space-y-1">
            <input
              value={titleField.value}
              onChange={(e) => titleField.onChange(e.target.value)}
              onBlur={titleField.onBlur}
              placeholder={t('characterArc.arcTitlePlaceholder')}
              className="w-full bg-transparent text-lg font-serif font-semibold text-text-primary outline-none border-b border-transparent focus:border-accent-gold transition"
            />
            <select
              value={arc.characterId ?? (orphanName ? '__orphan__' : '')}
              onChange={(e) => handleCharacter(e.target.value)}
              title={t('characterArc.character')}
              className="max-w-full text-xs text-text-dim bg-transparent border border-transparent rounded cursor-pointer outline-none hover:border-border focus:border-accent-gold transition"
            >
              <option value="">{t('characterArc.unlinked')}</option>
              {orphanName && <option value="__orphan__">{orphanName}</option>}
              {characters.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={arc.status}
            onChange={(e) => handleField('status')(e.target.value)}
            className={`text-[11px] px-2 py-1 rounded-full cursor-pointer outline-none bg-elevated border border-border ${ARC_STATUS_CONFIG[arc.status].color}`}
          >
            {(Object.entries(ARC_STATUS_CONFIG) as [ArcStatus, { labelKey: string }][]).map(([k, v]) => (
              <option key={k} value={k}>{t(v.labelKey)}</option>
            ))}
          </select>
          <button
            onClick={() => setPendingDeleteArc(true)}
            className="p-1.5 rounded-lg text-text-dim hover:text-danger hover:bg-danger/10 transition"
            title={t('common.delete')}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* --- Core frame (Ghost / Lie / Truth / Want / Need) --- */}
      <div className="border border-border rounded-xl bg-surface/50 overflow-hidden">
        <button
          onClick={() => setCorePanelOpen((o) => !o)}
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-elevated/50 transition"
        >
          <span className="text-xs font-semibold text-accent-gold flex items-center gap-1.5">
            {corePanelOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {t('characterArc.core.title')}
          </span>
          <span className="text-[10px] text-text-dim">
            {t('characterArc.core.subtitle')}
          </span>
        </button>
        {corePanelOpen && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-4 pt-2">
            <CoreField label={t('characterArc.core.ghost')} color="bg-gray-500/10 text-gray-300" value={arc.ghost} onChange={handleField('ghost')} placeholder={corePrompts?.ghost} />
            <CoreField label={t('characterArc.core.lie')} color="bg-red-500/10 text-red-300" value={arc.lie} onChange={handleField('lie')} placeholder={corePrompts?.lie} />
            <CoreField label={t('characterArc.core.truth')} color="bg-green-500/10 text-green-300" value={arc.truth} onChange={handleField('truth')} placeholder={corePrompts?.truth} />
            <CoreField label={t('characterArc.core.want')} color="bg-amber-500/10 text-amber-300" value={arc.want} onChange={handleField('want')} placeholder={corePrompts?.want} />
            <CoreField label={t('characterArc.core.need')} color="bg-blue-500/10 text-blue-300" value={arc.need} onChange={handleField('need')} placeholder={corePrompts?.need} />
            <CoreField label={t('characterArc.core.summary')} color="bg-accent-gold/10 text-accent-gold" value={arc.summary} onChange={handleField('summary')} rows={4} />
          </div>
        )}
      </div>

      {/* --- Beats by stage --- */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-serif font-semibold text-text-primary">{t('characterArc.beats.title')}</h3>
          <button
            onClick={handleAddBeat}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent-gold/10 text-accent-gold rounded-lg hover:bg-accent-gold/20 transition"
          >
            <Plus size={12} />
            {t('characterArc.beats.add')}
          </button>
        </div>
        {beats.length === 0 ? (
          <p className="text-xs text-text-dim text-center py-6">{t('characterArc.beats.empty')}</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <div className="space-y-2">
            {(Object.keys(ARC_STAGE_CONFIG) as ArcBeatStage[]).map((stage) => {
              const stageBeats = groupedBeats.get(stage);
              if (!stageBeats || stageBeats.length === 0) return null;
              const cfg = ARC_STAGE_CONFIG[stage];
              return (
                <div key={stage} className="border border-border rounded-lg bg-surface/30 overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-elevated/50 border-b border-border">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cfg.color }} />
                    <span className="text-xs font-semibold text-text-primary">{t(cfg.labelKey)}</span>
                    <span className="text-[10px] text-text-dim">({stageBeats.length})</span>
                  </div>
                  <SortableContext items={stageBeats.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                    <div className="divide-y divide-border/50">
                      {stageBeats.map((beat) => (
                        <BeatRow
                          key={beat.id}
                          beat={beat}
                          focused={beat.id === focusedBeatId}
                          onUpdate={(changes) => editBeat(beat.id, changes)}
                          onDelete={() => removeBeat(beat.id)}
                          outlineBeats={outlineBeats}
                          scenes={scenes}
                          links={arcBeatLinks(beat, linkCatalog)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </div>
              );
            })}
          </div>
          </DndContext>
        )}
      </div>

      {/* Margin notes + backlinks — first time character arcs join the
          interconnectedness layer. */}
      <div className="pt-2 border-t border-border">
        <AnnotationSurface
          projectId={projectId}
          engineId="character-arc"
          entityId={arc.id}
          layout="stack"
        />
      </div>

      <ConfirmDialog
        open={pendingDeleteArc}
        destructive
        message={t('characterArc.confirmDelete')}
        onConfirm={async () => {
          setPendingDeleteArc(false);
          await onDelete();
        }}
        onCancel={() => setPendingDeleteArc(false)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CoreField — a labeled textarea for the 6 core arc attributes
// ---------------------------------------------------------------------------

function CoreField({
  label,
  value,
  onChange,
  color,
  rows = 2,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => Promise<void>;
  color: string;
  rows?: number;
  /** The template's prompt — a hint, never persisted content. */
  placeholder?: string;
}) {
  // Buffered: this used to write to Dexie and refresh the whole table on every
  // keystroke, with the textarea bound to the refreshed row — so fast typing
  // dropped characters and the caret jumped to the end.
  const field = useDebouncedField(value, onChange);
  return (
    <label className="space-y-1">
      <span className={`inline-block text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${color}`}>
        {label}
      </span>
      <textarea
        value={field.value}
        onChange={(e) => field.onChange(e.target.value)}
        onBlur={field.onBlur}
        placeholder={placeholder}
        rows={rows}
        className="w-full px-3 py-2 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition resize-none"
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// BeatRow
// ---------------------------------------------------------------------------

function BeatRow({
  beat,
  focused,
  onUpdate,
  onDelete,
  outlineBeats,
  scenes,
  links,
}: {
  beat: ArcBeat;
  focused: boolean;
  onUpdate: (changes: Partial<ArcBeat>) => Promise<void>;
  onDelete: () => Promise<void>;
  outlineBeats: { id: string; title: string }[];
  scenes: { id: string; title: string; sceneNumber?: number }[];
  /** Resolved by `arcBeatLinks`: only targets that exist in an enabled engine. */
  links: ArcBeatLink[];
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id: beat.id });

  // A deep-linked beat opens unfolded. Render-adjust, not an effect, so the
  // row never paints collapsed first (lesson #17).
  const [prevFocused, setPrevFocused] = useState(false);
  if (focused !== prevFocused) {
    setPrevFocused(focused);
    if (focused) setExpanded(true);
  }
  const rowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (focused) rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focused]);

  const handleField = (key: keyof ArcBeat) => (value: string) =>
    onUpdate({ [key]: value, updatedAt: Date.now() } as Partial<ArcBeat>);

  const titleField = useDebouncedField(beat.title, handleField('title'));
  const descriptionField = useDebouncedField(beat.description, handleField('description'));
  const emotionField = useDebouncedField(beat.emotion ?? '', handleField('emotion'));

  // Save what is still buffered before leaving: the fields flush on unmount
  // too, but a write that fails there has nobody left to tell.
  const followLink = async (link: ArcBeatLink) => {
    if (navigating) return;
    setNavigating(true);
    try {
      const saved = await Promise.all([titleField.flush(), descriptionField.flush(), emotionField.flush()]);
      if (saved.every(Boolean)) navigateTo(link.path);
      else toast.error(t('characterArc.beat.navigationFailed'));
    } catch {
      toast.error(t('characterArc.beat.navigationFailed'));
    } finally {
      setNavigating(false);
    }
  };

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        rowRef.current = node;
      }}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      aria-current={focused ? 'true' : undefined}
      className={`px-3 py-2 group ${focused ? 'bg-accent-gold/5 ring-1 ring-inset ring-accent-gold/40' : ''}`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          title={t('characterArc.beat.dragHint')}
          aria-label={t('characterArc.beat.dragHint')}
          className="mt-1 text-text-dim opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition cursor-grab active:cursor-grabbing touch-none"
        >
          <GripVertical size={12} aria-hidden="true" />
        </button>
        <button
          onClick={() => setExpanded((e) => !e)}
          className="p-0.5 mt-0.5 text-text-dim hover:text-text-primary transition"
          title={expanded ? t('common.collapse') : t('common.expand')}
          aria-label={expanded ? t('common.collapse') : t('common.expand')}
        >
          {expanded ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
        </button>
        <input
          value={titleField.value}
          onChange={(e) => titleField.onChange(e.target.value)}
          onBlur={titleField.onBlur}
          className="flex-1 min-w-0 bg-transparent text-sm text-text-primary outline-none border-b border-transparent focus:border-accent-gold transition"
        />
        {links.map((link) => {
          const label = t(link.kind === 'scene' ? 'characterArc.beat.openScene' : 'characterArc.beat.openOutlineBeat').replace('{title}', link.title);
          return (
            <button
              key={link.path}
              type="button"
              disabled={navigating}
              onClick={() => { void followLink(link); }}
              title={label}
              aria-label={label}
              className="flex max-w-[9rem] items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-accent-gold hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50 transition"
            >
              {link.kind === 'scene'
                ? <MessageSquare size={10} className="shrink-0" aria-hidden="true" />
                : <ListTree size={10} className="shrink-0" aria-hidden="true" />}
              <span className="truncate">{link.title}</span>
            </button>
          );
        })}
        <select
          value={beat.stage}
          onChange={(e) => handleField('stage')(e.target.value)}
          className="text-[10px] bg-elevated border border-border rounded px-1.5 py-0.5 text-text-primary outline-none focus:border-accent-gold cursor-pointer"
        >
          {(Object.entries(ARC_STAGE_CONFIG) as [ArcBeatStage, { labelKey: string }][]).map(([k, v]) => (
            <option key={k} value={k}>{t(v.labelKey)}</option>
          ))}
        </select>
        {/* Beat status — the field was stamped 'planning' on create and there
            was no control to ever change it. Same pattern as the arc-level
            status select above. */}
        <select
          value={beat.status}
          onChange={(e) => handleField('status')(e.target.value)}
          className={`text-[10px] bg-elevated border border-border rounded px-1.5 py-0.5 outline-none focus:border-accent-gold cursor-pointer ${ARC_STATUS_CONFIG[beat.status].color}`}
        >
          {(Object.entries(ARC_STATUS_CONFIG) as [ArcStatus, { labelKey: string }][]).map(([k, v]) => (
            <option key={k} value={k}>{t(v.labelKey)}</option>
          ))}
        </select>
        <button
          onClick={() => setPendingDelete(true)}
          className="p-1 rounded text-text-dim opacity-0 group-hover:opacity-100 hover:text-danger hover:bg-danger/10 transition"
          title={t('common.delete')}
        >
          <Trash2 size={11} />
        </button>
      </div>
      {expanded && (
        <div className="ml-7 mt-2 space-y-2">
          <textarea
            value={descriptionField.value}
            onChange={(e) => descriptionField.onChange(e.target.value)}
            onBlur={descriptionField.onBlur}
            rows={3}
            placeholder={t('characterArc.beat.descriptionPlaceholder')}
            className="w-full px-2 py-1.5 text-xs bg-elevated border border-border rounded text-text-primary outline-none focus:border-accent-gold transition resize-none"
          />
          <div className="flex items-center gap-2">
            <input
              value={emotionField.value}
              onChange={(e) => emotionField.onChange(e.target.value)}
              onBlur={emotionField.onBlur}
              placeholder={t('characterArc.beat.emotionPlaceholder')}
              className="flex-1 px-2 py-1 text-xs bg-elevated border border-border rounded text-text-primary outline-none focus:border-accent-gold transition"
            />
            <input
              type="number"
              min={0}
              max={100}
              value={beat.storyPosition ?? ''}
              onChange={(e) => onUpdate({ storyPosition: e.target.value === '' ? undefined : Number(e.target.value), updatedAt: Date.now() })}
              placeholder="%"
              className="w-16 px-2 py-1 text-xs bg-elevated border border-border rounded text-text-primary outline-none focus:border-accent-gold transition"
            />
          </div>

          <LinkSelect
            label={t('characterArc.beat.linkedBeat')}
            value={beat.linkedBeatId ?? ''}
            onChange={(v) => onUpdate({ linkedBeatId: v || undefined, updatedAt: Date.now() })}
            options={outlineBeats.map((b) => ({ id: b.id, label: b.title }))}
          />
          <LinkSelect
            label={t('characterArc.beat.linkedScene')}
            value={beat.linkedSceneId ?? ''}
            onChange={(v) => onUpdate({ linkedSceneId: v || undefined, updatedAt: Date.now() })}
            options={scenes.map((sc) => ({
              id: sc.id,
              label: `${sc.sceneNumber ? `#${sc.sceneNumber} ` : ''}${sc.title}`,
            }))}
          />
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete}
        destructive
        message={t('characterArc.beat.confirmDelete')}
        onConfirm={async () => {
          setPendingDelete(false);
          await onDelete();
        }}
        onCancel={() => setPendingDelete(false)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// seedTemplateBeats — creates initial ArcBeats from a template
// ---------------------------------------------------------------------------

// The template's beats carry i18n keys, and this is the one place where they
// stop being labels and become the author's content: whatever lands in `title`
// / `description` / `emotion` is persisted in the ArcBeat row forever. Resolve
// every key with the module-level `t()` here — writing the raw key would leave
// 'characterArc.template.positive-change.beat.1.title' inside the project.
async function seedTemplateBeats(arcId: string, projectId: string, templateId: ArcTemplateId): Promise<void> {
  const template = ARC_TEMPLATES.find((candidate) => candidate.id === templateId);
  if (!template) return;
  for (let i = 0; i < template.beats.length; i++) {
    const tpl = template.beats[i];
    const now = Date.now();
    const beat: ArcBeat = {
      id: generateId('arc-beat'),
      arcId,
      projectId,
      order: i,
      stage: tpl.stage,
      title: t(tpl.titleKey),
      description: t(tpl.descriptionKey),
      emotion: tpl.emotionKey ? t(tpl.emotionKey) : undefined,
      storyPosition: tpl.storyPosition,
      status: 'planning',
      createdAt: now,
      updatedAt: now,
    };
    await createBeat(beat);
  }
}
