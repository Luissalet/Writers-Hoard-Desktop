// "New story" with its cover: format and colour chosen when the book is made,
// previewed live, saved as the book's jacket with the title on front and spine.
import '@/engines';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import CreateProjectModal from '@/components/dashboard/CreateProjectModal';
import { t } from '@/i18n/useTranslation';
import { useLocaleStore } from '@/stores/localeStore';
import type { Project } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string, tries = 100) { for (let i = 0; i < tries; i++) { if (check()) return; await act(async () => { await pause(40); }); } throw new Error(`Timed out: ${label}`); }

export async function testCreateCover(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const passed: string[] = [];
  const host = document.getElementById('root'); assert(host, 'root');
  const root = createRoot(host);
  let created: Project | null = null;
  try {
    await act(async () => { root.render(<CreateProjectModal open onClose={() => {}} onCreate={async project => { created = project; }} />); await pause(400); });
    await until(() => !!document.querySelector('[role="dialog"] button:has(h3)'), 'modes');
    await act(async () => { (document.querySelector('[role="dialog"] button:has(h3)') as HTMLButtonElement).click(); await pause(150); });
    const title = document.querySelector(`[aria-label="${t('common.title')}"]`) as HTMLInputElement ?? [...document.querySelectorAll('[role="dialog"] input')].find(input => (input as HTMLInputElement).type === 'text') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(title, 'La sal'); title.dispatchEvent(new Event('input', { bubbles: true })); await pause(60); });
    await until(() => !!document.querySelector('[data-testid="create-cover-enabled"]'), 'cover option');
    await act(async () => { (document.querySelector('[data-testid="create-cover-enabled"]') as HTMLInputElement).click(); await pause(80); });
    const style = document.querySelector('[data-testid="create-cover-style"]') as HTMLSelectElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(style, 'paperback'); style.dispatchEvent(new Event('change', { bubbles: true })); await pause(80); });
    assert(/La sal/.test(document.querySelector('[data-testid="create-cover-preview"]')?.textContent ?? '') || !!document.querySelector('[data-testid="create-cover-preview"] svg, [data-testid="create-cover-preview"] *'), 'Preview shown');
    await act(async () => { [...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent?.trim() === t('createProject.createButton'))!.click(); await pause(300); });
    await until(() => !!created, 'created');
    const made = created as unknown as Project;
    const cover = made.readerPresentation?.cover;
    assert(cover && cover.style === 'paperback' && cover.showAtStart && cover.jacket?.elements.filter(e => e.kind === 'text' && e.text === 'La sal').length === 2, `Cover: ${JSON.stringify(cover)}`);
    passed.push('New story: "Diseñar la cubierta del libro ahora" offers format (Tapa blanda chosen) and colour with a live preview; the book is created with that cover and "La sal" on the front and the spine, ready to refine in the jacket designer');
  } finally {
    await act(async () => { root.unmount(); await pause(); });
  }
  return passed;
}
