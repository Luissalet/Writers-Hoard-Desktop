import { act } from 'react';
import { createRoot } from 'react-dom/client';
import ReadAloudPanel from '@/components/read-aloud/ReadAloudPanel';
import type { DialogBlock } from '@/engines/dialog-scene/types';
import {
  ReadAloudController,
  collectCharacterVoiceAssignments,
  dialogBlocksToReadAloudBlocks,
  segmentReadAloudBlocks,
  voicePreferenceKey,
  writingToReadAloudBlocks,
  type ReadAloudVoice,
  type SpeechDriver,
  type SpeechRequest,
} from '@/services/readAloud';

declare global {
  interface Window {
    __readAloudResult?: { ok: boolean; tests: string[]; error?: string };
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

class MockSpeechDriver implements SpeechDriver {
  readonly supported: boolean;
  readonly boundaryEvents: boolean;
  readonly voices: ReadAloudVoice[] = [
    { voiceURI: 'voice-ana', name: 'Ana', lang: 'es-ES', default: true },
    { voiceURI: 'voice-ben', name: 'Ben', lang: 'en-GB', default: false },
  ];
  requests: SpeechRequest[] = [];
  cancelCount = 0;
  pauseCount = 0;
  resumeCount = 0;

  constructor(supported = true, boundaryEvents = true) {
    this.supported = supported;
    this.boundaryEvents = boundaryEvents;
  }

  speak(request: SpeechRequest): void {
    this.requests.push(request);
    request.onStart();
  }

  cancel(): void {
    this.cancelCount += 1;
  }

  pause(): void {
    this.pauseCount += 1;
  }

  resume(): void {
    this.resumeCount += 1;
  }

  getVoices(): ReadAloudVoice[] {
    return this.voices;
  }
}

function dialogBlock(
  id: string,
  order: number,
  type: DialogBlock['type'],
  content: string,
  characterName = '',
  characterId?: string,
  parenthetical?: string,
): DialogBlock {
  return {
    id,
    sceneId: 'scene-1',
    projectId: 'project-1',
    type,
    content,
    order,
    characterName,
    characterId,
    characterColor: characterName ? '#c4973b' : '#64748b',
    parenthetical,
    createdAt: 1,
    updatedAt: 2,
  };
}

function testCanonicalAdapters(): void {
  const writing = writingToReadAloudBlocks({
    id: 'chapter-1',
    title: 'The bell',
    content: '<h2>First line</h2><p>Hello <em>there</em>.</p><p>Second &amp; final.</p>',
  });
  assertEqual(writing.length, 3, 'rich text paragraphs were flattened into one block');
  assertEqual(writing[1].text, 'Hello there.', 'writing HTML was not projected as readable text');
  assert(writing.every((block) => block.sourceId === 'chapter-1'), 'writing provenance was lost');

  const blocks = dialogBlocksToReadAloudBlocks([
    dialogBlock('action', 2, 'action', 'The light dies.'),
    dialogBlock('line', 1, 'dialog', 'Not again. Stay close!', 'Mara', 'mara', 'whispering'),
  ]);
  assertEqual(blocks.length, 3, 'dialogue parenthetical was not preserved as a stage direction');
  assertEqual(blocks[0].kind, 'stage-direction', 'parenthetical did not precede its line');
  assertEqual(blocks[1].characterId, 'mara', 'dialogue speaker identity was lost');
  assertEqual(blocks[2].sourceId, 'action', 'canonical block order was not respected');

  const sentences = segmentReadAloudBlocks(blocks, 'sentence', 'en');
  assertEqual(sentences.length, 4, 'sentence mode did not split dialogue punctuation');
  assert(sentences[1].endOffset <= blocks[1].text.length, 'sentence anchor escaped its source block');
  const blockSegments = segmentReadAloudBlocks(blocks, 'block', 'en');
  assertEqual(blockSegments.length, blocks.length, 'block mode changed block cardinality');
}

function testControllerStateMachine(): void {
  const blocks = dialogBlocksToReadAloudBlocks([
    dialogBlock('line', 0, 'dialog', 'One. Two.', 'Mara', 'mara'),
  ]);
  const segments = segmentReadAloudBlocks(blocks, 'sentence', 'en');
  const driver = new MockSpeechDriver();
  const controller = new ReadAloudController({
    driver,
    segments,
    locale: 'en',
    rate: 1.3,
    voicePreferences: { 'id:mara': 'voice-ben' },
  });

  controller.play();
  assertEqual(controller.getSnapshot().status, 'playing', 'play did not enter the playing state');
  assertEqual(driver.requests[0].voiceURI, 'voice-ben', 'character voice preference was not applied');
  assertEqual(driver.requests[0].rate, 1.3, 'playback rate was not applied');
  driver.requests[0].onBoundary({ charIndex: 2, charLength: 3 });
  assertEqual(controller.getSnapshot().activeCharIndex, 2, 'boundary progress was not exposed');

  controller.pause();
  assertEqual(controller.getSnapshot().status, 'paused', 'pause did not hold playback');
  controller.resume();
  assertEqual(driver.resumeCount, 1, 'resume did not reach the speech driver');

  const staleEnd = driver.requests[0].onEnd;
  controller.jumpTo(1);
  assertEqual(controller.getSnapshot().activeIndex, 1, 'jump did not target the requested sentence');
  staleEnd();
  assertEqual(controller.getSnapshot().activeIndex, 1, 'a stale cancel callback advanced playback');
  const current = driver.requests.at(-1);
  assert(current, 'jump while playing did not speak its target');
  current.onEnd();
  assertEqual(controller.getSnapshot().status, 'finished', 'last segment did not finish the reading');

  controller.play();
  assertEqual(controller.getSnapshot().activeIndex, 0, 'play after finish did not restart from the beginning');
  assertEqual(controller.getSnapshot().completedIndexes.length, 0, 'restarting kept stale completed states');

  controller.setRate(99);
  assertEqual(controller.getSnapshot().rate, 2, 'rate was not clamped to a safe Web Speech range');
  controller.destroy();

  const unsupported = new ReadAloudController({
    driver: new MockSpeechDriver(false, false),
    segments,
  });
  unsupported.jumpTo(1);
  assertEqual(unsupported.getSnapshot().activeIndex, 1, 'manual navigation disappeared without TTS');
  assertEqual(unsupported.getSnapshot().status, 'unsupported', 'unsupported capability was hidden');
}

async function testAccessiblePanel(): Promise<void> {
  const source = dialogBlocksToReadAloudBlocks([
    dialogBlock('line', 0, 'dialog', 'No abras esa puerta.', 'Mara', 'mara'),
    dialogBlock('direction', 1, 'stage-direction', 'La lluvia golpea el cristal.'),
  ]);
  const assignments = collectCharacterVoiceAssignments(source, { 'id:mara': 'voice-ana' });
  assertEqual(assignments.length, 1, 'voice cast included a non-dialogue block');
  assertEqual(voicePreferenceKey(source[0]), 'id:mara', 'voice preference key is unstable');

  const driver = new MockSpeechDriver();
  const notes: string[] = [];
  const jumps: string[] = [];
  const voiceChanges: string[] = [];
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);

  await act(async () => {
    root.render(
      <ReadAloudPanel
        blocks={source}
        mode="table-read"
        locale="es"
        speechDriver={driver}
        voicePreferences={{ 'id:mara': 'voice-ana' }}
        onVoicePreferenceChange={(key, voice) => voiceChanges.push(`${key}:${voice ?? ''}`)}
        onCreateNote={(anchor) => notes.push(anchor.quote)}
        onJumpToSource={(anchor) => jumps.push(anchor.blockId)}
      />,
    );
  });

  const section = host.querySelector<HTMLElement>('section[tabindex="0"]');
  assert(section, 'panel is not a keyboard focus target');
  assert(host.querySelector('fieldset > legend'), 'voice assignments have no fieldset legend');
  assert(host.querySelector('label[for] select'), 'segmentation select has no programmatic label');
  assertEqual(host.querySelectorAll('ol > li').length, 2, 'table read did not render its blocks');
  assert(host.textContent?.includes('Acotaci\u00f3n'), 'stage directions are not visibly distinguished');

  const play = [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.trim() === 'Reproducir');
  assert(play && !play.disabled, 'play is not keyboard-operable when speech is available');
  await act(async () => play.click());
  assertEqual(driver.requests.length, 1, 'panel did not start playback');
  assertEqual(driver.requests[0].voiceURI, 'voice-ana', 'panel did not pass the persisted character voice');
  assert(host.querySelector('[data-read-aloud-state="current"]'), 'active segment is not exposed by state');

  const pause = [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.trim() === 'Pausar');
  assert(pause, 'playing control did not become pause');
  await act(async () => pause.click());
  assertEqual(driver.pauseCount, 1, 'pause control did not reach the driver');

  await act(async () => {
    section.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  });
  assertEqual(host.querySelector('[data-read-aloud-active="true"]')?.textContent?.includes('lluvia'), true, 'arrow key did not jump playback');

  const noteButton = host.querySelector<HTMLButtonElement>('button[aria-label="Crear nota aqu\u00ed"]');
  const jumpButton = host.querySelector<HTMLButtonElement>('button[aria-label="Ir al bloque original"]');
  assert(noteButton && jumpButton, 'host note/source actions are not discoverable');
  await act(async () => {
    noteButton.click();
    jumpButton.click();
  });
  assertEqual(notes[0], 'No abras esa puerta.', 'note callback lost its quote anchor');
  assertEqual(jumps[0], 'line', 'source callback lost its canonical block id');

  const voiceSelect = host.querySelector<HTMLSelectElement>('select[aria-label^="Reparto de voces"]');
  assert(voiceSelect, 'character voice control is missing');
  await act(async () => {
    voiceSelect.value = 'voice-ben';
    voiceSelect.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assertEqual(voiceChanges[0], 'id:mara:voice-ben', 'voice persistence callback lost its host key');

  const unsupportedDriver = new MockSpeechDriver(false, false);
  await act(async () => {
    root.render(
      <ReadAloudPanel blocks={source} locale="en" speechDriver={unsupportedDriver} />,
    );
  });
  assert(host.querySelector('[role="alert"]')?.textContent?.includes('does not expose'), 'unsupported Web Speech is not explained');
  const disabledPlay = [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.trim() === 'Play');
  assert(disabledPlay?.disabled, 'play remains enabled without a speech capability');
  const next = host.querySelector<HTMLButtonElement>('button[aria-label="Next"]');
  assert(next && !next.disabled, 'manual stepping is unavailable without speech');
  await act(async () => next.click());
  assertEqual(host.querySelector('[data-read-aloud-active="true"]')?.textContent?.includes('lluvia'), true, 'manual stepping failed without speech');

  await act(async () => root.unmount());
  host.remove();
}

function setRangeValue(input: HTMLInputElement, value: string): void {
  // React tracks the value it last rendered; the native setter is what a
  // drag goes through, so the change is seen as one.
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function testSettingsSurviveGranularity(): Promise<void> {
  const source = dialogBlocksToReadAloudBlocks([
    dialogBlock('line', 0, 'dialog', 'Uno. Dos.', 'Mara', 'mara'),
    dialogBlock('direction', 1, 'stage-direction', 'Llueve.'),
  ]);
  const driver = new MockSpeechDriver();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <ReadAloudPanel blocks={source} mode="table-read" locale="es" speechDriver={driver} />,
    );
  });

  const range = host.querySelector<HTMLInputElement>('input[type="range"]');
  const voiceSelect = host.querySelector<HTMLSelectElement>('select[aria-label^="Reparto de voces"]');
  const granularity = host.querySelector<HTMLSelectElement>('label[for] select');
  assert(range && voiceSelect && granularity, 'rate, voice or segmentation control is missing');
  await act(async () => setRangeValue(range, '1.6'));
  await act(async () => {
    voiceSelect.value = 'voice-ben';
    voiceSelect.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assertEqual(host.querySelector('output')?.textContent, '1.6\u00d7', 'the speed slider did not move');

  await act(async () => {
    granularity.value = 'block';
    granularity.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assertEqual(host.querySelector('output')?.textContent, '1.6\u00d7', 'switching to block mode reset the speed');
  assertEqual(range.value, '1.6', 'switching to block mode reset the slider');

  const play = [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.trim() === 'Reproducir');
  assert(play, 'play control is missing');
  await act(async () => play.click());
  assertEqual(driver.requests.at(-1)?.rate, 1.6, 'block mode spoke at the initial speed');
  assertEqual(driver.requests.at(-1)?.voiceURI, 'voice-ben', 'block mode lost the chosen voice');

  await act(async () => root.unmount());
  host.remove();
}

function testDestroyIsNotTerminal(): void {
  const segments = segmentReadAloudBlocks(
    dialogBlocksToReadAloudBlocks([dialogBlock('line', 0, 'dialog', 'One. Two.', 'Mara', 'mara')]),
    'sentence',
    'en',
  );
  const driver = new MockSpeechDriver();
  const controller = new ReadAloudController({ driver, segments, locale: 'en' });
  let notified = 0;
  controller.subscribe(() => { notified += 1; });
  controller.play();
  const stale = driver.requests[0];
  controller.destroy();
  controller.destroy();
  assertEqual(controller.getSnapshot().status, 'idle', 'destroy left the snapshot claiming it still plays');
  const afterDestroy = notified;
  stale.onEnd();
  assertEqual(controller.getSnapshot().activeIndex, 0, 'a callback from before destroy advanced playback');
  // What StrictMode does: the view subscribes again to the same controller.
  let resubscribed = 0;
  controller.subscribe(() => { resubscribed += 1; });
  controller.play();
  assertEqual(driver.requests.length, 2, 'a destroyed controller never spoke again');
  assertEqual(controller.getSnapshot().status, 'playing', 'replay after destroy did not play');
  assertEqual(notified, afterDestroy, 'destroy kept notifying a dropped subscriber');
  assert(resubscribed > 0, 'a new subscriber after destroy is not notified');
}

async function runTests(): Promise<string[]> {
  testCanonicalAdapters();
  testControllerStateMachine();
  await testAccessiblePanel();
  await testSettingsSurviveGranularity();
  testDestroyIsNotTerminal();
  return [
    'read-aloud adapters preserve canonical anchors and sentence/block boundaries',
    'speech playback is deterministic across pause, resume, jump, stale events, rate, voices, and unsupported hosts',
    'the read-aloud and table-read panel exposes accessible controls, character voices, stage directions, notes, and source jumps',
    'switching sentence/block mode keeps the chosen speed and voice',
    'destroy is idempotent and a re-subscribed controller plays again',
  ];
}

void runTests().then(
  (tests) => {
    window.__readAloudResult = { ok: true, tests };
  },
  (error: unknown) => {
    window.__readAloudResult = {
      ok: false,
      tests: [],
      error: error instanceof Error ? `${error.stack ?? error.message}` : String(error),
    };
  },
);
