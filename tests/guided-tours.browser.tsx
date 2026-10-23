// Guided tours (D2 gap 7), against the REAL application: the real shell
// (MainLayout, Dashboard, ProjectDetail under a hash router, as in the desktop shell) is
// mounted with seeded worlds, and every
// tour is walked step by step through the real controller, so each `data-tour`
// anchor is proven to exist in the mounted UI where its tour expects it.
//
//   /tmp/claude-0/eb/ftw.sh <worktree> tests/guided-tours.browser.tsx testGuidedTours
import { createRoot, type Root } from 'react-dom/client';
import { HashRouter, Route, Routes } from 'react-router-dom';
import '@/engines';
import MainLayout from '@/components/layout/MainLayout';
import Dashboard from '@/pages/Dashboard';
import ProjectDetail from '@/pages/ProjectDetail';
import { db } from '@/db';
import { getSetting } from '@/db/operations';
import { useLocaleStore } from '@/stores/localeStore';
import { useAppStore } from '@/stores/appStore';
import { useCopilotStore } from '@/stores/copilotStore';
import { TOURS } from '@/components/tutorial/tours';
import { TOUR_PROGRESS_KEY, parseProgress, withDone, withStep, emptyProgress } from '@/components/tutorial/tourProgress';
import { dimStrips, placePopover, spotlightBox } from '@/components/tutorial/tourGeometry';
import { backStep, closeTour, findAnchor, loadTourProgress, nextStep, startTour, finishTour } from '@/components/tutorial/tourController';
import { useTourStore } from '@/components/tutorial/tourStore';
import type { TourDefinition } from '@/components/tutorial/tourTypes';
import type { Project } from '@/types';

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(check: () => boolean | Promise<boolean>, label: string, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(40); }
  throw new Error(`Timed out: ${label}\n${document.body.innerText.slice(-1500)}`);
}
const q = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);
const byId = (id: string) => q(`[data-testid="${id}"]`);
const click = async (element: Element | null, label: string) => {
  assert(element, `Missing: ${label}`);
  // A tour button is disabled while its step is being found; a writer's click waits for it too.
  if (element instanceof HTMLButtonElement) await until(() => !element.disabled, `${label} enabled`, 5000);
  (element as HTMLElement).click(); await delay(120);
};
const key = (name: string, target: EventTarget = document.body) => target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
const shownTitle = () => byId('tour-title')?.textContent ?? '';
const shownIndex = () => useTourStore.getState().active?.index ?? -1;
const hashTo = async (hash: string) => { window.location.hash = hash; await delay(150); };

