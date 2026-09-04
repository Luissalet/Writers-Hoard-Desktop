// ============================================================================
// X/Y/Z plot — the cheapest teaching surface in the whole studio
// ============================================================================
//
// Pick up to three fields, give each a list of values, and the studio runs the
// product and lays the results out labelled. It is pure client orchestration
// over the same generate call, so it behaves identically on every backend, and
// one run of it teaches more about steps and CFG than any amount of prose.
//
// The matrix is shown BEFORE anything runs, with the number of pictures and the
// time that implies, because the difference between a 9-cell plot and a 64-cell
// plot on a laptop is the difference between a coffee and an afternoon.

import { useMemo, useState } from 'react';
import { Grid3x3 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import Modal from '@/components/common/Modal';
import {
  AXIS_FIELDS,
  AXIS_REQUIRES,
  XYZ_MAX_CELLS,
  buildXyzMatrix,
  parseAxisValues,
  xyzRequestedCells,
  type AxisField,
  type StudioCapabilities,
  type XyzAxis,
  type XyzCell,
} from '../studio';
import { FIELD_CLASS } from './ParameterField';

export interface XyzPlotDialogProps {
  open: boolean;
  onClose: () => void;
  capabilities: StudioCapabilities;
  onRun: (cells: XyzCell[]) => void;
  /** False when nothing can generate: the plot is still readable, not runnable. */
  canGenerate: boolean;
  generateReasonKey?: string;
}

interface AxisDraft {
  field: AxisField | '';
  raw: string;
}

const EMPTY: AxisDraft[] = [{ field: 'steps', raw: '' }, { field: '', raw: '' }, { field: '', raw: '' }];

export default function XyzPlotDialog({
  open, onClose, capabilities, onRun, canGenerate, generateReasonKey,
}: XyzPlotDialogProps) {
  const { t } = useTranslation();
  const [drafts, setDrafts] = useState<AxisDraft[]>(EMPTY);

  const axes: XyzAxis[] = useMemo(
    () => drafts
      .filter((draft): draft is { field: AxisField; raw: string } => draft.field !== '')
      .map((draft) => ({ field: draft.field, values: parseAxisValues(draft.field, draft.raw) })),
    [drafts],
  );
  const cells = useMemo(() => buildXyzMatrix(axes), [axes]);
  const requested = xyzRequestedCells(axes);
  const capped = requested > XYZ_MAX_CELLS;

  const setDraft = (index: number, changes: Partial<AxisDraft>) => {
    setDrafts((current) => current.map((draft, at) => (at === index ? { ...draft, ...changes } : draft)));
  };

  return (
    <Modal open={open} onClose={onClose} title={t('imageStudio.xyz.title')} wide>
      <div className="space-y-3">
        <p className="text-[11px] text-text-muted">{t('imageStudio.xyz.intro')}</p>

        {drafts.map((draft, index) => (
          <div key={index} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 items-start">
            <select
              value={draft.field}
              aria-label={t(`imageStudio.xyz.axis.${index}`)}
              onChange={(event) => setDraft(index, { field: event.target.value as AxisField | '' })}
              className={FIELD_CLASS}
            >
              <option value="">{t('imageStudio.xyz.axisNone')}</option>
              {AXIS_FIELDS.map((field) => {
                const state = capabilities[AXIS_REQUIRES[field]];
                return (
                  <option
                    key={field}
                    value={field}
                    disabled={!state.enabled}
                    title={state.enabled ? undefined : t(state.reasonKey ?? 'visualRef.reason.unavailable')}
                  >
                    {t(`imageStudio.xyz.field.${field}`)}
                    {state.enabled ? '' : ` — ${t(state.reasonKey ?? 'visualRef.reason.unavailable')}`}
                  </option>
                );
              })}
            </select>
            <div>
              <input
                value={draft.raw}
                disabled={draft.field === ''}
                placeholder={t('imageStudio.xyz.valuesPlaceholder')}
                onChange={(event) => setDraft(index, { raw: event.target.value })}
                className={FIELD_CLASS}
              />
              {draft.field !== '' && (
                <p className="mt-1 text-[10px] text-text-dim font-mono">
                  {parseAxisValues(draft.field, draft.raw).join(' · ') || '—'}
                </p>
              )}
            </div>
          </div>
        ))}

        <div className="rounded-lg border border-border bg-elevated px-3 py-2 space-y-1">
          <p className="text-[11px] text-text-primary">
            {t('imageStudio.xyz.count').replace('{count}', String(cells.length))}
          </p>
          {capped && (
            <p className="text-[10px] text-accent-amber">
              {t('imageStudio.xyz.capped')
                .replace('{requested}', String(requested))
                .replace('{max}', String(XYZ_MAX_CELLS))}
            </p>
          )}
          {cells.length > 0 && (
            <p className="text-[10px] text-text-dim font-mono break-words">
              {cells.slice(0, 6).map((cell) => cell.coords.map((coord) => `${coord.field} ${coord.value}`).join(' · ')).join('  |  ')}
              {cells.length > 6 ? ' …' : ''}
            </p>
          )}
        </div>

        {!canGenerate && generateReasonKey && (
          <p className="text-[10px] text-accent-amber">{t(generateReasonKey)}</p>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-lg border border-border text-text-muted hover:text-text-primary transition"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={!canGenerate || cells.length === 0}
            title={canGenerate ? t('imageStudio.xyz.run') : t(generateReasonKey ?? 'visualRef.reason.unavailable')}
            aria-label={canGenerate ? t('imageStudio.xyz.run') : t(generateReasonKey ?? 'visualRef.reason.unavailable')}
            onClick={() => { onRun(cells); onClose(); }}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-gold text-deep text-xs font-semibold hover:bg-accent-amber transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Grid3x3 size={12} />
            {t('imageStudio.xyz.run')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
