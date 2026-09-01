// ============================================
// Seeds & Payoffs — closing an orphan in one step
// ============================================
//
// The proofreader's `seed-without-payoff` check exists to provoke exactly one
// action: naming the place where the seed finally lands. The card it sends the
// writer to could only ever restate the problem — "Huérfana" and nothing else.
// Saying "this pays off in chapter 7" meant opening the seed, adding an
// untitled payoff and then filling in three of its fields.
//
// This is the conversion the card's inline picker performs instead: two ids out
// of two dropdowns, one payoff row in. It lives outside the component because
// the rules below are about the data, not about the pixels.

import type { Payoff, Seed } from './types';

/**
 * A place a payoff can land, in the exact shape `LinkSelect` takes — the
 * picker builds one array per engine and feeds it to both the dropdown and
 * this builder, so the label the writer chose is the label the row records.
 */
export interface PayoffTargetOption {
  id: string;
  label: string;
}

export interface QuickPayoffInput {
  /** The orphan being closed; the row is scoped and denormalised from it. */
  seed: Seed;
  /** Ids as the two dropdowns hold them — empty string means "not chosen". */
  writingId: string;
  sceneId: string;
  /** What the writer was actually offered, and where the labels come from. */
  writings: readonly PayoffTargetOption[];
  scenes: readonly PayoffTargetOption[];
  /** `seeds.payoff.markPaid.title`, already translated, carrying `{target}`. */
  titleTemplate: string;
  id: string;
  now: number;
}

/**
 * "This pays off in chapter 7", as a row.
 *
 * A chosen id absent from the list it came from counts as not chosen. Those
 * lists are what the writer was shown; an id missing from one means the
 * chapter or scene went away between the render and the click, and linking to
 * it would mint precisely the dead reference the proofreader is there to
 * catch. The other half of the choice still stands on its own.
 *
 * Chapter and scene are both kept when both are given: neither answer replaces
 * the other — the chapter says where to look, the scene says where to stop —
 * and "Chapter 3 · Scene 2" is the shape `seeds.locationPlaceholder` has been
 * asking authors to type by hand all along.
 */
export function buildQuickPayoff(input: QuickPayoffInput): Payoff | null {
  const { seed, writingId, sceneId, writings, scenes, titleTemplate, id, now } = input;
  const writing = writings.find((option) => option.id === writingId);
  const scene = scenes.find((option) => option.id === sceneId);
  if (!writing && !scene) return null;

  // An untitled chapter reads as nothing, so it contributes nothing to the
  // label either — the link it stands for still lands.
  const label = [writing?.label, scene?.label]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(' · ');

  return {
    id,
    seedId: seed.id,
    // Denormalised like every other payoff writer: `getAllPayoffsForProject`
    // and the backup strategy both read `projectId` off the payoff row.
    projectId: seed.projectId,
    title: titleTemplate.replace('{target}', label),
    description: '',
    strength: 3,
    linkedWritingId: writing?.id,
    linkedSceneId: scene?.id,
    locationLabel: label,
    createdAt: now,
    updatedAt: now,
  };
}
