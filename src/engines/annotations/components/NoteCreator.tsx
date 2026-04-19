// ============================================
// NoteCreator — picks note type + collects body, then persists
// ============================================
//
// Three branches behind a single "what kind of note?" toggle:
//   - text       — textarea + Save
//   - image      — file input → data URL preview
//   - reference  — engine picker → entity search picker → pick or create new
//
// Persists via the operations module so the parent only handles refresh.

import { useEffect, useState } from 'react';
import { FileText, Image as ImageIcon, Link as LinkIcon, Plus } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { generateId } from '@/utils/idGenerator';
import { searchEntities } from '@/engines/_shared';
import type { EntityPreview } from '@/engines/_types';
import {
  getAllAnchorAdapters,
  getAnchorAdapter,
  type AnchorAdapter,
} from '@/engines/_shared/anchoring';
import {
  createAnnotation,
  createReference,
} from '../operations';
import type {
  Annotation,
  AnnotationAnchor,
  AnnotationReference,
  NoteType,
} from '../types';

export interface NoteCreatorProps {
  projectId: string;
  sourceEngineId: string;
  sourceEntityId: string;
  /** Pre-built anchor (entity-level or text-range with offsets + context). */
  anchor: AnnotationAnchor;
  /** Default note type — UI starts here but user can switch. */
  defaultType?: NoteType;
  /** Stacking position for the new note. */
  position: number;
  onCreated: () => void;
  onCancel: () => void;
}

