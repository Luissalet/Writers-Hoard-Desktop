// Guided tours — shared types. A tour is plain data: the controller, the
// overlay and the list never know what any particular tour says.

/** Copy in both interface languages. */
export interface Bilingual {
  es: string;
  en: string;
}

/**
 * Where the writer has to be for a step. `engine:<id>` is a tool's page inside
 * the open world; `overview` is the world's home page.
 */
export type TourRoute = 'home' | 'overview' | 'publishing' | `engine:${string}`;

export interface TourStep {
  /** Stable within the tour (used by tests and the bridge listing). */
  id: string;
  /** The `data-tour="…"` value to spotlight. No anchor = a card in the middle of the screen. */
  anchor?: string;
  /** Go here first (through the router) if the writer is somewhere else. */
  route?: TourRoute;
  /** The `data-tour` value of a `<summary>` whose `<details>` must be open for this step. */
  openDetails?: string;
  /** Open (true) or close (false) the tool manager for this step. Absent = leave it as it is. */
  toolManager?: boolean;
  title: Bilingual;
  text: Bilingual;
}

export interface TourDefinition {
  id: string;
  title: Bilingual;
  /** One line shown in the list. */
  summary: Bilingual;
  /** True if any step needs an open world (the controller opens the latest one). */
  needsProject: boolean;
  steps: TourStep[];
}

/** What is stored for one tour. Absent = not started. */
export interface TourRecord {
  status: 'in-progress' | 'done';
  /** Index in `steps` of the step the writer reached (in-progress only). */
  step: number;
  updatedAt: number;
}

export interface TourProgress {
  version: 1;
  tours: Record<string, TourRecord>;
  /** The one-time offer on a fresh install was answered. */
  offerAnswered?: boolean;
}

export type TourStatus = 'not-started' | 'in-progress' | 'done';
