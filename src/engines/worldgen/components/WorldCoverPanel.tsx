import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ImagePlus, RotateCcw, Trash2 } from 'lucide-react';
import GalleryAssetPicker from '@/components/gallery/GalleryAssetPicker';
import { useTranslation } from '@/i18n/useTranslation';
import type { WorldEraScope } from '@/services/worldEras/types';
import { getWorldCover, saveWorldCover, revertWorldCover, WorldCoverError } from '../worldCover';
import { worldCoverCopy } from '../worldCoverCopy';
import type { GeneratedWorld } from '../types';

type CoverState = Awaited<ReturnType<typeof getWorldCover>>;
type CoverReceipt = Awaited<ReturnType<typeof saveWorldCover>>;
type CoverSelection = { revision: number; owner: WorldEraScope; ownerToken: CoverState['ownerToken'] };
interface Props { scope: WorldEraScope; world: GeneratedWorld; onSaved?: () => void | Promise<void> }

/** A new owner gets a new editor, including its pending local image read. */
export default function WorldCoverPanel(props: Props) {
  const owner = JSON.stringify([props.scope.projectId, props.scope.eraId ?? '', props.world.id, props.world.createdAt]);
  return <WorldCoverEditor key={owner} {...props} />;
}

function WorldCoverEditor({ scope, world, onSaved }: Props) {
  const { locale } = useTranslation(), copy = worldCoverCopy(locale);
  const alive = useRef(true), operation = useRef(0), query = useRef(0), busy = useRef(false);
  const fileReader = useRef<FileReader | null>(null);
  const gallerySelection = useRef<CoverSelection | null>(null);
  const [state, setState] = useState<CoverState>();
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<'' | 'reading' | 'saving' | 'undoing'>('');
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [gallery, setGallery] = useState(false), [undo, setUndo] = useState<CoverReceipt>();

  const load = useCallback(async () => {
    const ticket = ++query.current;
    try {
      const next = await getWorldCover({ projectId: scope.projectId, eraId: scope.eraId }, world.id);
      if (alive.current && query.current === ticket) setState(next);
    } catch {
      if (alive.current && query.current === ticket) setError(copy.loadFailed);
    } finally {
      if (alive.current && query.current === ticket) setLoading(false);
    }
  }, [scope.projectId, scope.eraId, world.id, copy.loadFailed]);
  const cancelUnmountedRequests = useCallback(() => {
    alive.current = false; operation.current++; query.current++; fileReader.current?.abort();
  }, []);
  useEffect(() => {
    alive.current = true;
    return cancelUnmountedRequests;
  }, [cancelUnmountedRequests]);
  useEffect(() => { void load(); }, [load, world.coverImage, world.coverRevision]);

  const messageFor = (reason: unknown) => reason instanceof WorldCoverError
    ? reason.code === 'conflict' ? copy.conflict : reason.code === 'not-found' ? copy.notFound : copy.invalidImage
    : copy.failed;
  const finish = (ticket: number) => {
    if (alive.current && operation.current === ticket) { busy.current = false; setStage(''); }
  };
  const refreshHost = async (ticket: number) => {
    try { await onSaved?.(); }
    catch { if (alive.current && operation.current === ticket) setError(copy.refreshFailed); }
  };
  const selectedAt = (value: CoverState): CoverSelection => ({ revision: value.revision, owner: { ...value.scope }, ownerToken: value.ownerToken });
  const commit = async (image: string | null, selected: CoverSelection, ticket: number) => {
    if (!alive.current || operation.current !== ticket) return;
    setStage('saving');
    try {
      const fresh = await getWorldCover(scope, world.id);
      if (!alive.current || operation.current !== ticket) return;
      if (fresh.ownerToken !== selected.ownerToken || fresh.scope.projectId !== selected.owner.projectId || (fresh.scope.eraId ?? '') !== (selected.owner.eraId ?? '')) throw new WorldCoverError('conflict', copy.conflict);
      const receipt = await saveWorldCover(scope, world.id, image, selected.revision, selected.ownerToken);
      if (!alive.current || operation.current !== ticket) return;
      if (receipt.changed) { setUndo(receipt); setNotice(image === null ? copy.removed : copy.saved); }
      await load();
      if (alive.current && operation.current === ticket) await refreshHost(ticket);
    } catch (reason) {
      if (alive.current && operation.current === ticket) setError(messageFor(reason));
    } finally { finish(ticket); }
  };
  const begin = (image: string | null, selected?: CoverSelection) => {
    if (!alive.current || busy.current || loading || !state) return;
    busy.current = true; setError(''); setNotice(''); setGallery(false);
    void commit(image, selected ?? selectedAt(state), ++operation.current);
  };
  const chooseFile = (file: File | undefined) => {
    if (!file || busy.current || loading || !state) return;
    const selected = selectedAt(state), ticket = ++operation.current, reader = new FileReader();
    busy.current = true; setStage('reading'); setError(''); setNotice(''); fileReader.current = reader;
    reader.onload = () => {
      if (!alive.current || operation.current !== ticket) return;
      fileReader.current = null;
      if (typeof reader.result === 'string') void commit(reader.result, selected, ticket);
      else { setError(copy.readFailed); finish(ticket); }
    };
    reader.onerror = () => {
      if (alive.current && operation.current === ticket) { fileReader.current = null; setError(copy.readFailed); finish(ticket); }
    };
    reader.onabort = () => { if (alive.current && operation.current === ticket) finish(ticket); };
    try { reader.readAsDataURL(file); }
    catch { fileReader.current = null; setError(copy.readFailed); finish(ticket); }
  };
  const cancelRead = () => {
    operation.current++; fileReader.current?.abort(); fileReader.current = null;
    busy.current = false; setStage('');
  };
  const revert = async () => {
    if (busy.current || !undo) return;
    const receipt = undo, ticket = ++operation.current;
    busy.current = true; setStage('undoing'); setError(''); setNotice('');
    try {
      const result = await revertWorldCover(scope, world.id, receipt);
      if (!alive.current || operation.current !== ticket) return;
      if (result.kept.length || !result.reverted.length) setError(copy.undoConflict);
      else { setUndo(undefined); setNotice(copy.undone); }
      await load();
      if (alive.current && operation.current === ticket) await refreshHost(ticket);
    } catch (reason) {
      if (alive.current && operation.current === ticket) {
        setError(reason instanceof WorldCoverError && reason.code === 'conflict' ? copy.undoConflict : messageFor(reason));
        await load();
      }
    } finally { finish(ticket); }
  };

  const chosen = state ? state.coverImage : world.coverImage ?? null, preview = chosen || world.thumbnail;
  const disabled = !!stage || loading || !state;
  const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary transition hover:border-accent-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold disabled:cursor-default disabled:opacity-40';
  return <section aria-label={copy.title} aria-busy={!!stage || loading} className="flex min-w-0 flex-wrap items-center gap-4 border-y border-border py-3" data-testid="world-cover-panel">
    {preview && <img src={preview} alt={copy.preview(world.title)} className="h-20 w-32 shrink-0 rounded-lg object-cover" data-testid="world-cover-preview" />}
    <div className="min-w-0 flex-1 space-y-2">
      <div><h3 className="text-sm font-semibold text-text-primary">{copy.title}</h3><p className="text-xs text-text-muted">{copy.description}</p></div>
      <p className="text-xs text-text-muted" data-testid="world-cover-source">{chosen ? copy.selected : world.thumbnail ? copy.fallback : copy.empty}</p>
      {!loading && state && state.requestedScope.eraId && !state.scope.eraId && <p className="text-xs text-text-muted">{copy.inheritedNotice}</p>}
      <div className="flex flex-wrap gap-2">
        <label className={`${button} focus-within:ring-2 focus-within:ring-accent-gold ${disabled ? 'cursor-default opacity-40' : 'cursor-pointer'}`}>
          <ImagePlus size={15} aria-hidden="true" />{chosen ? copy.changeFile : copy.file}
          <input type="file" accept="image/*" className="sr-only" disabled={disabled} aria-label={chosen ? copy.changeFile : copy.file} data-testid="world-cover-file" onChange={event => { chooseFile(event.target.files?.[0]); event.target.value = ''; }} />
        </label>
        <button type="button" className={button} disabled={disabled} onClick={() => { if (!state || busy.current) return; gallerySelection.current = selectedAt(state); setError(''); setNotice(''); setGallery(true); }} data-testid="world-cover-gallery">{chosen ? copy.changeGallery : copy.gallery}</button>
        {chosen && <button type="button" className={button} disabled={disabled} onClick={() => begin(null)} data-testid="world-cover-remove"><Trash2 size={15} aria-hidden="true" />{copy.remove}</button>}
        {undo && <button type="button" className={button} disabled={!!stage || loading} onClick={() => void revert()} data-testid="world-cover-undo"><RotateCcw size={15} aria-hidden="true" />{copy.undo}</button>}
        {stage === 'reading' && <button type="button" className={button} onClick={cancelRead} data-testid="world-cover-cancel-read">{copy.cancelRead}</button>}
      </div>
      <p role="status" aria-live="polite" className="min-h-4 text-xs text-text-muted">{stage ? copy[stage] : notice}</p>
      {error && <div className="flex flex-wrap items-center gap-2" role="alert"><AlertCircle size={16} className="shrink-0 text-danger" aria-hidden="true" /><p className="min-w-0 flex-1 text-sm text-text-primary">{error}</p><button type="button" className={button} disabled={!!stage} onClick={() => { setError(''); void load(); }} data-testid="world-cover-reload">{copy.retry}</button></div>}
    </div>
    <GalleryAssetPicker projectId={scope.projectId} open={gallery} onClose={() => { gallerySelection.current = null; setGallery(false); }} onSelect={selection => { const selected = gallerySelection.current; if (selected) begin(selection.imageData, selected); }} />
  </section>;
}
