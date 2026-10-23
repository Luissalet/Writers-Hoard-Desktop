import { db } from '@/db';
import type { Project, Writing } from '@/types';
import { buildReaderHtml } from '@/engines/writings/readerExport';
import { defaultReaderPresentation } from '@/engines/writings/readerPresentation';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const pause = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

/** The exported Reader edition: the reader's own size, typeface and light, remembered, and the book's own back. */
export async function testReaderControls(): Promise<string[]> {
  const P = `reader-controls-${Date.now()}`;
  const frames: HTMLIFrameElement[] = [];
  try {
    const project = { id: P, title: 'La travesía', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['writings'], createdAt: 1, updatedAt: 1 } satisfies Project;
    await db.projects.put(project);
    const chapter = { id: `${P}-1`, projectId: P, title: 'El puerto', status: 'draft', content: '<p>Salieron con la marea.</p>', wordCount: 4, tags: [], chapter: 1, createdAt: 1, updatedAt: 1 } satisfies Writing;
    const artifact = await buildReaderHtml(project, [chapter], defaultReaderPresentation(), 'es');
    assert(artifact.html.includes('data-reader-set="size"') && artifact.html.includes('data-reader-own'), 'The edition carries the reading settings');
    const open = async () => {
      const frame = document.createElement('iframe'); frame.style.width = '1000px'; frame.style.height = '700px'; document.body.append(frame); frames.push(frame);
      const loaded = new Promise<void>((resolve) => { frame.onload = () => resolve(); }); frame.srcdoc = artifact.html; await loaded; await pause();
      return frame.contentDocument!;
    };
    let doc = await open();
    const section = () => doc.querySelector('.reader-section') as HTMLElement;
    const size = () => parseFloat(doc.defaultView!.getComputedStyle(section()).fontSize);
    const base = size();
    const press = async (selector: string) => { (doc.querySelector(selector) as HTMLElement).click(); await pause(60); };
    await press('[data-reader-set="size"][data-value="xl"]');
    assert(size() === 24 && doc.body.dataset.readerSize === 'xl', `Size XL: ${size()} against ${base}`);
    await press('[data-reader-set="face"][data-value="sans"]');
    assert(/system-ui|sans-serif/.test(doc.defaultView!.getComputedStyle(section().querySelector('p') ?? section()).fontFamily), 'Sans serif');
    await press('[data-reader-set="light"][data-value="dark"]');
    const bg = doc.defaultView!.getComputedStyle(doc.body).backgroundColor;
    assert(bg === 'rgb(23, 23, 27)', `Night: ${bg}`);
    assert((doc.querySelector('[data-reader-set="light"][data-value="dark"]') as HTMLElement).getAttribute('aria-pressed') === 'true', 'The pressed choice says so');
    // Reopened: the reader's choices are remembered in the reader's browser.
    doc = await open();
    assert(size() === 24 && doc.body.dataset.readerLight === 'dark' && doc.body.dataset.readerFace === 'sans', 'Remembered on reopening');
    await press('[data-reader-own]');
    assert(size() === base && !doc.body.dataset.readerLight && !doc.body.dataset.readerFace, 'The book\'s own styling is back');
    return ['The exported Reader edition lets its reader choose the size (S to XL), the typeface (serif, sans, mono) and the light (day, sepia, night); the choices are remembered in the reader\'s browser, never in the file, and "Como el libro" puts the author\'s styling back'];
  } finally {
    for (const frame of frames) frame.remove();
    try { localStorage.removeItem('wh-reader-settings'); } catch { /* none */ }
    await db.projects.delete(P);
  }
}
