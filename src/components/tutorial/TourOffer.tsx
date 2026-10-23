// The one-time offer on a fresh install: dismissible, and remembered.

import { Compass, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { answerTourOffer, startTour } from './tourController';
import { tourCopy } from './tourCopy';

export default function TourOffer() {
  const { locale } = useTranslation();
  const words = tourCopy[locale];
  return (
    <section
      data-testid="tour-offer"
      aria-label={words.offerTitle}
      className="fixed bottom-4 left-4 z-[70] w-[min(320px,calc(100vw-2rem))] rounded-xl border border-accent-gold/40 bg-surface p-4 shadow-2xl"
    >
      <button
        type="button"
        data-testid="tour-offer-dismiss"
        onClick={() => { void answerTourOffer(); }}
        aria-label={words.close}
        title={words.close}
        className="absolute right-2 top-2 rounded-md p-1 text-text-dim hover:bg-elevated hover:text-text-primary"
      >
        <X size={14} aria-hidden="true" />
      </button>
      <p className="flex items-center gap-2 pr-6 font-serif text-sm font-semibold text-text-primary">
        <Compass size={16} className="text-accent-gold" aria-hidden="true" />{words.offerTitle}
      </p>
      <p className="mt-1 text-xs text-text-muted">{words.offerText}</p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          data-testid="tour-offer-yes"
          onClick={() => { void answerTourOffer(); void startTour('first-world'); }}
          className="rounded-lg bg-accent-gold px-3 py-1.5 text-sm font-semibold text-deep hover:brightness-110"
        >
          {words.offerYes}
        </button>
        <button
          type="button"
          data-testid="tour-offer-no"
          onClick={() => { void answerTourOffer(); }}
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-elevated"
        >
          {words.offerNo}
        </button>
      </div>
    </section>
  );
}
