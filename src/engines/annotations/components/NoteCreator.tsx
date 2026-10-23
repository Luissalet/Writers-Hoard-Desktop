import {useWorldEraScope} from '@/services/worldEras/hooks';
import {annotationReferenceCandidates} from '../scope';
import {annotationDrafts} from '../drafts';
import ThreadTextEditor from './ThreadTextEditor';
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

import { useEffect, useMemo, useState } from 'react';
import { FileText, Image as ImageIcon, Link as LinkIcon, Plus } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { generateId } from '@/utils/idGenerator';
import type { EntityPreview } from '@/engines/_types';
import {
  getAllAnchorAdapters,
  getAnchorAdapter,
  type AnchorAdapter,
} from '@/engines/_shared/anchoring';
import {
  createAnnotation,
} from '../operations';
import type {
  Annotation,
  AnnotationAnchor,
  NoteType,
} from '../types';

export interface NoteCreatorProps {
  projectId: string;
  eraId?:string;
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
  // The bodies are rendered conditionally, so a draft living inside one of them
  // died the moment the reader pressed another type button. The drafts live
  // here instead and survive every switch.
  const pane=useWorldEraScope(props.projectId),scope={...pane,eraId:props.eraId??pane.eraId},[journal]=useState(()=>annotationDrafts(scope)),journalId=`new:${props.sourceEngineId}:${props.sourceEntityId}`;
  const [textDraft, setTextDraft] = useState<string>(()=>journal.get(journalId)?.body??'');
  const [mentions,setMentions]=useState<import('../types').AnnotationMention[]>(()=>journal.get(journalId)?.mentions??[]);
  const remember=(body:string,links=mentions)=>{setTextDraft(body);setMentions(links);journal.set(journalId,{kind:'new',body,mentions:links,revision:0});};
  const cancel=()=>{journal.delete(journalId);props.onCancel();};
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-accent-gold/40 bg-bg-elevated p-3 space-y-3 shadow-sm">
      <div className="flex items-center gap-1">
        <TypeButton active={type === 'text'} onClick={() => setType('text')} icon={<FileText size={12} />} label={t('annotations.create.text')} />
        <TypeButton active={type === 'image'} onClick={() => setType('image')} icon={<ImageIcon size={12} />} label={t('annotations.create.image')} />
        <TypeButton active={type === 'reference'} onClick={() => setType('reference')} icon={<LinkIcon size={12} />} label={t('annotations.create.reference')} />
        <div className="flex-1" />
        <button onClick={cancel} className="min-h-9 px-2 text-xs text-text-muted hover:text-text-primary">
          {t('common.cancel')}
        </button>
      </div>

      {type === 'text' && <TextBody {...props} eraId={scope.eraId} draft={textDraft} mentions={mentions} onDraftChange={remember} onMentionsChange={links=>remember(textDraft,links)} onCreated={()=>{journal.delete(journalId);props.onCreated();}} onCancel={cancel}/>}
      {type === 'image' && <ImageBody {...props} eraId={scope.eraId} dataUrl={imageDataUrl} onDataUrlChange={setImageDataUrl} />}
      {type === 'reference' && <ReferenceBody {...props} eraId={scope.eraId} />}
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
      className={`flex min-h-9 items-center gap-1 px-2 py-1 rounded-md text-[11px] transition border ${
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
  body: { noteBody?: string; noteImageUrl?: string; mentions?:import('../types').AnnotationMention[] },
  referenceTarget?:{engineId:string;entityId:string},
): Promise<string> {
  const id = generateId('ann');
  const now = Date.now();
  const annotation: Annotation = {
    id,
    projectId: props.projectId,eraId:props.eraId,
    sourceEngineId: props.sourceEngineId,
    sourceEntityId: props.sourceEntityId,
    anchor: props.anchor,
    noteType,
    isOrphaned: false,
    position: props.position,
    createdAt: now,
    updatedAt: now,
    // What the writer writes is read from the start.
    readAt: now,
    ...body,
  };
  await createAnnotation(annotation,referenceTarget?{id:generateId('annref'),annotationId:id,targetEngineId:referenceTarget.engineId,targetEntityId:referenceTarget.entityId,createdAt:now}:undefined);
  return id;
}

// ---------------------------------------------------------------------------
// Text body
// ---------------------------------------------------------------------------

function TextBody(props:NoteCreatorProps & {draft:string;mentions:import('../types').AnnotationMention[];onDraftChange:(value:string)=>void;onMentionsChange:(mentions:import('../types').AnnotationMention[])=>void}){
 const {locale}=useTranslation(),es=locale==='es';const [saving,setSaving]=useState(false),[error,setError]=useState(''),scope=useMemo(()=>({projectId:props.projectId,eraId:props.eraId}),[props.projectId,props.eraId]);
 const save=async()=>{if(saving)return;setSaving(true);setError('');try{await persistShell(props,'text',{noteBody:props.draft,mentions:props.mentions});props.onCreated();}catch{setError(es?'No se pudo guardar. Conservamos el comentario y sus menciones.':'Could not save. Your comment and mentions are preserved.');}finally{setSaving(false);}};
 return <div className="space-y-2">{error&&<p role="alert" className="text-sm text-danger">{error}</p>}<ThreadTextEditor scope={scope} label={es?'Comentario':'Comment'} body={props.draft} mentions={props.mentions} onBody={props.onDraftChange} onMentions={props.onMentionsChange} onSave={()=>void save()} onCancel={props.onCancel} busy={saving}/></div>;
}

// ---------------------------------------------------------------------------
// Image body
// ---------------------------------------------------------------------------

function ImageBody(
  props: NoteCreatorProps & { dataUrl: string | null; onDataUrlChange: (value: string | null) => void },
) {
  const { t } = useTranslation();
  const { dataUrl, onDataUrlChange } = props;
  const [saving, setSaving] = useState<boolean>(false);

  function onPick(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') onDataUrlChange(reader.result);
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
        // Scoped to this project. Without it the reference picker listed
        // entities from every project in the database, and picking one created
        // a cross-project reference whose backlink then navigated to a dead
        // URL (the fallback composes the path from the *current* project id).
        const items = await annotationReferenceCandidates({projectId:props.projectId,eraId:props.eraId},pickedEngine,query);
        if (!cancelled) setResults(items);
      } finally {
        if (!cancelled) setSearching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pickedEngine, query, props.projectId,props.eraId]);

  async function attachReference(entityId: string) {
    if (saving) return;
    setSaving(true);
    try {
      await persistShell(props, 'reference', {},{engineId:pickedEngine,entityId});
      props.onCreated();
    } finally {
      setSaving(false);
    }
  }

  const adapter: AnchorAdapter | undefined = pickedEngine
    ? getAnchorAdapter(pickedEngine)
    : undefined;
  const InlineCreate = props.eraId?undefined:adapter?.CreateInlineForm;

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
