import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, MessageCircle, Pause, Play, RotateCcw, Smartphone } from 'lucide-react';
import type { DialogBlock, Scene, SceneCast } from '../types';
import { useTranslation } from '@/i18n/useTranslation';
import { useEnginePane } from '@/engines/_shared/EnginePaneContext';
import { buildConversation, conversationColor, conversationSpeakerId, filterConversation } from './model';
import { conversationCopy } from './copy';

const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold disabled:cursor-not-allowed disabled:opacity-40';
const input = 'min-h-10 rounded-lg border border-border bg-deep px-2 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold';
export default function ConversationPreview({ scene, blocks, cast, onSource }: { scene: Scene; blocks: DialogBlock[]; cast: SceneCast[]; onSource: (blockId: string) => void }) {
  const { locale } = useTranslation(), copy = conversationCopy[locale], pane = useEnginePane();
  const model = useMemo(() => buildConversation(scene.projectId, scene.id, blocks, cast), [scene.projectId, scene.id, blocks, cast]);
  const [dialogue, setDialogue] = useState(true), [narration, setNarration] = useState(true), [notes, setNotes] = useState(false);
  const [speakers, setSpeakers] = useState(() => new Set(model.speakers.map(speaker => speaker.id)));
  const [viewpoint, setViewpoint] = useState(model.speakers[0]?.id ?? ''), [phone, setPhone] = useState(true);
  const [revealed, setRevealed] = useState(0), [playing, setPlaying] = useState(false), [delay, setDelay] = useState(2000);
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const log = useRef<HTMLDivElement>(null);
  const turns = useMemo(() => filterConversation(model.turns, { dialogue, narration, notes, speakers }), [model.turns, dialogue, narration, notes, speakers]);
  const totalBlocks = turns.reduce((sum, turn) => sum + turn.blocks.length, 0);
  const shown = Math.min(revealed, turns.length), canPlay = turns.length > 0 && shown < turns.length;
  if (playing && (!pageVisible || pane?.visible === false || !canPlay)) setPlaying(false);
  useEffect(() => { const visibility = () => setPageVisible(!document.hidden); document.addEventListener('visibilitychange', visibility); return () => document.removeEventListener('visibilitychange', visibility); }, []);
  useEffect(() => {
    if (!playing || !canPlay || !pageVisible || pane?.visible === false) return;
    const timer = window.setTimeout(() => setRevealed(value => Math.min(turns.length, value + 1)), delay);
    return () => window.clearTimeout(timer);
  }, [playing, canPlay, pageVisible, pane?.visible, delay, shown, turns.length]);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [shown]);
  const reset = () => { setPlaying(false); setRevealed(0); };
  const step = (delta: number) => { setPlaying(false); setRevealed(value => Math.max(0, Math.min(turns.length, value + delta))); };
  const togglePlayback = () => { if (shown === turns.length) setRevealed(0); setPlaying(value => !value); };
  const keyboard = (event: KeyboardEvent) => {
    if (pane?.visible === false || event.ctrlKey || event.metaKey || event.altKey || event.target instanceof Element && event.target.closest('button,input,textarea,select,[contenteditable="true"]')) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
    else if (event.key === ' ') { event.preventDefault(); if (!event.repeat) togglePlayback(); }
    else if (event.key === 'Home') { event.preventDefault(); reset(); }
    else if (event.key === 'End') { event.preventDefault(); setPlaying(false); setRevealed(turns.length); }
  };
  return <section className="space-y-5 p-4 sm:p-6" data-testid="conversation-preview" onKeyDown={keyboard}>
    <p className="max-w-prose text-sm leading-relaxed text-text-secondary">{copy.intro}</p>
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-deep p-3">
      {([{ key: 'dialogue', label: copy.dialogue, value: dialogue, set: setDialogue }, { key: 'narration', label: copy.narration, value: narration, set: setNarration }, { key: 'notes', label: copy.notes, value: notes, set: setNotes }]).map(filter => <label key={filter.key} className="flex items-center gap-2 text-sm text-text-primary"><input data-testid={`conversation-filter-${filter.key}`} type="checkbox" checked={filter.value} onChange={event => { filter.set(event.target.checked); reset(); }} className="accent-accent-gold" />{filter.label}</label>)}
      <label className="ml-auto flex items-center gap-2 text-sm text-text-primary"><input type="checkbox" data-testid="conversation-phone" checked={phone} onChange={event => setPhone(event.target.checked)} className="accent-accent-gold" /><Smartphone size={15} aria-hidden="true" />{copy.phone}</label>
    </div>
    <details className="rounded-lg border border-border bg-deep p-3"><summary className="cursor-pointer text-sm text-text-primary">{copy.cast} · {speakers.size}/{model.speakers.length}</summary><div className="mt-3 flex flex-wrap gap-3">{model.speakers.map(speaker => <label key={speaker.id} className="flex items-center gap-2 text-sm text-text-primary"><input type="checkbox" data-testid={`conversation-speaker-${speaker.id}`} checked={speakers.has(speaker.id)} onChange={event => { const next = new Set(speakers); if (event.target.checked) next.add(speaker.id); else next.delete(speaker.id); setSpeakers(next); reset(); }} className="accent-accent-gold" /><span className="h-2 w-2 rounded-full" style={{ backgroundColor: speaker.color }} aria-hidden="true" />{speaker.name || copy.unnamed}<span className="tabular-nums text-text-muted">{speaker.count}</span></label>)}</div><div className="mt-3 flex flex-wrap gap-2"><button className={button} type="button" onClick={() => { setSpeakers(new Set(model.speakers.map(speaker => speaker.id))); reset(); }}>{copy.all}</button><button className={button} type="button" onClick={() => { setSpeakers(new Set()); reset(); }}>{copy.none}</button></div></details>
    <div className="flex flex-wrap items-end gap-3">
      <label className="grid min-w-44 gap-1 text-xs text-text-muted">{copy.viewpoint}<select data-testid="conversation-viewpoint" className={input} value={viewpoint} onChange={event => setViewpoint(event.target.value)}><option value="">{copy.neutral}</option>{model.speakers.map(speaker => <option key={speaker.id} value={speaker.id}>{speaker.name || copy.unnamed}</option>)}</select></label>
      <label className="grid gap-1 text-xs text-text-muted">{copy.delay}<select data-testid="conversation-delay" className={input} value={delay} onChange={event => setDelay(Number(event.target.value))}>{[800, 1500, 2000, 3000, 5000].map(value => <option key={value} value={value}>{value / 1000} {copy.seconds}</option>)}</select></label>
      <span data-testid="conversation-count" role="status" className="ml-auto py-2 text-sm tabular-nums text-text-muted">{copy.steps}: {shown}/{turns.length} · {totalBlocks} {copy.messages}</span>
    </div>
    <div className={`mx-auto overflow-hidden border border-border bg-deep shadow-sm ${phone ? 'max-w-[25rem] rounded-[1.8rem]' : 'w-full max-w-4xl rounded-xl'}`} data-testid="conversation-device">
      <header className="flex items-center gap-3 border-b border-border bg-surface px-5 py-4"><MessageCircle size={20} className="shrink-0 text-accent-gold" aria-hidden="true" /><div className="min-w-0"><h3 className="break-words font-display text-lg text-text-primary">{scene.title}</h3>{scene.setting && <p className="mt-1 break-words text-xs text-text-muted">{scene.setting}</p>}</div></header>
      <div ref={log} role="log" aria-label={copy.title} aria-live="polite" aria-relevant="additions" tabIndex={0} data-testid="conversation-log" className="h-[min(42vh,26rem)] min-h-56 space-y-4 overflow-y-auto overscroll-contain p-4 focus-visible:outline-2 focus-visible:outline-accent-gold">
        {turns.length === 0 ? <p className="py-8 text-center text-sm text-text-muted">{copy.empty}</p> : shown === 0 ? <div className="grid h-full place-content-center gap-4 text-center"><p className="text-sm text-text-muted">{copy.ready}</p><button type="button" className={button} onClick={() => step(1)}>{copy.start}<ArrowRight size={15} aria-hidden="true" /></button></div> : turns.slice(0, shown).map(turn => <div key={turn.id} data-testid={`conversation-turn-${turn.id}`} className={turn.simultaneous ? 'space-y-3 rounded-lg border border-dashed border-border p-2' : 'space-y-3'}>{turn.simultaneous && <p className="text-center text-[11px] uppercase tracking-wide text-text-muted">{copy.simultaneous}</p>}{turn.blocks.map(block => <ConversationBubble key={block.id} block={block} viewpoint={viewpoint} copy={copy} onSource={onSource} />)}</div>)}
        {shown > 0 && shown === turns.length && <p className="py-3 text-center text-xs text-text-muted">{copy.end}</p>}
      </div>
    </div>
    <div className="flex flex-wrap items-center justify-center gap-2"><button type="button" className={button} data-testid="conversation-restart" onClick={reset} disabled={shown === 0 && !playing}><RotateCcw size={15} aria-hidden="true" />{copy.restart}</button><button type="button" className={button} data-testid="conversation-previous" disabled={shown === 0} onClick={() => step(-1)}><ArrowLeft size={15} aria-hidden="true" />{copy.previous}</button><button type="button" className={button} data-testid="conversation-play" aria-pressed={playing} disabled={!turns.length} onClick={togglePlayback}>{playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}{playing ? copy.pause : copy.play}</button><button type="button" className={button} data-testid="conversation-next" disabled={!canPlay} onClick={() => step(1)}>{copy.next}<ArrowRight size={15} aria-hidden="true" /></button></div>
    <p className="text-center text-xs leading-relaxed text-text-muted">{copy.keyboard}<br />{copy.reduced}</p>
  </section>;
}

