import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AudioLines, ChevronLeft, ChevronRight, Download, Mic, Pause, Play, Settings2, Square, Trash2, Upload } from 'lucide-react';
import { saveAs } from 'file-saver';
import { useNavigate } from 'react-router-dom';
import { db } from '@/db';
import { useTranslation } from '@/i18n/useTranslation';
import { useDeepLinkParam } from '@/engines/_shared';
import ConfirmDialog from '@/engines/_shared/components/ConfirmDialog';
import { toast } from '@/components/common/toast';
import { registerPendingFlusher, trackPendingWrite } from '@/services/pendingWrites';
import type { EngineComponentProps } from '@/engines/_types';
import type { CodexEntry } from '@/types';
import type { LocalMediaAsset } from './types';
import { mediaFilename } from './types';
import { deleteLocalMedia, importLocalMedia, updateLocalMedia } from './operations';
import { LocalVoiceRecorder } from './recorder';
import { mediaCopy } from './copy';
import { LocalMediaPlayer } from './LocalMediaPlayer';

const control = 'min-h-9 rounded-lg border border-border bg-deep px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50';
const button = `${control} inline-flex items-center justify-center gap-2 hover:bg-elevated disabled:cursor-not-allowed`;
type Copy = typeof mediaCopy.en;
const extension = (mime: string) => mime.includes('wav') ? 'wav' : mime.includes('mpeg') ? 'mp3' : mime.includes('flac') ? 'flac' : mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
const voiceFile = (blob: Blob, name: string) => new File([blob], `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension(blob.type)}`, { type: blob.type });
type VoicePreview = { file: File; saved?: LocalMediaAsset; saving?: Promise<LocalMediaAsset> };
function persistVoice(projectId: string, preview: VoicePreview): Promise<LocalMediaAsset> {
  if (preview.saved) return Promise.resolve(preview.saved);
  if (preview.saving) return preview.saving;
  preview.saving = trackPendingWrite(importLocalMedia(projectId, preview.file), () => persistVoice(projectId, preview), `media-recording:${projectId}:${preview.file.name}`).then(asset => { preview.saved = asset; return asset; }).finally(() => { preview.saving = undefined; });
  return preview.saving;
}

function MediaDetailsForm({ asset, entries, copy, busy, onCancel, onSave }: { asset: LocalMediaAsset; entries: CodexEntry[]; copy: Copy; busy: boolean; onCancel: () => void; onSave: (changes: Pick<LocalMediaAsset, 'title' | 'notes' | 'tags' | 'linkedEntryIds'>, base: LocalMediaAsset) => void }) {
  const [base] = useState(asset);
  const [draft, setDraft] = useState({ title: asset.title, notes: asset.notes, tags: asset.tags.join(', '), linkedEntryIds: asset.linkedEntryIds });
  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); onSave({ ...draft, tags: [...new Set(draft.tags.split(',').map(tag => tag.trim()).filter(Boolean))] }, base); }}>
    <fieldset disabled={busy} className="space-y-4"><label className="block space-y-1 text-sm text-text-primary">{copy.name}<input required className={`${control} w-full`} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
      <label className="block space-y-1 text-sm text-text-primary">{copy.notes}<textarea className={`${control} w-full`} rows={6} value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label>
      <label className="block space-y-1 text-sm text-text-primary">{copy.tags}<input className={`${control} w-full`} value={draft.tags} onChange={event => setDraft({ ...draft, tags: event.target.value })} /></label>
      <label className="block space-y-1 text-sm text-text-primary">{copy.linked}<select multiple className={`${control} min-h-28 w-full`} value={draft.linkedEntryIds} onChange={event => setDraft({ ...draft, linkedEntryIds: [...event.target.selectedOptions].map(option => option.value) })}>{entries.map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></label>
      <div className="flex gap-2"><button className={`${button} bg-accent-gold text-deep`} type="submit">{copy.save}</button><button className={button} type="button" onClick={onCancel}>{copy.cancel}</button></div>
    </fieldset>
  </form>;
}

