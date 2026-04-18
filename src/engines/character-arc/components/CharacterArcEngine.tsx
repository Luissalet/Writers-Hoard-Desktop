import { useState, useMemo } from 'react';
import { TrendingUp, Plus, Trash2, ArrowLeft, ChevronDown, ChevronRight, Sparkles, GripVertical } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { EngineComponentProps } from '@/engines/_types';
import { EngineSpinner } from '@/engines/_shared';
import { useCharacterArcs, useArcBeats } from '../hooks';
import type { CharacterArc, ArcBeat, ArcTemplateId, ArcBeatStage, ArcStatus } from '../types';
import { ARC_TEMPLATES, ARC_STAGE_CONFIG, ARC_STATUS_CONFIG } from '../types';
import { generateId } from '@/utils/idGenerator';
import { useCodexEntries } from '@/engines/codex/hooks';

// ---------------------------------------------------------------------------
// CharacterArcEngine
// ---------------------------------------------------------------------------

export default function CharacterArcEngine({ projectId }: EngineComponentProps) {
  const { t } = useTranslation();
  const { items: arcs, loading, addItem: addArc, editItem: editArc, removeItem: removeArc } =
    useCharacterArcs(projectId);
  const [activeArcId, setActiveArcId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  if (loading) return <EngineSpinner />;

  // Editor view
  if (activeArcId) {
    const arc = arcs.find((a) => a.id === activeArcId);
    if (arc) {
      return (
        <ArcEditor
          arc={arc}
          projectId={projectId}
          onBack={() => setActiveArcId(null)}
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
        <div className="flex flex-col items-center justify-center py-16 text-text-dim">
          <TrendingUp size={36} className="mb-3 opacity-40" />
          <p className="text-sm">{t('characterArc.empty')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {arcs.map((arc) => (
            <ArcCard
              key={arc.id}
              arc={arc}
              onOpen={() => setActiveArcId(arc.id)}
              onDelete={async () => {
                if (confirm(t('characterArc.confirmDelete'))) await removeArc(arc.id);
              }}
            />
          ))}
        </div>
      )}
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
            {status.label}
          </span>
        </div>
        {arc.summary && <p className="text-xs text-text-dim line-clamp-2">{arc.summary}</p>}
        <div className="flex items-center gap-2 text-[10px] text-text-dim pt-1">
          {arc.lie && <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">Lie</span>}
          {arc.truth && <span className="px-1.5 py-0.5 rounded bg-green-500/10 text-green-400">Truth</span>}
          {arc.want && <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">Want</span>}
          {arc.need && <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">Need</span>}
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
    const template = ARC_TEMPLATES.find((t) => t.id === templateId);
    const now = Date.now();
    const arc: CharacterArc = {
      id: generateId('arc'),
      projectId,
      title: name,
      characterId,
      characterName: character?.title,
      templateId,
      ghost: template?.prompts.ghost ?? '',
      lie: template?.prompts.lie ?? '',
      truth: template?.prompts.truth ?? '',
      want: template?.prompts.want ?? '',
      need: template?.prompts.need ?? '',
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
                <span className="text-xs font-semibold text-text-primary">{tpl.name}</span>
              </div>
              <p className="text-[11px] text-text-dim mt-1 line-clamp-2">{tpl.description}</p>
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
  onBack,
  onUpdate,
  onDelete,
}: {
  arc: CharacterArc;
  projectId: string;
  onBack: () => void;
  onUpdate: (changes: Partial<CharacterArc>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { items: beats, addItem: addBeat, editItem: editBeat, removeItem: removeBeat } = useArcBeats(arc.id);
  const [corePanelOpen, setCorePanelOpen] = useState(true);

  const handleField = (key: keyof CharacterArc) => (value: string) => {
    onUpdate({ [key]: value, updatedAt: Date.now() } as Partial<CharacterArc>);
  };

  const handleAddBeat = async () => {
    const now = Date.now();
    const beat: ArcBeat = {
      id: generateId('arc-beat'),
      arcId: arc.id,
      projectId,
      order: beats.length,
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
              value={arc.title}
              onChange={(e) => handleField('title')(e.target.value)}
              placeholder={t('characterArc.arcTitlePlaceholder')}
              className="w-full bg-transparent text-lg font-serif font-semibold text-text-primary outline-none border-b border-transparent focus:border-accent-gold transition"
            />
            {arc.characterName && (
              <p className="text-xs text-text-dim">{arc.characterName}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={arc.status}
            onChange={(e) => handleField('status')(e.target.value)}
            className={`text-[11px] px-2 py-1 rounded-full cursor-pointer outline-none bg-elevated border border-border ${ARC_STATUS_CONFIG[arc.status].color}`}
          >
            {(Object.entries(ARC_STATUS_CONFIG) as [ArcStatus, { label: string }][]).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <button
            onClick={async () => {
              if (confirm(t('characterArc.confirmDelete'))) await onDelete();
            }}
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
            <CoreField label={t('characterArc.core.ghost')} color="bg-gray-500/10 text-gray-300" value={arc.ghost} onChange={handleField('ghost')} />
            <CoreField label={t('characterArc.core.lie')} color="bg-red-500/10 text-red-300" value={arc.lie} onChange={handleField('lie')} />
            <CoreField label={t('characterArc.core.truth')} color="bg-green-500/10 text-green-300" value={arc.truth} onChange={handleField('truth')} />
            <CoreField label={t('characterArc.core.want')} color="bg-amber-500/10 text-amber-300" value={arc.want} onChange={handleField('want')} />
            <CoreField label={t('characterArc.core.need')} color="bg-blue-500/10 text-blue-300" value={arc.need} onChange={handleField('need')} />
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
          <div className="space-y-2">
            {(Object.keys(ARC_STAGE_CONFIG) as ArcBeatStage[]).map((stage) => {
              const stageBeats = groupedBeats.get(stage);
              if (!stageBeats || stageBeats.length === 0) return null;
              const cfg = ARC_STAGE_CONFIG[stage];
              return (
                <div key={stage} className="border border-border rounded-lg bg-surface/30 overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-elevated/50 border-b border-border">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cfg.color }} />
                    <span className="text-xs font-semibold text-text-primary">{cfg.label}</span>
                    <span className="text-[10px] text-text-dim">({stageBeats.length})</span>
                  </div>
                  <div className="divide-y divide-border/50">
                    {stageBeats.map((beat) => (
                      <BeatRow
                        key={beat.id}
                        beat={beat}
                        onUpdate={(changes) => editBeat(beat.id, changes)}
                        onDelete={() => removeBeat(beat.id)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  color: string;
  rows?: number;
}) {
  return (
    <label className="space-y-1">
      <span className={`inline-block text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${color}`}>
        {label}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
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
  onUpdate,
  onDelete,
}: {
  beat: ArcBeat;
  onUpdate: (changes: Partial<ArcBeat>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const handleField = (key: keyof ArcBeat) => (value: string) => {
    onUpdate({ [key]: value, updatedAt: Date.now() } as Partial<ArcBeat>);
  };

  return (
    <div className="px-3 py-2 group">
      <div className="flex items-start gap-2">
        <GripVertical size={12} className="text-text-dim mt-1 opacity-0 group-hover:opacity-100 cursor-grab" />
        <button
          onClick={() => setExpanded((e) => !e)}
          className="p-0.5 mt-0.5 text-text-dim hover:text-text-primary transition"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <input
          value={beat.title}
          onChange={(e) => handleField('title')(e.target.value)}
          className="flex-1 bg-transparent text-sm text-text-primary outline-none border-b border-transparent focus:border-accent-gold transition"
        />
        <select
          value={beat.stage}
          onChange={(e) => handleField('stage')(e.target.value)}
          className="text-[10px] bg-elevated border border-border rounded px-1.5 py-0.5 text-text-primary outline-none focus:border-accent-gold cursor-pointer"
        >
          {(Object.entries(ARC_STAGE_CONFIG) as [ArcBeatStage, { label: string }][]).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <button
          onClick={async () => {
            if (confirm(t('characterArc.beat.confirmDelete'))) await onDelete();
          }}
          className="p-1 rounded text-text-dim opacity-0 group-hover:opacity-100 hover:text-danger hover:bg-danger/10 transition"
          title={t('common.delete')}
        >
          <Trash2 size={11} />
        </button>
      </div>
      {expanded && (
        <div className="ml-7 mt-2 space-y-2">
          <textarea
            value={beat.description}
            onChange={(e) => handleField('description')(e.target.value)}
            rows={3}
            placeholder={t('characterArc.beat.descriptionPlaceholder')}
            className="w-full px-2 py-1.5 text-xs bg-elevated border border-border rounded text-text-primary outline-none focus:border-accent-gold transition resize-none"
          />
          <div className="flex items-center gap-2">
            <input
              value={beat.emotion ?? ''}
              onChange={(e) => handleField('emotion')(e.target.value)}
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
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// seedTemplateBeats — creates initial ArcBeats from a template
// ---------------------------------------------------------------------------

async function seedTemplateBeats(arcId: string, projectId: string, templateId: ArcTemplateId): Promise<void> {
  const template = ARC_TEMPLATES.find((t) => t.id === templateId);
  if (!template) return;
  // Import lazily to avoid circular
  const { createBeat } = await import('../operations');
  for (let i = 0; i < template.beats.length; i++) {
    const tpl = template.beats[i];
    const now = Date.now();
    const beat: ArcBeat = {
      id: generateId('arc-beat'),
      arcId,
      projectId,
      order: i,
      stage: tpl.stage,
      title: tpl.title,
      description: tpl.description,
      emotion: tpl.emotion,
      storyPosition: tpl.storyPosition,
      status: 'planning',
      createdAt: now,
      updatedAt: now,
    };
    await createBeat(beat);
  }
}
