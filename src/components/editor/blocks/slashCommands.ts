// The "/" menu's logic: typing a slash at the start of a line or after a space opens a
// list of blocks to insert, filtered by what follows the slash. Arrow keys,
// Enter or a click choose; Escape closes it until the slash is retyped.
import type { Editor } from '@tiptap/react';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { AlertTriangle, ChevronRight, Code, Heading1, Heading2, Heading3, HelpCircle, Info, Lightbulb, List, ListChecks, ListOrdered, Mail, MessageSquare, Minus, Pilcrow, Quote, Scissors, StickyNote, Table, type LucideIcon, Mic, Square, Columns2 } from 'lucide-react';
import type { CalloutKind } from './extensions';

export interface SlashState { active: boolean; from: number; to: number; query: string; dismissed: number | null }
export const INACTIVE: SlashState = { active: false, from: 0, to: 0, query: '', dismissed: null };
export const slashMenuKey = new PluginKey<SlashState>('whSlashMenu');

/** The slash and the word after it, when the caret ends them. */
export function slashTrigger(state: EditorState): { from: number; to: number; query: string } | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const $from = selection.$from;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return null;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
  const match = /(?:^|\s)\/([\p{L}\p{N}]{0,24})$/u.exec(before);
  if (!match) return null;
  return { from: $from.pos - match[1].length - 1, to: $from.pos, query: match[1] };
}

export function createSlashMenuPlugin(onKey: (event: KeyboardEvent) => boolean) {
  return new Plugin<SlashState>({
    key: slashMenuKey,
    state: {
      init: () => INACTIVE,
      apply(tr, previous, _old, state) {
        const meta = tr.getMeta(slashMenuKey) as { dismiss?: number } | undefined;
        const trigger = slashTrigger(state);
        if (!trigger) return INACTIVE;
        const dismissed = meta?.dismiss ?? (previous.dismissed === trigger.from ? previous.dismissed : null);
        if (dismissed === trigger.from) return { ...INACTIVE, dismissed };
        return { active: true, ...trigger, dismissed: null };
      },
    },
    props: { handleKeyDown: (view, event) => (slashMenuKey.getState(view.state)?.active ? onKey(event) : false) },
  });
}

