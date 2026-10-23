import { useState } from 'react';

import { Copy, Plus, Save, Sparkles, Trash2, X } from 'lucide-react';

import type { CodexEntryType } from '@/types';

import { useProject } from '@/hooks/useProjects';

import { useTranslation } from '@/i18n/useTranslation';

import { ConfirmDialog } from '@/engines/_shared';

import Modal from '@/components/common/Modal';

import TiptapEditor from '@/components/editor/TiptapEditor';

import { generateId } from '@/utils/idGenerator';

import { foldAlias, isAliasField } from '@/services/codexReference/aliases';

import { CodexTemplateConflict, deleteCodexTemplate, saveCodexTemplate, type CodexTemplate } from '@/engines/codex/templates';

import { effectiveCodexTemplate, hierarchyOrder, templatePath } from '@/engines/codex/templateHierarchy';

import TemplateInheritance from './TemplateInheritance';

import ReferenceSubtypeSelector from './ReferenceSubtypeSelector';
import TemplateAppearance from './TemplateAppearance';
import PropertyDefinitionEditor from './PropertyDefinitionEditor';
import TemplateSyncPanel from './TemplateSyncPanel';
import { propertyDefinitions } from '@/engines/codex/properties';
import { genrePackTemplates, seedGenrePack } from '@/engines/codex/genrePacks';


const categories: CodexEntryType[] = ['character', 'location', 'item', 'faction', 'concept', 'magic', 'custom'];

const fieldClass = 'w-full min-w-0 px-3 py-2 rounded-lg border border-border bg-elevated text-sm text-text-primary outline-none focus:border-accent-gold';

const buttonClass = 'inline-flex gap-1.5 items-center rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated disabled:opacity-40';



