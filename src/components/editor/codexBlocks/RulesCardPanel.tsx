// A rules card from a Codex card: pick the layout (spell, magic item,
// creature), check which of the card's properties fills each slot — guessed
// from their names — and insert the box. Inside a box already in the text,
// "Actualizar" fills it again from the card as it is now, with the same mapping.
import { useMemo, useState, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/react';
import type { CodexEntry } from '@/types';
import { RULES_LAYOUTS, RULES_LAYOUT_LABELS, RULES_SLOTS, RULES_SLOT_LABELS, guessRulesSlots, normalizeRulesSlots, rulesCardHtml, rulesFieldNames, type RulesLayout } from '@/engines/codex/rulesCards';

const control = 'min-h-8 rounded border border-border bg-deep px-2 text-xs text-text-primary';
const button = 'inline-flex min-h-8 items-center justify-center rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary hover:bg-elevated disabled:opacity-50';

export default function RulesCardPanel({ editor, entry, locale, onDone, onCancel }: { editor: Editor; entry: CodexEntry; locale: 'es' | 'en'; onDone: (message: string) => void; onCancel: () => void }) {
  const names = useMemo(() => rulesFieldNames(entry), [entry]);
  const [layout, setLayout] = useState<RulesLayout>('spell');
  const [slots, setSlots] = useState<Record<string, string>>(() => guessRulesSlots('spell', names));
  const es = locale === 'es';
  const preview = rulesCardHtml(layout, entry, slots, locale);
  return <section data-testid="rules-card-panel" aria-label={es ? 'Ficha de reglas' : 'Rules card'} className="mt-3 space-y-2 rounded border border-border p-2 text-xs text-text-primary">
    <p className="font-semibold">{entry.title}</p>
    <label className="flex items-center gap-2 text-text-muted">{es ? 'Formato' : 'Layout'}
      <select data-testid="rules-layout" className={control} value={layout} onChange={event => { const next = event.target.value as RulesLayout; setLayout(next); setSlots(guessRulesSlots(next, names)); }}>
        {RULES_LAYOUTS.map(value => <option key={value} value={value}>{RULES_LAYOUT_LABELS[value][locale]}</option>)}
      </select>
    </label>
    <p className="text-text-muted">{es ? 'Qué propiedad de la ficha rellena cada hueco (adivinado por el nombre; cámbialo si hace falta):' : 'Which property of the card fills each slot (guessed from its name; change it if needed):'}</p>
    <div className="grid grid-cols-2 gap-1">
      {RULES_SLOTS[layout].map(slot => <label key={slot} className="flex min-w-0 flex-col text-text-muted">{RULES_SLOT_LABELS[slot][locale]}
        <select data-testid={`rules-slot-${slot}`} className={control} value={slots[slot] ?? ''} onChange={event => setSlots(current => { const next = { ...current }; if (event.target.value) next[slot] = event.target.value; else delete next[slot]; return next; })}>
          <option value="">{es ? '(vacío)' : '(empty)'}</option>
          {names.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>)}
    </div>
    {preview.missing.length > 0 && <p data-testid="rules-missing" className="text-text-muted">{es ? 'Sin rellenar' : 'Left empty'}: {preview.missing.map(slot => RULES_SLOT_LABELS[slot][locale]).join(', ')}</p>}
    <div className="flex gap-2">
      <button type="button" data-testid="rules-insert" className={button} onClick={() => {
        const inserted = editor.chain().focus().insertContent(rulesCardHtml(layout, entry, normalizeRulesSlots(layout, slots, names), locale).html).run();
        onDone(inserted ? (es ? 'Ficha de reglas insertada.' : 'Rules card inserted.') : (es ? 'Coloca el cursor en el texto del capítulo.' : 'Place the cursor in chapter prose.'));
      }}>{es ? 'Insertar ficha' : 'Insert card'}</button>
      <button type="button" className={button} onClick={onCancel}>{es ? 'Otra ficha' : 'Another card'}</button>
    </div>
  </section>;
}

/** The rules card the cursor is in, with its position. */
function enclosingRulesCard(editor: Editor): { pos: number; size: number; layout: RulesLayout; entry: string; slots: string } | null {
  if (editor.isDestroyed) return null;
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === 'rulesCard') return { pos: $from.before(depth), size: node.nodeSize, layout: node.attrs.layout as RulesLayout, entry: String(node.attrs.entry ?? ''), slots: String(node.attrs.slots ?? '{}') };
  }
  return null;
}

export function RulesCardRefresh({ editor, entries, locale, onDone }: { editor: Editor; entries: CodexEntry[]; locale: 'es' | 'en'; onDone: (message: string) => void }) {
  const subscribe = (changed: () => void) => { editor.on('transaction', changed); return () => { editor.off('transaction', changed); }; };
  const card = useSyncExternalStore(subscribe, () => { const found = enclosingRulesCard(editor); return found ? `${found.pos}|${found.entry}` : ''; });
  if (!card || !editor.isEditable) return null;
  const found = enclosingRulesCard(editor);
  const entry = found && entries.find(row => row.id === found.entry);
  const es = locale === 'es';
  return <button type="button" data-testid="rules-refresh" className={`${button} mt-2`} disabled={!entry} title={entry ? undefined : (es ? 'La ficha del Codex ya no existe' : 'The Codex card no longer exists')} onClick={() => {
    if (!found || !entry) return;
    let raw: unknown = {};
    try { raw = JSON.parse(found.slots); } catch { raw = {}; }
    const html = rulesCardHtml(found.layout, entry, normalizeRulesSlots(found.layout, raw, rulesFieldNames(entry)), locale).html;
    const done = editor.chain().focus().insertContentAt({ from: found.pos, to: found.pos + found.size }, html).run();
    onDone(done ? (es ? `Ficha "${entry.title}" actualizada desde el Codex.` : `"${entry.title}" refreshed from the Codex.`) : '');
  }}>{es ? `Actualizar ficha de reglas desde «${entry?.title ?? '?'}»` : `Refresh rules card from “${entry?.title ?? '?'}”`}</button>;
}