function ConversationBubble({ block, viewpoint, copy, onSource }: { block: DialogBlock; viewpoint: string; copy: typeof conversationCopy.en; onSource: (id: string) => void }) {
  const isDialogue = block.type === 'dialog', right = isDialogue && conversationSpeakerId(block) === viewpoint, color = conversationColor(block.characterColor);
  return <article data-testid={`conversation-block-${block.id}`} data-alignment={isDialogue ? right ? 'right' : 'left' : 'center'} className={isDialogue ? `max-w-[90%] rounded-2xl border border-border px-3 py-2.5 ${right ? 'ml-auto rounded-br-sm' : 'mr-auto rounded-bl-sm'}` : 'mx-auto max-w-prose rounded-lg px-3 py-2 text-center'} style={isDialogue ? { background: `color-mix(in srgb, ${color} 12%, var(--color-surface))`, borderInlineStartColor: color } : undefined}>
    <header className="mb-1.5 flex items-center justify-between gap-2"><span className={`min-w-0 break-words text-xs font-semibold ${isDialogue ? 'text-text-primary' : 'flex-1 text-text-muted'}`}>{isDialogue ? block.characterName || copy.unnamed : copy.types[block.type]}</span><button type="button" data-testid={`conversation-source-${block.id}`} onClick={() => onSource(block.id)} className="inline-flex min-h-7 min-w-7 shrink-0 items-center justify-center rounded text-text-muted hover:bg-elevated hover:text-accent-gold focus-visible:outline-2 focus-visible:outline-accent-gold" aria-label={`${copy.source}: ${isDialogue ? block.characterName || copy.unnamed : copy.types[block.type]}`} title={copy.source}><ExternalLink size={13} aria-hidden="true" /></button></header>
    {block.parenthetical && <p className="mb-1 break-words text-xs italic text-text-muted">({block.parenthetical})</p>}
    {block.content && <p className={`whitespace-pre-wrap break-words text-sm leading-relaxed ${isDialogue ? 'text-text-primary' : 'italic text-text-secondary'}`}>{block.content}</p>}
  </article>;
}