export default function MediaEngine({ projectId }: EngineComponentProps) {
  const { locale } = useTranslation(); const copy = mediaCopy[locale]; const navigate = useNavigate();
  const assets = useLiveQuery(() => db.localMediaAssets.where('projectId').equals(projectId).sortBy('createdAt'), [projectId]) ?? [];
  const entries = useLiveQuery(() => db.codexEntries.where('projectId').equals(projectId).toArray(), [projectId]) ?? [];
  const deepLink = useDeepLinkParam('entity');
  const [selectedId, setSelectedId] = useState(''); const [seenLink, setSeenLink] = useState<string | null>(null);
  const [query, setQuery] = useState(''); const [kind, setKind] = useState(''); const [loop, setLoop] = useState(false); const [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [editing, setEditing] = useState(false); const [confirm, setConfirm] = useState(false);
  const [recording, setRecording] = useState<'idle' | 'requesting' | 'recording' | 'paused'>('idle');
  const [elapsed, setElapsed] = useState(0); const [recorded, setRecorded] = useState<Blob | null>(null);
  const recorder = useRef<{ recorder: LocalVoiceRecorder; started: boolean } | null>(null); const fileInput = useRef<HTMLInputElement>(null);
  const previewRef = useRef<VoicePreview | null>(null);
  const mounted = useRef(true);
  const copyRef = useRef(copy);
  useEffect(() => { copyRef.current = copy; });
  const filtered = assets.filter(asset => (!kind || asset.kind === kind) && [asset.title, asset.notes, ...asset.tags].some(value => value.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  if (deepLink && deepLink !== seenLink && assets.some(asset => asset.id === deepLink)) { setSelectedId(deepLink); setSeenLink(deepLink); setQuery(''); setKind(''); }
  const selected = filtered.find(asset => asset.id === selectedId) ?? filtered[0];
  const locked = busy || editing || recording !== 'idle' || Boolean(recorded);
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false;
    const preview = previewRef.current; previewRef.current = null;
    if (preview) void persistVoice(projectId, preview).catch(() => toast.error(copyRef.current.error));
    const session = recorder.current; recorder.current = null;
    if (!session) return;
    if (session.started) {
      const operation = session.recorder.stop().then(blob => {
        if (!blob.size) return;
        const file = voiceFile(blob, copyRef.current.voiceName);
        return trackPendingWrite(importLocalMedia(projectId, file), async () => { await importLocalMedia(projectId, file); return true; }, `media-recording:${projectId}`);
      });
      void operation.catch(() => toast.error(copyRef.current.error));
    }
    session.recorder.dispose();
  }; }, [projectId]);
  useEffect(() => {
    if (!recorded) return;
    return registerPendingFlusher(`media-preview:${projectId}`, async () => {
      const preview = previewRef.current;
      if (preview) await persistVoice(projectId, preview);
      return true;
    });
  }, [recorded, projectId]);
  useEffect(() => {
    if (recording === 'idle') return;
    return registerPendingFlusher(`media-live:${projectId}`, async () => {
      const session = recorder.current; recorder.current = null;
      if (!session) return true;
      try {
        if (session.started) { const blob = await session.recorder.stop(); if (blob.size) await persistVoice(projectId, { file: voiceFile(blob, copyRef.current.voiceName) }); }
        if (mounted.current) setRecording('idle');
        return true;
      } finally { session.recorder.dispose(); }
    });
  }, [recording, projectId]);
  useEffect(() => {
    if (recording !== 'recording') return;
    const timer = window.setInterval(() => setElapsed(value => value + 1), 1000); return () => window.clearInterval(timer);
  }, [recording]);
  const run = async (work: () => Promise<void>, done?: () => void) => { if (busy) return; setBusy(true); setError(''); try { await work(); done?.(); } catch { setError(copy.error); } finally { setBusy(false); } };
  const startRecording = async () => {
    if (locked) return;
    const instance = new LocalVoiceRecorder(); const session = { recorder: instance, started: false }; recorder.current = session; setRecording('requesting'); setError(''); setElapsed(0);
    try { await instance.start(); if (recorder.current !== session) return; session.started = true; setRecording('recording'); }
    catch { if (recorder.current === session) { recorder.current = null; setRecording('idle'); setError(copy.permission); instance.dispose(); } }
  };
  const stopRecording = async () => {
    const session = recorder.current; if (!session?.started) return;
    recorder.current = null; setRecording('idle');
    try { const blob = await session.recorder.stop(); if (blob.size) { const preview = { file: voiceFile(blob, copy.voiceName) }; if (mounted.current) { previewRef.current = preview; setRecorded(blob); } else await persistVoice(projectId, preview); } else if (mounted.current) setError(copy.error); } catch { if (mounted.current) setError(copy.error); } finally { session.recorder.dispose(); }
  };
  const selectNext = (offset: number) => { if (!selected || locked || !filtered.length) return; const index = filtered.findIndex(asset => asset.id === selected.id); setSelectedId(filtered[(index + offset + filtered.length) % filtered.length].id); };
  return <section className="flex h-full min-h-0 flex-col bg-deep" aria-label={copy.title}>
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5"><div><h2 className="flex items-center gap-2 font-display text-2xl text-text-primary"><AudioLines size={24} />{copy.title}</h2><p className="mt-2 max-w-prose text-sm text-text-muted">{copy.intro}</p><p className="mt-1 text-xs text-text-muted">{copy.limit}</p></div><div className="flex flex-wrap gap-2"><button className={button} disabled={locked} onClick={() => fileInput.current?.click()}><Upload size={16} />{copy.import}</button><button className={button} disabled={locked} onClick={() => { void startRecording(); }}><Mic size={16} />{copy.record}</button><input className="hidden" ref={fileInput} type="file" accept="audio/*,video/*" multiple aria-label={copy.import} onChange={event => { const files = [...event.target.files ?? []]; event.target.value = ''; void run(async () => { for (const file of files) { const imported = await importLocalMedia(projectId, file); setSelectedId(imported.id); } }); }} /></div></header>
    {error && <p role="alert" className="p-4 text-sm text-danger">{error}</p>}
    {recording !== 'idle' && <div className="flex flex-wrap items-center gap-3 border-b border-border p-4" role="status"><span className="text-sm text-accent-gold">{recording === 'requesting' ? copy.requesting : recording === 'paused' ? copy.paused : copy.recording} <span className="tabular-nums">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span></span>{recording !== 'requesting' && <><button className={button} onClick={() => { if (recording === 'paused') { recorder.current?.recorder.resume(); setRecording('recording'); } else { recorder.current?.recorder.pause(); setRecording('paused'); } }}>{recording === 'paused' ? <Play size={15} /> : <Pause size={15} />}{recording === 'paused' ? copy.resume : copy.pause}</button><button className={button} onClick={() => { void stopRecording(); }}><Square size={15} />{copy.stop}</button></>}</div>}
    {recorded && <div className="space-y-3 border-b border-border p-4"><h3 className="text-sm font-medium text-text-primary">{copy.preview}</h3><LocalMediaPlayer asset={{ blob: recorded, kind: 'audio' }} loop={false} speed={1} fallback={copy.fallback} /><div className="flex gap-2"><button className={button} disabled={busy} onClick={() => { void run(async () => { const preview = previewRef.current; if (!preview) return; const asset = await persistVoice(projectId, preview); setSelectedId(asset.id); }, () => { previewRef.current = null; setRecorded(null); }); }}>{copy.saveRecording}</button><button className={button} disabled={busy} onClick={() => { previewRef.current = null; setRecorded(null); }}>{copy.discard}</button></div></div>}
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div className="flex shrink-0 flex-col border-b border-border md:w-72 md:border-r md:border-b-0"><div className="space-y-2 p-3"><input className={`${control} w-full`} aria-label={copy.search} placeholder={copy.search} value={query} disabled={editing} onChange={event => setQuery(event.target.value)} /><select className={`${control} w-full`} aria-label={copy.all} value={kind} disabled={editing} onChange={event => setKind(event.target.value)}><option value="">{copy.all}</option><option value="audio">{copy.audio}</option><option value="video">{copy.video}</option></select></div><nav className="max-h-52 space-y-1 overflow-auto px-3 pb-3 md:max-h-none md:flex-1" aria-label={copy.title}>{filtered.map(asset => <button key={asset.id} disabled={locked} aria-current={asset.id === selected?.id ? 'page' : undefined} className={`block w-full break-words rounded-lg p-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50 ${asset.id === selected?.id ? 'bg-elevated text-accent-gold' : 'text-text-primary hover:bg-surface'}`} onClick={() => setSelectedId(asset.id)}>{asset.title}<span className="mt-1 block text-xs tabular-nums text-text-muted">{copy[asset.kind]} · {(asset.size / 1024 / 1024).toFixed(1)} MB</span></button>)}</nav></div>
      <div className="min-w-0 flex-1 overflow-y-auto p-5">{selected ? <div className="space-y-5"><h3 className="break-words font-display text-xl text-text-primary">{selected.title}</h3><LocalMediaPlayer key={selected.id} asset={selected} loop={loop} speed={speed} fallback={copy.fallback} />
        <div className="flex flex-wrap items-center gap-3"><button className={button} disabled={locked || filtered.length < 2} aria-label={copy.previous} onClick={() => selectNext(-1)}><ChevronLeft size={16} /></button><button className={button} disabled={locked || filtered.length < 2} aria-label={copy.next} onClick={() => selectNext(1)}><ChevronRight size={16} /></button><label className="flex items-center gap-2 text-sm text-text-primary"><input type="checkbox" className="accent-accent-gold" checked={loop} onChange={event => setLoop(event.target.checked)} />{copy.loop}</label><label className="flex items-center gap-2 text-sm text-text-primary">{copy.speed}<select className={control} value={speed} onChange={event => setSpeed(Number(event.target.value))}>{[.5, .75, 1, 1.25, 1.5, 2].map(value => <option key={value} value={value}>{value}×</option>)}</select></label></div>
        <div className="flex flex-wrap gap-2"><button className={button} disabled={locked} onClick={() => setEditing(true)}><Settings2 size={15} />{copy.edit}</button><button className={button} onClick={() => saveAs(selected.blob, mediaFilename(selected))}><Download size={15} />{copy.download}</button><button className={button} disabled={locked} onClick={() => setConfirm(true)}><Trash2 size={15} />{copy.remove}</button></div>
        {editing ? <MediaDetailsForm key={selected.id} asset={selected} entries={entries} copy={copy} busy={busy} onCancel={() => setEditing(false)} onSave={(changes, base) => { void run(() => updateLocalMedia(projectId, selected.id, changes, base), () => setEditing(false)); }} /> : <><p className="max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed text-text-primary">{selected.notes}</p><p className="text-sm text-text-muted">{selected.tags.join(' · ')}</p><div className="flex flex-wrap gap-2">{selected.linkedEntryIds.map(id => entries.find(entry => entry.id === id)).filter((entry): entry is CodexEntry => Boolean(entry)).map(entry => <button key={entry.id} className={button} onClick={() => navigate(`/project/${encodeURIComponent(projectId)}/codex?entry=${encodeURIComponent(entry.id)}`)}>{entry.title}</button>)}</div></>}
      </div> : <p className="p-5 text-sm text-text-muted">{copy.empty}</p>}</div>
    </div>
    <ConfirmDialog open={confirm} destructive message={copy.confirm} onCancel={() => setConfirm(false)} onConfirm={async () => { if (selected) await run(() => deleteLocalMedia(projectId, selected.id), () => setConfirm(false)); }} />
  </section>;
}
