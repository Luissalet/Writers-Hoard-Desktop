import { useWorldEraScope } from '@/services/worldEras/hooks';
import { useRef, useState } from 'react';
import { CornerDownLeft } from 'lucide-react';
import type { CodexEntry } from '@/types';
import type { Scene, SceneCast } from '../types';
import { appendConversationTurn, conversationDraftStore } from './authoring';
import { useEnginePane } from '@/engines/_shared/EnginePaneContext';

export default function ConversationComposer({ scene, cast, entries, locale }: { scene: Scene; cast: SceneCast[]; entries: CodexEntry[]; locale: 'es' | 'en' }) {
  const copy = locale === 'es' ? { title: 'Continuar conversación', speaker: 'Hablante', action: 'Acción de escena', content: 'Nueva intervención', add: 'Añadir turno', help: 'Enter añade el turno y vuelve al hablante. Mayús+Enter escribe otra línea.', saved: 'Turno añadido', error: 'No se pudo añadir el turno. El borrador se conserva; comprueba el hablante y vuelve a intentarlo.' } : { title: 'Continue conversation', speaker: 'Speaker', action: 'Scene action', content: 'New turn', add: 'Add turn', help: 'Enter adds the turn and returns to the speaker. Shift+Enter writes another line.', saved: 'Turn added', error: 'The turn could not be added. Your draft is kept; check the speaker and try again.' };
  const scope = useWorldEraScope(scene.projectId);
  const pane = useEnginePane(), draftId = `${scene.id}:${pane?.instanceId ?? 'primary'}`;
  const [journal] = useState(() => conversationDraftStore(scene.projectId, scope.eraId));
  const [draft, setDraft] = useState(() => journal.get(draftId) ?? { speaker: '', content: '' });
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('');
  const pending = useRef(false), speaker = useRef<HTMLSelectElement>(null), text = useRef<HTMLTextAreaElement>(null);
  const choices = [...cast.map(member => ({ value: `cast:${member.id}`, label: member.characterName })), ...entries.filter(entry => entry.type === 'character' && !cast.some(member => member.characterId === entry.id)).map(entry => ({ value: `entry:${entry.id}`, label: entry.title }))];
  const change = (next: typeof draft) => { setDraft(next); journal.set(draftId, next); setStatus(''); setError(''); };
  const submit = async () => {
    if (pending.current || !draft.content.trim()) return;
    pending.current = true; setBusy(true); setError('');
    try { await appendConversationTurn(scene.id, draft, scope); const next = { ...draft, content: '' }; setDraft(next); journal.set(draftId, next); setStatus(copy.saved); requestAnimationFrame(() => { if (speaker.current?.getClientRects().length) speaker.current.focus(); }); }
    catch { setError(copy.error); }
    finally { pending.current = false; setBusy(false); }
  };
  const input = 'min-h-10 w-full rounded-lg border border-border bg-deep px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-60';
  return <section aria-label={copy.title} className="space-y-3 border-t border-border pt-5" data-testid="conversation-composer">
    <h3 className="font-display text-lg text-text-primary">{copy.title}</h3>
    <div className="grid items-start gap-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
      <label className="grid gap-1 text-xs text-text-muted">{copy.speaker}<select ref={speaker} aria-label={copy.speaker} className={input} disabled={busy} value={draft.speaker} onChange={event => change({ ...draft, speaker: event.target.value })} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); text.current?.focus(); } }}><option value="">{copy.action}</option>{draft.speaker && !choices.some(choice => choice.value === draft.speaker) && <option value={draft.speaker}>{locale === 'es' ? 'Hablante no disponible' : 'Speaker unavailable'}</option>}{choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select></label>
      <label className="grid gap-1 text-xs text-text-muted">{copy.content}<textarea ref={text} aria-label={copy.content} className={input} rows={3} disabled={busy} value={draft.content} onChange={event => change({ ...draft, content: event.target.value })} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} /></label>
    </div>
    <div className="flex flex-wrap items-center gap-3"><p className="min-w-48 flex-1 text-xs leading-relaxed text-text-muted">{copy.help}</p><button type="button" disabled={busy || !draft.content.trim()} onClick={() => void submit()} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-40"><CornerDownLeft size={15} aria-hidden="true" />{copy.add}</button></div>
    {status && <p role="status" className="text-sm text-text-muted">{status}</p>}{error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </section>;
}
