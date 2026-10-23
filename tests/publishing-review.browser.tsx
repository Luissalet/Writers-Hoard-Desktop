// The publishing review: words, pages and reading time per chapter and in all,
// the byline on the title page, and the page seen on a phone or an e-reader.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PublishingPreviewPane from '@/components/project/PublishingPreviewPane';
import type { Writing } from '@/types';
import type { PublishingProfile } from '@/types/projectTools';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

export async function testPublishingReview(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const words = (n: number) => Array.from({ length: n }, (_, i) => `palabra${i}`).join(' ');
  const writings: Writing[] = [
    { id: 'pr-1', projectId: 'pr', title: 'El puerto', status: 'draft', content: `<p>${words(600)}</p>`, wordCount: 600, chapter: 1, tags: [], createdAt: 1, updatedAt: 1 },
    { id: 'pr-2', projectId: 'pr', title: 'La tormenta', status: 'draft', content: `<p>${words(120)}</p>`, wordCount: 120, chapter: 2, tags: [], createdAt: 1, updatedAt: 1 },
  ];
  const profile: PublishingProfile = { id: 'pp', projectId: 'pr', name: 'Libro', format: 'manuscript', includeTitlePage: true, includeSynopsis: false, includeBibliography: false, citationStyle: 'apa', selectedWritingIds: [], createdAt: 1, updatedAt: 1 };
  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  try {
    await act(async () => { root = createRoot(host); root.render(<PublishingPreviewPane project={{ id: 'pr', title: 'La sal', author: 'Marta Salinas' }} profile={profile} writings={writings} />); await pause(300); });
    const stats = [...document.querySelectorAll('[data-testid="publishing-piece-stats"]')].map(e => e.textContent);
    assert(stats[0] === '600 palabras · ~3 pág. · 3 min de lectura' && stats[1] === '120 palabras · ~1 pág. · 1 min de lectura', `Per chapter: ${JSON.stringify(stats)}`);
    assert(/3 min de lectura/.test(document.body.textContent ?? ''), `Reading time in all: 720 words at 240 a minute`);
    assert(document.querySelector('[data-testid="publishing-preview-byline"]')?.textContent === 'Marta Salinas', 'Byline on the title page');
    const page = () => document.querySelector('[data-testid="publishing-preview-page"]') as HTMLElement;
    await act(async () => { (document.querySelector('[data-testid="publishing-device-mobile"]') as HTMLButtonElement).click(); await pause(); });
    assert(page().dataset.device === 'mobile' && page().getBoundingClientRect().width <= 391, `Mobile width: ${page().getBoundingClientRect().width}`);
    await act(async () => { (document.querySelector('[data-testid="publishing-device-ereader"]') as HTMLButtonElement).click(); await pause(); });
    assert(page().dataset.device === 'ereader' && /grayscale/.test(getComputedStyle(page()).filter), `E-reader: ${getComputedStyle(page()).filter}`);
    return ['Publishing review: each chapter shows its words, pages (250 a page) and minutes to read (240 a minute) — 600 words are ~3 pages and 3 minutes — and the whole book its reading time; the title page shows the byline; "Móvil" narrows the page to a phone and "Lector de tinta" turns it to grey ink on paper'];
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
  }
}
