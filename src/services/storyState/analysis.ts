import { db } from '@/db';
import type {
  ContinuityContradiction,
  NarrativeMoment,
  RuleStressQuestion,
  RuleStressScenario,
  StoryClaim,
  StoryFactClaim,
  StoryStateSnapshot,
  StoryWorldRuleClaim,
} from './types';

function momentOrder(moments: ReadonlyMap<string, NarrativeMoment>, id: string | undefined): number | null {
  if (!id) return null;
  return moments.get(id)?.order ?? null;
}

function activeInterval(
  at: number,
  from: number | null,
  until: number | null,
): boolean {
  return (from === null || from <= at) && (until === null || at <= until);
}

export function deriveStoryState(
  moment: NarrativeMoment,
  allMoments: readonly NarrativeMoment[],
  claims: readonly StoryClaim[],
): StoryStateSnapshot {
  const moments = new Map(allMoments.map((row) => [row.id, row]));
  let incomplete = false;
  const factClaims = claims.filter((claim): claim is StoryFactClaim => claim.kind === 'fact');
  const facts = factClaims.filter((claim) => {
    const from = momentOrder(moments, claim.fromMomentId);
    const until = momentOrder(moments, claim.untilMomentId);
    if (from === null || claim.untilMomentId && until === null) incomplete = true;
    return from !== null && activeInterval(moment.order, from, until);
  });
  const beliefs = claims.filter((claim): claim is Extract<StoryClaim, { kind: 'belief' }> => {
    if (claim.kind !== 'belief') return false;
    const acquired = momentOrder(moments, claim.acquiredAtMomentId);
    if (acquired === null) incomplete = true;
    return acquired !== null && acquired <= moment.order;
  });
  const rules = claims.filter((claim): claim is StoryWorldRuleClaim => {
    if (claim.kind !== 'world-rule') return false;
    const from = momentOrder(moments, claim.fromMomentId);
    const until = momentOrder(moments, claim.untilMomentId);
    if (claim.fromMomentId && from === null || claim.untilMomentId && until === null) incomplete = true;
    return activeInterval(moment.order, from, until);
  });

  const grouped = new Map<string, StoryFactClaim[]>();
  for (const claim of facts) {
    if (claim.status !== 'canonical' || claim.intentional) continue;
    const key = `${claim.subject.engineId}:${claim.subject.entityId}:${claim.factType}`;
    const group = grouped.get(key) ?? [];
    group.push(claim);
    grouped.set(key, group);
  }
  const contradictions: ContinuityContradiction[] = [];
  for (const [id, group] of grouped) {
    const values = [...new Set(group.map((claim) => claim.value.trim()).filter(Boolean))];
    if (values.length < 2) continue;
    contradictions.push({ id, subject: group[0].subject, factType: group[0].factType, claims: group, values });
  }
  return { moment, facts, beliefs, rules, contradictions, incomplete };
}

export async function storyStateAtMoment(projectId: string, momentId: string): Promise<StoryStateSnapshot> {
  const [moment, moments, claims] = await Promise.all([
    db.narrativeMoments.get(momentId),
    db.narrativeMoments.where('projectId').equals(projectId).toArray(),
    db.storyClaims.where('projectId').equals(projectId).toArray(),
  ]);
  if (!moment || moment.projectId !== projectId) throw new Error('Story moment not found in this project.');
  return deriveStoryState(moment, moments, claims);
}

const SCENARIOS: RuleStressScenario[] = ['extreme-use', 'abuse', 'failure', 'interaction', 'social'];

export function stressWorldRule(
  rule: StoryWorldRuleClaim,
  locale: 'es' | 'en' = 'es',
): RuleStressQuestion[] {
  const text = locale === 'es'
    ? {
        'extreme-use': `Si «${rule.title}» se usa al límite, ¿en qué punto deja de sostenerse «${rule.limit || 'su límite'}» y quién paga «${rule.cost || 'el coste'}»?`,
        abuse: `¿Cómo intentaría alguien explotar la condición «${rule.condition || 'sin condición declarada'}» sin aceptar el efecto completo «${rule.effect}»?`,
        failure: `Cuando «${rule.title}» falla, ¿qué señal observable lo demuestra y qué consecuencia permanece aunque el efecto no ocurra?`,
        interaction: `¿Qué otra regla podría amplificar, cancelar o contradecir «${rule.effect}», y cuál de las dos tendría prioridad?`,
        social: `Si la sociedad conoce «${rule.title}», ¿qué profesión, desigualdad, mercado o prohibición nace de «${rule.cost || rule.effect}»?`,
      }
    : {
        'extreme-use': `If “${rule.title}” is pushed to its extreme, when does “${rule.limit || 'its limit'}” stop holding and who pays “${rule.cost || 'the cost'}”?`,
        abuse: `How would someone exploit “${rule.condition || 'no stated condition'}” without accepting the full effect “${rule.effect}”?`,
        failure: `When “${rule.title}” fails, what observable sign proves it and which consequence remains even without the effect?`,
        interaction: `Which other rule could amplify, cancel, or contradict “${rule.effect}”, and which one takes priority?`,
        social: `If society knows “${rule.title}”, which profession, inequality, market, or prohibition grows from “${rule.cost || rule.effect}”?`,
      };
  const grounded: Record<RuleStressScenario, RuleStressQuestion['groundedIn']> = {
    'extreme-use': ['limit', 'cost'],
    abuse: ['condition', 'effect'],
    failure: ['effect', 'limit'],
    interaction: ['effect', 'exceptions'],
    social: ['cost', 'effect'],
  };
  return SCENARIOS.map((scenario) => ({
    id: `${rule.id}:${scenario}`,
    scenario,
    question: text[scenario],
    groundedIn: grounded[scenario],
  }));
}
