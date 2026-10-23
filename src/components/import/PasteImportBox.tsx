import { PASTE_SEPARATOR, splitPasted } from '@/services/worldFolderImport/pasted';

const control = 'min-h-10 min-w-0 w-full rounded border border-border bg-elevated px-3 py-2 text-sm text-text-primary focus-visible:outline-accent-gold';

/** Text typed or pasted instead of a file; it enters the review as a virtual pasted.md. */
export default function PasteImportBox({ text, name, onText, onName, es, disabled }: { text: string; name: string; onText: (value: string) => void; onName: (value: string) => void; es: boolean; disabled?: boolean }) {
  const pieces = text.trim() ? splitPasted(text).length : 0;
  return <fieldset disabled={disabled} className="grid min-w-0 gap-2 rounded-lg border border-border p-3" data-testid="world-folder-paste">
    <legend className="px-1 text-sm text-accent-gold">{es ? 'Pegar texto' : 'Paste text'}</legend>
    <p className="text-xs text-text-muted">{es ? `Markdown o texto plano. Para pegar varios documentos, sepáralos con una línea que contenga solo ${PASTE_SEPARATOR}.` : `Markdown or plain text. To paste several documents, separate them with a line that holds only ${PASTE_SEPARATOR}.`}</p>
    <label className="grid gap-1 text-xs text-text-muted">{es ? 'Nombre (opcional)' : 'Name (optional)'}
      <input className={control} data-testid="world-folder-paste-name" value={name} maxLength={80} placeholder="pasted" onChange={event => onName(event.target.value)} />
    </label>
    <textarea className={`${control} min-h-28 font-mono`} data-testid="world-folder-paste-text" aria-label={es ? 'Texto pegado' : 'Pasted text'} value={text} placeholder={es ? '# Título\nPega aquí tus notas…' : '# Title\nPaste your notes here…'} onChange={event => onText(event.target.value)} />
    {pieces > 0 && <p className="text-xs text-text-muted" data-testid="world-folder-paste-count">{es ? `${pieces} documento${pieces === 1 ? '' : 's'} pegado${pieces === 1 ? '' : 's'}` : `${pieces} pasted document${pieces === 1 ? '' : 's'}`}</p>}
  </fieldset>;
}
