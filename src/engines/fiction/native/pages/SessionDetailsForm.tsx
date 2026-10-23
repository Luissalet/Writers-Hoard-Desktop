import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { t, type Lang } from '../lib/i18n';
import { changedFields, rebaseForm } from '../lib/copilot-context';
import { useFormSnapshot } from '../lib/copilot';
import type { Entity, SessionAttendance, SessionDetailsPatch, SessionWithDetails } from '../lib/types';
import { ErrorBanner } from '../components/ui';

type Draft = {
  scheduled_local: string; length_min: string; place: string; hook: string; dm_notes: string;
  status: 'planned' | 'live' | 'played'; recap: string; attendance: SessionAttendance[];
};
export interface SessionPreparationDraft {
  baseline: Draft;
  draft: Draft;
  error: string | null;
  saved: boolean;
}
function localDate(at: number | null | undefined) {
  if (at == null) return '';
  const date = new Date(at * 1000);
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
function draftFor(row: SessionWithDetails): Draft {
  const detail = row.details;
  return { scheduled_local: localDate(detail?.scheduled_at), length_min: detail?.length_min == null ? '' : String(detail.length_min),
    place: detail?.place ?? '', hook: detail?.hook ?? '', dm_notes: detail?.dm_notes ?? '', status: detail?.status ?? (row.is_current ? 'live' : 'planned'),
    recap: detail?.recap ?? '', attendance: detail?.attendance ?? [] };
}

export function SessionDetailsForm({ row, worldId, lang, onSaved, onDownload, onClose, remembered, onRemember }: {
  row: SessionWithDetails; worldId: string; lang: Lang; onSaved: () => Promise<unknown>;
  onDownload: (row: SessionWithDetails, draft: boolean) => Promise<void>; onClose: () => void;
  remembered?: SessionPreparationDraft;
  onRemember?: (snapshot: SessionPreparationDraft, owner: object, onlyIfCurrent?: boolean) => void;
}) {
  const memoryOwner = useRef({});
  const [form, setForm] = useState<SessionPreparationDraft>(() => {
    const baseline = draftFor(row);
    return { baseline, draft: remembered ? rebaseForm(remembered.baseline, baseline, remembered.draft) as Draft : baseline,
      error: remembered?.error ?? null, saved: remembered?.saved ?? false };
  });
  const { draft, error, saved } = form;
  const latestForm = useRef(form); latestForm.current = form;
  const [characters, setCharacters] = useState<Entity[]>([]);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  useEffect(() => {
    const next = draftFor(row);
    setForm(previous => ({ ...previous, baseline: next, draft: rebaseForm(previous.baseline, next, previous.draft) as Draft }));
  }, [row]);
  useEffect(() => { onRemember?.(form, memoryOwner.current); }, [form, onRemember]);
  useEffect(() => {
    let alive = true;
    void api.listEntities(worldId, 'character').then(next => { if (alive) setCharacters(next); })
      .catch(() => { /* Names remain editable when the optional character list is unavailable. */ });
    return () => { alive = false; };
  }, [worldId]);
  useFormSnapshot('session-form', row.session.id, () => changedFields(form.baseline, draft));
  const change = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setForm(previous => ({ ...previous, saved: false, draft: { ...previous.draft, [key]: value } }));
  };
  const showError = (failure: unknown) => {
    const next = { ...latestForm.current, error: failure instanceof ApiError ? failure.message : String(failure) };
    onRemember?.(next, memoryOwner.current, true); setForm(next);
  };
  const changeAttendee = (index: number, patch: Partial<SessionAttendance>) =>
    change('attendance', draft.attendance.map((entry, i) => i === index ? { ...entry, ...patch } : entry));
  async function save(extra: SessionDetailsPatch = {}) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setForm(previous => ({ ...previous, error: null, saved: false }));
    const changed = changedFields(form.baseline, draft);
    const patch: SessionDetailsPatch = {};
    for (const key of ['place', 'hook', 'dm_notes', 'status', 'recap', 'attendance'] as const) {
      if (key in changed) Object.assign(patch, { [key]: draft[key] });
    }
    if ('scheduled_local' in changed) {
      patch.scheduled_at = draft.scheduled_local ? new Date(draft.scheduled_local).getTime() / 1000 : null;
      patch.timezone = zone;
    }
    if ('length_min' in changed) patch.length_min = draft.length_min === '' ? null : Number(draft.length_min);
    try {
      const next = await api.updateSessionDetails(worldId, row.session.id, { ...patch, ...extra });
      const baseline = draftFor(next);
      const snapshot = { baseline, draft: baseline, error: null, saved: true };
      // A different session may have been opened while this request was in flight.
      // Update the parent's private cache even if this form has unmounted.
      onRemember?.(snapshot, memoryOwner.current, true); setForm(snapshot);
      await onSaved();
    } catch (failure) { showError(failure); }
    finally { pending.current = false; setBusy(false); }
  }
  async function retireCharacter(id: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setForm(previous => ({ ...previous, error: null }));
    try {
      const next = await api.patchEntity(worldId, id, { status: 'retired' });
      setCharacters(previous => previous.map(character => character.id === id ? next : character));
    } catch (failure) { showError(failure); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section className="session-prep" aria-label={`${t('session_details', lang)}: ${row.session.title}`}>
    <div className="session-prep-heading">
      <h2>{t('session_details', lang)}</h2>
      <button className="icon-button" onClick={onClose} aria-label={t('session_close', lang)} disabled={busy}><X size={16} /></button>
    </div>
    {error && <ErrorBanner message={error} />}
    <fieldset disabled={busy} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
    <div className="session-prep-grid">
      <label>{t('session_schedule', lang)}<input type="datetime-local" value={draft.scheduled_local}
        onChange={event => change('scheduled_local', event.target.value)} />
        <small>{t('session_zone', lang)}: {zone}</small></label>
      <label>{t('session_length', lang)}<input type="number" min="0" step="1" value={draft.length_min}
        onChange={event => change('length_min', event.target.value)} /></label>
      <label>{t('session_place', lang)}<input value={draft.place} onChange={event => change('place', event.target.value)} /></label>
      <label>{t('session_status', lang)}<select value={draft.status} onChange={event => change('status', event.target.value as Draft['status'])}>
        {(['planned', 'live', 'played'] as const).map(value => <option key={value} value={value}>{t(`session_${value}`, lang)}</option>)}
      </select></label>
    </div>
    <label className="field">{t('session_hook', lang)}<input value={draft.hook} onChange={event => change('hook', event.target.value)} /></label>
    <label className="field">{t('session_dm_notes', lang)}<textarea rows={3} value={draft.dm_notes}
      onChange={event => change('dm_notes', event.target.value)} /><small>{t('session_dm_help', lang)}</small></label>
    <fieldset className="session-attendance"><legend>{t('session_attendance', lang)}</legend>
      {draft.attendance.map((entry, index) => <div className="session-attendee" key={index}>
        <label>{t('session_attendee', lang)}<input value={entry.name} onChange={event => changeAttendee(index, { name: event.target.value })} /></label>
        <label>{t('session_character', lang)}<select value={entry.entity_id ?? ''} onChange={event => {
          const entity_id = event.target.value;
          change('attendance', draft.attendance.map((item, i) => {
            if (i !== index) return item;
            const { entity_id: _old, ...rest } = item; void _old;
            return entity_id ? { ...rest, entity_id } : rest;
          }));
        }}><option value="">{t('session_no_character', lang)}</option>
          {entry.entity_id && !characters.some(character => character.id === entry.entity_id) && <option value={entry.entity_id}>{entry.entity_id}</option>}
          {characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}
        </select></label>
        <label className="session-present"><input type="checkbox" checked={entry.present} onChange={event => changeAttendee(index, { present: event.target.checked })} />{t('session_present', lang)}</label>
        <button className="icon-button" aria-label={`${t('session_remove_attendee', lang)} ${entry.name || index + 1}`}
          onClick={() => change('attendance', draft.attendance.filter((_, i) => i !== index))}><X size={15} /></button>
      </div>)}
      <button className="btn btn-sm" onClick={() => change('attendance', [...draft.attendance, { name: '', present: false }])}><Plus size={13} />{t('session_add_attendee', lang)}</button>
    </fieldset>
    <label className="field">{t('session_recap', lang)}<textarea rows={6} value={draft.recap} onChange={event => change('recap', event.target.value)} /></label>
    <p className="session-prep-muted">{row.details?.recap_posted && draft.recap === row.details.recap ? t('session_recap_ready', lang) : t('session_recap_draft', lang)}</p>
    <div className="session-prep-actions">
      <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{t(busy ? 'session_saving' : 'session_save', lang)}</button>
      {!row.is_current && <button className="btn" disabled={busy} onClick={() => void save({ status: 'live' })}>{t('session_start_selected', lang)}</button>}
      <button className="btn" disabled={busy} onClick={() => void save({ status: 'played' })}>{t('session_mark_played', lang)}</button>
      <button className="btn" disabled={busy || !draft.recap.trim()} onClick={() => void save({ recap_posted: true })}>{t('session_ready_action', lang)}</button>
      {!!row.details?.recap.trim() && <button className="btn" disabled={busy} onClick={() => void onDownload(row, !row.details?.recap_posted)}>
        {t(row.details.recap_posted ? 'session_download_recap' : 'session_download_draft', lang)}</button>}
    </div>
    <p className="session-prep-muted">{t('session_ready_help', lang)}</p>
    <p className="session-prep-muted">{t('session_start_help', lang)}</p>
    {row.details?.status === 'played' && characters.some(character => row.details?.attendance.some(entry => entry.entity_id === character.id)) && <fieldset className="session-attendance">
      <legend>{t('session_retirement', lang)}</legend><div className="session-prep-actions">
        {characters.filter(character => row.details?.attendance.some(entry => entry.entity_id === character.id)).map(character => <button key={character.id}
          className="btn btn-sm" disabled={busy || character.status === 'retired'} onClick={() => void retireCharacter(character.id)}>
          {character.status === 'retired' ? t('entity_status_retired', lang) : t('session_retire_character', lang)}: {character.name}</button>)}
      </div></fieldset>}
    </fieldset>
    <p role="status" className="session-prep-muted">{saved ? t('session_saved', lang) : ''}</p>
  </section>;
}