export default function CodexTemplateManager({ projectId, open, initial, onClose, onUse }: { projectId: string; open: boolean; initial?: CodexTemplate; onClose: () => void; onUse: (template: CodexTemplate) => void }) {

  const { t, locale } = useTranslation();

  const { project, refresh } = useProject(projectId);

  const [draft, setDraft] = useState<CodexTemplate | undefined>(initial);

  const [baseRevision, setBaseRevision] = useState<number | null>(initial?.revision ? initial.revision : null);

  const [savedSnapshot, setSavedSnapshot] = useState(initial?.revision ? JSON.stringify(initial) : '');

  const [newField, setNewField] = useState('');

  const [newKind, setNewKind] = useState<'text' | 'reference'>('text');

  const [notice, setNotice] = useState('');

  const [busy, setBusy] = useState(false);

  const [conflict, setConflict] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState(false);

  const [switchTo, setSwitchTo] = useState<CodexTemplate | null | undefined>(undefined);

  const dirty = !!draft && JSON.stringify(draft) !== savedSnapshot;

  const templates = project?.codexTemplates ?? [];
  const genres = project?.genres ?? [];
  const packCount = genres.length ? genrePackTemplates(genres, templates, locale === 'es' ? 'es' : 'en').length : 0;
  const [seeded, setSeeded] = useState('');
  const seedGenres = async () => {
    if (busy || !packCount) return;
    setBusy(true); setNotice(''); setSeeded('');
    try { const added = await seedGenrePack(projectId, genres, templates, locale === 'es' ? 'es' : 'en'); await refresh(); setSeeded(t('codex.templates.seeded').replace('{count}', String(added.length)).replace('{names}', added.join(', '))); }
    catch { setNotice(t('codex.templates.failure')); }
    finally { setBusy(false); }
  };

  // A closed manager stays mounted so deliberate Close preserves its in-progress editing session.

  const select = (template: CodexTemplate | null) => {

    const now = Date.now();

    const next = template ?? { id: generateId('codex-template'), name: '', category: 'custom' as const, fields: {}, content: '', revision: 0, createdAt: now, updatedAt: now };

    setDraft(structuredClone(next)); setBaseRevision(template?.revision ?? null); setSavedSnapshot(template ? JSON.stringify(template) : ''); setNotice(''); setConflict(false); setNewField('');

  };

  const requestSelect = (next: CodexTemplate | null) => { if (dirty) setSwitchTo(next); else select(next); };

  const save = async (asNew = false) => {

    if (!draft || busy) return;

    setBusy(true); setNotice('');

    try {

      const candidate = asNew ? { ...draft, id: generateId('codex-template'), revision: 0, createdAt: Date.now() } : draft;

      const saved = await saveCodexTemplate(projectId, candidate, asNew ? null : baseRevision);

      setDraft(saved); setBaseRevision(saved.revision); setSavedSnapshot(JSON.stringify(saved)); setConflict(false); await refresh();

    } catch (error) { setConflict(error instanceof CodexTemplateConflict); setNotice(t(error instanceof CodexTemplateConflict ? 'codex.templates.conflict' : 'codex.templates.failure')); }

    finally { setBusy(false); }

  };

  const addField = () => {

    if (!draft) return;

    const key = newField.trim().replace(/\s+/g, ' ');

    const all = [...Object.keys(draft.fields), ...(draft.referenceFieldDefinitions ?? []).map(definition => definition.key)];

    if (!key || isAliasField(key) || Object.getOwnPropertyNames(Object.prototype).some(name => foldAlias(name) === foldAlias(key)) || all.some(name => foldAlias(name) === foldAlias(key))) { setNotice(t('codex.fields.nameExists')); return; }

    setDraft(newKind === 'text' ? { ...draft, fields: { ...draft.fields, [key]: '' } } : { ...draft, referenceFieldDefinitions: [...(draft.referenceFieldDefinitions ?? []), { key, label: key }] });

    setNewField(''); setNotice('');

  };

  return <Modal open={open} onClose={onClose} busy={busy} dismissible={!dirty} title={t('codex.templates.title')} wide>

    <div className="space-y-4" data-testid="codex-template-manager">

      <p className="text-sm text-text-muted">{t('codex.templates.hint')}</p>

      <div className="flex gap-2 flex-wrap">

        <select aria-label={t('codex.templates.choose')} className={`${fieldClass} flex-1`} value={baseRevision !== null ? draft?.id ?? '' : ''} onChange={event => { const found = templates.find(template => template.id === event.target.value); if (found) requestSelect(found); }}><option value="">{t('codex.templates.choose')}</option>{hierarchyOrder(templates).map(template => <option key={template.id} value={template.id}>{templatePath(template, templates)}</option>)}</select>

        <button type="button" className={buttonClass} onClick={() => requestSelect(null)}><Plus size={14} />{t('codex.templates.new')}</button>

      </div>

      {genres.length > 0 && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-accent-gold/40 p-2 text-sm" data-testid="codex-seed-genres-row">
        <span className="text-text-muted">{t('codex.templates.seedHint').replace('{genres}', genres.join(', '))}</span>
        <button type="button" data-testid="codex-seed-genres" className={buttonClass} disabled={busy || !packCount} onClick={() => void seedGenres()}><Sparkles size={14} />{packCount ? t('codex.templates.seed').replace('{count}', String(packCount)) : t('codex.templates.seedNone')}</button>
      </div>}
      {seeded && <p role="status" data-testid="codex-seeded" className="text-sm text-success">{seeded}</p>}
      {notice && <p role="alert" className="text-sm text-danger">{notice}</p>}

      {draft && <fieldset disabled={busy} inert={busy} className="space-y-4">

        <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm text-text-muted">{t('codex.templates.name')}<input aria-label={t('codex.templates.name')} className={`${fieldClass} mt-1.5`} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label><label className="text-sm text-text-muted">{t('codex.templates.category')}<select aria-label={t('codex.templates.category')} disabled={!!draft.parentTemplateId || templates.some(item => item.parentTemplateId === draft.id)} title={locale === 'es' ? 'Desvincula los subtipos antes de cambiar la categoría general.' : 'Detach subtypes before changing the broad category.'} className={`${fieldClass} mt-1.5 disabled:opacity-60`} value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value as CodexEntryType })}>{categories.map(category => <option key={category} value={category}>{t(`codex.types.${category}`)}</option>)}</select></label></div>

        <TemplateInheritance draft={draft} templates={templates} locale={locale} onChange={setDraft} />
        <TemplateAppearance draft={draft} templates={templates} locale={locale} onChange={setDraft} />
        <div className="space-y-3"><h3 className="text-sm font-semibold text-text-primary">{t('codex.templates.fields')}</h3>

          {Object.entries(draft.fields).map(([key, value]) => <div key={key} className="flex gap-2 items-start"><div className="min-w-0 flex-1"><label className="text-sm text-text-muted">{key}<textarea aria-label={`${t('codex.templates.fields')} · ${key}`} className={`${fieldClass} mt-1.5`} rows={2} value={value} onChange={event => setDraft({ ...draft, fields: { ...draft.fields, [key]: event.target.value } })} /></label><PropertyDefinitionEditor projectId={projectId} template={draft} fieldKey={key} available={propertyDefinitions(effectiveCodexTemplate(draft, templates))} locale={locale} onChange={setDraft} /></div><button type="button" className="p-2 text-text-muted hover:text-danger" aria-label={t('codex.fields.remove').replace('{name}', key)} onClick={() => { const fields = { ...draft.fields }; delete fields[key]; setDraft({ ...draft, fields, propertyDefinitions: draft.propertyDefinitions?.filter(item => item.key !== key) }); }}><X size={14} /></button></div>)}
          {(draft.referenceFieldDefinitions ?? []).map(definition => <div key={definition.key} className="flex flex-wrap gap-2 items-center"><label className="text-sm text-text-muted min-w-0 flex-1">{definition.key}<input aria-label={`${t('codex.fields.reference')} · ${definition.key}`} className={`${fieldClass} mt-1.5`} value={definition.label} onChange={event => setDraft({ ...draft, referenceFieldDefinitions: draft.referenceFieldDefinitions!.map(field => field.key === definition.key ? { ...field, label: event.target.value } : field) })} /></label><select aria-label={`${t('codex.templates.category')} · ${definition.key}`} className={`${fieldClass} max-w-[180px]`} value={definition.targetType ?? ''} onChange={event => setDraft({ ...draft, referenceFieldDefinitions: draft.referenceFieldDefinitions!.map(field => field.key === definition.key ? { ...field, targetTemplateId: undefined, targetType: event.target.value ? event.target.value as CodexEntryType : undefined } : field) })}><option value="">{t('codex.templates.anyType')}</option>{categories.map(category => <option key={category} value={category}>{t(`codex.types.${category}`)}</option>)}</select><ReferenceSubtypeSelector definition={definition} templates={templates} locale={locale} onChange={next => setDraft({ ...draft, referenceFieldDefinitions: draft.referenceFieldDefinitions!.map(field => field.key === definition.key ? next : field) })} /><button type="button" className="p-2 text-text-muted hover:text-danger" aria-label={t('codex.fields.remove').replace('{name}', definition.key)} onClick={() => setDraft({ ...draft, referenceFieldDefinitions: draft.referenceFieldDefinitions!.filter(field => field.key !== definition.key) })}><X size={14} /></button></div>)}

          <div className="flex flex-wrap gap-2"><input aria-label={t('codex.templates.fieldName')} className={`${fieldClass} flex-1`} placeholder={t('codex.templates.fieldName')} value={newField} onChange={event => setNewField(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addField(); } }} /><select aria-label={t('codex.fields.kind')} className={`${fieldClass} max-w-[180px]`} value={newKind} onChange={event => setNewKind(event.target.value as 'text' | 'reference')}><option value="text">{t('codex.fields.text')}</option><option value="reference">{t('codex.fields.reference')}</option></select><button type="button" className={buttonClass} onClick={addField}><Plus size={14} />{t('codex.templates.addField')}</button></div>

        </div>

        {!(draft.parentTemplateId && (draft.contentMode === 'inherit' || draft.contentMode === undefined && !draft.content.trim())) && <div><h3 className="text-sm text-text-muted mb-1.5">{t('codex.templates.content')}</h3><TiptapEditor key={draft.id} content={draft.content} referenceContext={{ projectId, scopeId: `codex-template:${draft.id}` }} onChange={content => setDraft(previous => previous ? { ...previous, content } : previous)} /></div>}

        <div className="flex flex-wrap gap-2">

          <button type="button" className={buttonClass} disabled={!draft.name.trim() || !dirty} onClick={() => void save()}><Save size={14} />{t('codex.templates.save')}</button>

          {conflict && <button type="button" className={buttonClass} onClick={() => void save(true)}><Copy size={14} />{t('codex.templates.copy')}</button>}

          <button type="button" className={buttonClass} disabled={dirty || baseRevision === null || effectiveCodexTemplate(draft,templates).hiddenFromPickers} onClick={() => onUse(effectiveCodexTemplate(draft, templates))}>{t('codex.templates.use')}</button>

          {baseRevision !== null && <button type="button" className={`${buttonClass} text-danger`} onClick={() => setConfirmDelete(true)}><Trash2 size={14} />{t('codex.templates.delete')}</button>}

        </div>

        {baseRevision !== null && <TemplateSyncPanel key={`${draft.id}:${baseRevision}`} projectId={projectId} template={effectiveCodexTemplate(draft, templates)} locale={locale} disabled={dirty} />}
      </fieldset>}

    </div>

    <ConfirmDialog open={confirmDelete} destructive title={t('codex.templates.delete')} message={t('codex.templates.deleteConfirm')} onCancel={() => setConfirmDelete(false)} onConfirm={async () => { if (!draft || baseRevision === null) return; try { await deleteCodexTemplate(projectId, draft.id, baseRevision); setDraft(undefined); setSavedSnapshot(''); setConfirmDelete(false); await refresh(); } catch { setNotice(t('codex.templates.conflict')); setConfirmDelete(false); } }} />

    <ConfirmDialog open={switchTo !== undefined} destructive title={t('codex.discardDraft')} message={t('codex.discardDraftConfirm')} onCancel={() => setSwitchTo(undefined)} onConfirm={() => { if (switchTo !== undefined) select(switchTo); setSwitchTo(undefined); }} />

  </Modal>;

}
