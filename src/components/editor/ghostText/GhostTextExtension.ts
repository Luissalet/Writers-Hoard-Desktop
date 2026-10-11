import { Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import {
  GHOST_DEBOUNCE_MS,
  GHOST_MAX_BEFORE_CHARS,
  boundedBefore,
  createGhostScheduler,
  ghostEligibility,
  splitFirstWord,
  type GhostSnapshot,
  type GhostTimers,
} from '@/services/ghostText/ghostText';

/**
 * Ghost text: a faint continuation after the cursor.
 *
 * The suggestion is a ProseMirror WIDGET DECORATION, the same trick the find
 * bar uses for its matches: it is drawn over the document but is not in it. So
 * it never reaches `onChange` or the autosave, never enters the undo history,
 * and is not selectable. It becomes text only when accepted — one transaction,
 * one undo step.
 *
 * Lifecycle, all in `view.update` so it follows every transaction:
 *   typing or moving the cursor  → the suggestion on screen is dropped (see
 *                                  `apply`), the countdown restarts, and any
 *                                  request still in flight is aborted;
 *   a pause of `delayMs`         → one request, for the text as it stands;
 *   the answer arrives           → shown only if the document and the cursor
 *                                  are exactly as they were when it was asked.
 * Nothing in that chain is awaited by typing.
 */

/** What the editor needs from the app; read through a function on every use. */
export interface GhostTextHost {
  /** The setting. Read again at every keystroke and again when the timer fires. */
  enabled: () => boolean;
  /** One continuation for the text before the cursor, or null. Must honour `signal`. */
  request: (input: { before: string; signal: AbortSignal }) => Promise<string | null>;
  /** The suggestion on screen changed (null = none); screen readers are told. */
  onChange?: (suggestion: string | null) => void;
}

export interface GhostTextOptions {
  host: () => GhostTextHost | null;
  delayMs: number;
  /** Tests only: a clock they can drive. */
  timers?: GhostTimers;
}

interface Ghost {
  text: string;
  /** Document position of the cursor the suggestion hangs from. */
  pos: number;
}

interface GhostState {
  ghost: Ghost | null;
  /**
   * Set when the writer just accepted a suggestion: no new one is requested
   * until they type again, so accepting does not start a chain of unasked-for
   * sentences.
   */
  quiet: boolean;
}

type GhostMeta =
  | { type: 'set'; text: string; pos: number }
  | { type: 'clear' }
  | { type: 'accept'; rest: string; pos: number };

export const ghostTextKey = new PluginKey<GhostState>('whGhostText');

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    ghostText: {
      /** Insert the whole suggestion. False when there is none. */
      acceptGhostText: () => ReturnType;
      /** Insert the suggestion's next word and keep the rest showing. */
      acceptGhostWord: () => ReturnType;
      /** Drop the suggestion. False when there is none. */
      dismissGhostText: () => ReturnType;
    };
  }
}

/** The suggestion on screen, if any. */
export function ghostSuggestionOf(state: EditorState): string | null {
  return ghostTextKey.getState(state)?.ghost?.text ?? null;
}

const IDLE: GhostState = { ghost: null, quiet: false };

function snapshotOf(view: EditorView): GhostSnapshot {
  const { state } = view;
  const { selection } = state;
  const { $from } = selection;
  const parent = $from.parent;
  const reach = Math.max(0, $from.pos - GHOST_MAX_BEFORE_CHARS * 2);
  return {
    editable: view.editable,
    focused: view.hasFocus(),
    composing: view.composing,
    selectionEmpty: selection.empty,
    parentType: parent.type.name,
    paragraphBefore: parent.isTextblock ? parent.textBetween(0, $from.parentOffset, undefined, ' ') : '',
    paragraphAfter: parent.isTextblock ? parent.textBetween($from.parentOffset, parent.content.size, undefined, ' ') : '',
    before: boundedBefore(state.doc.textBetween(reach, $from.pos, '\n', ' ')),
  };
}

/** Writes the acceptance into `tr`. False (and `tr` untouched) when it does not apply. */
function writeAcceptance(tr: Transaction, state: GhostState, mode: 'all' | 'word'): boolean {
  const ghost = state.ghost;
  if (!ghost || !tr.selection.empty || tr.selection.from !== ghost.pos) return false;
  const { word, rest } = mode === 'word' ? splitFirstWord(ghost.text) : { word: ghost.text, rest: '' };
  if (!word) return false;
  // Close the history group first: the accepted text is one undo step of its
  // own, never glued to the sentence the writer was typing a second ago.
  closeHistory(tr);
  tr.insertText(word);
  const meta: GhostMeta = { type: 'accept', rest: rest.trim() ? rest : '', pos: tr.selection.from };
  tr.setMeta(ghostTextKey, meta);
  return true;
}

function ghostElement(text: string): HTMLElement {
  const element = document.createElement('span');
  element.className = 'wh-ghost-text';
  element.setAttribute('data-wh-ghost', '');
  // The announcement is the live region's job (TiptapEditor); reading the
  // widget in place would interleave it with the text being written.
  element.setAttribute('aria-hidden', 'true');
  element.textContent = text;
  return element;
}

