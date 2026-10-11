import {
  GHOST_DEBOUNCE_MS,
  GHOST_MAX_BEFORE_CHARS,
  GHOST_MAX_WORDS,
  boundedBefore,
  buildGhostMessages,
  createGhostScheduler,
  ghostEligibility,
  isSuggestionComplete,
  pickGhostRoute,
  selectGhostCodexNotes,
  splitFirstWord,
  styleBriefFromProfile,
  trimSuggestion,
  type GhostSnapshot,
  type GhostTimers,
} from '@/services/ghostText/ghostText';
import type { AiConnectionSummary, AiModelDescriptor } from '@/services/aiRuntime/types';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function same(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\n  expected ${JSON.stringify(expected)}\n  received ${JSON.stringify(actual)}`);
  }
}

const READY: GhostSnapshot = {
  editable: true,
  focused: true,
  composing: false,
  selectionEmpty: true,
  parentType: 'paragraph',
  paragraphBefore: 'Ana abrió la puerta y miró hacia la calle vacía.',
  paragraphAfter: '',
  before: 'Era de noche en el puerto. Ana abrió la puerta y miró hacia la calle vacía.',
};

/** A clock the test drives by hand. */
function fakeClock(): GhostTimers & { advance: (ms: number) => void; pending: () => number } {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    set: (callback, ms) => {
      const id = next++;
      timers.set(id, { at: now + ms, callback });
      return id;
    },
    clear: (handle) => {
      timers.delete(handle as number);
    },
    advance: (ms) => {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
    pending: () => timers.size,
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const connection = (id: string, extra: Partial<AiConnectionSummary> = {}): AiConnectionSummary =>
  ({
    id,
    name: id,
    kind: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    enabled: true,
    hasSecret: false,
    locality: 'loopback',
    modelTypes: ['chat'],
    pinnedModels: [],
    status: 'online',
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  }) as AiConnectionSummary;

const model = (connectionId: string, id: string, extra: Partial<AiModelDescriptor> = {}): AiModelDescriptor => ({
  connectionId,
  id,
  type: 'chat',
  capabilities: ['chat'],
  ...extra,
});

export function runGhostTextLogicTests(): string[] {
  const passed: string[] = [];

  // -- eligibility -----------------------------------------------------------
  assert(ghostEligibility(READY).ok, 'the end of an ordinary paragraph, focused and editable, is eligible');
  const blocked = (patch: Partial<GhostSnapshot>) => {
    const verdict = ghostEligibility({ ...READY, ...patch });
    return verdict.ok ? 'ok' : verdict.reason;
  };
  same(blocked({ editable: false }), 'read-only', 'a read-only editor gets nothing');
  same(blocked({ focused: false }), 'no-focus', 'an unfocused editor gets nothing');
  same(blocked({ composing: true }), 'composing', 'no suggestion over an IME composition');
  same(blocked({ selectionEmpty: false }), 'selection', 'no suggestion while text is selected');
  same(blocked({ parentType: 'heading' }), 'not-prose', 'headings are not continued');
  same(blocked({ parentType: 'chapterHeading' }), 'not-prose', 'chapter titles are not continued');
  same(blocked({ paragraphAfter: 'ando por la calle' }), 'mid-word', 'inside a word: nothing');
  same(blocked({ paragraphAfter: ' y luego' }), 'not-at-end', 'with text after the cursor: nothing');
  same(blocked({ paragraphBefore: 'Hola.' }), 'short-paragraph', 'an almost empty paragraph: nothing');
  same(blocked({ before: 'Hola, qué tal.' }), 'short-text', 'too little text to continue: nothing');
  passed.push('eligibility: end of an ordinary paragraph only; never read-only, unfocused, selected, mid-word, composing or in a heading');

  same(boundedBefore('corto'), 'corto', 'short text is kept whole');
  const long = `${'palabra '.repeat(1000)}final`;
  const cut = boundedBefore(long, 100);
  assert(cut.length <= 100 && cut.endsWith('final') && cut.startsWith('palabra'), 'bounded text keeps the end and starts on a whole word');
  assert(boundedBefore('x'.repeat(GHOST_MAX_BEFORE_CHARS + 50)).length <= GHOST_MAX_BEFORE_CHARS, 'the default bound applies');
  passed.push('context is bounded and never starts mid-word');

  // -- codex context ---------------------------------------------------------
  const codex = [
    { id: 'ana', type: 'character', title: 'Ana', fields: { Aliases: 'Anita' }, content: '<p>Cartógrafa de ojos grises.</p>' },
    { id: 'faro', type: 'place', title: 'El Faro', fields: { Región: 'Costa norte' } },
    { id: 'mara', type: 'character', title: 'Mara', content: '<p>La hermana mayor.</p>' },
    { id: 'agora', type: 'term', title: 'Ágora', fields: {}, content: '<p>La plaza del consejo.</p>' },
    { id: 'otro', type: 'character', title: 'Bruno', fields: {}, content: '<p>No sale en el texto.</p>' },
  ];
  const recent = 'Mara no llegó. En el ágora, Ana miró El Faro desde la ventana y Anita sonrió.';
  const notes = selectGhostCodexNotes(recent, codex);
  same(notes.map((n) => n.title), ['Ana', 'El Faro', 'Ágora', 'Mara'], 'mentioned entries only, most recently mentioned first (aliases and accents count)');
  assert(notes[0].summary === 'Cartógrafa de ojos grises.' && notes[0].type === 'character', 'each note carries type and a short summary');
  assert(notes[1].summary === 'Costa norte', 'without a body, the first field summarises');
  same(selectGhostCodexNotes(recent, codex, 2).map((n) => n.title), ['Ana', 'El Faro'], 'the note count is capped');
  same(selectGhostCodexNotes('Nada de nombres aquí.', codex), [], 'no mention, no note');
  same(selectGhostCodexNotes(recent, []), [], 'no codex, no note');
  same(selectGhostCodexNotes('Banana y Canalla', [{ id: 'a', type: 'character', title: 'Ana' }]), [], 'a name inside another word does not match');
  passed.push('codex context: mentions by title/alias, accent-insensitive, recent first, capped');

  same(styleBriefFromProfile(null), '', 'no profile, no brief');
  same(styleBriefFromProfile({ enabled: false, voice: 'seca' }), '', 'a disabled brief is not used');
  assert(styleBriefFromProfile({ enabled: true, voice: 'Seca, irónica', rules: 'Sin adverbios en -mente' }) === 'Voice: Seca, irónica\nRules: Sin adverbios en -mente', 'voice and rules, in the writer\'s words');
  assert(styleBriefFromProfile({ enabled: true, voice: 'x'.repeat(2000) }).length <= 420, 'the brief is bounded');
  passed.push('style brief from the project profile');

  const messages = buildGhostMessages({ before: 'Texto previo.', notes, style: 'Voice: seca' });
  assert(messages.length === 2 && messages[0].role === 'system' && messages[1].role === 'user', 'a system and a user message');
  assert(messages[1].content.includes('- Ana (character): Cartógrafa de ojos grises.'), 'codex notes are in the prompt');
  assert(messages[1].content.includes('Voice: seca') && messages[1].content.endsWith('Texto previo.'), 'style brief and the text, text last');
  assert(!buildGhostMessages({ before: 'Texto.', notes: [] }).map((m) => m.content).join('\n').includes('WORLD NOTES'), 'no notes, no notes section');
  passed.push('prompt: system rules, codex notes, style, text last');

  // -- trimming and de-duplication ------------------------------------------
  const before = 'Ana abrió la puerta y miró hacia la calle vacía.';
  same(trimSuggestion('Nadie esperaba en la esquina. Luego volvió dentro.', before), ' Nadie esperaba en la esquina.', 'one sentence, with the space the join needs');
  same(trimSuggestion('  \n"Nadie esperaba en la esquina."  ', before), ' Nadie esperaba en la esquina.', 'wrapping quotes and blank lines are dropped');
  same(trimSuggestion('<think>pensando…</think>Nadie esperaba.', before), ' Nadie esperaba.', 'reasoning blocks never reach the page');
  same(trimSuggestion('Continuación: Nadie esperaba en la esquina.', before), ' Nadie esperaba en la esquina.', 'a label is dropped');
  same(trimSuggestion('Primera frase corta.\nOtro párrafo que no debe entrar.', before), ' Primera frase corta.', 'one paragraph only');
  same(trimSuggestion('El Sr. Pérez llegó tarde a la cena. Luego se marchó.', before), ' El Sr. Pérez llegó tarde a la cena.', 'an abbreviation is not a sentence end');
  same(trimSuggestion('Costaba 3.5 euros y nadie lo notó. Fin', before), ' Costaba 3.5 euros y nadie lo notó.', 'a decimal point is not a sentence end');
  same(trimSuggestion('"¿Quién anda ahí?", preguntó. Nadie respondió.', before), ' "¿Quién anda ahí?", preguntó.', 'a quote followed by a comma does not end the sentence');
  passed.push('trim: one sentence, no wrapper, label or reasoning, abbreviations and decimals respected');

  const open = 'Ana abrió la puerta y miró hacia la calle vacía';
  same(trimSuggestion('miró hacia la calle vacía, pero nadie esperaba.', open), ', pero nadie esperaba.', 'a repeat of the last words is stripped and the join stays tight');
  same(trimSuggestion('Ana abrió la puerta y miró hacia la calle vacía, otra vez.', open), ', otra vez.', 'even when the model repeats the whole clause');
  same(trimSuggestion('Hacía frío en la plaza.', 'Hacía frío en la plaza. Ana cruzó despacio.'), '', 'a sentence already written is a loop: nothing shown');
  same(trimSuggestion('calle', 'La calle'), '', 'one bare word with no sentence end: nothing shown');
  same(trimSuggestion('...', before), '', 'no letters: nothing shown');
  same(trimSuggestion('', before), '', 'empty answer: nothing shown');
  same(trimSuggestion('Sí.', before), ' Sí.', 'a one-word sentence is fine when it ends');
  passed.push('dedupe: echoed words stripped, repeated sentences and empty answers show nothing');

  same(trimSuggestion('Nadie esperaba.', 'Ana miró la calle vacía. '), 'Nadie esperaba.', 'no extra space after a space');
  same(trimSuggestion('Nadie esperaba.', 'Ana dijo: «'), 'Nadie esperaba.', 'no space after an opening quote');
  same(trimSuggestion(', respiró hondo y siguió.', 'Se detuvo'), ', respiró hondo y siguió.', 'a comma attaches to the word');
  same(trimSuggestion('respiró hondo y siguió.', 'Se detuvo'), ' respiró hondo y siguió.', 'a word gets its space');
  const longRun = Array.from({ length: 70 }, (_, i) => `palabra${i}`).join(' ');
  assert(trimSuggestion(longRun, before).trim().split(/\s+/).length === GHOST_MAX_WORDS, 'with no sentence end the suggestion stops at the word cap');
  same(trimSuggestion('Nadie esperaba en la esquina cuando de', before, { truncated: true }), ' Nadie esperaba en la esquina cuando', 'a reply cut by the token cap loses its half word');
  passed.push('joining: spacing rules, word cap, truncated replies');

  assert(isSuggestionComplete('Nadie esperaba en la esquina. Luego', before), 'a finished sentence ends the stream early');
  assert(!isSuggestionComplete('Nadie esperaba en la', before), 'half a sentence keeps streaming');
  assert(!isSuggestionComplete('Costaba 3.', before), '"3." may still become "3.5"');
  assert(!isSuggestionComplete('El Sr. ', before), 'an abbreviation does not end the stream');
  assert(isSuggestionComplete(longRun, before), 'the word cap ends the stream');
  same(splitFirstWord(' alla del puerto'), { word: ' alla', rest: ' del puerto' }, 'next word keeps its leading space');
  same(splitFirstWord('fin'), { word: 'fin', rest: '' }, 'last word leaves nothing');
  passed.push('streaming stop test and word split');

  // -- which model -----------------------------------------------------------
  const local = connection('local');
  const remote = connection('lan', { locality: 'lan', kind: 'openai-compatible' });
  const cloud = connection('cloud', { locality: 'remote', kind: 'claude-subscription' });
  const pick = (input: Parameters<typeof pickGhostRoute>[0]) => {
    const route = pickGhostRoute(input);
    return route ? `${route.connectionId}/${route.modelId}` : null;
  };
  const models = {
    local: { models: [model('local', 'qwen-7b', { parameterCountB: 7 }), model('local', 'qwen-3b', { parameterCountB: 3 }), model('local', 'big-70b', { parameterCountB: 70 })] },
    lan: { models: [model('lan', 'tiny-lan', { parameterCountB: 2 })] },
    cloud: { models: [model('cloud', 'sonnet', { parameterCountB: 1 })] },
  };
  assert(pick({ connections: [remote, cloud], modelsByConnection: models }) === null, 'nothing local: no suggestion, never a network or cloud model');
  assert(pick({ defaultChat: { connectionId: 'cloud', modelId: 'sonnet' }, connections: [cloud], modelsByConnection: models }) === null, 'a cloud default is never used');
  assert(pick({ defaultChat: { connectionId: 'local', modelId: 'qwen-7b' }, connections: [local, remote], modelsByConnection: models }) === 'local/qwen-7b', 'the default chat model when it is local and not huge (already loaded)');
  assert(pick({ defaultChat: { connectionId: 'local', modelId: 'big-70b' }, connections: [local], modelsByConnection: models }) === 'local/qwen-3b', 'a huge default is passed over for the smallest usable local model');
  assert(pick({ defaultChat: { connectionId: 'lan', modelId: 'tiny-lan' }, connections: [local, remote], modelsByConnection: models }) === 'local/qwen-3b', 'a default on the network is passed over for a local one');
  assert(pick({ connections: [{ ...local, enabled: false }], modelsByConnection: models }) === null, 'a disabled connection is ignored');
  const odd = {
    local: {
      models: [
        model('local', 'nano-0.5b', { parameterCountB: 0.5 }),
        model('local', 'qwen-coder-7b', { parameterCountB: 7, family: 'qwen-coder' }),
        model('local', 'flux', { type: 'image', capabilities: ['image-generation'] }),
        model('local', 'gone', { parameterCountB: 2, installed: false }),
        model('local', 'sized-by-bytes', { sizeBytes: 1.2e9 }),
        model('local', 'llama-8b', { parameterCountB: 8 }),
      ],
    },
  };
  assert(pick({ connections: [local], modelsByConnection: odd }) === 'local/sized-by-bytes', 'smallest usable: not too tiny, not a coder, not an image model, not a missing file');
  passed.push('model choice: local only, default chat model if local and small, else the smallest usable');

  // -- debounce and cancellation --------------------------------------------
  return passed;
}

export async function runGhostSchedulerTests(): Promise<string[]> {
  const passed: string[] = [];

  const clock = fakeClock();
  const scheduler = createGhostScheduler(GHOST_DEBOUNCE_MS, clock);
  const ran: string[] = [];
  const signals: AbortSignal[] = [];
  const job = (name: string) => (signal: AbortSignal) => {
    ran.push(name);
    signals.push(signal);
    return new Promise<void>(() => undefined); // a request that never answers by itself
  };

  scheduler.schedule(job('first'));
  clock.advance(GHOST_DEBOUNCE_MS - 100);
  scheduler.schedule(job('second'));
  clock.advance(GHOST_DEBOUNCE_MS - 100);
  await flush();
  same(ran, [], 'every keystroke restarts the countdown: nothing ran yet');
  assert(scheduler.pending, 'a countdown is pending');
  clock.advance(100);
  await flush();
  same(ran, ['second'], 'after one full idle pause only the last request ran');
  assert(scheduler.inFlight && !scheduler.pending, 'and it is in flight');
  passed.push('debounce: only the last pause produces a request');

  scheduler.schedule(job('third'));
  assert(signals[0].aborted, 'a new keystroke aborts the request in flight');
  assert(!scheduler.inFlight && scheduler.pending, 'and starts a new countdown');
  clock.advance(GHOST_DEBOUNCE_MS);
  await flush();
  same(ran, ['second', 'third'], 'the new pause runs the new request');
  assert(!signals[1].aborted, 'the new request is live');
  scheduler.cancel();
  assert(signals[1].aborted && !scheduler.inFlight && !scheduler.pending, 'cancel aborts and clears everything');
  scheduler.schedule(job('never'));
  scheduler.cancel();
  clock.advance(GHOST_DEBOUNCE_MS * 2);
  await flush();
  same(ran, ['second', 'third'], 'a cancelled countdown never runs');
  assert(clock.pending() === 0, 'no timer is left behind');
  passed.push('cancel: a new keystroke or cancel() aborts the request in flight and drops the countdown');

  const failing = createGhostScheduler(10, clock);
  let after = 0;
  failing.schedule(() => {
    throw new Error('model exploded');
  });
  clock.advance(10);
  await flush();
  failing.schedule(() => {
    after++;
  });
  clock.advance(10);
  await flush();
  assert(after === 1, 'a request that throws does not break the next one');
  assert(!failing.inFlight, 'and leaves nothing in flight');
  passed.push('a failing request is swallowed');

  return passed;
}
