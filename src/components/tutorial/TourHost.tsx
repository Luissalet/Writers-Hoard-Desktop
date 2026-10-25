// Mounted once in MainLayout. Hands the router to the tour runner, loads the
// saved progress, listens for the tour's keys and shows the overlay, the list
// and (once, on a fresh install) the offer.

import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { db } from '@/db';
import { activeTourDefinition, backStep, closeTour, finishTour, installTourRouter, loadTourProgress, nextStep } from './tourController';
import TourOffer from './TourOffer';
import TourOverlay from './TourOverlay';
import ToursPanel from './ToursPanel';
import { useTourStore } from './tourStore';

/** Typing into a field must keep its arrow keys. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export default function TourHost() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const active = useTourStore(state => state.active);
  const progress = useTourStore(state => state.progress);
  const loaded = useTourStore(state => state.progressLoaded);
  const [hasWorlds, setHasWorlds] = useState<boolean | null>(null);

  useEffect(() => {
    installTourRouter({ navigate: path => navigate(path), pathname: () => pathname });
  }, [navigate, pathname]);

  useEffect(() => { void loadTourProgress(); }, []);

  // Only a fresh install gets the offer, so only a fresh install pays for the count.
  const offerPossible = loaded && !progress.offerAnswered && Object.keys(progress.tours).length === 0 && pathname === '/';
  useEffect(() => {
    if (!offerPossible) return;
    let cancelled = false;
    void db.projects.count().then(count => { if (!cancelled) setHasWorlds(count > 0); }).catch(() => { if (!cancelled) setHasWorlds(true); });
    return () => { cancelled = true; };
  }, [offerPossible]);

  const running = active !== null;
  useEffect(() => {
    if (!running) return;
    const onKey = (event: KeyboardEvent) => {
      const state = useTourStore.getState();
      const current = state.active;
      if (!current) return;
      const tour = activeTourDefinition(current);
      if (!tour) return;
      const swallow = () => { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); };
      if (event.key === 'Escape') { swallow(); closeTour(); return; }
      if (current.shown === 0 || state.resolving || isEditable(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'ArrowRight') { swallow(); void (current.index === tour.steps.length - 1 ? finishTour() : nextStep()); }
      else if (event.key === 'ArrowLeft') { swallow(); void backStep(); }
    };
    // Capture on window: the tool manager and other dialogs close on Escape,
    // and the first Escape belongs to the tour that is on top of them.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [running]);

  // Leaving the screen for good (the host unmounting) must not leave a tour running.
  useEffect(() => () => closeTour(), []);

  const showOffer = offerPossible && hasWorlds === false && !running;

  return (
    <>
      <TourOverlay />
      <ToursPanel />
      {showOffer && <TourOffer />}
    </>
  );
}