export interface SlashItem { id: string; es: string; en: string; keywords: string; icon: LucideIcon; run: (editor: Editor) => void }
const callout = (kind: CalloutKind) => (editor: Editor) => { editor.chain().focus().setCallout(kind).run(); };
export const SLASH_ITEMS: SlashItem[] = [
  { id: 'text', es: 'Texto', en: 'Text', keywords: 'parrafo paragraph texto', icon: Pilcrow, run: e => { e.chain().focus().setParagraph().run(); } },
  { id: 'h1', es: 'Título 1', en: 'Heading 1', keywords: 'titulo heading h1', icon: Heading1, run: e => { e.chain().focus().setHeading({ level: 1 }).run(); } },
  { id: 'h2', es: 'Título 2', en: 'Heading 2', keywords: 'titulo heading h2 subtitulo', icon: Heading2, run: e => { e.chain().focus().setHeading({ level: 2 }).run(); } },
  { id: 'h3', es: 'Título 3', en: 'Heading 3', keywords: 'titulo heading h3', icon: Heading3, run: e => { e.chain().focus().setHeading({ level: 3 }).run(); } },
  { id: 'bullet', es: 'Lista', en: 'Bulleted list', keywords: 'lista vinetas bullet list', icon: List, run: e => { e.chain().focus().toggleBulletList().run(); } },
  { id: 'ordered', es: 'Lista numerada', en: 'Numbered list', keywords: 'lista numerada ordered numbered', icon: ListOrdered, run: e => { e.chain().focus().toggleOrderedList().run(); } },
  { id: 'checklist', es: 'Lista de tareas', en: 'Checklist', keywords: 'tareas casillas checklist todo task', icon: ListChecks, run: e => { e.chain().focus().setChecklist().run(); } },
  { id: 'quote', es: 'Cita', en: 'Quote', keywords: 'cita quote blockquote', icon: Quote, run: e => { e.chain().focus().toggleBlockquote().run(); } },
  { id: 'attributed', es: 'Cita con autor', en: 'Quote with attribution', keywords: 'cita autor atribucion quote attribution epigrafe epigraph', icon: Quote, run: e => { e.chain().focus().setAttributedQuote().run(); } },
  { id: 'note', es: 'Nota', en: 'Note', keywords: 'nota callout aviso note', icon: StickyNote, run: callout('note') },
  { id: 'info', es: 'Información', en: 'Info', keywords: 'informacion info callout', icon: Info, run: callout('info') },
  { id: 'question', es: 'Pregunta', en: 'Question', keywords: 'pregunta duda question callout', icon: HelpCircle, run: callout('question') },
  { id: 'tip', es: 'Idea', en: 'Tip', keywords: 'idea consejo tip callout', icon: Lightbulb, run: callout('tip') },
  { id: 'readaloud', es: 'Leer en voz alta', en: 'Read aloud', keywords: 'leer voz alta narrar read aloud box caja manual', icon: Mic, run: callout('readaloud') },
  { id: 'sidebar', es: 'Recuadro', en: 'Sidebar', keywords: 'recuadro caja descriptiva sidebar box manual', icon: Square, run: callout('sidebar') },
  { id: 'columnbreak', es: 'Salto de columna', en: 'Column break', keywords: 'salto columna column break manual', icon: Columns2, run: e => { e.chain().focus().insertColumnBreak().run(); } },
  { id: 'warning', es: 'Aviso', en: 'Warning', keywords: 'aviso peligro warning callout', icon: AlertTriangle, run: callout('warning') },
  { id: 'toggle', es: 'Desplegable', en: 'Toggle', keywords: 'desplegable plegable toggle details', icon: ChevronRight, run: e => { e.chain().focus().setToggle().run(); } },
  { id: 'sent', es: 'Mensaje enviado', en: 'Sent message', keywords: 'mensaje chat sms whatsapp enviado sent message text', icon: MessageSquare, run: e => { e.chain().focus().setMessage('sent').run(); } },
  { id: 'received', es: 'Mensaje recibido', en: 'Received message', keywords: 'mensaje chat sms whatsapp recibido received message text', icon: MessageSquare, run: e => { e.chain().focus().setMessage('received').run(); } },
  { id: 'letter', es: 'Carta', en: 'Letter', keywords: 'carta letter misiva', icon: Mail, run: e => { e.chain().focus().setLetter().run(); } },
  { id: 'email', es: 'Correo electrónico', en: 'Email', keywords: 'email correo mail mensaje electronico', icon: Mail, run: e => { e.chain().focus().setEmail().run(); } },
  { id: 'scene', es: 'Separador de escena', en: 'Scene break', keywords: 'separador escena scene break hr linea', icon: Minus, run: e => { e.chain().focus().setHorizontalRule().run(); } },
  { id: 'table', es: 'Tabla', en: 'Table', keywords: 'tabla table', icon: Table, run: e => { e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); } },
  { id: 'page', es: 'Salto de página', en: 'Page break', keywords: 'salto pagina page break', icon: Scissors, run: e => { e.chain().focus().insertPageBreak().run(); } },
  { id: 'code', es: 'Código', en: 'Code', keywords: 'codigo code', icon: Code, run: e => { e.chain().focus().toggleCodeBlock().run(); } },
];
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
export function slashMatches(query: string, locale: string): SlashItem[] {
  const q = fold(query);
  return SLASH_ITEMS.filter(item => !q || fold(`${locale === 'en' ? item.en : item.es} ${item.keywords}`).split(/\s+/).some(word => word.startsWith(q)));
}

