// "Recorridos guiados": the list of tours with where the writer is in each.

import { Check, Compass, Play, RotateCcw } from 'lucide-react';
import Modal from '@/components/common/Modal';
import { useTranslation } from '@/i18n/useTranslation';
import { startTour } from './tourController';
import { fill, tourCopy } from './tourCopy';
import { tourStatus } from './tourProgress';
import { useTourStore } from './tourStore';
import { TOURS } from './tours';

export default function ToursPanel() {
  const { locale } = useTranslation();
  const words = tourCopy[locale];
  const open = useTourStore(state => state.panelOpen);
  const progress = useTourStore(state => state.progress);
  const close = () => useTourStore.getState().setPanelOpen(false);

  return (
    <Modal open={open} onClose={close} title={words.listTitle} wide>
      <div data-testid="tours-panel" className="space-y-4">
        <p className="text-sm text-text-muted">{words.listIntro}</p>
        <ul className="space-y-2">
          {TOURS.map(tour => {
            const { status, step } = tourStatus(progress, tour.id);
            return (
              <li
                key={tour.id}
                data-testid={`tour-row-${tour.id}`}
                data-status={status}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-elevated p-3"
              >
                <Compass size={18} className="shrink-0 text-accent-gold" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary">{tour.title[locale]}</p>
                  <p className="text-xs text-text-muted">{tour.summary[locale]}</p>
                  <p data-testid={`tour-status-${tour.id}`} className="mt-1 flex items-center gap-1 text-[11px] text-text-dim">
                    {status === 'done' && <Check size={12} className="text-accent-gold" aria-hidden="true" />}
                    {status === 'done'
                      ? words.done
                      : status === 'in-progress'
                        ? fill(words.inProgress, { step: step + 1, total: tour.steps.length })
                        : `${words.notStarted} · ${fill(words.steps, { count: tour.steps.length })}`}
                  </p>
                </div>
                {status === 'in-progress' && (
                  <button
                    type="button"
                    data-testid={`tour-resume-${tour.id}`}
                    onClick={() => { void startTour(tour.id, { resume: true }); }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-accent-gold px-3 py-1.5 text-sm font-semibold text-deep hover:brightness-110"
                  >
                    <Play size={14} aria-hidden="true" />{words.resume}
                  </button>
                )}
                {status === 'not-started' ? (
                  <button
                    type="button"
                    data-testid={`tour-start-${tour.id}`}
                    onClick={() => { void startTour(tour.id); }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-accent-gold px-3 py-1.5 text-sm font-semibold text-deep hover:brightness-110"
                  >
                    <Play size={14} aria-hidden="true" />{words.start}
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid={`tour-repeat-${tour.id}`}
                    onClick={() => { void startTour(tour.id); }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-surface"
                  >
                    <RotateCcw size={14} aria-hidden="true" />{words.repeat}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}
