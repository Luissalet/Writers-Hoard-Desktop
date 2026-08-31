import { ExternalLink, Plus } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import TagInput from '@/components/common/TagInput';
import { toast } from '@/components/common/toast';
import AnnotationSurface from '@/engines/annotations/components/AnnotationSurface';
import { ATLAS_PLACE_KINDS, type AtlasDivergence, type AtlasPlace, type AtlasPlaceKind } from '../types';
import { EditorHeader, Field, inputClass, labelClass, selectClass, textareaClass } from './fields';
import { useRowDraft } from './useRowDraft';

/** What the inputs hold: strings where the row has numbers or lists. */
interface PlaceDraft {
  name: string;
  kind: AtlasPlaceKind;
  aliases: string[];
  country: string;
  address: string;
  lat: string;
  lon: string;
  parentId: string;
  era: string;
  fictional: boolean;
  description: string;
  realNotes: string;
  sources: string;
  tags: string[];
}

function toDraft(place: AtlasPlace): PlaceDraft {
  return {
    name: place.name,
    kind: place.kind,
    aliases: place.aliases,
    country: place.country ?? '',
    address: place.address ?? '',
    lat: place.lat === undefined ? '' : String(place.lat),
    lon: place.lon === undefined ? '' : String(place.lon),
    parentId: place.parentId ?? '',
    era: place.era ?? '',
    fictional: place.fictional,
    description: place.description,
    realNotes: place.realNotes,
    sources: place.sources.join('\n'),
    tags: place.tags,
  };
}

/** '' → unset; a finite number within ±limit → itself; anything else → NaN, which Save refuses. */
function parseCoord(text: string, limit: number): number | undefined {
  if (text.trim() === '') return undefined;
  const value = Number(text);
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : NaN;
}

// Optional fields go back as `undefined`, not '': Dexie's update() deletes the
// key, so a cleared address does not linger as an empty string in backups.
function fromDraft(draft: PlaceDraft, untitled: string): Partial<AtlasPlace> {
  return {
    name: draft.name.trim() || untitled,
    kind: draft.kind,
    aliases: draft.aliases,
    country: draft.country.trim() || undefined,
    address: draft.address.trim() || undefined,
    lat: parseCoord(draft.lat, 90),
    lon: parseCoord(draft.lon, 180),
    parentId: draft.parentId || undefined,
    era: draft.era.trim() || undefined,
    fictional: draft.fictional,
    description: draft.description,
    realNotes: draft.realNotes,
    sources: draft.sources.split('\n').map((line) => line.trim()).filter(Boolean),
    tags: draft.tags,
  };
}

/** The place and everything below it: a place cannot sit inside itself or inside its own child. */
function subtreeOf(rootId: string, places: AtlasPlace[]): Set<string> {
  const ids = new Set([rootId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const place of places) {
      if (place.parentId && ids.has(place.parentId) && !ids.has(place.id)) {
        ids.add(place.id);
        grew = true;
      }
    }
  }
  return ids;
}

function CoordInput({ value, limit, label, invalid, onChange }: {
  value: string; limit: number; label: string; invalid: boolean; onChange: (value: string) => void;
}) {
  return (
    <div className="w-36">
      <input
        type="number" step="any" min={-limit} max={limit}
        value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={label} aria-label={label}
        className={`${inputClass} ${invalid ? 'border-danger' : ''}`}
      />
    </div>
  );
}

interface PlaceEditorProps {
  projectId: string;
  place: AtlasPlace;
  /** Every place of the project: the parent picker needs the siblings. */
  places: AtlasPlace[];
  /** Every divergence of the project; the editor picks out this place's. */
  divergences: AtlasDivergence[];
  onSave: (changes: Partial<AtlasPlace>) => Promise<void>;
  onDelete: () => Promise<void>;
  onAddDivergence: () => void;
  onOpenDivergence: (id: string) => void;
}