export default function NoteCreator(props: NoteCreatorProps) {
  const { t } = useTranslation();
  const [type, setType] = useState<NoteType>(props.defaultType ?? 'text');

  return (
    <div className="rounded-lg border border-accent-gold/40 bg-bg-elevated p-3 space-y-3 shadow-sm">
      <div className="flex items-center gap-1">
        <TypeButton active={type === 'text'} onClick={() => setType('text')} icon={<FileText size={12} />} label={t('annotations.create.text')} />
        <TypeButton active={type === 'image'} onClick={() => setType('image')} icon={<ImageIcon size={12} />} label={t('annotations.create.image')} />
        <TypeButton active={type === 'reference'} onClick={() => setType('reference')} icon={<LinkIcon size={12} />} label={t('annotations.create.reference')} />
        <div className="flex-1" />
        <button onClick={props.onCancel} className="text-[11px] text-text-secondary hover:text-text-primary px-1.5">
          {t('common.cancel')}
        </button>
      </div>

      {type === 'text' && <TextBody {...props} />}
      {type === 'image' && <ImageBody {...props} />}
      {type === 'reference' && <ReferenceBody {...props} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function TypeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] transition border ${
        active
          ? 'border-accent-gold text-accent-gold bg-accent-gold/10'
          : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-bg-base/60'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

async function persistShell(
  props: NoteCreatorProps,
  noteType: NoteType,
  body: { noteBody?: string; noteImageUrl?: string },
): Promise<string> {
  const id = generateId('ann');
  const now = Date.now();
  const annotation: Annotation = {
    id,
    projectId: props.projectId,
    sourceEngineId: props.sourceEngineId,
    sourceEntityId: props.sourceEntityId,
    anchor: props.anchor,
    noteType,
    isOrphaned: false,
    position: props.position,
    createdAt: now,
    updatedAt: now,
    ...body,
  };
  await createAnnotation(annotation);
  return id;
}

// ---------------------------------------------------------------------------
// Text body
// ---------------------------------------------------------------------------

function TextBody(props: NoteCreatorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);

  async function save() {
    setSaving(true);
    try {
      await persistShell(props, 'text', { noteBody: draft });
      props.onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={t('annotations.create.textPlaceholder')}
        className="w-full min-h-[70px] rounded-md border border-border bg-bg-base px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent-gold"
        autoFocus
      />
      <div className="flex justify-end mt-2">
        <button
          onClick={save}
          disabled={!draft.trim() || saving}
          className="px-3 py-1 text-xs rounded-md bg-accent-gold text-black hover:bg-accent-gold/90 disabled:opacity-40 transition"
        >
          {t('common.save')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Image body
// ---------------------------------------------------------------------------

function ImageBody(props: NoteCreatorProps) {
  const { t } = useTranslation();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  function onPick(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setDataUrl(reader.result);
    };
    reader.readAsDataURL(file);
  }

  async function save() {
    if (!dataUrl) return;
    setSaving(true);
    try {
      await persistShell(props, 'image', { noteImageUrl: dataUrl });
      props.onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <input
        type="file"
        accept="image/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
        }}
        className="text-xs text-text-secondary"
      />
      {dataUrl && (
        <img
          src={dataUrl}
          alt=""
          className="max-h-40 w-full object-contain rounded-md border border-border"
        />
      )}
      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={!dataUrl || saving}
          className="px-3 py-1 text-xs rounded-md bg-accent-gold text-black hover:bg-accent-gold/90 disabled:opacity-40 transition"
        >
          {t('common.save')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reference body — engine picker + entity search
// ---------------------------------------------------------------------------

function ReferenceBody(props: NoteCreatorProps) {
  const { t } = useTranslation();
  const allAdapters = getAllAnchorAdapters();
  // Hide the source engine from its own picker — referencing yourself is allowed
  // but not a primary use case; users can still pick it after expanding.
  const [pickedEngine, setPickedEngine] = useState<string>(
    allAdapters.find((a) => a.engineId !== props.sourceEngineId)?.engineId ?? '',
  );
  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<EntityPreview[]>([]);
  const [searching, setSearching] = useState<boolean>(false);
  const [showInlineCreate, setShowInlineCreate] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    if (!pickedEngine || !query.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    (async () => {
      try {
        const items = await searchEntities(query, [pickedEngine]);
        if (!cancelled) setResults(items.slice(0, 10));
      } finally {
        if (!cancelled) setSearching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pickedEngine, query]);

  async function attachReference(entityId: string) {
    if (saving) return;
    setSaving(true);
    try {
      const annotationId = await persistShell(props, 'reference', {});
      const reference: AnnotationReference = {
        id: generateId('annref'),
        annotationId,
        targetEngineId: pickedEngine,
        targetEntityId: entityId,
        createdAt: Date.now(),
      };
      await createReference(reference);
      props.onCreated();
    } finally {
      setSaving(false);
    }
  }

  const adapter: AnchorAdapter | undefined = pickedEngine
    ? getAnchorAdapter(pickedEngine)
    : undefined;
  const InlineCreate = adapter?.CreateInlineForm;

  return (
    <div className="space-y-2">
      {/* Engine picker */}
      <div className="flex flex-wrap gap-1">
        {allAdapters.map((a) => (
          <button
            key={a.engineId}
            onClick={() => {
              setPickedEngine(a.engineId);
              setShowInlineCreate(false);
            }}
            className={`px-2 py-1 rounded-md text-[11px] border transition ${
              pickedEngine === a.engineId
                ? 'border-accent-gold text-accent-gold bg-accent-gold/10'
                : 'border-border text-text-secondary hover:text-text-primary hover:bg-bg-base/60'
            }`}
          >
            {a.getEngineChipLabel()}
          </button>
        ))}
      </div>

      {/* Search */}
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('annotations.create.searchPlaceholder')}
        className="w-full rounded-md border border-border bg-bg-base px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent-gold"
      />

      {/* Search results */}
      {query.trim() && (
        <ul className="max-h-44 overflow-y-auto rounded-md border border-border divide-y divide-border">
          {searching && (
            <li className="px-2 py-1.5 text-xs text-text-secondary">{t('common.loading')}</li>
          )}
          {!searching && results.length === 0 && (
            <li className="px-2 py-1.5 text-xs text-text-secondary">{t('annotations.create.noResults')}</li>
          )}
          {!searching &&
            results.map((r) => (
              <li key={`${r.engineId}:${r.id}`}>
                <button
                  onClick={() => attachReference(r.id)}
                  disabled={saving}
                  className="w-full text-left px-2 py-1.5 text-sm text-text-primary hover:bg-bg-elevated transition"
                >
                  {r.title}
                  {r.subtitle && (
                    <span className="ml-2 text-[10px] text-text-secondary">{r.subtitle}</span>
                  )}
                </button>
              </li>
            ))}
        </ul>
      )}

      {/* Inline create */}
      {InlineCreate && (
        showInlineCreate ? (
          <InlineCreate
            projectId={props.projectId}
            initialTitle={props.anchor.selectedText}
            onCreated={(entityId) => {
              setShowInlineCreate(false);
              attachReference(entityId);
            }}
            onCancel={() => setShowInlineCreate(false)}
          />
        ) : (
          <button
            onClick={() => setShowInlineCreate(true)}
            className="flex items-center gap-1 text-[11px] text-accent-gold hover:underline"
          >
            <Plus size={11} />
            {t('annotations.create.inlineCreate').replace('{label}', adapter?.getEngineChipLabel() ?? '')}
          </button>
        )
      )}
    </div>
  );
}
