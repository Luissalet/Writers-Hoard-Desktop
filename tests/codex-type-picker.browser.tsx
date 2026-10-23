// The document picker of the Library's "New card": the project's types by
// category, searched, as a grid or a list, or no type; then the card's form.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import CreateCodexDialog from '@/components/project/workspace/library/CreateCodexDialog';
import type { CodexTemplate } from '@/engines/codex/templateTypes';
import type { Project } from '@/types';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

export async function testCodexTypePicker(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const base = { content: '', revision: 1, createdAt: 1, updatedAt: 1 };
  const templates: CodexTemplate[] = [
    { id: 'tp-hero', name: 'Protagonista', category: 'character', fields: { Motivo: '' }, ...base },
    { id: 'tp-villain', name: 'Antagonista', category: 'character', fields: {}, ...base },
    { id: 'tp-port', name: 'Puerto', category: 'location', fields: { Calado: '' }, ...base },
  ];
  const project = { id: 'tp', title: 'Sal', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['codex'], createdAt: 1, updatedAt: 1, codexTemplates: templates } as Project;
  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  try {
    await act(async () => { root = createRoot(host); root.render(<MemoryRouter><CreateCodexDialog project={project} onClose={() => {}} /></MemoryRouter>); await pause(300); });
    const picker = q('codex-type-picker'); assert(picker, 'Picker first');
    assert(/Personaje[\s\S]*Protagonista[\s\S]*Antagonista[\s\S]*Lugar[\s\S]*Puerto/.test(picker.textContent ?? ''), `Grouped: ${picker.textContent}`);
    const search = q('codex-type-search') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'puer'); search.dispatchEvent(new Event('input', { bubbles: true })); await pause(); });
    assert(q('codex-type-pick-tp-port') && !q('codex-type-pick-tp-hero'), 'Search narrows');
    await act(async () => { q('codex-type-view-list')!.click(); await pause(); });
    assert(q('codex-type-view-list')!.getAttribute('aria-pressed') === 'true' && q('codex-type-pick-tp-port')!.parentElement!.className.includes('flex-col'), 'List view');
    await act(async () => { q('codex-type-pick-tp-port')!.click(); await pause(300); });
    assert(!q('codex-type-picker') && /Calado/.test(document.body.textContent ?? ''), 'Form with the type\'s fields');
    return ['New card: the picker shows the project\'s types under Personaje (Protagonista, Antagonista) and Lugar (Puerto); "puer" leaves Puerto; the list view lays them in a column; choosing Puerto opens its form with "Calado"; "Sin tipo" opens a plain card'];
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
  }
}
