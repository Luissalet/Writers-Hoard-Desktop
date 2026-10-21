import { useRef, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useWorldEraScope } from '@/services/worldEras/hooks';
import type { TimelineEvent } from '@/types';
import { applyTimelineBatch, timelineBatchTargets, undoTimelineBatch, type TimelineBatchAction } from '../eventBatch';
import ConfirmDialog from '@/engines/_shared/components/ConfirmDialog';

const button = 'min-h-9 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated disabled:opacity-40';
export default function TimelineBatchBar({ projectId, events, onChanged }: { projectId: string; events: TimelineEvent[]; onChanged: () => void }) {
  const scope = useWorldEraScope(projectId), { locale } = useTranslation(), es = locale === 'es';
  const [selection, setSelection] = useState<Set<string>>(new Set()), [daysText, setDays] = useState('1'), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false), [receipt, setReceipt] = useState<string>(), [error, setError] = useState('');
  const locked = useRef(false), days = Number(daysText);
  const selected = events.filter(event => selection.has(event.id));
  const run = async (action?: TimelineBatchAction) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true); setError('');
    try {
      if (action) { const result = await applyTimelineBatch(scope, selected.map(event => event.id), action, await timelineBatchTargets(scope)); setReceipt(result.receiptId); if (action.kind === 'remove') setSelection(new Set()); }
      else if (receipt) { await undoTimelineBatch(scope, receipt); setReceipt(undefined); }
      onChanged();
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : '';
      setError(code.includes('exact_dates') ? es ? 'Para desplazar, todos los eventos necesitan una fecha de día completa. El texto libre y las fechas parciales se conservan sin cambios.' : 'Moving requires a complete day for every event. Free text and partial dates remain unchanged.' : code.includes('conflict') ? es ? 'Los eventos han cambiado. Revisa la selección antes de repetir.' : 'Events have changed. Review the selection before trying again.' : es ? 'No se ha podido aplicar el cambio al conjunto.' : 'The batch could not be applied.');
    } finally { locked.current = false; setBusy(false); }
  };
  return <section className="rounded-lg border border-border bg-surface p-3 space-y-3" data-testid="timeline-batch" aria-busy={busy}>
    <details><summary className="cursor-pointer py-1 text-sm text-text-primary">{es ? 'Seleccionar varios eventos' : 'Select multiple events'} · {selected.length}</summary><fieldset disabled={busy} className="mt-3 max-h-60 space-y-2 overflow-auto">
      <label className="flex items-center gap-2 text-sm text-text-muted"><input type="checkbox" checked={events.length > 0 && selected.length === events.length} onChange={event => setSelection(new Set(event.target.checked ? events.map(item => item.id) : []))} />{es ? 'Todos los eventos' : 'All events'}</label>
      {events.map(event => <label key={event.id} className="flex items-center gap-2 text-sm text-text-primary"><input type="checkbox" data-batch-event={event.id} checked={selection.has(event.id)} onChange={change => setSelection(previous => { const next = new Set(previous); if (change.target.checked) next.add(event.id); else next.delete(event.id); return next; })} /><span className="min-w-0 break-words">{event.title}<span className="text-text-muted"> · {event.date}</span></span></label>)}
    </fieldset></details>
    <div className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-2 text-sm text-text-muted">{es ? 'Días' : 'Days'}<input aria-label={es ? 'Desplazamiento en días' : 'Shift in days'} type="number" step="1" className="w-24 min-h-9 rounded-lg border border-border bg-deep px-2 text-text-primary" value={daysText} disabled={busy} onChange={event => setDays(event.target.value)} /></label><button className={button} disabled={busy || !selected.length || !daysText.trim() || !Number.isSafeInteger(days) || days === 0} onClick={() => void run({ kind: 'shift', days })}>{es ? 'Desplazar selección' : 'Move selection'}</button><button className={`${button} text-danger`} disabled={busy || !selected.length} onClick={() => setConfirm(true)}>{es ? 'Borrar selección' : 'Delete selection'}</button>{receipt && <button className={button} disabled={busy} onClick={() => void run()}>{es ? 'Deshacer conjunto' : 'Undo batch'}</button>}</div>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <ConfirmDialog open={confirm} title={es ? 'Borrar eventos seleccionados' : 'Delete selected events'} message={es ? `Se borrarán ${selected.length} eventos y sus conexiones. Puedes deshacer el conjunto.` : `${selected.length} events and their connections will be removed. You can undo the batch.`} destructive onCancel={() => setConfirm(false)} onConfirm={async () => { setConfirm(false); await run({ kind: 'remove' }); }} />
  </section>;
}
