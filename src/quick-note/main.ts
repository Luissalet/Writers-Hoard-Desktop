// ============================================================================
// Quick note — floating capture window (Electron only)
// ============================================================================
//
// Loaded by electron/main.ts into a frameless always-on-top window that the
// global Ctrl+Shift+N summons when the app is NOT focused. It is deliberately
// standalone: no React, no Tailwind, no Dexie. It shows a box, takes a line of
// text, hands it to the main process and disappears. Anything heavier would be
// felt every single time, because this window exists to be faster than the
// thought it's catching.
//
// Strings are inlined (the app's i18n lives in the main renderer's store) —
// the locale rides along in the context payload.

type NoteKind = 'note' | 'quote' | 'idea' | 'word';

interface QuickNoteContext {
  projectId: string | null;
  projectTitle: string | null;
  locale: string;
}

const STRINGS = {
  es: {
    brand: 'Nota rápida',
    placeholder: 'Apunta lo que se te ha ocurrido…',
    hint: 'Enter guarda · Shift+Enter salta línea · Esc cierra',
    inbox: 'Inbox',
    saved: 'Guardado',
    error: 'No se pudo guardar',
    kind: { note: 'Nota', quote: 'Cita', idea: 'Idea', word: 'Palabra' },
  },
  en: {
    brand: 'Quick note',
    placeholder: 'Jot down what just occurred to you…',
    hint: 'Enter saves · Shift+Enter new line · Esc closes',
    inbox: 'Inbox',
    saved: 'Saved',
    error: "Couldn't save",
    kind: { note: 'Note', quote: 'Quote', idea: 'Idea', word: 'Word' },
  },
} as const;

const KIND_COLORS: Record<NoteKind, string> = {
  note: '#e8c577',
  quote: '#7c5cbf',
  idea: '#d4a843',
  word: '#4a9e6d',
};

const KINDS: NoteKind[] = ['note', 'quote', 'idea', 'word'];

// This page only ever loads inside the Electron shell, so the bridge is there.
const api = window.electronAPI!;

let kind: NoteKind = 'note';
let context: QuickNoteContext = { projectId: null, projectTitle: null, locale: 'es' };
/** false → save to the project-less inbox even when a project is open. */
let toProject = true;

const root = document.getElementById('app')!;
const strings = () => (context.locale === 'en' ? STRINGS.en : STRINGS.es);

// --- Markup ---------------------------------------------------------------

const header = document.createElement('div');
header.className = 'row';

const chips = document.createElement('div');
chips.className = 'row';

const drag = document.createElement('div');
drag.className = 'drag';

const brand = document.createElement('span');
brand.className = 'brand';

const textarea = document.createElement('textarea');
textarea.rows = 3;
textarea.spellcheck = true;

const footer = document.createElement('div');
footer.className = 'footer';

const targetButton = document.createElement('button');
targetButton.className = 'target';
targetButton.type = 'button';

const status = document.createElement('span');
status.className = 'hint';

header.append(chips, drag, brand);
footer.append(targetButton, status);
root.append(header, textarea, footer);

// --- Rendering ------------------------------------------------------------

function renderChips(): void {
  chips.replaceChildren(
    ...KINDS.map((k) => {
      const button = document.createElement('button');
      button.className = 'chip';
      button.type = 'button';
      button.textContent = strings().kind[k];
      button.dataset.active = String(k === kind);
      if (k === kind) button.style.background = KIND_COLORS[k];
      button.addEventListener('click', () => {
        kind = k;
        renderChips();
        textarea.focus();
      });
      return button;
    }),
  );
}

function renderTarget(): void {
  const label = toProject && context.projectTitle ? context.projectTitle : strings().inbox;
  targetButton.replaceChildren(document.createTextNode('→ '));
  const span = document.createElement('span');
  span.textContent = label;
  targetButton.append(span);
  // Only clickable when there IS a project to choose between.
  targetButton.disabled = !context.projectId;
  targetButton.style.cursor = context.projectId ? 'pointer' : 'default';
}

function render(): void {
  brand.textContent = strings().brand;
  textarea.placeholder = strings().placeholder;
  status.textContent = strings().hint;
  status.className = 'hint';
  renderChips();
  renderTarget();
}

// --- Behaviour ------------------------------------------------------------

function reset(): void {
  textarea.value = '';
  kind = 'note';
  toProject = true;
  render();
  textarea.focus();
}

async function loadContext(): Promise<void> {
  try {
    context = await api.quickNote.getContext();
  } catch {
    context = { projectId: null, projectTitle: null, locale: 'es' };
  }
  render();
}

async function submit(): Promise<void> {
  const text = textarea.value.trim();
  if (!text) return;
  const projectId = toProject ? context.projectId : null;
  try {
    const result = await api.quickNote.submit({ text, kind, projectId });
    if (!result?.ok) throw new Error('rejected');
    status.textContent = strings().saved;
    status.className = 'saved';
    textarea.value = '';
    // Let the confirmation land for a beat, then get out of the way.
    window.setTimeout(() => api.quickNote.close(), 260);
  } catch {
    status.textContent = strings().error;
    status.className = 'error';
  }
}

targetButton.addEventListener('click', () => {
  if (!context.projectId) return;
  toProject = !toProject;
  renderTarget();
  textarea.focus();
});

textarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void submit();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    api.quickNote.close();
  }
});

// The window is reused across summons (creating it each time costs ~150ms of
// nothing). Hiding and showing it flips document visibility, which is the
// precise "you're up again" signal — reset there, not on focus, so clicking
// back into a half-typed note doesn't wipe it.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  void loadContext();
  reset();
});

window.addEventListener('focus', () => textarea.focus());

render();
void loadContext();
textarea.focus();
