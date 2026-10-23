// Tools the "/" menu opens beside the text: the name generator (/nombre) and
// a quick dice roll (/dados). Both put their result at the caret; the name
// generator can also make a Codex card (in the shared base, not inside an era).
import { lazy, Suspense, useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import Modal from '@/components/common/Modal';
import { describeRoll, rollDice, type DiceMode } from '@/engines/dice/dice';

const NameGenerator = lazy(() => import('@/engines/names/NameGenerator'));
export type SlashTool = 'names' | 'dice';
export const SLASH_TOOL_EVENT = 'wh-slash-tool';

function QuickDice({ locale, onInsert }: { locale: 'es' | 'en'; onInsert: (text: string) => void }) {
  const [expression, setExpression] = useState('1d20'), [mode, setMode] = useState<DiceMode>('normal'), [text, setText] = useState(''), [error, setError] = useState('');
  const es = locale === 'es';
  const roll = () => { try { const result = rollDice(expression, { mode }); setError(''); setText(`🎲 ${describeRoll(result)}${result.natural === 20 ? (es ? ' — ¡20 natural!' : ' — natural 20!') : result.natural === 1 ? (es ? ' — 1 natural' : ' — natural 1') : ''}`); } catch { setError(es ? 'Prueba con 1d20+5, 2d6 o 4d6kh3.' : 'Try 1d20+5, 2d6 or 4d6kh3.'); } };
  return <form className="space-y-3" data-testid="slash-dice" onSubmit={event => { event.preventDefault(); roll(); }}>
    <div className="flex gap-2"><input className="min-h-9 flex-1 rounded-lg border border-border bg-deep px-2 font-mono text-sm text-text-primary" aria-label={es ? 'Tirada' : 'Roll'} data-testid="slash-dice-expression" value={expression} onChange={event => setExpression(event.target.value)} />
      <select className="min-h-9 rounded-lg border border-border bg-deep px-2 text-sm text-text-primary" aria-label={es ? 'Modo' : 'Mode'} value={mode} onChange={event => setMode(event.target.value as DiceMode)}><option value="normal">{es ? 'Normal' : 'Normal'}</option><option value="advantage">{es ? 'Con ventaja' : 'Advantage'}</option><option value="disadvantage">{es ? 'Con desventaja' : 'Disadvantage'}</option></select>
      <button type="submit" className="min-h-9 rounded-lg border border-border px-3 text-sm text-text-primary hover:bg-elevated" data-testid="slash-dice-roll">{es ? 'Tirar' : 'Roll'}</button></div>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {text && <p className="font-mono text-sm text-text-primary" data-testid="slash-dice-result">{text}</p>}
    <button type="button" disabled={!text} className="min-h-9 rounded-lg bg-accent-gold px-3 text-sm text-deep disabled:opacity-50" data-testid="slash-dice-insert" onClick={() => onInsert(text)}>{es ? 'Insertar en el texto' : 'Insert into the text'}</button>
  </form>;
}

export default function SlashToolHost({ editor, locale, projectId, eraId }: { editor: Editor | null; locale: string; projectId?: string; eraId?: string }) {
  const [tool, setTool] = useState<SlashTool | null>(null), lang = locale === 'en' ? 'en' : 'es';
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const dom = editor.view.dom, open = (event: Event) => setTool((event as CustomEvent<{ tool: SlashTool }>).detail.tool);
    dom.addEventListener(SLASH_TOOL_EVENT, open);
    return () => dom.removeEventListener(SLASH_TOOL_EVENT, open);
  }, [editor]);
  const insert = (text: string) => { setTool(null); if (editor && !editor.isDestroyed && text) editor.chain().focus().insertContent(text.replace(/[<&]/g, char => char === '<' ? '&lt;' : '&amp;')).run(); };
  return <Modal open={!!tool} onClose={() => setTool(null)} title={tool === 'dice' ? (lang === 'es' ? 'Tirar dados' : 'Roll dice') : (lang === 'es' ? 'Generar un nombre' : 'Generate a name')} wide={tool === 'names'}>
    <Suspense fallback={null}>{tool === 'names' ? <NameGenerator locale={lang} projectId={eraId ? undefined : projectId} onInsert={insert} /> : tool === 'dice' ? <QuickDice locale={lang} onInsert={insert} /> : null}</Suspense>
  </Modal>;
}
