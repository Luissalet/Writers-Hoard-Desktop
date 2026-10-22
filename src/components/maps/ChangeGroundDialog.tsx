import { useEffect, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import Modal from '@/components/common/Modal';
import { useTranslation } from '@/i18n/useTranslation';
import type { MapFeature } from '@/types';
import { groundCounts, groundFit, loadImageSize, type GroundFitMode, type GroundSize } from './mapGround';
import { mapGroundCopy } from './mapGroundCopy';

interface Props {
  open: boolean;
  oldImage: string;
  newImage: string;
  features: readonly MapFeature[];
  /** Only the number of pins matters here. */
  pins: readonly unknown[];
  onCancel: () => void;
  /** Resolves when the change is saved; a rejection keeps the dialog open with an error. */
  onConfirm: (change: { mode: GroundFitMode; oldSize: GroundSize | null; newSize: GroundSize }) => Promise<void>;
  /** The author picked a different file from inside the dialog. */
  onChooseAnother: (imageData: string) => void;
}

type Sizes = { status: 'loading' } | { status: 'ready'; oldSize: GroundSize | null; newSize: GroundSize } | { status: 'error' };

const pill = 'rounded-lg border border-border bg-elevated px-3 py-2 text-sm';

/** Confirms replacing a classic map's image and says what happens to its shapes and places. */
export default function ChangeGroundDialog({ open, oldImage, newImage, features, pins, onCancel, onConfirm, onChooseAnother }: Props) {
  const { locale } = useTranslation();
  const copy = mapGroundCopy[locale];
  const [sizes, setSizes] = useState<Sizes>({ status: 'loading' });
  const [mode, setMode] = useState<GroundFitMode>('keep');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSizes({ status: 'loading' }); setMode('keep'); setFailed(false);
    void (async () => {
      const [oldResult, newResult] = await Promise.allSettled([loadImageSize(oldImage), loadImageSize(newImage)]);
      if (cancelled) return;
      if (newResult.status === 'rejected') setSizes({ status: 'error' });
      else setSizes({ status: 'ready', oldSize: oldResult.status === 'fulfilled' ? oldResult.value : null, newSize: newResult.value });
    })();
    return () => { cancelled = true; };
  }, [open, oldImage, newImage]);

  const counts = groundCounts(features, pins);
  const ready = sizes.status === 'ready' ? sizes : null;
  const fit = ready?.oldSize ? groundFit(ready.oldSize, ready.newSize) : null;
  const askMode = !!fit && !fit.sameShape;
  const effectiveMode: GroundFitMode = askMode ? mode : 'stretch';
  const ratio = (value: number) => `${value.toFixed(2)}:1`;
  const size = (value: GroundSize | null) => (value ? `${value.width} × ${value.height} ${copy.pixels}` : '—');

  const confirm = async () => {
    if (!ready || busy) return;
    setBusy(true); setFailed(false);
    try { await onConfirm({ mode: effectiveMode, oldSize: ready.oldSize, newSize: ready.newSize }); }
    catch { setFailed(true); }
    finally { setBusy(false); }
  };

  const chooseFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') onChooseAnother(reader.result); };
    reader.readAsDataURL(file);
  };

  return (
    <Modal open={open} busy={busy} wide onClose={() => { if (!busy) onCancel(); }} title={copy.title}>
      <div className="space-y-4" data-testid="change-ground-dialog">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {([['old', copy.oldLabel, oldImage, ready ? ready.oldSize : null], ['new', copy.newLabel, newImage, ready ? ready.newSize : null]] as const).map(([key, label, src, value]) => (
            <figure key={key} className="space-y-1.5" data-testid={`change-ground-${key}`}>
              <figcaption className="text-xs text-text-muted">{label}</figcaption>
              <div className="flex h-40 items-center justify-center overflow-hidden rounded-lg border border-border bg-deep">
                <img src={src} alt={label} className="max-h-full max-w-full object-contain" draggable={false} />
              </div>
              <p className="text-xs text-text-primary" data-testid={`change-ground-${key}-size`}>{sizes.status === 'loading' ? '…' : size(value)}</p>
            </figure>
          ))}
        </div>

        {sizes.status === 'loading' && <p role="status" className="text-sm text-text-muted">{copy.loading}</p>}
        {sizes.status === 'error' && <p role="alert" className="text-sm text-danger" data-testid="change-ground-error">{copy.errorNew}</p>}
        {ready && !ready.oldSize && <p role="status" className="text-sm text-text-muted" data-testid="change-ground-old-unreadable">{copy.oldUnreadable}</p>}

        <div className={pill} data-testid="change-ground-counts">
          <p className="mb-1 text-xs text-text-muted">{copy.movesWith}</p>
          <ul className="flex flex-wrap gap-x-5 gap-y-1">
            {([['places', copy.places, counts.places], ['zones', copy.zones, counts.zones], ['paths', copy.paths, counts.paths], ['names', copy.names, counts.names]] as const).map(([key, label, value]) => (
              <li key={key} data-testid={`change-ground-count-${key}`}>{label}: <strong className="text-text-primary">{value}</strong></li>
            ))}
          </ul>
        </div>

        {fit && (
          <p className={`text-sm ${fit.sameShape ? 'text-text-muted' : 'text-accent-gold'}`} role="status" data-testid={fit.sameShape ? 'change-ground-same-shape' : 'change-ground-different-shape'}>
            {fit.sameShape ? copy.sameShape : copy.differentShape.replace('{old}', ratio(fit.oldRatio)).replace('{new}', ratio(fit.newRatio))}
          </p>
        )}

        {askMode && (
          <fieldset className="space-y-2" disabled={busy}>
            {([['keep', copy.keep, copy.keepHelp], ['stretch', copy.stretch, copy.stretchHelp]] as const).map(([value, label, help]) => (
              <label key={value} className={`flex cursor-pointer items-start gap-3 ${pill} ${mode === value ? 'border-accent-gold' : ''}`}>
                <input type="radio" name="change-ground-fit" className="mt-1" checked={mode === value} onChange={() => setMode(value)} data-testid={`change-ground-fit-${value}`} />
                <span><span className="block text-text-primary">{label}</span><span className="block text-xs text-text-muted">{help}</span></span>
              </label>
            ))}
          </fieldset>
        )}

        {ready?.oldSize && <p className="text-xs text-text-muted">{copy.safety.replace('{name}', copy.versionName)}</p>}
        {failed && <p role="alert" className="text-sm text-danger" data-testid="change-ground-save-failed">{copy.saveFailed}</p>}

        <div className="flex flex-wrap gap-3 pt-1">
          <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={chooseFile} data-testid="change-ground-choose-input" />
          <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2.5 text-sm text-text-muted transition hover:bg-elevated disabled:opacity-50" data-testid="change-ground-choose">
            <ImagePlus size={15} />{copy.chooseAnother}
          </button>
          <span className="flex-1" />
          <button type="button" disabled={busy} onClick={onCancel} className="rounded-lg border border-border px-6 py-2.5 text-text-muted transition hover:bg-elevated disabled:opacity-50" data-testid="change-ground-cancel">{copy.cancel}</button>
          <button type="button" disabled={busy || !ready} onClick={() => void confirm()} className="rounded-lg bg-accent-gold px-6 py-2.5 font-semibold text-deep transition hover:bg-accent-amber disabled:opacity-50" data-testid="change-ground-confirm">{busy ? copy.working : copy.confirm}</button>
        </div>
      </div>
    </Modal>
  );
}
