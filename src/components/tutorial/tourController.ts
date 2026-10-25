// The tour runner: starts a tour, finds each step's element (going to the right
// page first), skips a step whose element is not there, and records progress.
// Plain TypeScript around the store so it can be driven without React.

import { db } from '@/db';
import { toast } from '@/components/common/toast';
import { useAppStore } from '@/stores/appStore';
import { useLocaleStore } from '@/stores/localeStore';
import { findTour } from './tours';
import { tourCopy } from './tourCopy';
import { useTourStore, type ActiveTour } from './tourStore';
import {
  readTourProgress,
  tourStatus,
  updateTourProgress,
  withDone,
  withOfferAnswered,
  withStep,
} from './tourProgress';
import { usableRect } from './tourGeometry';
import type { TourBinding, TourDefinition, TourRoute, TourStep } from './tourTypes';

// ----- The app's router, handed in by the host -------------------------------

let navigateTo: (path: string) => void = () => undefined;
let readPathname: () => string = () => (typeof window === 'undefined' ? '/' : window.location.pathname);

export function installTourRouter(router: { navigate: (path: string) => void; pathname: () => string }): void {
  navigateTo = router.navigate;
  readPathname = router.pathname;
}

// ----- DOM lookups -----------------------------------------------------------

/** Quote a value for an attribute selector. */
function attr(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

/** The first on-screen element carrying the anchor (a split workspace can hold two). */
export function findAnchor(name: string, root: ParentNode = document): HTMLElement | null {
  for (const element of root.querySelectorAll<HTMLElement>(`[data-tour="${attr(name)}"]`)) {
    if (element.getClientRects().length === 0) continue;
    if (getComputedStyle(element).visibility === 'hidden') continue;
    return element;
  }
  return null;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// ----- Run state -------------------------------------------------------------

/** Bumped by every start/move/close; an older, still-waiting resolution drops out. */
let generation = 0;
let disarm: (()=>void) | undefined;
let armedEvent:{run:number;binding:TourBinding;index:number;name:string}|undefined;
export function activeTourDefinition(active:ActiveTour|null):TourDefinition|undefined{return active?.binding?active.binding.definition():active?findTour(active.tourId):undefined;}
export function activeTourRoot(active:ActiveTour|null):ParentNode{return active?.binding?.root??document;}
function current(run:number,binding?:TourBinding):boolean{return run===generation&&(!binding||binding.isCurrent()&&binding.root.isConnected);}
export function manualTourStep(active:ActiveTour|null):boolean{const step=activeTourDefinition(active)?.steps[active?.index??0];return !step?.advanceOn||step.advanceOn.type==='manual';}
function clearCondition():void{disarm?.();disarm=undefined;armedEvent=undefined;}
function armCondition(run:number,binding:TourBinding|undefined,step:TourStep):void{
 clearCondition();if(!binding||!step.advanceOn)return;
 if(step.advanceOn.type==='event'){armedEvent={run,binding,index:useTourStore.getState().active!.index,name:step.advanceOn.name};return;}
 if(step.advanceOn.type!=='element-appears')return;
 const target=step.advanceOn.target;let fired=false;
 const check=()=>{if(!fired&&current(run,binding)&&findAnchor(target,binding.root)){fired=true;void advanceCondition(run,binding);}};
 const observer=new MutationObserver(check);observer.observe(binding.root,{childList:true,subtree:true,attributes:true});
 const tick=window.setInterval(check,60);disarm=()=>{observer.disconnect();window.clearInterval(tick);};check();
}
async function advanceCondition(run:number,binding:TourBinding):Promise<void>{if(!current(run,binding))return;const active=useTourStore.getState().active;if(active?.binding!==binding)return;const tour=activeTourDefinition(active);if(tour)await showFrom(tour,active.index+1,1,binding);}
export function signalBoundTour(binding:TourBinding,name:string):void{const armed=armedEvent,active=useTourStore.getState().active;if(armed&&armed.binding===binding&&armed.name===name&&active?.binding===binding&&active.index===armed.index&&current(armed.run,binding)){armedEvent=undefined;void advanceCondition(armed.run,binding);}}
export async function startBoundTour(binding:TourBinding,options:{resume?:boolean}={}):Promise<boolean>{
 if(!binding.isCurrent()||!binding.root.isConnected)return false;
 const tour=binding.definition(),store=useTourStore.getState(),saved=tourStatus(store.progress,binding.progressKey),index=options.resume&&saved.status==='in-progress'?Math.min(saved.step,tour.steps.length-1):0;
 clearCondition();store.setActive({tourId:tour.id,index,shown:0,binding});await showFrom(tour,index,1,binding);
 const active=useTourStore.getState().active;return active?.binding===binding&&active.shown>0&&binding.isCurrent();
}
type SkipReason = 'no-project' | 'tool-off' | 'missing';
let skipped = new Set<SkipReason>();

const copy = () => tourCopy[useLocaleStore.getState().locale];

function projectInPath(pathname: string): string | undefined {
  const match = /^\/project\/([^/]+)/.exec(pathname);
  if (!match) return undefined;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

async function latestProjectId(): Promise<string | undefined> {
  const latest = await db.projects.orderBy('updatedAt').reverse().first();
  return latest?.id;
}

export function routePath(route: TourRoute, projectId: string | undefined): string | null {
  if (route === 'home') return '/';
  if (route === 'publishing') return '/publishing';
  if (!projectId) return null;
  const base = `/project/${encodeURIComponent(projectId)}`;
  return route === 'overview' ? `${base}/overview` : `${base}/${route.slice('engine:'.length)}`;
}

async function waitForAnchor(name: string, timeoutMs: number, run: number, binding?:TourBinding): Promise<HTMLElement | null> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (!current(run,binding)) return null;
    const found = findAnchor(name,binding?.root??document);
    if (found) return found;
    if (Date.now() >= end) return null;
    await sleep(60);
  }
}

type Outcome = { ok: true } | { ok: false; reason: SkipReason };

/** Bring the app to the state the step needs. Resolves `ok` only when its element is on screen. */
async function prepare(step: TourStep, run: number,binding?:TourBinding): Promise<Outcome> {
  let patient = false;
  if (step.route) {
    const open = projectInPath(readPathname());
    const projectId = open ?? (step.route.startsWith('engine:') || step.route === 'overview' ? await latestProjectId() : undefined);
    const target = routePath(step.route, projectId);
    if (!target) return { ok: false, reason: 'no-project' };
    if (step.route.startsWith('engine:') && projectId) {
      const project = await db.projects.get(projectId);
      if (!project) return { ok: false, reason: 'no-project' };
      if (!project.enabledEngines.includes(step.route.slice('engine:'.length))) return { ok: false, reason: 'tool-off' };
    }
    if (!current(run,binding)) return { ok: false, reason: 'missing' };
    if (readPathname() !== target) { navigateTo(target); patient = true; }
  }
  if (step.toolManager !== undefined) {
    // The manager lives inside a world's page; give a navigation a moment first.
    if (patient) await sleep(150);
    useAppStore.getState().setShowEngineManager(step.toolManager);
    patient = patient || step.toolManager;
  }
  if (step.openDetails) {
    const summary = await waitForAnchor(step.openDetails, patient ? 3000 : 1000, run,binding);
    const details = summary?.closest('details');
    if (details && !details.open) details.open = true;
    patient = true;
  }
  if (!step.anchor) return { ok: true };
  const found = await waitForAnchor(step.anchor, patient ? 3000 : 800, run,binding);
  if (!current(run,binding)) return { ok: false, reason: 'missing' };
  if (!found) {
    const needsWorld = !projectInPath(readPathname()) && !!step.route && step.route !== 'home' && step.route !== 'publishing';
    return { ok: false, reason: needsWorld ? 'no-project' : 'missing' };
  }
  if (!usableRect(found.getBoundingClientRect())) return { ok: false, reason: 'missing' };
  return { ok: true };
}

function reportSkips(): void {
  const words = copy();
  if (skipped.has('no-project')) toast.info(words.skippedNoProject);
  if (skipped.has('tool-off')) toast.info(words.skippedToolOff);
  if (skipped.has('missing')) toast.info(words.skippedMissing);
  skipped = new Set();
}

function releaseToolManager(tour: TourDefinition): void {
  if (tour.steps.some(step => step.toolManager === true)) useAppStore.getState().setShowEngineManager(false);
}

async function savePosition(tourId: string, index: number,run:number,binding?:TourBinding): Promise<void> {
  const next = await updateTourProgress(progress => current(run,binding)?withStep(progress, tourId, index, Date.now()):progress);
  if(current(run,binding))useTourStore.getState().setProgress(next);
}

/**
 * Put the first showable step at or after `from` (stepping `direction`) on screen.
 * Steps whose element cannot be found are skipped. Running off the end finishes
 * the tour if it showed anything, and gives up with a notice if it never did.
 */
async function showFrom(tour: TourDefinition, from: number, direction: 1 | -1,binding?:TourBinding): Promise<void> {
  clearCondition();
  const run = ++generation;
  const store = useTourStore.getState();
  store.setResolving(true);
  try {
    for (let index = from; index >= 0 && index < tour.steps.length; index += direction) {
      const step = tour.steps[index];
      const outcome = await prepare(step, run,binding);
      if (!current(run,binding)) return;
      if (outcome.ok) {
        const previous = useTourStore.getState().active;
        useTourStore.getState().setActive({
          tourId: tour.id,
          ...(binding?{binding}:{}),
          index,
          shown: (previous?.tourId === tour.id ? previous.shown : 0) + 1,
          anchor: step.anchor,
        });
        armCondition(run,binding,step);
        await savePosition(binding?.progressKey??tour.id, index,run,binding);
        return;
      }
      skipped.add(outcome.reason);
    }
    // Ran off an end.
    const shownActive = useTourStore.getState().active;
    if (direction > 0) {
      if (shownActive && shownActive.shown > 0) await completeTour(true);
      else {
        toast.info(copy().nothingToShow);
        reportSkips();
        closeTour();
      }
    }
    // Going back past the first showable step: stay where we are.
  } finally {
    if (run === generation) useTourStore.getState().setResolving(false);
  }
}

// ----- Public actions --------------------------------------------------------

export async function loadTourProgress(): Promise<void> {
  const run=generation;
  try {
    const progress=await readTourProgress();
    if(run===generation)useTourStore.getState().setProgress(progress);
  } catch (error) {
    console.error('Tour progress could not be read', error);
    useTourStore.getState().setProgress(useTourStore.getState().progress);
  }
}

/**
 * Start a tour. `resume` continues from the step the writer reached; otherwise
 * it begins at the first step. Returns false if it could not start.
 */
export async function startTour(tourId: string, options: { resume?: boolean } = {}): Promise<boolean> {
  const tour = findTour(tourId);
  if (!tour) return false;
  if (tour.needsProject && !projectInPath(readPathname()) && !(await latestProjectId())) {
    toast.info(copy().needsWorld);
    return false;
  }
  const store = useTourStore.getState();
  store.setPanelOpen(false);
  skipped = new Set();
  const saved = tourStatus(store.progress, tourId);
  const start = options.resume && saved.status === 'in-progress' ? Math.min(saved.step, tour.steps.length - 1) : 0;
  store.setActive({ tourId, index: start, shown: 0 });
  await showFrom(tour, start, 1);
  return true;
}

export async function nextStep(): Promise<void> {
  const active = useTourStore.getState().active;
  const tour = activeTourDefinition(active);
  if (!active || !tour || !manualTourStep(active)) return;
  await showFrom(tour, active.index + 1, 1,active.binding);
}

export async function backStep(): Promise<void> {
  const active = useTourStore.getState().active;
  const tour = activeTourDefinition(active);
  if (!active || !tour || active.index === 0) return;
  await showFrom(tour, active.index - 1, -1,active.binding);
}

/** Close without finishing (Saltar, Esc, the list): the position stays saved. */
export function closeTour(): void {
  clearCondition();
  generation++;
  const active = useTourStore.getState().active;
  const tour = activeTourDefinition(active);
  useTourStore.getState().setResolving(false);
  useTourStore.getState().setActive(null);
  if (tour) releaseToolManager(tour);
  skipped = new Set();
}

/** The last step's Terminar, or running off the end of a tour that showed something. */
export async function finishTour(): Promise<void> {await completeTour(false);}
async function completeTour(condition:boolean):Promise<void>{
 const active=useTourStore.getState().active,tour=activeTourDefinition(active);
 if(!active||!tour||!condition&&!manualTourStep(active))return;
 clearCondition();const run=++generation,binding=active.binding,key=binding?.progressKey??tour.id;
 const next=await updateTourProgress(progress=>current(run,binding)?withDone(progress,key,Date.now()):progress);
 if(!current(run,binding))return;
 useTourStore.getState().setProgress(next);useTourStore.getState().setResolving(false);useTourStore.getState().setActive(null);releaseToolManager(tour);toast.success(binding?copy().doneToolToast:copy().doneToast);reportSkips();
}

/** Remember that the one-time offer was answered, whichever way. */
export async function answerTourOffer(): Promise<void> {
  const next = await updateTourProgress(withOfferAnswered);
  useTourStore.getState().setProgress(next);
}
