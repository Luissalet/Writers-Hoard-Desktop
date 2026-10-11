import { createRoot } from 'react-dom/client';
import App from '@/App';
import { db } from '@/db';
import { useCopilotStore } from '@/stores/copilotStore';
import { useLocaleStore } from '@/stores/localeStore';
import { useAppStore } from '@/stores/appStore';
import { requestDocument, bytesFromBase64 } from '@/services/documents/client';
import '@/services/aiBridge/dispatch';

const projectId = 'document-full-qa';
const writingId = 'chapter-full-qa';
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function wait(check: () => boolean | Promise<boolean>, message: string) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await check()) return; await delay(30); }
  throw new Error(`${message}: ${document.body.innerText.slice(-5000)}`);
}
function button(label: string): HTMLButtonElement {
  const element = Array.from(document.querySelectorAll('button')).find(item => [item.textContent?.trim(), item.getAttribute('aria-label'), item.title].includes(label));
  assert(element, `Button ${label}`); return element;
}
async function click(label: string) { button(label).click(); await delay(80); }
function editorElement(): HTMLElement { const element = document.querySelector<HTMLElement>('.ProseMirror'); assert(element, 'Actual manuscript editor'); return element; }
async function selectText(collapse = false) {
  const element = editorElement(); element.focus();
  const range = document.createRange(); range.selectNodeContents(element.querySelector('p')!);
  if (collapse) range.collapse(false);
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange')); await delay(80);
}
async function choose(label: string, value: string) {
  const select = document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
  assert(select, `Select ${label}`); select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); await delay(80);
}
async function mount() {
  if (!await db.projects.get(projectId)) {
    const now = Date.now();
    await db.projects.put({ id: projectId, title: 'Documento de prueba', description: 'Perfil aislado de verificación.', mode: 'novelist', type: 'standalone', color: '#aa7733', status: 'draft', enabledEngines: ['writings', 'codex', 'outline'], engineOrder: ['writings', 'codex', 'outline'], createdAt: now, updatedAt: now });
    await db.writings.put({ id: writingId, projectId, title: 'El puerto', content: '<p>La canción del puerto conserva el borrador.</p>', wordCount: 8, status: 'draft', tags: [], chapter: 1, order: 0, createdAt: now, updatedAt: now });
  }
  await useLocaleStore.getState().setLocale('es');
  useCopilotStore.setState({ dockOpen: false });
  window.location.hash = `#/project/${projectId}/writings?writing=${writingId}`;
  createRoot(document.getElementById('root')!).render(<App />);
  await wait(() => !!document.querySelector('.ProseMirror'), 'Full application mounted');
  const qa = {
    async format() {
      await selectText(); await choose('Fuente', 'serif'); await choose('Tamaño', '18');
      const color = document.querySelector<HTMLInputElement>('input[aria-label="Color de texto"]'); assert(color, 'Text colour input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(color, '#996633'); color.dispatchEvent(new Event('input', { bubbles: true })); color.dispatchEvent(new Event('change', { bubbles: true })); await delay(80);
      await click('Centrar'); await selectText(true); await choose('Tabla', 'insert');
      await wait(async () => { const html = (await db.writings.get(writingId))?.content || ''; return html.includes('data-wh-font="serif"') && html.includes('data-wh-align="center"') && html.includes('<table'); }, 'Formatting and table autosave');
      const row = await db.writings.get(writingId);
      assert(row?.content.includes('data-wh-size="18"'), 'Font size persisted');
      assert(row?.content.includes('data-wh-color="#996633"'), 'Text colour persisted');
      return { html: row.content, text: editorElement().textContent };
    },
    async imported() {
      const original = editorElement().innerHTML;
      const embeddedImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jOmcAAAAASUVORK5CYII=';
      const session = await requestDocument<{ sessionId: string }>('document.importHtml', { html: `<h1>Documento importado</h1><p style="text-align:right">Texto español importado con ñ.</p><p><img src="${embeddedImage}" alt="Imagen importada"></p><table><tr><td><p>Una celda.</p></td></tr></table>` });
      const exported = await requestDocument<{ dataBase64: string }>('document.exportBytes', { sessionId: session.sessionId, format: 'docx' });
      await requestDocument('document.close', { sessionId: session.sessionId });
      await click('Herramientas de documento');
      const input = document.querySelector<HTMLInputElement>('input[type="file"][aria-label="Abrir archivo"]'); assert(input, 'Actual document file picker');
      const transfer = new DataTransfer(); transfer.items.add(new File([bytesFromBase64(exported.dataBase64)], 'Importado.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(() => !!Array.from(document.querySelectorAll('button')).find(item => item.textContent?.trim() === 'Aplicar texto al editor'), 'Native DOCX opened');
      assert(editorElement().innerHTML === original, 'Opening native DOCX keeps current manuscript');
      await click('Previsualizar página');
      await wait(() => !!document.querySelector<HTMLImageElement>('[data-document-tools] img')?.naturalWidth, 'Real native PNG loads');
      await click('Descargar documento');
      await click('Aplicar texto al editor');
      assert(editorElement().textContent?.includes('Texto español importado con ñ.'), 'Actual editor receives imported body');
      assert(editorElement().querySelector('img[src^="data:image/"]'), 'Actual editor preserves the native embedded image');
      assert(document.querySelector<HTMLSelectElement>('select[aria-label="Origen"]')?.value === 'editor', 'Applying switches exports to live editor');
      const undo = document.querySelector('svg.lucide-undo-2')?.closest('button'); assert(undo, 'Actual undo toolbar button'); undo.click(); await delay(80);
      assert(editorElement().innerHTML === original, 'Actual editor undo restores draft');
      await choose('Formato', 'pdf'); await click('Descargar documento');
      await click('Previsualizar página');
      await wait(() => !!document.querySelector<HTMLImageElement>('[data-document-tools] img')?.naturalWidth, 'Current editor native PNG loads');
      return { original, imported: true, undo: true };
    },
    async snapshot() {
      const row = await db.writings.get(writingId);
      return { row, html: editorElement().innerHTML, text: document.body.innerText, viewport: { width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }, panel: !!document.querySelector('[data-document-tools] section') };
    },
    async frame() {
      document.querySelector('[aria-label="Formato avanzado"]')?.scrollIntoView({ block: 'start' });
      await delay(150);
      return qa.snapshot();
    },
    async responsive() {
      // The existing collapsed-sidebar preference is the normal narrow layout.
      useAppStore.setState({ sidebarOpen: false, sidebarLoaded: true });
      await delay(150);
      return qa.snapshot();
    },
  };
  Object.assign(window, { __documentQa: qa });
}
void mount().catch(error => Object.assign(window, { __documentQaError: String(error.stack || error) }));
