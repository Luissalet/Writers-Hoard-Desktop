import { act } from 'react';
import { createRoot } from 'react-dom/client';
import CharacterPressureChamber from '@/components/character-pressure/CharacterPressureChamber';
import type { CharacterArc } from '@/engines/character-arc/types';
import type { Relationship } from '@/engines/relationships/types';
import {
  buildCharacterPressureSession,
  createCharacterPressurePromotionDraft,
  CharacterPressureValidationError,
  type CharacterPressurePromotionDraft,
  type CharacterPressureRequest,
} from '@/services/characterPressureChamber';
import type { CodexEntry } from '@/types';

declare global {
  interface Window {
    __characterPressureResult?: {
      ok: boolean;
      tests: string[];
      error?: string;
    };
  }
}

const PROJECT_ID = 'pressure-project';
const OTHER_PROJECT_ID = 'pressure-other-project';
const NOW = 1_788_768_000_000;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function character(
  id: string,
  title: string,
  fields: Record<string, string>,
  relations: CodexEntry['relations'] = [],
): CodexEntry {
  return {
    id,
    projectId: PROJECT_ID,
    type: 'character',
    title,
    fields,
    content: '<p>Private character prose must not be copied into provenance.</p>',
    tags: [],
    relations,
    createdAt: NOW,
    updatedAt: NOW + 1,
  };
}

function arc(
  id: string,
  characterId: string,
  updatedAt: number,
  fields: Partial<Pick<CharacterArc, 'want' | 'need' | 'ghost' | 'lie'>>,
): CharacterArc {
  return {
    id,
    projectId: PROJECT_ID,
    title: `${id} arc`,
    characterId,
    characterName: characterId,
    ghost: fields.ghost ?? '',
    lie: fields.lie ?? '',
    truth: '',
    want: fields.want ?? '',
    need: fields.need ?? '',
    summary: '',
    status: 'planning',
    createdAt: NOW,
    updatedAt,
  };
}

const ADA = character('ada', 'Ada', {
  goals: 'get the passengers out alive',
  fear: 'being exposed as the saboteur',
  abilities: 'controls the station access keys',
  debt: 'owes Beto for hiding the evidence',
});
const BETO = character('beto', 'Beto', {
  goals: 'save the failing habitat',
  abilities: 'can repair the oxygen recycler',
}, [{ targetId: 'cyra', targetTitle: 'Cyra', type: 'rival', description: 'professional rivals' }]);
const CYRA = character('cyra', 'Cyra', { goals: 'keep command of the station' });

const ARCS: CharacterArc[] = [
  arc('ada-old', 'ada', NOW + 2, { want: 'take sole command', need: 'trust the crew' }),
  arc('ada-new', 'ada', NOW + 3, { want: 'get the passengers out alive', need: 'admit responsibility' }),
  arc('beto-arc', 'beto', NOW + 4, {
    want: 'save the failing habitat',
    need: 'ask for help',
    ghost: 'the last evacuation he failed',
  }),
];

const RELATIONSHIPS: Relationship[] = [
  {
    id: 'ada-beto',
    projectId: PROJECT_ID,
    entityAId: 'ada',
    entityAType: 'codex-entry',
    entityAName: 'Ada',
    entityBId: 'beto',
    entityBType: 'codex-entry',
    entityBName: 'Beto',
    kind: 'ally',
    intensity: 2,
    label: 'Uneasy allies',
    notes: 'Neither trusts the other with command.',
    state: 'current',
    directional: false,
    createdAt: NOW,
    updatedAt: NOW + 5,
  },
  {
    id: 'foreign-row',
    projectId: OTHER_PROJECT_ID,
    entityAId: 'ada',
    entityAType: 'codex-entry',
    entityAName: 'Ada',
    entityBId: 'beto',
    entityBType: 'codex-entry',
    entityBName: 'Beto',
    kind: 'enemy',
    intensity: -5,
    label: 'Must never enter this session',
    notes: '',
    state: 'current',
    directional: false,
    createdAt: NOW,
    updatedAt: NOW + 6,
  },
];

