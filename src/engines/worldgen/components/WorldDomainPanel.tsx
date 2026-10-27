import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { DOMAIN_ANCHORS, resizeBounds } from '../core/worldDomain';
import { cancelWorldDomainOperation, getWorldDomain, resizeWorldDomain, revertWorldDomain, WorldDomainError, type DomainRead, type WorldDomainReceipt, type WorldDomainScope } from '../worldDomain';
import WorldDomainFrame, { type DomainDraft } from './WorldDomainFrame';

const control = 'min-h-10 rounded-lg border border-border bg-surface px-3 py-2 text-base text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50';

export default function WorldDomainPanel({ scope, worldId, onChanged }: { scope: WorldDomainScope; worldId: string; onChanged: () => Promise<void> }) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState<DomainRead>();
  const [draft, setDraft] = useState<DomainDraft>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [progress, setProgress] = useState(0), [notice, setNotice] = useState('');
  const [receipt, setReceipt] = useState<WorldDomainReceipt>();
  const [conflict, setConflict] = useState(false);
  const applying = useRef(false);
  const token = useRef(0);
  const jobId = useRef<string | undefined>(undefined);
  useEffect(() => () => {
    token.current++;
    if (jobId.current) cancelWorldDomainOperation(scope, jobId.current);
    jobId.current = undefined; applying.current = false;
  }, [scope, worldId]);
  const open = async () => {
    const own = ++token.current; setBusy(true); setError(''); setNotice(''); setConflict(false);
    try {
      const domain = await getWorldDomain(scope, worldId);
      if (token.current === own) { setSaved(domain); setDraft({ width: String(domain.widthKm), height: String(domain.heightKm), anchor: 'center', fill: 'sea' }); }
    } catch { if (token.current === own) setError(t('worldgen.domain.readError')); }
    finally { if (token.current === own) setBusy(false); }
  };
  const readCurrent = async () => {
    const own = ++token.current; setBusy(true);
    try {
      const domain = await getWorldDomain(scope, worldId);
      if (token.current === own) { setSaved(domain); setConflict(false); setError(''); }
    } catch { if (token.current === own) setError(t('worldgen.domain.readError')); }
    finally { if (token.current === own) setBusy(false); }
  };
  const undo = async () => {
    if (!receipt || applying.current) return;
    const own = ++token.current; applying.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await revertWorldDomain(scope, worldId, receipt);
      if (token.current === own) { setReceipt(undefined); await onChanged(); }
    } catch (error) {
      if (token.current === own) {
        const stale = error instanceof WorldDomainError && error.code === 'conflict';
        if (stale) setReceipt(undefined);
        setError(t(stale ? 'worldgen.domain.undoConflict' : 'worldgen.domain.undoError'));
      }
    } finally { if (token.current === own) { applying.current = false; setBusy(false); } }
  };
  let bounds: ReturnType<typeof resizeBounds> | undefined;
  if (saved && draft) {
    const width = Number(draft.width), height = Number(draft.height);
    if ([width, height].every(value => Number.isFinite(value) && value > 0)) {
      try { bounds = resizeBounds(saved.bounds, Math.max(1, Math.round(width / saved.cellKm)), Math.max(1, Math.round(height / saved.cellKm)), draft.anchor); } catch { /* Invalid drafts never reach storage. */ }
    }
  }
  const changed = !!bounds && !!saved && (bounds.x !== saved.bounds.x || bounds.y !== saved.bounds.y || bounds.width !== saved.bounds.width || bounds.height !== saved.bounds.height);
  const cancelPreparation = () => {
    if (!jobId.current || !cancelWorldDomainOperation(scope, jobId.current).canceled) return;
    token.current++; jobId.current = undefined; applying.current = false;
    setBusy(false); setProgress(0); setError(''); setNotice('');
  };
  const apply = async () => {
    if (!draft || !saved || !bounds || !changed || applying.current) return;
    const own = ++token.current, id = crypto.randomUUID();
    jobId.current = id; applying.current = true; setBusy(true); setError(''); setNotice(''); setProgress(0);
    try {
      const receipt = await resizeWorldDomain(scope, worldId, {
        widthKm: Number(draft.width), heightKm: Number(draft.height), anchor: draft.anchor, fill: draft.fill,
        expectedRevision: saved.revision, jobId: id,
        onProgress: (_stage, value) => { if (token.current === own) setProgress(value); },
      });
      if (token.current === own) {
        setSaved(receipt.domain); setDraft(undefined);
        if (receipt.changed) { setReceipt(receipt); await onChanged(); }
        else setNotice(t('worldgen.domain.noChange'));
      }
    } catch (error) {
      if (token.current === own) {
        const stale = error instanceof WorldDomainError && error.code === 'conflict';
        setConflict(stale); setError(t(stale ? 'worldgen.domain.conflict' : 'worldgen.domain.applyError'));
      }
    }
    finally { if (token.current === own) { jobId.current = undefined; applying.current = false; setBusy(false); } }
  };
  if (!draft || !saved) return <div className="mb-4 space-y-2">
    <button type="button" className={control} disabled={busy} onClick={() => void open()}>{t('worldgen.domain.resizeTitle')}</button>
    {receipt && <button type="button" className={`${control} ml-2`} disabled={busy} onClick={() => void undo()}>{t('worldgen.domain.undo')}</button>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="text-sm text-text-muted">{notice}</p>}
  </div>;
  const measures = bounds ? [
    ['effectiveWidth', bounds.width * saved.cellKm], ['effectiveHeight', bounds.height * saved.cellKm],
    ['gridWidth', bounds.width], ['gridHeight', bounds.height], ['cell', saved.cellKm],
    ['originX', bounds.x], ['originY', bounds.y], ['sourceWidth', saved.source.width], ['sourceHeight', saved.source.height],
    ['memory', (saved.source.width * saved.source.height + bounds.width * bounds.height) * 47 / 1048576],
  ] as const : [];
  return <section aria-label={t('worldgen.domain.resizeTitle')} aria-busy={busy} className="mb-4 min-w-0 space-y-4 rounded-lg border border-border bg-surface p-3">
    <h3 className="text-base font-semibold text-text-primary">{t('worldgen.domain.resizeTitle')}</h3>
    <p className="text-sm leading-relaxed text-text-muted">{t('worldgen.domain.resizeHint')}</p>
    {busy && <p role="status" className="text-sm text-text-primary">{t('worldgen.domain.applying')} {Math.round(Math.max(0, Math.min(1, progress)) * 100)}%</p>}
    <fieldset disabled={busy} className="min-w-0 space-y-4 disabled:opacity-60">
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {(['width', 'height'] as const).map(key => <label key={key} className="block min-w-0 text-sm text-text-muted">{t(`worldgen.domain.${key}`)}
        <input type="number" min="0" step="any" value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })} className={`${control} mt-1 block w-full min-w-0`} />
      </label>)}
    </div>
    <fieldset className="space-y-2">
      <legend className="text-sm text-text-muted">{t('worldgen.domain.anchor')}</legend>
      <div className="grid grid-cols-3 gap-1.5">
        {DOMAIN_ANCHORS.map(anchor => <button key={anchor} type="button" aria-pressed={draft.anchor === anchor} className={`${control} break-words px-1.5 ${draft.anchor === anchor ? 'border-accent-gold text-accent-gold' : ''}`} onClick={() => setDraft({ ...draft, anchor })}>{t(`worldgen.domain.anchor.${anchor}`)}</button>)}
      </div>
    </fieldset>
    <div role="group" aria-label={t('worldgen.domain.fill')} className="flex flex-wrap gap-2">
      {(['sea', 'land'] as const).map(fill => <button key={fill} type="button" aria-pressed={draft.fill === fill} className={`${control} ${draft.fill === fill ? 'border-accent-gold text-accent-gold' : ''}`} onClick={() => setDraft({ ...draft, fill })}>{t(`worldgen.domain.${fill}`)}</button>)}
    </div>
    {bounds ? <>
      <WorldDomainFrame saved={saved.bounds} bounds={bounds} cellKm={saved.cellKm} draft={draft} onChange={setDraft} />
      <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-2 text-sm">
        {measures.map(([key, value]) => <div key={key} className="min-w-0"><dt className="text-text-muted">{t(`worldgen.domain.${key}`)}</dt><dd className="break-words tabular-nums text-text-primary"><output aria-label={t(`worldgen.domain.${key}`)}>{value}</output></dd></div>)}
      </dl>
    </> : <p role="alert" className="text-sm text-danger">{t('worldgen.domain.invalidDimensions')}</p>}
    </fieldset>
    <p className="text-sm leading-relaxed text-text-muted">{t('worldgen.domain.costHint')}</p>
    {!changed && bounds && <p className="text-sm text-text-muted">{t('worldgen.domain.noChange')}</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={`${control} border-accent-gold text-accent-gold`} disabled={busy || conflict || !changed} onClick={() => void apply()}>{t('worldgen.domain.apply')}</button>
      {conflict && <button type="button" className={control} disabled={busy} onClick={() => void readCurrent()}>{t('worldgen.domain.readCurrent')}</button>}
      <button type="button" className={control} disabled={busy && !jobId.current} onClick={() => {
        if (busy) cancelPreparation();
        else { token.current++; setDraft(undefined); setError(''); }
      }}>{t(busy && jobId.current ? 'worldgen.domain.cancelPreparation' : 'worldgen.domain.cancelResize')}</button>
    </div>
  </section>;
}
