// ============================================
// Character web — everything connected to this character, in one place
// ============================================
//
// Shown inside the codex detail modal for `character` entries. Surfaces the
// cross-engine links that already exist in the data but were previously
// invisible from the character's side:
//   • Character arcs   (character-arc engine, characterId → codex id)
//   • Relationships    (relationships engine, entityA/BId → codex id)
//   • Scene appearances (dialog-scene cast, characterId → codex id)
//   • Manuscript appearances (the chapters her name occurs in)
//
// The last one is the question a novelist actually asks — "when was Marek last
// on the page?" — and until now the Codex answered every question but that one.
// The chapters are scanned by the caller, once per project, and handed down
// here: this component must never scan a manuscript of its own.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, TrendingUp, Network, Clapperboard, ChevronRight } from 'lucide-react';
import { db } from '@/db/index';
import { useTranslation } from '@/i18n/useTranslation';
import { getAnchorAdapter } from '@/engines/_shared/anchoring';
import { RELATIONSHIP_KIND_CONFIG } from '@/engines/relationships/types';
import type { RelationshipKind } from '@/engines/relationships/types';
import type { CodexAppearance } from '@/services/projectIntelligence';
import type { CodexEntry } from '@/types';

interface CharacterConnectionsProps {
  projectId: string;
  entry: CodexEntry;
  /** Chapters this character is named in, in manuscript order. */
  appearances?: CodexAppearance[];
}

interface ConnectionsData {
  arcs: { id: string; title: string; status?: string }[];
  relationships: { id: string; otherName: string; kind: string }[];
  scenes: { id: string; title: string; sceneNumber?: number }[];
}

const EMPTY: ConnectionsData = { arcs: [], relationships: [], scenes: [] };

const CHIP_CLASS = 'text-xs px-2 py-1 rounded-lg bg-elevated border border-border text-text-primary';

// Module scope — components created during render remount on every render.
function Section({
  icon: Icon,
  label,
  onNavigate,
  children,
}: {
  icon: typeof Network;
  label: string;
  onNavigate: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onNavigate}
        className="flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-accent-gold transition mb-1.5 group"
      >
        <Icon size={13} className="text-accent-gold" />
        {label}
        <ChevronRight size={11} className="opacity-0 group-hover:opacity-100 transition" />
      </button>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export default function CharacterConnections({
  projectId,
  entry,
  appearances = [],
}: CharacterConnectionsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState<ConnectionsData>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [arcs, relsA, relsB, casts] = await Promise.all([
          db.characterArcs.where('characterId').equals(entry.id).toArray(),
          db.relationships.where('entityAId').equals(entry.id).toArray(),
          db.relationships.where('entityBId').equals(entry.id).toArray(),
          db.sceneCasts.filter((c) => c.characterId === entry.id).toArray(),
        ]);
        const sceneIds = [...new Set(casts.map((c) => c.sceneId))];
        const scenes = (await db.scenes.bulkGet(sceneIds)).filter(
          (s): s is NonNullable<typeof s> => !!s && s.projectId === projectId,
        );
        if (cancelled) return;
        setData({
          arcs: arcs
            .filter((a) => a.projectId === projectId)
            .map((a) => ({ id: a.id, title: a.title, status: a.status })),
          relationships: [...relsA, ...relsB]
            .filter((r) => r.projectId === projectId)
            .map((r) => ({
              id: r.id,
              otherName: r.entityAId === entry.id ? r.entityBName : r.entityAName,
              kind: r.kind,
            })),
          scenes: scenes
            .sort((a, b) => a.order - b.order)
            .map((s) => ({ id: s.id, title: s.title, sceneNumber: s.sceneNumber })),
        });
      } catch (err) {
        console.error('[character-web] failed to load connections', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry.id, projectId]);

  const total =
    data.arcs.length + data.relationships.length + data.scenes.length + appearances.length;
  if (total === 0) return null;

  const chip = CHIP_CLASS;

  // The same jump the margin notes and global search make, so a chapter opens
  // on the chapter rather than on the list of them.
  const openWriting = (writingId: string) => {
    const adapter = getAnchorAdapter('writings');
    if (adapter) adapter.navigateToEntity(writingId, projectId);
    else navigate(`/project/${projectId}/writings?writing=${encodeURIComponent(writingId)}`);
  };

  return (
    <div className="space-y-3 p-3 bg-deep/40 border border-border rounded-xl">
      <h4 className="text-[10px] uppercase tracking-widest text-text-dim font-semibold">
        {t('codex.web.title')}
      </h4>

      {data.arcs.length > 0 && (
        <Section icon={TrendingUp} label={t('codex.web.arcs')} onNavigate={() => navigate(`/project/${projectId}/character-arc`)}>
          {data.arcs.map((a) => (
            <span key={a.id} className={chip}>
              {a.title}
            </span>
          ))}
        </Section>
      )}

      {data.relationships.length > 0 && (
        <Section icon={Network} label={t('codex.web.relationships')} onNavigate={() => navigate(`/project/${projectId}/relationships`)}>
          {data.relationships.map((r) => {
            const cfg = RELATIONSHIP_KIND_CONFIG[r.kind as RelationshipKind];
            return (
              <span key={r.id} className={chip}>
                {cfg?.emoji && <span className="mr-1">{cfg.emoji}</span>}
                {r.otherName}
              </span>
            );
          })}
        </Section>
      )}

      {appearances.length > 0 && (
        <Section icon={BookOpen} label={t('codex.web.appearsIn')} onNavigate={() => navigate(`/project/${projectId}/writings`)}>
          {appearances.map((appearance) => (
            <button
              key={appearance.writingId}
              type="button"
              onClick={() => openWriting(appearance.writingId)}
              title={appearance.title}
              className={`${chip} max-w-[12rem] truncate hover:border-accent-gold/40 hover:text-accent-gold transition`}
            >
              {appearance.chapter !== undefined
                ? t('codex.web.chapterShort').replace('{n}', String(appearance.chapter))
                : appearance.title}
            </button>
          ))}
        </Section>
      )}

      {data.scenes.length > 0 && (
        <Section icon={Clapperboard} label={t('codex.web.scenes')} onNavigate={() => navigate(`/project/${projectId}/dialog-scene`)}>
          {data.scenes.map((s) => (
            <span key={s.id} className={chip}>
              {s.sceneNumber !== undefined && (
                <span className="text-accent-gold mr-1">{s.sceneNumber}.</span>
              )}
              {s.title}
            </span>
          ))}
        </Section>
      )}
    </div>
  );
}