export default function PlaceEditor({
  projectId, place, places, divergences, onSave, onDelete, onAddDivergence, onOpenDivergence,
}: PlaceEditorProps) {
  const { t } = useTranslation();
  const untitled = t('realAtlas.place.untitled');
  const { draft, patch, changes, dirty } = useRowDraft(place, toDraft, (d) => fromDraft(d, untitled));

  const latInvalid = Number.isNaN(changes.lat);
  const lonInvalid = Number.isNaN(changes.lon);
  const hasCoords = changes.lat !== undefined && changes.lon !== undefined && !latInvalid && !lonInvalid;
  const excluded = subtreeOf(place.id, places);
  const here = divergences.filter((d) => d.placeId === place.id);

  // window.open, not <a href>: Electron's window-open handler hands http(s) to
  // the OS browser, whereas a plain link would navigate the app shell itself.
  const openInOsm = () => {
    const { lat, lon } = changes;
    window.open(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=14/${lat}/${lon}`, '_blank', 'noopener');
  };

  return (
    <div className="space-y-5">
      <EditorHeader
        title={changes.name ?? ''}
        saveLabel={t('realAtlas.place.save')}
        canSave={dirty && !latInvalid && !lonInvalid}
        onSave={async () => {
          await onSave(changes);
          toast.success(t('realAtlas.place.saved'));
        }}
        deleteLabel={t('realAtlas.place.delete')}
        deleteConfirm={t('realAtlas.place.deleteConfirm')}
        onDelete={onDelete}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t('realAtlas.place.name')} className="sm:col-span-2">
          <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} className={inputClass} />
        </Field>
        <Field label={t('realAtlas.place.kind')}>
          <select value={draft.kind} onChange={(e) => patch({ kind: e.target.value as AtlasPlaceKind })} className={selectClass}>
            {ATLAS_PLACE_KINDS.map((kind) => <option key={kind} value={kind}>{t(`realAtlas.kind.${kind}`)}</option>)}
          </select>
        </Field>
        <Field label={t('realAtlas.place.parent')}>
          <select value={draft.parentId} onChange={(e) => patch({ parentId: e.target.value })} className={selectClass}>
            <option value="">{t('realAtlas.place.noParent')}</option>
            {places.filter((p) => !excluded.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label={t('realAtlas.place.aliases')} className="sm:col-span-2">
          <TagInput tags={draft.aliases} onChange={(aliases) => patch({ aliases })} placeholder={t('realAtlas.place.aliasesPlaceholder')} />
        </Field>
        <Field label={t('realAtlas.place.country')}>
          <input value={draft.country} onChange={(e) => patch({ country: e.target.value })} className={inputClass} />
        </Field>
        <Field label={t('realAtlas.place.address')}>
          <input value={draft.address} onChange={(e) => patch({ address: e.target.value })} className={inputClass} />
        </Field>
        <div className="sm:col-span-2">
          <span className={labelClass}>{t('realAtlas.place.coordinates')}</span>
          <div className="flex flex-wrap items-center gap-2">
            <CoordInput value={draft.lat} limit={90} label={t('realAtlas.place.lat')} invalid={latInvalid} onChange={(lat) => patch({ lat })} />
            <CoordInput value={draft.lon} limit={180} label={t('realAtlas.place.lon')} invalid={lonInvalid} onChange={(lon) => patch({ lon })} />
            {hasCoords && (
              <button type="button" onClick={openInOsm} className="flex items-center gap-1 text-xs text-accent-gold hover:underline">
                <ExternalLink size={12} />
                {t('realAtlas.place.openInOsm')}
              </button>
            )}
          </div>
        </div>
        <Field label={t('realAtlas.place.era')}>
          <input value={draft.era} onChange={(e) => patch({ era: e.target.value })} placeholder={t('realAtlas.place.eraPlaceholder')} className={inputClass} />
        </Field>
        <label className="flex items-start gap-2 cursor-pointer sm:pt-6">
          <input type="checkbox" checked={draft.fictional} onChange={(e) => patch({ fictional: e.target.checked })} className="mt-1 accent-accent-gold" />
          <span>
            <span className="block text-sm text-text-primary">{t('realAtlas.place.fictional')}</span>
            <span className="block text-xs text-text-dim">{t('realAtlas.place.fictionalHint')}</span>
          </span>
        </label>
        <Field label={t('realAtlas.place.description')} className="sm:col-span-2">
          <textarea rows={4} value={draft.description} onChange={(e) => patch({ description: e.target.value })} placeholder={t('realAtlas.place.descriptionPlaceholder')} className={textareaClass} />
        </Field>
        <Field label={t('realAtlas.place.realNotes')} className="sm:col-span-2">
          <textarea rows={4} value={draft.realNotes} onChange={(e) => patch({ realNotes: e.target.value })} placeholder={t('realAtlas.place.realNotesPlaceholder')} className={textareaClass} />
        </Field>
        <Field label={t('realAtlas.place.sources')} className="sm:col-span-2">
          <textarea rows={3} value={draft.sources} onChange={(e) => patch({ sources: e.target.value })} placeholder={t('realAtlas.place.sourcesPlaceholder')} className={textareaClass} />
        </Field>
        <Field label={t('realAtlas.place.tags')} className="sm:col-span-2">
          <TagInput tags={draft.tags} onChange={(tags) => patch({ tags })} />
        </Field>
      </div>

      <section className="border-t border-border pt-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className={labelClass}>{t('realAtlas.place.divergencesHere')}</h3>
          <button
            type="button"
            onClick={onAddDivergence}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-accent-gold/10 text-accent-gold rounded-lg hover:bg-accent-gold/20 transition"
          >
            <Plus size={12} />
            {t('realAtlas.divergences.new')}
          </button>
        </div>
        {here.length === 0 ? (
          <p className="text-sm text-text-dim">{t('realAtlas.place.noDivergences')}</p>
        ) : (
          <ul className="space-y-1">
            {here.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => onOpenDivergence(d.id)}
                  className="w-full text-left px-3 py-2 rounded-lg border border-border bg-elevated hover:border-accent-gold/40 transition"
                >
                  <span className="block truncate text-sm text-text-primary">{d.title}</span>
                  <span className="block text-[10px] uppercase tracking-wide text-text-dim">
                    {t(`realAtlas.category.${d.category}`)}{d.since ? ` · ${d.since}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="pt-2 border-t border-border">
        <AnnotationSurface projectId={projectId} engineId="real-atlas" entityId={place.id} layout="stack" />
      </div>
    </div>
  );
}
