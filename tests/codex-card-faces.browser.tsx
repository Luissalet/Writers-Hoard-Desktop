// The faces of a card: "Ficha", its stat block and sheet (sheets linked to the
// card), and "Notas" — one tab each, only the faces the card has.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import CodexCardFaces from '@/components/codex/CodexCardFaces';
import { createSheet } from '@/engines/character-sheets/types';
import type { CodexEntry, Project } from '@/types';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

export async function testCodexCardFaces(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const entry = { id: 'cf-wolf', projectId: 'cf', type: 'character', title: 'Lobo del Estuario', content: '', fields: {}, tags: [], relations: [], createdAt: 1, updatedAt: 1 } as CodexEntry;
  const block = { ...createSheet('5e-stat-block', 'Lobo (bloque)'), linkedEntryId: entry.id };
  const sheet = { ...createSheet('5e-character', 'Lobo (hoja)'), linkedEntryId: entry.id };
  const other = { ...createSheet('custom', 'Otro'), linkedEntryId: 'someone-else' };
  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  const tabs = () => [...document.querySelectorAll('[data-testid^="codex-face-"][role="tab"]')].map(tab => tab.textContent);
  try {
    await act(async () => { root = createRoot(host); root.render(<MemoryRouter><CodexCardFaces entry={entry} project={{ id: 'cf', characterSheets: [block, sheet, other] } as Pick<Project, 'id' | 'characterSheets'>} about={<p data-testid="about-body">Un lobo gris.</p>} notes={<p data-testid="notes-body">Notas</p>} /></MemoryRouter>); await pause(200); });
    assert(tabs().join() === 'Ficha,Bloque de estadísticas,Hoja,Notas' && document.querySelector('[data-testid="about-body"]'), `Faces: ${tabs().join()}`);
    await act(async () => { (document.querySelector('[data-testid="codex-face-statblock"]') as HTMLButtonElement).click(); await pause(); });
    assert(document.querySelector(`[data-testid="codex-face-paper-${block.id}"] svg`) && !document.querySelector(`[data-testid="codex-face-paper-${sheet.id}"]`), 'Stat block paper');
    await act(async () => { (document.querySelector('[data-testid="codex-face-sheet"]') as HTMLButtonElement).click(); await pause(); });
    assert(document.querySelector(`[data-testid="codex-face-paper-${sheet.id}"] svg`) && !document.querySelector(`[data-testid="codex-face-paper-${other.id}"]`), 'Sheet paper, only the card\'s');
    await act(async () => { (document.querySelector('[data-testid="codex-face-notes"]') as HTMLButtonElement).click(); await pause(); });
    assert(document.querySelector('[data-testid="notes-body"]') && !document.querySelector('[data-testid="about-body"]'), 'Notes face');
    await act(async () => { root!.render(<MemoryRouter><CodexCardFaces entry={entry} project={{ id: 'cf', characterSheets: [] } as Pick<Project, 'id' | 'characterSheets'>} about={<p>x</p>} notes={<p>y</p>} /></MemoryRouter>); await pause(); });
    assert(tabs().join() === 'Ficha,Notas', `Without sheets: ${tabs().join()}`);
    return ['Card faces: "Lobo del Estuario" shows Ficha · Bloque de estadísticas · Hoja · Notas; the stat block and the sheet tabs draw the papers linked to this card (not another card\'s), Notas holds the notes; a card with no sheets shows only Ficha and Notas'];
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
  }
}
