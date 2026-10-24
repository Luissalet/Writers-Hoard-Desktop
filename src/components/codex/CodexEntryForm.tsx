import { useWorldEraScope } from '@/services/worldEras/hooks';
import { missingRequiredProperties, projectCodexEntry, propertyDefinitions } from '@/engines/codex/properties';
import { freezeCodexEntry } from '@/engines/codex/freeze';
import type { CodexPropertyDefinition } from '@/engines/codex/templateTypes';
import PropertyValueInput from './PropertyValueInput';
import { useEffect, useId, useState, useRef } from 'react';
import type { CodexEntry, CodexEntryType } from '@/types';
import { getTemplateFields } from '@/types';
import { generateId } from '@/utils/idGenerator';
import TiptapEditor from '@/components/editor/TiptapEditor';
import type {Editor} from '@tiptap/core';
import {localToolAtomKey,localToolAtomPending} from '@/engines/local/blocks/pending';
import TagInput from '@/components/common/TagInput';
import ImagePreviewCrop from '@/components/common/ImagePreviewCrop';
import { User, MapPin, Sword, Shield, Sparkles, HelpCircle, BookOpen, ImagePlus, Plus, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { CodexEditConflict, type CodexFieldConflict } from '@/engines/codex/operations';
import { sanitizedHtml } from '@/utils/sanitizeRichHtml';
import { ConfirmDialog } from '@/engines/_shared';
import { codexDraftStore, codexFormValues, restoreCodexDraft, sameCodexFormValues, toCodexDraft } from './codexDrafts';
import { aliasProblem, foldAlias, isAliasField, readAliases, replaceAliases, suggestAliases } from '@/services/codexReference/aliases';
import { useProject } from '@/hooks/useProjects';
import { useCodexEntries } from '@/engines/codex/hooks';
import { applyCodexTemplate, type CodexTemplate } from '@/engines/codex/templates';
import { effectiveCodexTemplate, effectiveTemplatePresentation, selectableCodexTemplates, templateIsWithin, templatePath } from '@/engines/codex/templateHierarchy';
import { templatePresentationCopy } from '@/engines/codex/templatePresentationCopy';
import { ProjectIcon } from '@/components/common/ProjectIcon';
import CodexRevealControl from './CodexRevealControl';

const typeConfig: Record<CodexEntryType, { icon: typeof User; labelKey: string; color: string }> = {
  character: { icon: User, labelKey: 'codex.types.character', color: '#c4973b' },
  location: { icon: MapPin, labelKey: 'codex.types.location', color: '#4a9e6d' },
  item: { icon: Sword, labelKey: 'codex.types.item', color: '#4a7ec4' },
  faction: { icon: Shield, labelKey: 'codex.types.faction', color: '#c4463a' },
  concept: { icon: Sparkles, labelKey: 'codex.types.concept', color: '#7c5cbf' },
  magic: { icon: Sparkles, labelKey: 'codex.types.magic', color: '#d4a843' },
  custom: { icon: HelpCircle, labelKey: 'codex.types.custom', color: '#8a8690' },
};

const FIELD_LABEL_KEYS: Record<string, string> = {
  name: 'codex.field.name',
  age: 'codex.field.age',
  species: 'codex.field.species',
  role: 'codex.field.role',
  physicalDescription: 'codex.field.physicalDescription',
  personality: 'codex.field.personality',
  backstory: 'codex.field.backstory',
  abilities: 'codex.field.abilities',
  goals: 'codex.field.goals',
  flaws: 'codex.field.flaws',
  region: 'codex.field.region',
  climate: 'codex.field.climate',
  population: 'codex.field.population',
  history: 'codex.field.history',
  notableFeatures: 'codex.field.notableFeatures',
  inhabitants: 'codex.field.inhabitants',
  type: 'codex.field.type',
  origin: 'codex.field.origin',
  properties: 'codex.field.properties',
  currentOwner: 'codex.field.currentOwner',
  leader: 'codex.field.leader',
  territory: 'codex.field.territory',
  allies: 'codex.field.allies',
  enemies: 'codex.field.enemies',
  // Filled by the investigation engine's Wikidata enrichment.
  description: 'codex.field.description',
  born: 'codex.field.born',
  died: 'codex.field.died',
  placeOfBirth: 'codex.field.placeOfBirth',
  occupation: 'codex.field.occupation',
  citizenship: 'codex.field.citizenship',
  country: 'codex.field.country',
  locatedIn: 'codex.field.locatedIn',
  coordinates: 'codex.field.coordinates',
  founded: 'codex.field.founded',
  headquarters: 'codex.field.headquarters',
  website: 'codex.field.website',
  date: 'codex.field.date',
  start: 'codex.field.start',
  end: 'codex.field.end',
  location: 'codex.field.location',
};

const RESERVED_FIELD_NAMES = new Set([...Object.getOwnPropertyNames(Object.prototype).map(foldAlias), 'prototype']);

interface CodexEntryFormProps {
  projectId: string;
  entry?: CodexEntry;
  template?: CodexTemplate;
  onSave: (entry: CodexEntry, base?: CodexEntry) => Promise<void>;
  onPendingChange?: (pending: boolean) => void;
  /** Whether the form holds unsaved input (typed now or recovered). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Closing keeps the recovery draft; only Save, Discard or deleting the entry retire it. */
  onCancel: () => void;
}

export default function CodexEntryForm({ projectId, entry, template, onSave, onCancel, onPendingChange, onDirtyChange }: CodexEntryFormProps) {
  const { t,locale } = useTranslation();
  const presentationCopy=templatePresentationCopy[locale];
  const { project } = useProject(projectId);
  const { items: codexEntries } = useCodexEntries(projectId);
  const aliasesInputId = useId();
  const draftId = entry?.id ?? 'new';
  const scope = useWorldEraScope(projectId);
  const [drafts] = useState(() => codexDraftStore(projectId, scope.eraId));
  const [initial] = useState(() => {
    const stored = drafts.get(draftId);
    const blank = codexFormValues(entry);
    const values = template && !entry ? { ...blank, ...applyCodexTemplate(template, {}, '') } : blank;
    return stored ? { ...restoreCodexDraft(stored, entry), recovered: true } : { values, base: entry, recovered: false };
  });
  const [type, setType] = useState<CodexEntryType>(initial.values.type);
  const [title, setTitle] = useState(initial.values.title);
  // The alias just refused, and why: shown under the chips until the next one.
  const [aliasRefused, setAliasRefused] = useState<{ alias: string; problem: string } | null>(null);
  const [avatar, setAvatar] = useState(initial.values.avatar);
  const [avatarOriginal, setAvatarOriginal] = useState(initial.values.avatarOriginal);
  const [fields, setFields] = useState<Record<string, string>>(initial.values.fields);
  const [content, setContent] = useState(initial.values.content);
  const [tags, setTags] = useState<string[]>(initial.values.tags);
  const [templateId, setTemplateId] = useState(initial.values.templateId);
  // Set when the card is frozen from its type: its own property kinds from then on.
  const [frozenDefinitions, setFrozenDefinitions] = useState<CodexPropertyDefinition[] | undefined>(undefined);
  const [referenceFields, setReferenceFields] = useState<Record<string, string[]>>(initial.values.referenceFields ?? {});
  const rawTemplate = project?.codexTemplates?.find(item => item.id === templateId) ?? (template?.id === templateId ? template : undefined);
  const activeTemplate = rawTemplate ? effectiveCodexTemplate(rawTemplate, project?.codexTemplates ?? []) : undefined;
  const valueDefinitions = activeTemplate ? propertyDefinitions(activeTemplate) : entry?.propertyDefinitions ?? [];
  const [requiredMissing, setRequiredMissing] = useState<string[]>([]);
  const projection = projectCodexEntry({ ...initial.values, ...entry, id: entry?.id ?? '', projectId, type, title, fields, content, tags, relations: [], createdAt: 0, updatedAt: 0, templateId }, project?.codexTemplates ?? (activeTemplate ? [activeTemplate] : []));
  const referenceDefinitions = activeTemplate?.referenceFieldDefinitions ?? [];
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [pendingAvatar, setPendingAvatar] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [pendingBlock, setPendingBlock] = useState(false);
  const contentEditor = useRef<Editor|null>(null);
  const savingRef = useRef(false);
  // The entry this edit started from, advanced field by field as conflicts are resolved.
  const [base, setBase] = useState(initial.base);
  const [externalEntry,setExternalEntry]=useState<CodexEntry>();
  const [conflict, setConflict] = useState<CodexEditConflict | null>(null);
  const [recovered, setRecovered] = useState(initial.recovered);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [pendingRemoveField, setPendingRemoveField] = useState<string | null>(null);
  const [fieldKind, setFieldKind] = useState<'text' | 'reference'>('text');

  // Mirror unsaved input into the recovery store: closing the modal unmounts
  // this form, and what was typed has to survive it.
  const dirty = recovered || !sameCodexFormValues({ type, title, avatar, avatarOriginal, fields, content, tags, templateId, referenceFields }, codexFormValues(externalEntry??entry));
  useEffect(() => {
    if (dirty) drafts.set(draftId, toCodexDraft({ type, title, avatar, avatarOriginal, fields, content, tags, templateId, referenceFields }, base));
    else drafts.delete(draftId);
  }, [drafts, draftId, dirty, type, title, avatar, avatarOriginal, fields, content, tags, templateId, referenceFields, base]);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const discardDraft = () => {
    const saved = codexFormValues(externalEntry??entry);
    drafts.delete(draftId);
    setType(saved.type);
    setTitle(saved.title);
    setAvatar(saved.avatar);
    setAvatarOriginal(saved.avatarOriginal);
    setFields(saved.fields);
    setContent(saved.content);
    setTags(saved.tags);
    setTemplateId(saved.templateId);
    setReferenceFields(saved.referenceFields ?? {});
    setBase(entry);
    setConflict(null);
    setSaveError(false);
    setRecovered(false);
    setConfirmDiscard(false);
    setNewFieldName('');
    setFieldError('');
    setPendingRemoveField(null);
  };

  const resolveConflict = (item: CodexFieldConflict, keepDraft: boolean) => {
    if (!conflict || !base) return;
    const nextBase = { ...base, fields: { ...base.fields } };
    if (item.key.startsWith('referenceFields.')) {
      const key = item.key.slice('referenceFields.'.length);
      const value = conflict.current.referenceFields?.[key];
      nextBase.referenceFields = { ...(base.referenceFields ?? {}) };
      if (value === undefined) delete nextBase.referenceFields[key]; else nextBase.referenceFields[key] = value;
      if (!keepDraft) setReferenceFields(previous => { const next = { ...previous }; if (value === undefined) delete next[key]; else next[key] = [...value]; return next; });
    } else if (item.key.startsWith('fields.')) {
      const key = item.key.slice(7);
      const value = conflict.current.fields[key];
      if (value === undefined) delete nextBase.fields[key];
      else nextBase.fields[key] = value;
      if (!keepDraft) setFields(previous => {
        const next = { ...previous };
        if (value === undefined) delete next[key];
        else next[key] = value;
        return next;
      });
    } else {
      const key = item.key as 'title' | 'content' | 'tags' | 'avatar' | 'avatarOriginal' | 'templateId' | 'type';
      Object.assign(nextBase, { [key]: conflict.current[key] });
      if (!keepDraft) {
        if (key === 'title') setTitle(conflict.current.title);
        if (key === 'content') setContent(conflict.current.content);
        if (key === 'tags') setTags([...conflict.current.tags]);
        if (key === 'avatar') setAvatar(conflict.current.avatar ?? '');
        if (key === 'avatarOriginal') setAvatarOriginal(conflict.current.avatarOriginal ?? conflict.current.avatar ?? '');
        if (key === 'templateId') setTemplateId(conflict.current.templateId);
        if (key === 'type') setType(conflict.current.type);
      }
    }
    setBase(nextBase);
    const remaining = conflict.conflicts.filter(candidate => candidate.key !== item.key);
    setConflict(remaining.length ? new CodexEditConflict(remaining, conflict.current) : null);
  };

  const conflictLabel = (key: CodexFieldConflict['key']) => key.startsWith('referenceFields.') ? key.slice('referenceFields.'.length) : key.startsWith('fields.')
    ? t(isAliasField(key.slice(7)) ? 'codex.aliases' : FIELD_LABEL_KEYS[key.slice(7)] || key.slice(7))
    : t(({ title: 'common.title', content: 'codex.extendedNotes', tags: 'common.tags', avatar: 'codex.avatar', avatarOriginal: 'codex.avatar', templateId: 'codex.templates.template', type: 'codex.entryType' } as Record<string, string>)[key]);
  const conflictDraftValue = (key: CodexFieldConflict['key']) => key.startsWith('referenceFields.') ? referenceFields[key.slice('referenceFields.'.length)] : key.startsWith('fields.')
    ? fields[key.slice(7)]
    : ({ title, content, tags, avatar, avatarOriginal, templateId, type } as Record<string, string | string[] | undefined>)[key];

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPendingAvatar(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleTypeChange = (newType: CodexEntryType) => {
    setType(newType);
    setTemplateId(undefined);
    if (!entry) {
      const previousTemplate = getTemplateFields(type);
      setFields(previous => ({ ...getTemplateFields(newType), ...Object.fromEntries(Object.entries(previous).filter(([key]) => !Object.hasOwn(previousTemplate, key))) }));
    }
  };

  const addField = () => {
    const name = newFieldName.trim().replace(/\s+/g, ' ');
    const normalized = foldAlias(name);
    if (!name) { setFieldError('codex.fields.nameRequired'); return; }
    if (isAliasField(name) || RESERVED_FIELD_NAMES.has(normalized)) {
      setFieldError('codex.fields.nameReserved'); return;
    }
    if ([...Object.keys(fields), ...Object.keys(referenceFields), ...referenceDefinitions.map(definition => definition.key)].some(key => foldAlias(key.trim().replace(/\s+/g, ' ')) === normalized || foldAlias(t(FIELD_LABEL_KEYS[key] || key)) === normalized)) {
      setFieldError('codex.fields.nameExists'); return;
    }
    if (fieldKind === 'reference') setReferenceFields(previous => ({ ...previous, [name]: [] }));
    else setFields(previous => ({ ...previous, [name]: '' }));
    setNewFieldName('');
    setFieldError('');
  };

  const removeField = (name: string) => {
    setFields(previous => {
      const next = { ...previous };
      delete next[name];
      return next;
    });
    setReferenceFields(previous => { const next = { ...previous }; delete next[name]; return next; });
    setPendingRemoveField(null);
  };

  const handleSave = async () => {
    if (!title.trim() || savingRef.current || conflict) return;
    let pending=false;
    const editor=contentEditor.current;
    if(editor&&!editor.isDestroyed)editor.state.doc.descendants(node=>{const key=localToolAtomKey(node);if(key&&localToolAtomPending(editor,key))pending=true;});
    setPendingBlock(pending);
    if(pending)return;
    const missing = missingRequiredProperties(valueDefinitions, fields);
    setRequiredMissing(missing.map(definition => definition.label));
    if (missing.length) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(false);
    onPendingChange?.(true);
    try {
      await onSave({
      id: entry?.id || generateId('codex'),
      projectId,
      type,
      title,
      avatar: avatar || undefined,
      avatarOriginal: avatarOriginal || avatar || undefined,
      fields,
      templateId,
      propertyDefinitions: frozenDefinitions ?? entry?.propertyDefinitions,
      referenceFields,
      content,
      tags,
      relations: entry?.relations || [],
      createdAt: entry?.createdAt || Date.now(),
      updatedAt: Date.now(),
      }, base);
      // Saved: the recovery copy has done its job.
      drafts.delete(draftId);
    } catch (error) {
      if (error instanceof CodexEditConflict) setConflict(error);
      else setSaveError(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
      onPendingChange?.(false);
    }
  };

  return (
    <fieldset disabled={saving} inert={saving} aria-busy={saving} className="space-y-6">
      {recovered && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-accent-gold/40 bg-surface px-4 py-2 text-sm text-text-primary">
          <span>{t('codex.draftRecovered')}</span>
          <span aria-hidden="true" className="text-text-muted">·</span>
          <button type="button" onClick={() => setConfirmDiscard(true)} className="text-accent-gold underline-offset-2 hover:underline">
            {t('codex.discardDraft')}
          </button>
        </div>
      )}
      {entry && <CodexRevealControl projectId={projectId} entry={codexEntries.find(item => item.id === entry.id) ?? entry} />}
      {(project?.codexTemplates?.length || templateId) ? (
        <div>
          <label htmlFor={`${aliasesInputId}-template`} className="block text-sm text-text-muted mb-1.5">{t('codex.templates.template')}</label>
          <select id={`${aliasesInputId}-template`} value={templateId ?? ''} onChange={event => {
            const selected = project?.codexTemplates?.find(item => item.id === event.target.value);
            if (!selected) { setTemplateId(undefined); return; }
            if(selected.id!==templateId&&effectiveTemplatePresentation(selected,project?.codexTemplates??[]).hiddenFromPickers)return;
            const applied = applyCodexTemplate(selected, fields, content, project?.codexTemplates ?? []);
            setType(applied.type); setTemplateId(applied.templateId); setFields(applied.fields); setContent(applied.content); setFrozenDefinitions(undefined);
          }} className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold">
            <option value="">{t('codex.templates.none')}</option>
            {templateId && !project?.codexTemplates?.some(item => item.id === templateId) && <option value={templateId}>{activeTemplate?.name ?? t('codex.templates.retired')}</option>}
            {selectableCodexTemplates(project?.codexTemplates ?? [],templateId).map(item => <option key={item.id} value={item.id}>{templatePath(item, project?.codexTemplates ?? [])} · {t(`codex.types.${item.category}`)}{effectiveTemplatePresentation(item,project?.codexTemplates??[]).hiddenFromPickers?` (${presentationCopy.hiddenTag})`:''}</option>)}
          </select>
          <p className="text-xs text-text-dim mt-1.5">{t('codex.templates.applyHint')}</p>
          {templateId && <button type="button" data-testid="codex-freeze" onClick={() => {
            const frozen = freezeCodexEntry({ ...(entry ?? {} as CodexEntry), id: entry?.id ?? '', projectId, type, title, fields, content, tags, relations: entry?.relations ?? [], createdAt: entry?.createdAt ?? 0, updatedAt: 0, templateId }, project?.codexTemplates ?? []);
            setFields(frozen.fields); setFrozenDefinitions(frozen.propertyDefinitions ?? []); setTemplateId(undefined);
          }} title={t('codex.templates.freezeHint')} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-text-muted hover:text-accent-gold hover:bg-elevated">❄ {t('codex.templates.freeze')}</button>}
          {activeTemplate&&<div className="mt-2 flex items-center gap-2 text-sm" style={{color:activeTemplate.color??typeConfig[type].color}}><ProjectIcon name={activeTemplate.icon} fallback={typeConfig[type].icon} size={18}/><span>{activeTemplate.name}</span></div>}
        </div>
      ) : null}

      {/* Type selector */}
        <div>
          <label className="block text-sm text-text-muted mb-2">{t('codex.entryType')}</label>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(typeConfig) as CodexEntryType[]).map(entryType => {
              const config = typeConfig[entryType];
              const Icon = config.icon;
              return (
                <button
                  key={entryType}
                  type="button"
                  aria-pressed={type === entryType}
                  onClick={() => handleTypeChange(entryType)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition ${
                    type === entryType
                      ? 'border-2'
                      : 'border border-border text-text-muted hover:text-text-primary hover:bg-elevated'
                  }`}
                  style={type === entryType ? { borderColor: config.color, color: config.color, backgroundColor: `${config.color}15` } : {}}
                >
                  <Icon size={16} />
                  {t(config.labelKey)}
                </button>
              );
            })}
          </div>
        </div>

      {/* Title + Avatar */}
      <div className="flex gap-4 items-start">
        {/* Avatar */}
        {activeTemplate?.imageLayout==='none'?<p data-testid="codex-hidden-image" className="max-w-44 text-xs leading-relaxed text-text-muted">{presentationCopy.hiddenImage}</p>:<div className="flex-shrink-0">
          <label className="block text-sm text-text-muted mb-1.5">{t('codex.avatar')}</label>
          <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
          {avatar ? (
            // Sibling buttons, not nested ones: the image re-crops, the overlay
            // actions replace or remove, and each is reachable by keyboard.
            <div className={`relative rounded-xl overflow-hidden border border-border group ${activeTemplate?.imageLayout==='portrait'?'w-20 h-28':activeTemplate?.imageLayout==='landscape'?'w-32 h-20':'w-20 h-20'}`}>
              <button
                type="button"
                onClick={() => setPendingAvatar(avatarOriginal || avatar)}
                className="block w-full h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-gold"
                aria-label={t('imageCrop.title')}
                title={t('imageCrop.title')}
              >
                <img src={avatar} alt="" className="w-full h-full object-cover" />
              </button>
              <div className="pointer-events-none absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition flex items-center justify-center gap-1">
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  className="pointer-events-auto p-1.5 bg-white/20 rounded-full hover:bg-white/30 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  aria-label={t('common.change')}
                  title={t('common.change')}
                >
                  <ImagePlus size={12} className="text-white" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => { setAvatar(''); setAvatarOriginal(''); }}
                  className="pointer-events-auto p-1.5 bg-white/20 rounded-full hover:bg-red-500/50 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  aria-label={t('common.remove')}
                  title={t('common.remove')}
                >
                  <X size={12} className="text-white" aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => avatarInputRef.current?.click()}
              className={`${activeTemplate?.imageLayout==='portrait'?'w-20 h-28':activeTemplate?.imageLayout==='landscape'?'w-32 h-20':'w-20 h-20'} rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 text-text-muted hover:border-accent-gold/50 hover:text-accent-gold transition`}
            >
              <ImagePlus size={20} />
              <span className="text-[10px]">{t('common.image')}</span>
            </button>
          )}
        </div>}

        {/* Title */}
        <div className="flex-1">
          <label className="block text-sm text-text-muted mb-1.5">{t('common.title')}</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('codex.entryName')}
            className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition text-lg font-serif"
          />
        </div>
      </div>

      <div>
        <label htmlFor={aliasesInputId} className="block text-sm text-text-muted mb-1.5">{t('codex.aliases')}</label>
        <TagInput
          inputId={aliasesInputId}
          describedBy={`${aliasesInputId}-hint`}
          tags={readAliases(fields)}
          onChange={aliases => {
            // A new alias that is a common word, too short or the name itself is refused, with the reason.
            const before = new Set(readAliases(fields).map(foldAlias));
            const refused = aliases.map(alias => ({ alias, problem: before.has(foldAlias(alias)) ? null : aliasProblem(alias, title) })).find(item => item.problem);
            setAliasRefused(refused?.problem ? { alias: refused.alias, problem: refused.problem } : null);
            setFields(previous => replaceAliases(previous, aliases.filter(alias => before.has(foldAlias(alias)) || !aliasProblem(alias, title))));
          }}
          placeholder={t('codex.aliasesPlaceholder')}
        />
        {aliasRefused && <p role="alert" data-testid="codex-alias-refused" className="mt-1.5 text-xs text-danger">{t(`codex.aliasRefused.${aliasRefused.problem}`).replace('{alias}', aliasRefused.alias)}</p>}
        {(() => {
          const suggested = suggestAliases(title, readAliases(fields), { person: type === 'character' });
          return suggested.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5" data-testid="codex-alias-suggestions">
              <span className="text-xs text-text-dim">{t('codex.aliasSuggest')}</span>
              {suggested.map(alias => (
                <button key={alias} type="button" data-testid={`codex-alias-suggest-${alias}`} onClick={() => { setAliasRefused(null); setFields(previous => replaceAliases(previous, [...readAliases(previous), alias])); }}
                  className="px-2 py-0.5 rounded border border-dashed border-accent-plum/50 text-xs text-accent-plum-light hover:bg-accent-plum/15 transition">+ {alias}</button>
              ))}
            </div>
          );
        })()}
        <p id={`${aliasesInputId}-hint`} className="mt-1.5 text-xs text-text-dim">{t('codex.aliasesHint')}</p>
      </div>

      {/* Template fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.entries({ ...Object.fromEntries(valueDefinitions.map(item => [item.key, ''])), ...fields }).filter(([key]) => !isAliasField(key)).map(([key, value]) => { const definition = valueDefinitions.find(item => item.key === key); const projected = projection.properties[key]; return (
          <div key={key}>
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <label htmlFor={`${aliasesInputId}-field-${encodeURIComponent(key)}`} className="text-sm text-text-muted break-words min-w-0">{definition?.label ?? t(FIELD_LABEL_KEYS[key] || key)}{definition?.required && !definition.formula && <span className="ml-0.5 text-danger" data-testid="codex-property-required" aria-label={t('codex.property.required')}>*</span>}</label>
              {!definition?.formula && !Object.hasOwn(getTemplateFields(type), key) && (
                <button type="button" onClick={() => value ? setPendingRemoveField(key) : removeField(key)} className="shrink-0 rounded p-1 text-text-muted hover:text-danger hover:bg-danger/10" aria-label={t('codex.fields.remove').replace('{name}', key)} title={t('codex.fields.remove').replace('{name}', key)}><X size={14} aria-hidden="true" /></button>
              )}
            </div>
            {definition ? <><PropertyValueInput id={`${aliasesInputId}-field-${encodeURIComponent(key)}`} definition={definition} value={value} projected={projected} onChange={value => setFields({ ...fields, [key]: value })} />{definition.description && <p className="mt-1 text-xs text-text-dim" data-testid="codex-property-description">{definition.description}</p>}</> : key === 'backstory' || key === 'history' || key === 'physicalDescription' || key === 'personality' ? (
              <textarea
                id={`${aliasesInputId}-field-${encodeURIComponent(key)}`}
                value={value}
                onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition resize-none text-sm"
              />
            ) : (
              <input
                id={`${aliasesInputId}-field-${encodeURIComponent(key)}`}
                value={value}
                onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
                className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition text-sm"
              />
            )}
          </div>
        ); })}
      </div>

      <div>
        <label htmlFor={`${aliasesInputId}-new-field`} className="block text-sm text-text-muted mb-1.5">{t('codex.fields.custom')}</label>
        <div className="flex gap-2 flex-wrap">
          <input
            id={`${aliasesInputId}-new-field`}
            value={newFieldName}
            onChange={event => { setNewFieldName(event.target.value); setFieldError(''); }}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addField(); } }}
            placeholder={t('codex.fields.namePlaceholder')}
            aria-invalid={!!fieldError}
            aria-describedby={`${aliasesInputId}-field-help`}
            className="min-w-0 flex-1 px-3 py-2 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition text-sm"
          />
          <select aria-label={t('codex.fields.kind')} value={fieldKind} onChange={event => setFieldKind(event.target.value as 'text' | 'reference')} className="px-2 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary"><option value="text">{t('codex.fields.text')}</option><option value="reference">{t('codex.fields.reference')}</option></select>
          <button type="button" onClick={addField} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-text-primary hover:bg-elevated"><Plus size={14} aria-hidden="true" />{t('codex.fields.add')}</button>
        </div>
        <p id={`${aliasesInputId}-field-help`} role={fieldError ? 'alert' : undefined} className={`mt-1.5 text-xs ${fieldError ? 'text-danger' : 'text-text-dim'}`}>{t(fieldError || 'codex.fields.hint')}</p>
      </div>

      {[...new Set([...Object.keys(referenceFields), ...referenceDefinitions.map(definition => definition.key)])].map(key => {
        const definition = referenceDefinitions.find(item => item.key === key);
        const selectedIds = referenceFields[key] ?? [];
        const targets = codexEntries.filter(item => (!definition?.targetType || item.type === definition.targetType) && (!definition?.targetTemplateId || templateIsWithin(item.templateId, definition.targetTemplateId, project?.codexTemplates ?? [])) && !selectedIds.includes(item.id) && !effectiveTemplatePresentation(project?.codexTemplates?.find(template=>template.id===item.templateId),project?.codexTemplates??[]).hiddenFromPickers);
        return <div key={key} className="space-y-2" data-reference-field={key}>
          <div className="flex items-center justify-between gap-2"><label htmlFor={`${aliasesInputId}-ref-${encodeURIComponent(key)}`} className="text-sm text-text-muted">{definition?.label || key}</label>{!definition && <button type="button" aria-label={t('codex.fields.remove').replace('{name}', key)} onClick={() => selectedIds.length ? setPendingRemoveField(key) : removeField(key)} className="p-1 rounded text-text-muted hover:text-danger"><X size={14} /></button>}</div>
          {selectedIds.length > 0 && <ul className="flex flex-wrap gap-2">{selectedIds.map(id => <li key={id} className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-sm text-text-primary"><span className="break-words">{codexEntries.find(item => item.id === id)?.title ?? t('codex.fields.missingReference')}</span><button type="button" aria-label={`${t('common.remove')} ${codexEntries.find(item => item.id === id)?.title ?? id}`} onClick={() => setReferenceFields(previous => ({ ...previous, [key]: selectedIds.filter(target => target !== id) }))} className="p-1 text-text-muted hover:text-danger"><X size={12} /></button></li>)}</ul>}
          <select id={`${aliasesInputId}-ref-${encodeURIComponent(key)}`} value="" onChange={event => { const id = event.target.value; if (id) setReferenceFields(previous => ({ ...previous, [key]: [...new Set([...(previous[key] ?? []), id])] })); }} className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary"><option value="">{t('codex.fields.chooseReference')}{definition?.targetType ? ` · ${t(`codex.types.${definition.targetType}`)}` : ''}</option>{targets.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
        </div>;
      })}

      {/* Rich text content */}
      <div>
        <label className="flex items-center gap-2 text-sm text-text-muted mb-1.5">
          <BookOpen size={14} />
          {t('codex.extendedNotes')}
        </label>
        <TiptapEditor onEditorReady={editor=>{contentEditor.current=editor;}} documentOwner={entry?{kind:'codex',documentId:entry.id}:undefined} prepareExternal={async()=>!dirty} canAcceptExternalBlock={()=>!dirty&&!saving} onExternalBlockCommit={(_owner,root)=>{const updated=root as unknown as CodexEntry;setExternalEntry(updated);setBase(updated);setContent(updated.content);}} content={content} onChange={setContent} placeholder={t('codex.extendedNotesPlaceholder')} referenceContext={{ projectId, scopeId: `codex:${entry?.id ?? 'new'}`, entryId: entry?.id }} />
      </div>

      {/* Tags */}
      <div>
        <label className="block text-sm text-text-muted mb-1.5">{t('common.tags')}</label>
        <TagInput tags={tags} onChange={setTags} />
      </div>

      {/* Actions */}
      {conflict && (
        <div role="alert" className="space-y-4 rounded-lg border border-accent-gold/40 bg-surface p-4">
          <p className="text-sm text-text-primary">{t('codex.conflictNotice')}</p>
          {conflict.conflicts.map(item => (
            <div key={item.key} className="space-y-2" data-conflict-field={item.key}>
              <h4 className="text-sm font-semibold text-accent-gold">{conflictLabel(item.key)}</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                {(['draft', 'current'] as const).map(version => {
                  const value = version === 'draft' ? conflictDraftValue(item.key) : item.current;
                  return (
                  <div key={version} className="min-w-0 rounded border border-border p-3">
                    <p className="mb-2 text-xs text-text-muted">{t(version === 'draft' ? 'codex.yourVersion' : 'codex.latestVersion')}</p>
                    {(item.key === 'avatar' || item.key === 'avatarOriginal') && typeof value === 'string' && value
                      ? <img src={value} alt="" className="max-h-28 rounded object-contain" />
                      : item.key === 'content'
                        ? <div className="max-h-40 overflow-auto break-words text-sm text-text-primary" dangerouslySetInnerHTML={sanitizedHtml(String(value ?? ''))} />
                        : <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-text-primary">{Array.isArray(value) ? value.map(itemValue => item.key.startsWith('referenceFields.') ? codexEntries.find(entry => entry.id === itemValue)?.title ?? t('codex.fields.missingReference') : itemValue).join(', ') : value || '—'}</pre>}
                    <button type="button" onClick={() => resolveConflict(item, version === 'draft')} className="mt-3 rounded border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated">{t(version === 'draft' ? 'codex.keepYourVersion' : 'codex.useLatestVersion')}</button>
                  </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {requiredMissing.length > 0 && <p role="alert" data-testid="codex-required-missing" className="text-sm text-danger">{t('codex.property.requiredMissing').replace('{names}', requiredMissing.join(', '))}</p>}
      {saveError && <p role="alert" className="text-sm text-red-400">{t('codex.saveError')}</p>}
      {pendingBlock && <p role="alert" className="text-sm text-danger">{locale==='es'?'Guarda o descarta los cambios del bloque antes de guardar la tarjeta.':'Save or discard the block changes before saving the card.'}</p>}
      <div className="flex gap-3 pt-2">
        <button
          onClick={() => void handleSave()}
          disabled={saving || !title.trim() || !!conflict}
          className="flex-1 py-2.5 bg-accent-gold text-deep font-semibold rounded-lg hover:bg-accent-amber transition"
        >
          {saving ? t('common.saving') : entry ? t('codex.saveChanges') : t('codex.createEntry')}
        </button>
        <button
          onClick={onCancel}
          className="px-6 py-2.5 border border-border text-text-muted rounded-lg hover:bg-elevated transition"
        >
          {t('common.cancel')}
        </button>
      </div>
      <ImagePreviewCrop
        imageSrc={pendingAvatar}
        onConfirm={(cropped, original) => {
          setAvatar(cropped);
          setAvatarOriginal(original);
          setPendingAvatar(null);
        }}
        onCancel={() => setPendingAvatar(null)}
      />
      <ConfirmDialog
        open={pendingRemoveField !== null}
        destructive
        title={t('codex.fields.removeTitle')}
        confirmLabel={t('common.remove')}
        message={t('codex.fields.removeConfirm').replace('{name}', pendingRemoveField ?? '')}
        onConfirm={() => { if (pendingRemoveField !== null) removeField(pendingRemoveField); }}
        onCancel={() => setPendingRemoveField(null)}
      />
      <ConfirmDialog
        open={confirmDiscard}
        destructive
        title={t('codex.discardDraft')}
        confirmLabel={t('codex.discardDraft')}
        message={t('codex.discardDraftConfirm')}
        onConfirm={discardDraft}
        onCancel={() => setConfirmDiscard(false)}
      />
    </fieldset>
  );
}