// App.tsx itself cannot be bundled by the focused runner (the publishing
// engine imports an .html file with `?raw`), so the route table is repeated
// here for the three routes the tours use. Every component in it is the real one.
function TestApp() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/project/:id" element={<ProjectDetail />} />
          <Route path="/project/:id/:tab" element={<ProjectDetail />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

const P = 'tours-world', E = 'tours-essentials', W = 'tours-chapter';

export async function testGuidedTours(): Promise<string[]> {
  const passed: string[] = [];
  // The shell updates itself asynchronously (live queries, timers); there is no act() to wrap that in.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  let root: Root | undefined;
  const mount = async (hash: string) => {
    root?.unmount();
    window.location.hash = hash;
    root = createRoot(document.getElementById('root')!);
    root.render(<TestApp />);
    await until(() => !!q('[data-tour="sidebar"]'), 'application mounted');
  };
  try {
    useCopilotStore.setState({ dockOpen: false });
    await useLocaleStore.getState().setLocale('es');

    // ---- Pure data and geometry ------------------------------------------
    assert(TOURS.length >= 8 && TOURS.length <= 10, `About 8 tours, got ${TOURS.length}`);
    const wanted = ['first-world', 'first-card', 'first-map', 'timeline', 'board', 'enable-tools', 'wiki-edition', 'backups'];
    for (const id of wanted) assert(TOURS.some(tour => tour.id === id), `Tour ${id} is defined`);
    assert(new Set(TOURS.map(tour => tour.id)).size === TOURS.length, 'Tour ids are unique');
    for (const tour of TOURS) {
      assert(tour.steps.length >= 3 && tour.steps.length <= 7, `${tour.id}: 3-7 steps, got ${tour.steps.length}`);
      assert(new Set(tour.steps.map(step => step.id)).size === tour.steps.length, `${tour.id}: step ids are unique`);
      for (const text of [tour.title, tour.summary, ...tour.steps.flatMap(step => [step.title, step.text])]) {
        assert(text.es.trim().length > 1 && text.en.trim().length > 1, `${tour.id}: both languages have copy`);
        assert(text.es !== text.en || text.es.length < 12, `${tour.id}: Spanish and English copy are not the same string ("${text.es}")`);
      }
    }
    passed.push(`Data: ${TOURS.length} tours, each with 3-7 steps, unique ids and Spanish and English copy`);

    const view = { width: 1000, height: 700 };
    const hole = spotlightBox({ left: 100, top: 50, width: 200, height: 40 }, view);
    assert(hole.left === 94 && hole.top === 44 && hole.width === 212 && hole.height === 52, `Hole is padded: ${JSON.stringify(hole)}`);
    const strips = dimStrips(hole, view);
    const area = strips.reduce((sum, strip) => sum + strip.width * strip.height, 0) + hole.width * hole.height;
    assert(area === view.width * view.height, 'Dim strips plus the hole tile the viewport exactly');
    const below = placePopover(hole, { width: 340, height: 180 }, view);
    assert(below.side === 'bottom' && below.left >= 12 && below.left + 340 <= 988, 'Popover goes below and stays inside');
    const low = placePopover({ left: 100, top: 600, width: 100, height: 40 }, { width: 340, height: 180 }, view);
    assert(low.side === 'top', 'Popover flips above near the bottom');
    assert(placePopover(null, { width: 340, height: 180 }, view).side === 'center', 'No target = centred');
    const record = withStep(emptyProgress(), 'x', 0, 1);
    assert(!record.tours.x, 'Showing the first step of an unstarted tour records nothing');
    assert(withStep(emptyProgress(), 'x', 2, 1).tours.x.status === 'in-progress', 'Reaching step 2 is in progress');
    assert(withStep(withDone(emptyProgress(), 'x', 1), 'x', 1, 2).tours.x.status === 'done', 'A repeated tour stays done');
    assert(Object.keys(parseProgress('{"version":1,"tours":{"a":{"status":"weird"},"b":null}}').tours).length === 0 && parseProgress('not json').offerAnswered === undefined, 'Damaged progress reads as empty');
    passed.push('Geometry and progress rules: padded hole, strips tile the screen, popover below/above/centred, repeats keep "done", damaged rows read as empty');

    // ---- Fresh install: the offer, answered once and remembered -----------
    await db.settings.where('key').equals(TOUR_PROGRESS_KEY).delete();
    await mount('#/');
    await until(() => !!byId('tour-offer'), 'one-time offer on a fresh install');
    await click(byId('tour-offer-dismiss'), 'dismiss the offer');
    await until(() => !byId('tour-offer'), 'offer gone');
    assert(parseProgress(await getSetting(TOUR_PROGRESS_KEY)).offerAnswered === true, 'The answer is stored');
    await mount('#/');
    await delay(500);
    assert(!byId('tour-offer'), 'The offer does not come back after a restart');
    passed.push('Fresh install: the offer appears once, dismissing it is stored and it stays away after a remount');

    // ---- No world yet: steps that need one are skipped, nothing crashes ----
    await click(byId('topbar-tours'), 'open the tours list from the top bar');
    await until(() => !!byId('tours-panel'), 'list open');
    assert(TOURS.every(tour => byId(`tour-row-${tour.id}`)?.getAttribute('data-status') === 'not-started'), 'Every tour starts as not started');
    assert(/Recorridos guiados/.test(q('[role="dialog"]')?.textContent ?? ''), 'List is in Spanish');
    await click(byId('tour-start-first-world'), 'start the first-world tour');
    await until(() => shownTitle() === 'Crea un mundo', 'first step shown');
    assert(!byId('tours-panel'), 'Starting closes the list');
    assert(byId('tour-step-counter')?.textContent?.startsWith('Paso 1 de 6'), `Counter: ${byId('tour-step-counter')?.textContent}`);
    await until(() => !!byId('tour-spotlight'), 'spotlight drawn');
    const aim = findAnchor('dashboard-new-project')!.getBoundingClientRect(), ring = byId('tour-spotlight')!.getBoundingClientRect();
    assert(Math.abs(ring.left - (aim.left - 6)) <= 1 && Math.abs(ring.width - (aim.width + 12)) <= 1, `Spotlight hugs its target: ${JSON.stringify([ring.left, aim.left])}`);
    assert(byId('tour-spotlight')?.getAttribute('data-tour-target') === 'dashboard-new-project', 'Spotlight names its target');
    passed.push('Start from the top-bar list: the first step spotlights "dashboard-new-project" with a counter "Paso 1 de 6"');

    // Follow the element: move it, and the ring follows.
    const mover = findAnchor('dashboard-new-project')!;
    mover.style.position = 'relative'; mover.style.left = '37px';
    await until(() => Math.abs(byId('tour-spotlight')!.getBoundingClientRect().left - (mover.getBoundingClientRect().left - 6)) <= 1, 'spotlight follows the moved element');
    mover.style.left = '0px';
    window.dispatchEvent(new Event('resize'));
    await until(() => Math.abs(byId('tour-spotlight')!.getBoundingClientRect().left - (mover.getBoundingClientRect().left - 6)) <= 1, 'spotlight follows back');
    passed.push('The spotlight follows its element when the layout moves and on resize');

    // Next / Back / arrows / Esc.
    await click(byId('tour-next'), 'next');
    await until(() => shownTitle() === 'La barra lateral', 'step 2');
    await click(byId('tour-back'), 'back');
    await until(() => shownTitle() === 'Crea un mundo', 'back to step 1');
    assert((byId('tour-back') as HTMLButtonElement).disabled, 'Atrás is disabled on the first step');
    key('ArrowRight');
    await until(() => shownTitle() === 'La barra lateral', 'ArrowRight moves on');
    key('ArrowLeft');
    await until(() => shownTitle() === 'Crea un mundo', 'ArrowLeft moves back');
    key('ArrowRight');
    await until(() => shownTitle() === 'La barra lateral', 'ArrowRight to step 2 again');
    key('ArrowRight');
    await until(() => shownTitle() === 'Captura una idea', 'two arrows');
    passed.push('Siguiente / Atrás and the arrow keys move between steps; Atrás is disabled on the first');

    // Steps that need a world are skipped when there is none (4 shown, 2 skipped), then the tour finishes.
    await click(byId('tour-next'), 'to search');
    await until(() => shownTitle() === 'Busca en todo', 'search step');
    await click(byId('tour-next'), 'past the world-only steps');
    await until(() => !byId('tour-overlay'), 'tour ended after skipping the steps that need a world', 20000);
    let progress = parseProgress(await getSetting(TOUR_PROGRESS_KEY));
    assert(progress.tours['first-world']?.status === 'done', 'Running off the end of a tour that showed steps marks it done');
    passed.push('No world open: the two steps that need one were skipped without a crash and the tour finished as done');

    // ---- Seed worlds, then walk EVERY tour through the real UI ------------
    const now = Date.now();
    const engines = ['writings', 'codex', 'maps', 'timeline', 'board', 'notes'];
    await db.projects.put({ id: P, title: 'Mundo de recorridos', description: 'x', mode: 'custom', type: 'standalone', color: '#aa7733', status: 'draft', enabledEngines: engines, engineOrder: engines, createdAt: now, updatedAt: now + 10 } as Project);
    await db.projects.put({ id: E, title: 'Mundo esencial', description: '', mode: 'essentials', type: 'standalone', color: '#3377aa', status: 'draft', enabledEngines: ['writings', 'codex'], engineOrder: ['writings', 'codex'], createdAt: now, updatedAt: now } as Project);
    await db.writings.put({ id: W, projectId: P, title: 'El puerto', content: '<p>Texto.</p>', wordCount: 1, status: 'draft', tags: [], chapter: 1, order: 0, createdAt: now, updatedAt: now } as never);
    await hashTo('#/');
    await until(() => !!q('[data-tour="dashboard-backup-full"]'), 'dashboard with worlds');

    const walked: Record<string, string[]> = {};
    for (const tour of TOURS) {
      await hashTo('#/');
      await until(() => !!q('[data-tour="dashboard-new-project"]'), `dashboard before ${tour.id}`);
      await startTour(tour.id);
      const seen: string[] = [];
      for (let guard = 0; guard < 12; guard++) {
        const active = useTourStore.getState().active;
        if (!active) break;
        const step = tour.steps[active.index];
        seen.push(step.id);
        if (step.anchor) {
          const target = findAnchor(step.anchor);
          assert(target, `${tour.id}/${step.id}: anchor "${step.anchor}" is on screen in the mounted app`);
          await until(() => byId('tour-spotlight')?.getAttribute('data-tour-target') === step.anchor, `${tour.id}/${step.id}: spotlight on "${step.anchor}"`);
        }
        assert(byId('tour-title')?.textContent === step.title.es, `${tour.id}/${step.id}: shows its Spanish title`);
        if (active.index === tour.steps.length - 1) { await finishTour(); break; }
        await nextStep();
      }
      assert(!useTourStore.getState().active, `${tour.id}: ended`);
      walked[tour.id] = seen;
    }
    // Every step of every tour was shown, except the ones that need something the seed does not have.
    const expectedSkips: Record<string, string[]> = { 'first-chapter': ['editor'] };
    for (const tour of TOURS) {
      const missing = tour.steps.map(step => step.id).filter(id => !walked[tour.id].includes(id));
      const allowed = expectedSkips[tour.id] ?? [];
      assert(missing.join() === allowed.join(), `${tour.id}: steps not shown = [${missing}] (allowed [${allowed}])`);
    }
    progress = parseProgress(await getSetting(TOUR_PROGRESS_KEY));
    assert(TOURS.every(tour => progress.tours[tour.id]?.status === 'done'), 'All tours finished as done');
    passed.push(`Anchors: all ${TOURS.length} tours walked in the mounted app (navigating to Códice, Mapas, Cronología, Tablero, Manuscrito; opening the tool manager and the wiki drop-down); every step's anchor was on screen — ${TOURS.reduce((sum, tour) => sum + walked[tour.id].length, 0)} of ${TOURS.reduce((sum, tour) => sum + tour.steps.length, 0)} steps shown, the only skip being the editor step with no chapter open`);

    await hashTo(`#/project/${P}/writings?writing=${W}`);
    await until(() => !!findAnchor('editor-surface'), 'editor-surface with a chapter open');
    passed.push('Anchor "editor-surface" exists on the manuscript editor with a chapter open');
    assert(!useAppStore.getState().showEngineManager, 'The tool manager was left closed by the tours');

    // ---- Progress shown in the list, resume, repeat ------------------------
    await hashTo('#/');
    await until(() => !!byId('topbar-tours'), 'top bar');
    await click(byId('topbar-tours'), 'open list');
    await until(() => byId('tour-row-board')?.getAttribute('data-status') === 'done', 'list shows done');
    assert(/Hecho/.test(byId('tour-status-board')?.textContent ?? ''), 'Done label');
    assert(!!byId('tour-repeat-board') && !byId('tour-start-board'), 'A done tour offers Repetir, not Empezar');
    await click(byId('tour-repeat-first-card'), 'repeat first-card');
    await until(() => shownTitle() === 'El Códice', 'repeat starts from the first step');
    assert(shownIndex() === 0, 'Repeat begins at step 1');
    assert(window.location.hash.includes(`/project/${P}/codex`), `The tour went to the Codex: ${window.location.hash}`);
    await click(byId('tour-next'), 'next');
    await until(() => shownTitle() === 'Fichas o grafo', 'second step');
    key('Escape');
    await until(() => !byId('tour-overlay'), 'Escape closes the tour');
    progress = parseProgress(await getSetting(TOUR_PROGRESS_KEY));
    assert(progress.tours['first-card'].status === 'done', 'Closing a repeat keeps "done"');
    passed.push('Repeat on a finished tour restarts from step 1 (navigating to the Códice); Esc closes it; "done" stays done');

    // In-progress: a tour not yet done. Remove the record, go 2 steps in, Esc, then Continuar.
    const record2 = parseProgress(await getSetting(TOUR_PROGRESS_KEY));
    delete record2.tours['first-map'];
    await db.settings.put({ id: 'set_' + TOUR_PROGRESS_KEY, key: TOUR_PROGRESS_KEY, value: JSON.stringify(record2) });
    await useTourStore.getState().setProgress(record2);
    await startTour('first-map');
    await until(() => shownTitle() === 'Mapas', 'maps step 1');
    await click(byId('tour-next'), 'maps next');
    await until(() => shownTitle() === 'El lienzo', 'maps step 2');
    key('Escape');
    await until(() => !byId('tour-overlay'), 'closed with Esc');
    progress = parseProgress(await getSetting(TOUR_PROGRESS_KEY));
    assert(progress.tours['first-map']?.status === 'in-progress' && progress.tours['first-map'].step === 1, `Saved in progress at step index 1: ${JSON.stringify(progress.tours['first-map'])}`);
    await click(byId('topbar-tours'), 'open list');
    await until(() => byId('tour-row-first-map')?.getAttribute('data-status') === 'in-progress', 'list shows in progress');
    assert(/Paso 2 de 3/.test(byId('tour-status-first-map')?.textContent ?? ''), `In-progress label: ${byId('tour-status-first-map')?.textContent}`);
    assert(!!byId('tour-resume-first-map') && !!byId('tour-repeat-first-map'), 'In progress offers Continuar and Repetir');
    await click(byId('tour-resume-first-map'), 'resume');
    await until(() => shownTitle() === 'El lienzo', 'resume lands on the saved step');
    await click(byId('tour-skip'), 'Saltar');
    await until(() => !byId('tour-overlay'), 'Saltar closes');
    passed.push('Closing mid-tour saves "Paso 2 de 3"; the list shows In progress with Continuar + Repetir; Continuar resumes there; Saltar closes');

    // ---- Missing anchors are skipped ---------------------------------------
    const ghost: TourDefinition = {
      id: 'zz-ghost', needsProject: false,
      title: { es: 'Fantasma', en: 'Ghost' }, summary: { es: 'x', en: 'x' },
      steps: [
        { id: 'a', anchor: 'does-not-exist', title: { es: 'No está', en: 'Gone' }, text: { es: 'x', en: 'x' } },
        { id: 'b', anchor: 'sidebar', title: { es: 'Sí está', en: 'Here' }, text: { es: 'x', en: 'x' } },
        { id: 'c', anchor: 'also-gone', title: { es: 'Tampoco', en: 'Nope' }, text: { es: 'x', en: 'x' } },
        { id: 'd', title: { es: 'Final', en: 'End' }, text: { es: 'x', en: 'x' } },
      ],
    };
    (TOURS as TourDefinition[]).push(ghost);
    try {
      await startTour('zz-ghost');
      await until(() => shownTitle() === 'Sí está', 'a missing first anchor is skipped', 8000);
      assert(shownIndex() === 1, 'Landed on the second step');
      await nextStep();
      await until(() => shownTitle() === 'Final', 'a missing middle anchor is skipped');
      await backStep();
      await until(() => shownTitle() === 'Sí está', 'going back skips the missing one too');
      closeTour();
      // Forget the first run so only the second one is measured.
      await db.settings.where('key').equals(TOUR_PROGRESS_KEY).delete();
      await loadTourProgress();
      ghost.steps = [{ id: 'x', anchor: 'nope-1', title: { es: 'x', en: 'x' }, text: { es: 'x', en: 'x' } }, { id: 'y', anchor: 'nope-2', title: { es: 'x', en: 'x' }, text: { es: 'x', en: 'x' } }];
      await startTour('zz-ghost');
      await until(() => !useTourStore.getState().active && !useTourStore.getState().resolving, 'a tour with nothing to show gives up', 8000);
      assert(!parseProgress(await getSetting(TOUR_PROGRESS_KEY)).tours['zz-ghost'], 'A tour that showed nothing leaves no progress');
      assert(!byId('tour-overlay'), 'No overlay left behind');
    } finally {
      (TOURS as TourDefinition[]).splice((TOURS as TourDefinition[]).indexOf(ghost), 1);
    }
    passed.push('Missing anchors: skipped going forward and back with no crash; a tour with nothing to show closes and records no progress');

    // ---- Esc belongs to the tour when a dialog is open under it -------------
    await startTour('enable-tools');
    await until(() => shownTitle() === 'Gestionar herramientas', 'enable-tools step 1');
    await click(byId('tour-next'), 'open manager step');
    await until(() => shownTitle() === 'Un punto de partida' && !!q('[role="dialog"][aria-modal="true"]'), 'manager open under the tour');
    key('Escape');
    await until(() => !byId('tour-overlay'), 'Esc closes the tour');
    await until(() => !q('[role="dialog"][aria-modal="true"]') && !useAppStore.getState().showEngineManager, 'the manager the tour opened is closed with it');
    passed.push('Tool-manager tour: the manager opens for its step and closes with the tour; Esc closes the tour first');

    // ---- English ------------------------------------------------------------
    await useLocaleStore.getState().setLocale('en');
    await hashTo('#/');
    await until(() => !!byId('topbar-tours'), 'top bar');
    await click(byId('topbar-tours'), 'open list (English)');
    await until(() => /Guided tours/.test(q('[role="dialog"]')?.textContent ?? ''), 'English list');
    assert(/Your first card/.test(byId('tour-row-first-card')?.textContent ?? '') && /Start/.test(byId('tour-start-first-card')?.textContent ?? '') && /Not started/.test(byId('tour-status-first-card')?.textContent ?? ''), `English rows and buttons: ${byId('tour-row-first-card')?.textContent} / ${byId('tour-start-first-card')?.textContent}`);
    await click(byId('tour-start-first-card'), 'start in English');
    await until(() => shownTitle() === 'The Codex', 'English step title');
    assert(byId('tour-step-counter')?.textContent?.startsWith('Step 1 of 4'), `English counter: ${byId('tour-step-counter')?.textContent}`);
    assert(byId('tour-next')?.textContent === 'Next' && byId('tour-skip')?.textContent === 'Skip' && byId('tour-back')?.textContent === 'Back', 'English buttons');
    closeTour();
    await useLocaleStore.getState().setLocale('es');
    passed.push('English: list, tour title, counter and Next/Back/Skip are translated, and switching language back works');

    // ---- The checklist links to the tours ----------------------------------
    await hashTo(`#/project/${E}/writings`);
    await until(() => !!byId('checklist-tours-link'), 'getting-started checklist with the tours link', 20000);
    assert(/Ver los recorridos guiados/.test(byId('checklist-tours-link')?.textContent ?? ''), 'Link text');
    await click(byId('checklist-tours-link'), 'checklist link');
    await until(() => !!byId('tours-panel'), 'list opens from the checklist');
    assert(!!q('.border-accent-gold\\/40'), 'Existing checklist card is still there');
    useTourStore.getState().setPanelOpen(false);
    passed.push('GettingStartedChecklist still renders and links to the tours list');
  } finally {
    closeTour();
    useTourStore.getState().setPanelOpen(false);
    root?.unmount();
    await db.writings.where('projectId').equals(P).delete();
    await db.projects.bulkDelete([P, E]);
    await db.settings.where('key').equals(TOUR_PROGRESS_KEY).delete();
    window.location.hash = '#/';
  }
  return passed;
}
