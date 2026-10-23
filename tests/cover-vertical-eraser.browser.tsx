// Cover designer: vertical text (letters stacked; each line a column) and an
// eraser that rubs out part of an ink stroke, splitting it where it passes.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import CoverDesigner from '@/engines/writings/coverDesign/CoverDesigner';
import { eraseInk, validateCoverJacket } from '@/engines/writings/coverDesign/model';
import { coverElementSvg } from '@/engines/writings/coverDesign/render';
import type { CoverElement, CoverStroke, CoverText } from '@/engines/writings/coverDesign/types';
import type { ReaderPresentation } from '@/engines/writings/readerPresentationTypes';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

export async function testCoverVerticalEraser(): Promise<string[]> {
  const passed: string[] = [];
  const text: CoverText = { id: 't1', kind: 'text', text: 'SAL\nMAR', x: 900, y: 100, width: 120, height: 500, rotation: 0, font: 'georgia', size: 40, bold: true, align: 'left', color: '#ffffff', vertical: true };
  validateCoverJacket({ version: 1, elements: [text] });
  const svg = coverElementSvg(text);
  const spans = [...svg.matchAll(/<tspan x="([\d.]+)" y="([\d.]+)">(.)<\/tspan>/g)].map(match => ({ x: Number(match[1]), y: Number(match[2]), letter: match[3] }));
  assert(spans.map(span => span.letter).join('') === 'SALMAR' && spans[0].x === spans[2].x && spans[1].y > spans[0].y && spans[3].x < spans[0].x && /data-cover-vertical="true"/.test(svg), `Vertical: ${svg}`);
  let refused = false; try { validateCoverJacket({ version: 1, elements: [{ ...text, vertical: 'yes' }] }); } catch { refused = true; }
  assert(refused, 'A non-boolean vertical is refused');
  passed.push('Vertical text: "SAL / MAR" draws S, A, L down one column and M, A, R in the next column to its left; saved and validated with the jacket');

  const stroke: CoverStroke = { id: 'ink-1', kind: 'ink', x: 700, y: 300, width: 400, height: 1, rotation: 0, color: '#d7b653', weight: 6, points: Array.from({ length: 41 }, (_, i) => ({ x: i / 40, y: 0 })) };
  let n = 0;
  const cut = eraseInk([text, stroke], { x: 900, y: 300 }, 20, () => `new-${++n}`);
  const inks = cut.filter((e): e is CoverStroke => e.kind === 'ink');
  assert(cut[0] === text && inks.length === 2 && inks[0].id === 'ink-1' && inks[1].id === 'new-1' && inks[0].x === 700 && inks[0].x + inks[0].width < 880 && inks[1].x > 920, `Cut: ${JSON.stringify(inks.map(e => [e.id, e.x, e.width]))}`);
  assert(eraseInk([stroke], { x: 100, y: 100 }, 20)[0] === stroke, 'Far away nothing changes');
  assert(eraseInk([{ ...stroke, points: [{ x: 0.5, y: 0 }] }], { x: 900, y: 300 }, 20).length === 0, 'A dot under the eraser goes');
  passed.push('Eraser: rubbing the middle of a stroke leaves two strokes (left part keeps its id); away from the ink nothing changes; a dot under it goes; text and artwork are never touched');

  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  let applied: ReaderPresentation['cover'] | null = null;
  const cover = { style: 'hardcover', color: '#293b33', texture: 'linen', artwork: false, showAtStart: false, jacket: { version: 1, elements: [stroke, { ...text, vertical: undefined } as CoverElement] } } as ReaderPresentation['cover'];
  try {
    await act(async () => { root = createRoot(host); root.render(<CoverDesigner title="La sal" cover={cover} locale="es" onApply={value => { applied = value; }} onClose={() => {}} />); await pause(400); });
    for (let i = 0; i < 40 && !document.querySelector('[data-testid="cover-eraser"]'); i++) await act(async () => { await pause(100); });
    const select = [...document.querySelectorAll('select')].find(element => [...element.options].some(option => option.value === 't1')) as HTMLSelectElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 't1'); select.dispatchEvent(new Event('change', { bubbles: true })); await pause(80); });
    await act(async () => { (document.querySelector('[data-testid="cover-text-vertical"]') as HTMLInputElement).click(); await pause(80); });
    assert(document.querySelector('svg[aria-label="Lienzo de cubierta"] [data-cover-vertical="true"]'), 'Vertical on the canvas');
    await act(async () => { (document.querySelector('[data-testid="cover-eraser"]') as HTMLButtonElement).click(); await pause(60); });
    const canvas = document.querySelector('svg[aria-label="Lienzo de cubierta"]') as SVGSVGElement;
    const screen = (x: number, y: number) => { const p = canvas.createSVGPoint(); p.x = x; p.y = y; const out = p.matrixTransform(canvas.getScreenCTM()!); return { clientX: out.x, clientY: out.y }; };
    const fire = (type: string, x: number, y: number) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, ...screen(x, y) }));
    await act(async () => { fire('pointerdown', 890, 300); fire('pointermove', 900, 300); fire('pointermove', 910, 300); fire('pointerup', 910, 300); await pause(120); });
    await act(async () => { [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Aplicar a presentación'))!.click(); await pause(120); });
    const final = applied as ReaderPresentation['cover'] | null;
    const inksAfter = final?.jacket?.elements.filter(e => e.kind === 'ink') ?? [];
    assert(inksAfter.length === 2 && final!.jacket!.elements.some(e => e.kind === 'text' && e.vertical === true), `Applied: ${JSON.stringify(final?.jacket?.elements.map(e => [e.kind, e.x]))}`);
    passed.push('Designer: "Vertical" on the title stacks it on the canvas; "Borrador" dragged across the gold stroke cuts it in two; "Aplicar a presentación" keeps both');
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
  }
  return passed;
}
