// Library search: the "Términos exactos" checkbox reaches the REST call and the
// matched terms of a hit are shown as chips.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import NativeSurface from '@/engines/publishing/NativeSurface';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

export async function testLibraryExactTerms(): Promise<string[]> {
  const searches: string[] = [];
  const reply = (body: unknown) => ({ status: 200, headers: {}, type: 'application/json', base64: btoa(unescape(encodeURIComponent(JSON.stringify(body)))) });
  const hit = { chunk_id: 'c1', document_id: 'd1', kind: 'md', citation: 'notas.md', collection: 'Notas', rel_path: 'notas.md', section: 'Voz', snippet: 'llama a <mark>voice_speak</mark>', more: 0, also: [], matched_terms: ['voice_speak'] };
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    publishing: {
      request: async (_method: string, path: string) => {
        if (path.includes('/library/api/search')) { searches.push(path); return reply({ query: 'voice_speak', mode: 'hybrid', took_ms: 3, hits: [hit] }); }
        if (path.includes('/library/api/status')) return reply({ counts: { documents: 3, chunks: 9 }, model: { state: 'ready' }, reindex_needed: 0 });
        if (path.includes('/library/api/collections')) return reply({ collections: [] });
        return reply({});
      },
    },
  };
  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  try {
    await act(async () => { root = createRoot(host); root.render(<NativeSurface module="library" />); await pause(300); });
    const shadow = () => host.querySelector('div')?.shadowRoot ?? [...host.querySelectorAll('div')].map(d => d.shadowRoot).find(Boolean) ?? null;
    for (let i = 0; i < 60 && !shadow()?.querySelector('[data-testid="search-exact"]'); i++) await act(async () => { await pause(80); });
    const box = () => shadow()!.querySelector<HTMLInputElement>('[data-testid="search-exact"]')!;
    assert(box() && box().checked, 'Checkbox present and on by default');
    const input = shadow()!.querySelector<HTMLInputElement>('input[aria-label="Buscar en la biblioteca"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setValue.call(input, 'voice_speak'); input.dispatchEvent(new Event('input', { bubbles: true })); await pause(900); });
    for (let i = 0; i < 40 && !searches.length; i++) await act(async () => { await pause(80); });
    assert(searches.length && !/exact=/.test(searches[0]), `Default search sends no exact=false: ${searches[0]}`);
    for (let i = 0; i < 40 && !shadow()!.querySelector('[data-testid="matched-term"]'); i++) await act(async () => { await pause(80); });
    assert(shadow()!.querySelector('[data-testid="matched-term"]')?.textContent === 'voice_speak', 'Matched term chip shown');
    await act(async () => { box().click(); await pause(300); });
    for (let i = 0; i < 40 && searches.length < 2; i++) await act(async () => { await pause(80); });
    assert(searches.length >= 2 && /exact=false/.test(searches[searches.length - 1]), `Unchecking sends exact=false: ${searches.join(' | ')}`);
    return ['Library Buscar: "Términos exactos" is on by default, a hit shows the chip "voice_speak", and unticking it repeats the search with exact=false'];
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  }
}
