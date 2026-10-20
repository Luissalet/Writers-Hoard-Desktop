import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation, registerLocaleStrings } from '@/i18n/useTranslation';
import { ConfirmDialog } from '@/engines/_shared';
import { defaultWorldCalendar, type WorldCalendar } from '../worldCalendar';
import { deleteCalendarPreset, earthCalendar, loadCalendarPresets, saveCalendarPreset } from '../calendarPresets';
import en from '../locales/en';
import es from '../locales/es';
registerLocaleStrings({ es, en });

export default function CalendarPresetControls({ calendar, onLoad }: { calendar: WorldCalendar; onLoad: (calendar: WorldCalendar) => void }) {
  const { t, locale } = useTranslation();
  const presets = useLiveQuery(loadCalendarPresets, []) ?? [];
  const [selected, setSelected] = useState('generic');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'savedPreset' | 'presetFailed' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const preset = presets.find(value => value.id === selected);
  const field = 'px-2 py-1.5 bg-elevated border border-border rounded-md text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold';
  return <details className="border-b border-border pb-3">
    <summary className="cursor-pointer text-sm text-accent-gold">{t('timeline.details.presets')}</summary>
    <div className="space-y-3 pt-3">
      <p className="text-xs text-text-muted">{t('timeline.details.presetHelp')}</p>
      <div className="flex flex-wrap gap-2">
        <select className={`${field} min-w-0 flex-1`} value={selected} aria-label={t('timeline.details.choosePreset')} onChange={event => { setSelected(event.target.value); setStatus(null); }}>
          <option value="generic">{t('timeline.details.generic')}</option><option value="earth">{t('timeline.details.earth')}</option>
          {presets.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}
        </select>
        <button type="button" disabled={busy || (!preset && selected !== 'generic' && selected !== 'earth')} className={field} onClick={() => onLoad(selected === 'earth' ? earthCalendar(locale) : selected === 'generic' ? defaultWorldCalendar(t('timeline.world.defaultName')) : JSON.parse(JSON.stringify(preset!.calendar)) as WorldCalendar)}>{t('timeline.details.applyPreset')}</button>
        {preset && <button type="button" disabled={busy} className={`${field} text-danger`} onClick={() => setConfirmDelete(true)}>{t('timeline.details.deletePreset')}</button>}
      </div>
      <div className="flex flex-wrap gap-2">
        <input className={`${field} min-w-0 flex-1`} aria-label={t('timeline.details.presetName')} placeholder={t('timeline.details.presetName')} value={name} maxLength={100} onChange={event => { setName(event.target.value); setStatus(null); }} />
        <button type="button" className={field} disabled={busy || !name.trim()} onClick={async () => { setBusy(true); try { const next = await saveCalendarPreset(name, calendar); setSelected(next.id); setName(''); setStatus('savedPreset'); } catch { setStatus('presetFailed'); } finally { setBusy(false); } }}>{t('timeline.details.savePreset')}</button>
      </div>
      {status && <p role={status === 'presetFailed' ? 'alert' : 'status'} className="text-xs text-text-muted">{t(`timeline.details.${status}`)}</p>}
    </div>
    <ConfirmDialog open={confirmDelete} destructive message={t('timeline.details.deletePresetConfirm').replace('{name}', preset?.name ?? '')} onCancel={() => setConfirmDelete(false)} onConfirm={async () => { if (!preset) return; try { await deleteCalendarPreset(preset.id); setSelected('generic'); } catch { setStatus('presetFailed'); } finally { setConfirmDelete(false); } }} />
  </details>;
}