const BASE_REQUEST: CharacterPressureRequest = {
  projectId: PROJECT_ID,
  characterIds: ['cyra', 'ada', 'beto'],
  codexEntries: [CYRA, ADA, BETO],
  characterArcs: ARCS,
  relationships: RELATIONSHIPS,
  pressure: {
    situation: 'the station is losing oxygen',
    scarceResource: 'one escape pod',
    timeLimit: 'before the next airlock cycle',
    secret: 'Ada disabled the backup recycler',
    cost: 'someone must remain behind',
  },
  locale: 'en',
};

function expectValidation(
  code: CharacterPressureValidationError['code'],
  request: CharacterPressureRequest,
): void {
  try {
    buildCharacterPressureSession(request);
  } catch (error) {
    assert(error instanceof CharacterPressureValidationError, `expected ${code}, received generic error`);
    assert(error.code === code, `expected ${code}, received ${error.code}`);
    return;
  }
  throw new Error(`expected validation error ${code}`);
}

async function runTests(): Promise<string[]> {
  const inputBefore = JSON.stringify(BASE_REQUEST);
  const session = buildCharacterPressureSession(BASE_REQUEST);
  assert(JSON.stringify(BASE_REQUEST) === inputBefore, 'building a session mutated source rows');
  assert(session.status === 'hypothesis', 'session was presented as canon');
  assert(session.characters.length === 3, 'selected characters were lost');
  assert(session.insights.length === 12, 'three characters should produce 12 bounded possibilities');
  assert(new Set(session.insights.map((row) => row.kind)).size === 4, 'an insight category is missing');
  assert(
    session.characters.find((row) => row.characterId === 'ada')?.signals.objective.source?.id === 'ada-new',
    'the latest linked Character Arc was not reused',
  );
  assert(
    session.characters.find((row) => row.characterId === 'beto')?.signals.fear.confidence === 'adjacent',
    'an adjacent Arc ghost was silently promoted to an explicit fear',
  );
  assert(
    session.characters.find((row) => row.characterId === 'cyra')?.signals.debt.confidence === 'missing',
    'a missing debt was invented',
  );
  assert(
    session.provenance.relationshipIds.join(',') === 'ada-beto',
    'cross-project relationship provenance entered the session',
  );
  assert(
    !JSON.stringify(session.provenance).includes('Private character prose'),
    'private Codex prose leaked into provenance',
  );

  const reversed = buildCharacterPressureSession({
    ...BASE_REQUEST,
    characterIds: [...BASE_REQUEST.characterIds].reverse(),
    codexEntries: [...BASE_REQUEST.codexEntries].reverse(),
    characterArcs: [...BASE_REQUEST.characterArcs].reverse(),
    relationships: [...BASE_REQUEST.relationships].reverse(),
  });
  assert(JSON.stringify(reversed) === JSON.stringify(session), 'row ordering changed deterministic output');

  const forbiddenAnswerLanguage = /\b(correct answer|right answer|definitely|must choose|will choose|respuesta correcta|sin duda|debe elegir)\b/i;
  for (const insight of session.insights) {
    assert(/[?¿]/.test(insight.prompt) && insight.prompt.endsWith('?'), 'an insight was not phrased as a question');
    assert(!forbiddenAnswerLanguage.test(insight.prompt), 'an insight prescribed a correct answer');
  }
  const decision = session.insights.find((row) => row.kind === 'decision');
  assert(decision, 'no difficult decision was produced');
  assert(
    new Set(decision.dimensions).size === 6,
    'the decision did not cross objective, need, fear, power, debt, and relationship',
  );

  const beatDraft = createCharacterPressurePromotionDraft(session, decision.id, 'beat');
  assert(beatDraft.target === 'beat', 'promotion draft targeted the wrong destination');
  assert(beatDraft.provenance.sessionId === session.id, 'promotion lost its session provenance');
  assert(beatDraft.provenance.resultId === decision.id, 'promotion lost its result provenance');
  assert(JSON.stringify(BASE_REQUEST) === inputBefore, 'creating a promotion draft mutated canon rows');
  const soloQuestion = session.insights.find((row) => row.kind === 'question');
  assert(soloQuestion, 'no single-character question was produced');
  try {
    createCharacterPressurePromotionDraft(session, soloQuestion.id, 'relationship-change');
    throw new Error('single-character result produced a relationship change');
  } catch (error) {
    assert(
      error instanceof CharacterPressureValidationError && error.code === 'target-not-applicable',
      'relationship promotion failed without the expected guard',
    );
  }

  expectValidation('character-count', { ...BASE_REQUEST, characterIds: ['ada'] });
  expectValidation('duplicate-character', { ...BASE_REQUEST, characterIds: ['ada', 'ada'] });
  expectValidation('situation-required', {
    ...BASE_REQUEST,
    pressure: { ...BASE_REQUEST.pressure, situation: ' ' },
  });
  expectValidation('pressure-required', {
    ...BASE_REQUEST,
    pressure: { situation: 'a quiet room' },
  });

  const spanish = buildCharacterPressureSession({ ...BASE_REQUEST, locale: 'es' });
  assert(spanish.insights.every((row) => row.prompt.includes('¿')), 'Spanish prompts were not localized');

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const received: CharacterPressurePromotionDraft<'beat'>[] = [];
  await act(async () => {
    root.render(
      <CharacterPressureChamber
        projectId={PROJECT_ID}
        codexEntries={[ADA, BETO, CYRA]}
        characterArcs={ARCS}
        relationships={RELATIONSHIPS}
        initialCharacterIds={['ada', 'beto']}
        initialPressure={{
          situation: BASE_REQUEST.pressure.situation,
          scarceResource: BASE_REQUEST.pressure.scarceResource,
        }}
        onPromoteBeat={(draft) => {
          received.push(draft);
        }}
      />,
    );
  });
  assert(host.querySelector('fieldset > legend'), 'character selection has no fieldset legend');
  assert(host.querySelectorAll('input[type="checkbox"]').length === 3, 'character checkboxes are missing');
  assert(host.querySelector('label[for$="-situation"]'), 'the situation textarea has no programmatic label');
  const submit = host.querySelector<HTMLButtonElement>('button[type="submit"]');
  assert(submit && !submit.disabled, 'a valid chamber cannot be launched from the keyboard');

  await act(async () => {
    submit.click();
  });
  const articles = [...host.querySelectorAll('article')];
  assert(articles.length === 6, 'two-character UI did not render the bounded result set');
  const questionArticle = articles.find((row) => row.textContent?.includes('Questions'));
  assert(questionArticle, 'question result is missing from the UI');
  assert(
    !questionArticle.textContent?.includes('Draft relationship change'),
    'single-character question offered an invalid relationship change',
  );
  const beatButton = questionArticle.querySelector<HTMLButtonElement>('button');
  assert(beatButton?.textContent?.includes('Draft beat'), 'host promotion callback is not exposed');
  await act(async () => {
    beatButton.click();
  });
  assert(received.length === 1, 'promotion did not go through the host callback');
  assert(received[0].provenance.source === 'character-pressure-chamber', 'UI callback lost provenance');
  assert(host.querySelector('[role="status"]'), 'successful callback feedback is not announced');

  await act(async () => root.unmount());
  host.remove();

  return [
    'Character Pressure Chamber is deterministic, non-prescriptive, source-grounded, non-mutating, callback-only, and accessible at its interaction boundary',
  ];
}

void runTests().then(
  (tests) => {
    window.__characterPressureResult = { ok: true, tests };
  },
  (error: unknown) => {
    window.__characterPressureResult = {
      ok: false,
      tests: [],
      error: error instanceof Error ? `${error.stack ?? error.message}` : String(error),
    };
  },
);
