// ============================================================================
// Ghost text in the editor — behaviour on a real Tiptap editor in a real DOM
// ============================================================================
//
// Run with:  electron scripts/run-focused-browser-tests.cjs \
//              tests/ghost-text-editor.browser.tsx testGhostTextEditor
//
// The model is a fake that answers with a fixed sentence (or hangs), so what
// is tested is everything the editor does around it: when it asks, what it
// ignores, what Tab / Esc / typing do, what reaches the document and the undo
// history, and that nothing is asked while the setting is off.

import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { undoDepth } from '@tiptap/pm/history';
import { Selection, TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { GhostText, ghostSuggestionOf, type GhostTextHost } from '@/components/editor/ghostText/GhostTextExtension';
import TiptapEditor from '@/components/editor/TiptapEditor';
import { parseGhostSetting, useGhostTextStore } from '@/stores/ghostTextStore';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const DELAY = 40;
const PARAGRAPH = 'Era de noche en el puerto. Ana abrió la puerta y miró hacia la calle vacía.';
// No leading space: the tests type a trailing space first, as the real trim would see it.
const SUGGESTION = 'Nadie esperaba en la esquina.';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, label: string, timeoutMs = 2500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await sleep(10);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

interface Call {
  before: string;
  signal: AbortSignal;
}

interface Rig {
  editor: Editor;
  element: HTMLElement;
  calls: Call[];
  changes: Array<string | null>;
  updates: { count: number };
  flags: { enabled: boolean };
  /** What the fake model answers; replace it to hang or to answer late. */
  answer: { current: (call: Call) => Promise<string | null> };
  destroy: () => void;
}

function mount(content = `<p>${PARAGRAPH}</p>`, enabled = true): Rig {
  const element = document.createElement('div');
  element.className = 'tiptap-editor';
  element.style.cssText = 'position:relative;width:640px;';
  document.body.appendChild(element);

  const calls: Call[] = [];
  const changes: Array<string | null> = [];
  const flags = { enabled };
  const answer = { current: (_call: Call): Promise<string | null> => Promise.resolve(SUGGESTION) };
  const host: GhostTextHost = {
    enabled: () => flags.enabled,
    request: (input) => {
      const call = { before: input.before, signal: input.signal };
      calls.push(call);
      return answer.current(call);
    },
    onChange: (suggestion) => changes.push(suggestion),
  };
  const updates = { count: 0 };
  const editor = new Editor({
    element,
    extensions: [StarterKit, GhostText.configure({ host: () => host, delayMs: DELAY })],
    content,
  });
  editor.on('update', () => {
    updates.count += 1;
  });
  editor.view.focus();
  editor.view.dispatch(editor.state.tr.setSelection(Selection.atEnd(editor.state.doc)));
  return {
    editor,
    element,
    calls,
    changes,
    updates,
    flags,
    answer,
    destroy: () => {
      editor.destroy();
      element.remove();
    },
  };
}

/** Types at the end of the document, like the keyboard would. */
function typeAtEnd(editor: Editor, text: string): void {
  // Synchronous focus: Tiptap's `focus` command waits a frame, and the pause
  // this test measures is 40 ms.
  editor.view.focus();
  editor.view.dispatch(editor.state.tr.setSelection(Selection.atEnd(editor.state.doc)).insertText(text));
}

function press(editor: Editor, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  editor.view.dom.dispatchEvent(event);
  return event;
}

const ghostNode = (rig: Rig): HTMLElement | null => rig.element.querySelector('.wh-ghost-text');

async function shown(rig: Rig): Promise<void> {
  await until(() => ghostSuggestionOf(rig.editor.state) !== null, 'a suggestion on screen');
}

export async function testGhostTextEditor(): Promise<string[]> {
  const passed: string[] = [];

  // -- off by default --------------------------------------------------------
  assert(useGhostTextStore.getState().enabled === false, 'the stored setting starts off');
  assert(parseGhostSetting(undefined) === false && parseGhostSetting('') === false && parseGhostSetting('yes') === false, 'a missing or odd value is off');
  assert(parseGhostSetting('true') === true, 'only an explicit true turns it on');
  {
    const rig = mount(undefined, false);
    typeAtEnd(rig.editor, ' Más texto.');
    await sleep(DELAY * 6);
    assert(rig.calls.length === 0, 'with the setting off, the model is never asked');
    assert(ghostNode(rig) === null && ghostSuggestionOf(rig.editor.state) === null, 'and nothing is drawn');
    rig.destroy();
  }
  passed.push('off by default: stored value off, nothing asked, nothing drawn');

  // -- a pause shows a suggestion; it is not part of the document ------------
  {
    const rig = mount();
    const htmlBefore = rig.editor.getHTML();
    const depthBefore = undoDepth(rig.editor.state);
    typeAtEnd(rig.editor, ' ');
    await sleep(DELAY / 2);
    assert(rig.calls.length === 0, 'nothing is asked before the pause is over');
    await shown(rig);
    assert(rig.calls.length === 1, 'one request for one pause');
    assert(rig.calls[0].before.endsWith('miró hacia la calle vacía. '), 'the model gets the text before the cursor');
    const node = ghostNode(rig);
    assert(node && node.textContent === SUGGESTION, 'the suggestion is drawn after the cursor');
    assert(node.getAttribute('aria-hidden') === 'true', 'the drawn copy is hidden from assistive technology (the live region announces it)');
    assert(rig.editor.getHTML() === `<p>${PARAGRAPH} </p>` && !htmlBefore.includes('Nadie'), 'the document holds only what was typed');
    assert(!rig.editor.getText().includes('Nadie esperaba'), 'neither does its plain text');
    assert(rig.updates.count === 1, 'only the writer\'s own typing reached onUpdate (saving); the suggestion did not');
    assert(undoDepth(rig.editor.state) === depthBefore + 1, 'and the suggestion added nothing to the undo history');
    assert(rig.changes.at(-1) === SUGGESTION, 'the host was told, for the screen-reader announcement');
    rig.destroy();
  }
  passed.push('pause → request → ghost drawn; not in the document, not in saved content, not in undo history');

  // -- Tab accepts, as one undo step -----------------------------------------
  {
    const rig = mount();
    typeAtEnd(rig.editor, ' ');
    await shown(rig);
    const typedHtml = rig.editor.getHTML();
    const updates = rig.updates.count;
    const depth = undoDepth(rig.editor.state);
    const tab = press(rig.editor, 'Tab');
    assert(tab.defaultPrevented, 'Tab is spent on the suggestion');
    assert(ghostSuggestionOf(rig.editor.state) === null && ghostNode(rig) === null, 'the ghost is gone');
    assert(rig.editor.getText().endsWith(`vacía. Nadie esperaba en la esquina.`), 'the sentence is now text, with the right spacing');
    assert(rig.updates.count === updates + 1, 'accepting is a real edit: onUpdate fires once');
    assert(undoDepth(rig.editor.state) === depth + 1, 'one undo step');
    assert(rig.editor.state.selection.from === rig.editor.state.doc.content.size - 1, 'the cursor sits after the accepted text');
    const callsAfterAccept = rig.calls.length;
    await sleep(DELAY * 6);
    assert(rig.calls.length === callsAfterAccept, 'accepting does not chain another request until the writer types again');
    rig.editor.commands.undo();
    assert(rig.editor.getHTML() === typedHtml, 'one Ctrl+Z removes the whole accepted sentence and nothing else');
    rig.destroy();
  }
  passed.push('Tab accepts the whole suggestion: one edit, one undo step, no chained request');

  // -- Tab without a suggestion is left alone --------------------------------
  {
    const rig = mount();
    assert(press(rig.editor, 'Tab').defaultPrevented === false, 'with no suggestion Tab is not ours');
    assert(press(rig.editor, 'Escape').defaultPrevented === false, 'nor Escape');
    rig.destroy();
  }
  passed.push('Tab and Esc are untouched while no suggestion is showing');

  // -- Esc dismisses and is not passed on ------------------------------------
  {
    const rig = mount();
    let reachedWindow = false;
    const spy = (event: KeyboardEvent) => {
      if (event.key === 'Escape') reachedWindow = true;
    };
    window.addEventListener('keydown', spy);
    typeAtEnd(rig.editor, ' ');
    await shown(rig);
    const htmlBefore = rig.editor.getHTML();
    const esc = press(rig.editor, 'Escape');
    assert(esc.defaultPrevented, 'Esc is spent on the suggestion');
    assert(!reachedWindow, 'and does not reach the window, so it does not also leave focus mode');
    assert(ghostSuggestionOf(rig.editor.state) === null && ghostNode(rig) === null, 'the ghost is gone');
    assert(rig.editor.getHTML() === htmlBefore, 'the document is untouched');
    await sleep(DELAY * 5);
    assert(rig.calls.length === 1, 'dismissing does not ask again until the writer types');
    press(rig.editor, 'Escape');
    assert(reachedWindow, 'a second Esc (nothing showing) reaches the window as usual');
    window.removeEventListener('keydown', spy);
    rig.destroy();
  }
  passed.push('Esc dismisses without touching the document and without leaving focus mode');

  // -- typing and cursor moves dismiss; pause asks again ---------------------
  {
    const rig = mount();
    typeAtEnd(rig.editor, ' ');
    await shown(rig);
    typeAtEnd(rig.editor, 'Y');
    assert(ghostSuggestionOf(rig.editor.state) === null && ghostNode(rig) === null, 'any typing drops the suggestion at once');
    await until(() => rig.calls.length === 2, 'a new request after the next pause');
    await shown(rig);
    rig.editor.commands.setTextSelection(5);
    assert(ghostSuggestionOf(rig.editor.state) === null, 'moving the cursor drops it too');
    rig.destroy();
  }
  passed.push('typing or moving the cursor dismisses; the next pause asks again');

  // -- cancel in flight ------------------------------------------------------
  {
    const rig = mount();
    const late: Array<(value: string | null) => void> = [];
    rig.answer.current = () => new Promise((resolve) => late.push(resolve));
    typeAtEnd(rig.editor, ' ');
    await until(() => rig.calls.length === 1, 'the first request');
    assert(!rig.calls[0].signal.aborted, 'live while the writer is idle');
    typeAtEnd(rig.editor, 'q');
    assert(rig.calls[0].signal.aborted, 'a new keystroke aborts the request in flight');
    late[0](' Respuesta tardía.');
    await sleep(DELAY / 2);
    assert(ghostSuggestionOf(rig.editor.state) === null, 'an answer that arrives late never lands on the new text');
    await until(() => rig.calls.length === 2, 'the second request');
    assert(!rig.calls[1].signal.aborted, 'the new request is live');
    late[1](' Respuesta buena.');
    await shown(rig);
    assert(ghostNode(rig)?.textContent === ' Respuesta buena.', 'the current answer is shown');
    rig.destroy();
  }
  passed.push('cancellation: a keystroke aborts the request in flight; a late answer is discarded');

  // -- debounce under fast typing -------------------------------------------
  {
    const rig = mount();
    for (let i = 0; i < 8; i++) {
      typeAtEnd(rig.editor, 'a');
      await sleep(DELAY / 4);
    }
    await shown(rig);
    assert(rig.calls.length === 1, 'eight quick keystrokes make one request, after the last');
    rig.destroy();
  }
  passed.push('debounce: a burst of typing makes a single request');

  // -- where it must not appear ---------------------------------------------
  {
    const rig = mount();
    rig.editor.commands.setTextSelection({ from: 3, to: 20 });
    await sleep(DELAY * 5);
    assert(rig.calls.length === 0, 'no request while text is selected');
    rig.editor.commands.setTextSelection(rig.editor.state.doc.content.size - 4);
    await sleep(DELAY * 5);
    assert(rig.calls.length === 0, 'no request inside a word');
    rig.destroy();
  }
  {
    const rig = mount(`<h2>Un título largo para el capítulo primero del libro</h2><p>${PARAGRAPH}</p>`);
    rig.editor.view.dispatch(rig.editor.state.tr.setSelection(TextSelection.create(rig.editor.state.doc, 1 + 'Un título largo para el capítulo primero del libro'.length)));
    await sleep(DELAY * 5);
    assert(rig.calls.length === 0, 'no request at the end of a heading');
    rig.destroy();
  }
  {
    const rig = mount();
    rig.editor.setEditable(false);
    typeAtEnd(rig.editor, ' ');
    rig.editor.commands.setTextSelection(rig.editor.state.doc.content.size - 1);
    await sleep(DELAY * 5);
    assert(rig.calls.length === 0, 'no request in a read-only editor');
    rig.destroy();
  }
  {
    const rig = mount('<p>Hola.</p>');
    typeAtEnd(rig.editor, ' ');
    await sleep(DELAY * 5);
    assert(rig.calls.length === 0, 'no request on an almost empty paragraph');
    rig.destroy();
  }
  {
    const rig = mount();
    rig.answer.current = () => Promise.resolve(null);
    typeAtEnd(rig.editor, ' ');
    await until(() => rig.calls.length === 1, 'the request');
    await sleep(DELAY * 3);
    assert(ghostNode(rig) === null && rig.changes.length === 0, 'a model that has nothing to say shows nothing');
    rig.destroy();
  }
  passed.push('ignored: selection, mid-word, heading, read-only, near-empty paragraph, empty answer');

  // -- blur, and the setting turning off ------------------------------------
  {
    const rig = mount();
    typeAtEnd(rig.editor, ' ');
    await shown(rig);
    rig.editor.view.dom.dispatchEvent(new FocusEvent('blur'));
    await until(() => ghostSuggestionOf(rig.editor.state) === null, 'dismissal on blur');
    rig.destroy();
  }
  {
    const rig = mount();
    typeAtEnd(rig.editor, ' ');
    await shown(rig);
    rig.flags.enabled = false;
    rig.editor.view.dispatch(rig.editor.state.tr.setMeta('anything', true));
    await until(() => ghostSuggestionOf(rig.editor.state) === null, 'dismissal when the setting is turned off');
    typeAtEnd(rig.editor, 'x');
    const asked = rig.calls.length;
    await sleep(DELAY * 5);
    assert(rig.calls.length === asked, 'and nothing more is asked');
    rig.destroy();
  }
  passed.push('blur dismisses; turning the setting off dismisses and stops asking');

  // -- Ctrl+Right takes one word at a time -----------------------------------
  {
    const rig = mount();
    rig.answer.current = () => Promise.resolve('uno dos tres.');
    typeAtEnd(rig.editor, ' ');
    await shown(rig);
    const depth = undoDepth(rig.editor.state);
    const first = press(rig.editor, 'ArrowRight', { ctrlKey: true });
    assert(first.defaultPrevented, 'Ctrl+→ is spent on the suggestion');
    assert(rig.editor.getText().endsWith('vacía. uno'), 'the first word went in');
    assert(ghostSuggestionOf(rig.editor.state) === ' dos tres.' && ghostNode(rig)?.textContent === ' dos tres.', 'and the rest is still showing');
    press(rig.editor, 'ArrowRight', { ctrlKey: true });
    assert(ghostSuggestionOf(rig.editor.state) === ' tres.', 'second word');
    press(rig.editor, 'ArrowRight', { ctrlKey: true });
    assert(ghostSuggestionOf(rig.editor.state) === null, 'last word leaves nothing');
    assert(/uno dos tres\.$/.test(rig.editor.getText()), 'the three words are in the text');
    assert(undoDepth(rig.editor.state) >= depth + 1, 'each acceptance is an undo step');
    await sleep(DELAY * 5);
    assert(rig.calls.length === 1, 'no chained request');
    rig.destroy();
  }
  passed.push('Ctrl+→ accepts one word at a time, keeping the rest showing');

  // -- the React editor: live region, toggle, setting off -------------------
  {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const calls: Call[] = [];
    let toggled = 0;
    let editor: Editor | null = null;
    const render = async (enabled: boolean) => {
      await act(async () => {
        root.render(
          createElement(TiptapEditor, {
            content: `<p>${PARAGRAPH}</p>`,
            onEditorReady: (instance: Editor | null) => {
              editor = instance ?? editor;
            },
            ghostText: {
              enabled,
              request: (input: Call) => {
                calls.push(input);
                return Promise.resolve(SUGGESTION);
              },
              onToggle: () => {
                toggled += 1;
              },
            },
          }),
        );
      });
    };
    await render(true);
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-pressed]');
    assert(toggle && toggle.getAttribute('aria-pressed') === 'true' && (toggle.getAttribute('aria-label') ?? '').length > 0, 'the toolbar toggle is a labelled pressed button');
    toggle.click();
    assert(toggled === 1, 'the toggle calls the host');
    const proseMirror = container.querySelector<HTMLElement>('.ProseMirror');
    assert(proseMirror, 'the editor is mounted');
    const live = container.querySelector('[data-ghost-announcer]');
    assert(live && live.getAttribute('aria-live') === 'polite' && live.getAttribute('role') === 'status', 'a polite live region exists');
    assert((live.textContent ?? '') === '', 'it is empty until there is a suggestion');

    assert(editor, 'the editor instance was handed to the host');
    const live_editor: Editor = editor;
    await act(async () => {
      typeAtEnd(live_editor, ' ');
      await sleep(900 + 400);
    });
    assert(calls.length === 1, 'the real editor asks after the real 900 ms pause');
    assert((live.textContent ?? '').includes('Nadie esperaba en la esquina.'), 'the live region announces the suggestion');
    assert(proseMirror.querySelector('.wh-ghost-text')?.textContent === SUGGESTION, 'and it is drawn in the page');

    await render(false);
    assert(!proseMirror.querySelector('.wh-ghost-text'), 'switching the setting off removes the drawn suggestion');
    assert((live.textContent ?? '') === '', 'and clears the announcement');
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
  passed.push('TiptapEditor: labelled toggle, polite live region announces the suggestion, setting off clears it');

  return passed;
}