export const GhostText = Extension.create<GhostTextOptions>({
  name: 'ghostText',
  // Before the list and indent keymaps: while a suggestion is up, Tab is ours.
  priority: 1000,

  addOptions() {
    return { host: () => null, delayMs: GHOST_DEBOUNCE_MS };
  },

  addCommands() {
    return {
      acceptGhostText:
        () =>
        ({ tr, state, dispatch }) => {
          const current = ghostTextKey.getState(state);
          if (!current || !writeAcceptance(tr, current, 'all')) return false;
          if (dispatch) tr.scrollIntoView();
          return true;
        },
      acceptGhostWord:
        () =>
        ({ tr, state, dispatch }) => {
          const current = ghostTextKey.getState(state);
          if (!current || !writeAcceptance(tr, current, 'word')) return false;
          if (dispatch) tr.scrollIntoView();
          return true;
        },
      dismissGhostText:
        () =>
        ({ tr, state, dispatch }) => {
          if (!ghostTextKey.getState(state)?.ghost) return false;
          if (dispatch) tr.setMeta(ghostTextKey, { type: 'clear' } satisfies GhostMeta);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;

    const dismiss = (view: EditorView): void => {
      if (ghostTextKey.getState(view.state)?.ghost) {
        view.dispatch(view.state.tr.setMeta(ghostTextKey, { type: 'clear' } satisfies GhostMeta));
      }
    };

    const accept = (view: EditorView, mode: 'all' | 'word'): boolean => {
      const current = ghostTextKey.getState(view.state);
      if (!current?.ghost) return false;
      const tr = view.state.tr;
      if (!writeAcceptance(tr, current, mode)) {
        dismiss(view);
        return true;
      }
      view.dispatch(tr.scrollIntoView());
      return true;
    };

    return [
      new Plugin<GhostState>({
        key: ghostTextKey,

        state: {
          init: () => IDLE,
          apply(tr, value) {
            const meta = tr.getMeta(ghostTextKey) as GhostMeta | undefined;
            if (meta?.type === 'set') return { ghost: { text: meta.text, pos: meta.pos }, quiet: false };
            if (meta?.type === 'clear') return { ghost: null, quiet: value.quiet };
            if (meta?.type === 'accept') {
              return { ghost: meta.rest ? { text: meta.rest, pos: meta.pos } : null, quiet: true };
            }
            // Typing, deleting, pasting, undo, a click or an arrow key: whatever
            // the writer does next, the suggestion was for a text that is gone.
            if (tr.docChanged) return IDLE;
            if (tr.selectionSet && value.ghost) return { ghost: null, quiet: value.quiet };
            return value;
          },
        },

        props: {
          decorations(state) {
            const ghost = ghostTextKey.getState(state)?.ghost;
            if (!ghost || ghost.pos > state.doc.content.size) return null;
            return DecorationSet.create(state.doc, [
              Decoration.widget(ghost.pos, () => ghostElement(ghost.text), {
                side: 1,
                ignoreSelection: true,
                key: `wh-ghost:${ghost.pos}:${ghost.text}`,
              }),
            ]);
          },

          handleKeyDown(view, event) {
            if (view.composing || !ghostTextKey.getState(view.state)?.ghost) return false;
            const bare = !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
            if (event.key === 'Tab' && bare) {
              event.preventDefault();
              return accept(view, 'all');
            }
            if (event.key === 'Escape' && bare) {
              event.preventDefault();
              // Spent on the suggestion: it must not also leave focus mode.
              event.stopPropagation();
              dismiss(view);
              return true;
            }
            if (event.key === 'ArrowRight' && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
              event.preventDefault();
              return accept(view, 'word');
            }
            return false;
          },

          handleDOMEvents: {
            blur(view) {
              dismiss(view);
              return false;
            },
          },
        },

        view() {
          const scheduler = createGhostScheduler(options.delayMs, options.timers);
          let announced: string | null = null;

          const pause = (view: EditorView): void => {
            const host = options.host();
            if (!host?.enabled() || view.isDestroyed) return;
            const snapshot = snapshotOf(view);
            // Focus is judged when the countdown ends, not here: a cursor that
            // has only just been placed may not have taken focus yet.
            if (!ghostEligibility({ ...snapshot, focused: true }).ok) return;
            const docAtAsk = view.state.doc;
            const cursorAtAsk = view.state.selection.from;

            scheduler.schedule(async (signal) => {
              const live = options.host();
              if (!live?.enabled() || view.isDestroyed) return;
              // The countdown ran out with the editor still focused and idle?
              const now = snapshotOf(view);
              if (!ghostEligibility(now).ok) return;
              const text = await live.request({ before: snapshot.before, signal });
              if (signal.aborted || view.isDestroyed || !text) return;
              // Only for the text it was asked about, with the cursor where it was.
              if (view.state.doc !== docAtAsk || view.state.selection.from !== cursorAtAsk) return;
              view.dispatch(view.state.tr.setMeta(ghostTextKey, { type: 'set', text, pos: cursorAtAsk } satisfies GhostMeta));
            });
          };

          return {
            update(view, previous) {
              const host = options.host();
              const current = ghostTextKey.getState(view.state) ?? IDLE;

              const text = current.ghost?.text ?? null;
              if (text !== announced) {
                announced = text;
                host?.onChange?.(text);
              }

              if (!host?.enabled()) {
                scheduler.cancel();
                // Not from inside the update that is running: a dispatch here
                // would re-enter it.
                if (current.ghost) queueMicrotask(() => { if (!view.isDestroyed) dismiss(view); });
                return;
              }
              // A transaction that changed neither text nor cursor (our own
              // "show it", a plugin's bookkeeping) is not a keystroke.
              if (previous.doc === view.state.doc && previous.selection.eq(view.state.selection)) return;

              scheduler.cancel();
              if (current.ghost || current.quiet) return;
              pause(view);
            },
            destroy() {
              scheduler.cancel();
              if (announced !== null) options.host()?.onChange?.(null);
            },
          };
        },
      }),
    ];
  },
});
