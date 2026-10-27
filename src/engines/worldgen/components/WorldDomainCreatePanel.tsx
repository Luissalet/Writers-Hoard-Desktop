import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { DEFAULT_PARAMS } from '../core/types';
import { applyWorldPreset, WORLD_PRESETS } from '../core/presets';
import { planSheetSize } from '../core/worldDomain';
import { cancelWorldDomainOperation, createFiniteWorld, type WorldDomainScope } from '../worldDomain';

const control = 'min-h-10 rounded-lg border border-border bg-surface px-3 py-2 text-base text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50';

/** Draft-only until the finite-domain writer publishes one complete map. */
export default function WorldDomainCreatePanel({ scope, onCreated }: {
  scope: WorldDomainScope;
  onCreated: (worldId: string, isCurrent: () => boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [width, setWidth] = useState('600');
  const [height, setHeight] = useState('300');
  const [resolution, setResolution] = useState(2048);
  const [presetId, setPresetId] = useState('continents');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const operation = useRef<{ token: number; jobId?: string }>({ token: 0 });
  useEffect(() => () => {
    operation.current.token++;
    if (operation.current.jobId) cancelWorldDomainOperation(scope, operation.current.jobId);
  }, [scope]);

  let plan: ReturnType<typeof planSheetSize> | undefined;
  try { plan = planSheetSize(Number(width), Number(height), resolution); } catch { /* Keep incomplete drafts editable. */ }
  const cancel = () => {
    operation.current.token++;
    if (operation.current.jobId) cancelWorldDomainOperation(scope, operation.current.jobId);
    operation.current.jobId = undefined;
    setBusy(false); setError(''); setOpen(false);
  };
  const create = async () => {
    if (!plan || !title.trim() || operation.current.jobId) return;
    const token = ++operation.current.token;
    const jobId = crypto.randomUUID();
    operation.current.jobId = jobId;
    setBusy(true); setError(''); setProgress(0);
    try {
      const preset = WORLD_PRESETS.find(candidate => candidate.id === presetId)!;
      const params = applyWorldPreset({ ...DEFAULT_PARAMS, seed: crypto.randomUUID(), width: resolution }, preset);
      const result = await createFiniteWorld(scope, {
        title, params, sheetSize: { widthKm: Number(width), heightKm: Number(height), resolution }, jobId,
        onProgress: (_stage, value) => { if (operation.current.token === token) setProgress(value); },
      });
      if (operation.current.token === token) {
        await onCreated(result.world.id, () => operation.current.token === token);
        if (operation.current.token === token) setOpen(false);
      }
    } catch (reason) {
      if (operation.current.token === token) {
        const code = (reason as { code?: string })?.code;
        setError(t(code === 'canceled' ? 'worldgen.domain.createCanceled' : 'worldgen.domain.createError'));
      }
    } finally {
      if (operation.current.token === token) { operation.current.jobId = undefined; setBusy(false); }
    }
  };

  if (!open) return <button type="button" className={control} onClick={() => { setOpen(true); setError(''); }}>{t('worldgen.domain.createTitle')}</button>;
  const measures = plan ? [
    ['effectiveWidth', plan.widthKm], ['effectiveHeight', plan.heightKm], ['cell', plan.cellKm],
    ['gridWidth', plan.width], ['gridHeight', plan.height],
    ['sourceWidth', plan.sourceWidth], ['sourceHeight', plan.sourceHeight],
    // Fourteen base terrain arrays, 47 bytes/cell. This excludes renderer/solver overhead.
    ['memory', (plan.sourceWidth * plan.sourceHeight + plan.width * plan.height) * 47 / 1048576],
  ] as const : [];
  return <section aria-label={t('worldgen.domain.createTitle')} aria-busy={busy} className="space-y-4 rounded-lg border border-border bg-surface p-4">
    <h3 className="text-base font-semibold text-text-primary">{t('worldgen.domain.createTitle')}</h3>
    <p className="text-sm leading-relaxed text-text-muted">{t('worldgen.domain.createHint')}</p>
    <fieldset disabled={busy} className="min-w-0 space-y-4 disabled:opacity-60">
      <label htmlFor={`${id}-name`} className="block text-sm text-text-muted">{t('worldgen.domain.name')}
        <input id={`${id}-name`} value={title} onChange={event => setTitle(event.target.value)} className={`${control} mt-1 block w-full`} />
      </label>
      <div role="group" aria-label={t('worldgen.preset.title')} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {WORLD_PRESETS.map(preset => <button key={preset.id} type="button" aria-pressed={presetId === preset.id} onClick={() => setPresetId(preset.id)} className={`${control} text-left ${presetId === preset.id ? 'border-accent-gold text-accent-gold' : ''}`}>{t(`worldgen.preset.${preset.id}`)}</button>)}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label htmlFor={`${id}-width`} className="text-sm text-text-muted">{t('worldgen.domain.width')}
          <input id={`${id}-width`} type="number" min="0" step="any" value={width} onChange={event => setWidth(event.target.value)} className={`${control} mt-1 block w-full`} />
        </label>
        <label htmlFor={`${id}-height`} className="text-sm text-text-muted">{t('worldgen.domain.height')}
          <input id={`${id}-height`} type="number" min="0" step="any" value={height} onChange={event => setHeight(event.target.value)} className={`${control} mt-1 block w-full`} />
        </label>
      </div>
      <div role="group" aria-label={t('worldgen.params.resolution')} className="flex flex-wrap gap-2">
        {([['Fast', 1024], ['Standard', 2048], ['High', 3072]] as const).map(([name, value]) => <button key={value} type="button" aria-pressed={resolution === value} onClick={() => setResolution(value)} className={`${control} ${resolution === value ? 'border-accent-gold text-accent-gold' : ''}`}>{t(`worldgen.params.res${name}`)}</button>)}
      </div>
    </fieldset>
    {plan ? <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {measures.map(([key, value]) => <div key={key} className="min-w-0"><dt className="text-text-muted">{t(`worldgen.domain.${key}`)}</dt><dd className="break-words tabular-nums text-text-primary"><output aria-label={t(`worldgen.domain.${key}`)}>{value}</output></dd></div>)}
    </dl> : <p role="alert" className="text-sm text-danger">{t('worldgen.domain.invalidDimensions')}</p>}
    <p className="text-sm leading-relaxed text-text-muted">{t('worldgen.domain.costHint')}</p>
    {busy && <p role="status" className="text-sm text-text-primary">{t('worldgen.domain.creating')} {Math.round(Math.max(0, Math.min(1, progress)) * 100)}%</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={`${control} border-accent-gold text-accent-gold`} disabled={busy || !plan || !title.trim()} onClick={() => void create()}>{t('worldgen.domain.create')}</button>
      <button type="button" className={control} onClick={cancel}>{t('worldgen.domain.cancelCreation')}</button>
    </div>
  </section>;
}
