// Actual NativeExecutor -> renderer handler -> PDF/PNG IPC. No HTTP host or stdio adapter.
const { app, dialog, ipcMain, nativeImage } = require('electron');
const { build } = require('esbuild');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const runner = require('../scripts/run-codex-properties-ui.cjs');
const root = path.resolve(__dirname, '..');
const directory = runner.directory;
const preloadFile = path.join(directory, 'card-export-preload.cjs');
const nativeFile = path.join(directory, 'card-export-native.cjs');
process.argv[2] = './tests/codex-entry-export.browser.tsx';
process.argv[3] = 'testCodexEntryExportNative';

fs.writeFileSync(preloadFile, `const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('electronAPI',{
  exporter:{scriptToPdf:(html,name)=>ipcRenderer.invoke('export:scriptToPdf',html,name)},
  documentImages:{capture:request=>ipcRenderer.invoke('document-image:capture',request)},
  aiBridge:{onRequest:fn=>{const listener=(_,payload)=>fn(payload);ipcRenderer.on('aibridge:request',listener);return()=>ipcRenderer.removeListener('aibridge:request',listener)},reply:payload=>ipcRenderer.invoke('aibridge:reply',payload)}
});
contextBridge.exposeInMainWorld('cardExportQa',{execute:payload=>ipcRenderer.invoke('codex-entry-export:execute',payload)});`);

let api, win;
let pdfIpc = 0, pngIpc = 0;
const dialogs = [];
const originalShowSaveDialog = dialog.showSaveDialog;
const unwrap = value => value?.result ?? value;

runner.main({
  preloadFile,
  async setup() {
    await build({
      stdin: { contents: "export {executeTool} from './electron/aibridge/executor';export {setBridgeConfig} from './electron/aibridge/state';export {resolveBridgeReply,setBridgeWindowResolver} from './electron/aibridge/rpc';export * from './electron/scriptPdf';export {registerDocumentImageIpc} from './electron/documentImage';export {isIpcChannelAllowedForRole} from './electron/security';", resolveDir: root },
      bundle: true, platform: 'node', format: 'cjs', outfile: nativeFile,
      external: ['electron'], alias: { '@': path.join(root, 'src') }, logLevel: 'warning',
    });
    api = require(nativeFile);
    await api.setBridgeConfig({ enabled: false, writesEnabled: true });
    const assertSender = (event, channel) => {
      assert.equal(event.sender, win.webContents);
      assert.equal(event.senderFrame, event.sender.mainFrame);
      assert(api.isIpcChannelAllowedForRole(channel, 'main'));
      if (channel === 'export:scriptToPdf') pdfIpc++;
      if (channel === 'document-image:capture') pngIpc++;
    };
    api.registerScriptPdfIpc(assertSender, () => win);
    api.registerDocumentImageIpc(assertSender);
    ipcMain.handle('aibridge:reply', (event, payload) => {
      assert.equal(event.sender, win.webContents);
      assert.equal(event.senderFrame, event.sender.mainFrame);
      api.resolveBridgeReply(payload);
    });
    ipcMain.handle('codex-entry-export:execute', (event, payload) => {
      assert.equal(event.sender, win.webContents);
      assert.equal(event.senderFrame, event.sender.mainFrame);
      return api.executeTool(payload, { origin: 'bridge', clientLabel: 'codex-entry-export-native-qa' });
    });
    // Only the destination selector is directed. Rendering and fs.writeFile
    // remain the exact shared product functions registered above.
    dialog.showSaveDialog = async (parent, options) => {
      assert.equal(parent, win);
      const filePath = path.join(directory, path.basename(options.defaultPath));
      const canceled = /cancel/i.test(options.defaultPath);
      dialogs.push({ ...options, filePath, canceled });
      return { canceled, filePath: canceled ? '' : filePath };
    };
  },
  window(value) {
    win = value;
    api.setBridgeWindowResolver(() => win);
  },
  async close() {
    const artifacts = await win.webContents.executeJavaScript('window.__codexEntryExportNative');
    assert(artifacts && typeof artifacts.html === 'string', 'Renderer must expose the actual prepared card HTML');
    assert(artifacts.request, 'Native fixture must retain its actual card request');
    const pdfResult = unwrap(artifacts.pdfResult), cancelResult = unwrap(artifacts.cancelResult);
    assert(pdfResult?.ok && pdfResult.filePath, JSON.stringify(artifacts.pdfResult));
    assert(!cancelResult?.ok && cancelResult?.code === 'canceled', JSON.stringify(artifacts.cancelResult));
    assert(pdfIpc >= 2, 'Success and cancel must traverse the real PDF IPC handler');
    assert(pngIpc >= 2, 'Generic and captured PNG must traverse the real document image IPC handler');
    const saved = dialogs.find(item => !item.canceled && item.filePath === pdfResult.filePath);
    assert(saved, 'Returned PDF must be written to the actual selected QA destination');
    assert.deepEqual(saved.filters, [{ name: 'PDF Document', extensions: ['pdf'] }]);
    for (const canceled of dialogs.filter(item => item.canceled)) assert(!fs.existsSync(canceled.filePath), 'Canceled destination was written');
    assert(dialogs.some(item => item.canceled), 'The real save selector must have returned canceled');

    const bytes = fs.readFileSync(pdfResult.filePath);
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: pathToFileURL(path.join(root, 'node_modules/pdfjs-dist/standard_fonts')).href + '/' });
    const pdf = await task.promise;
    assert(pdf.numPages >= 1);
    const pages = [];
    for (let index = 1; index <= pdf.numPages; index++) pages.push((await (await pdf.getPage(index)).getTextContent()).items.map(item => item.str ?? '').join(' '));
    const text = pages.join('\n');
    assert(Array.isArray(artifacts.expectedText) && artifacts.expectedText.length, 'Native PDF text expectations must come from the actual fixture');
    for (const expected of artifacts.expectedText) assert(text.includes(expected), 'Actual PDF lacks ' + expected);
    for (const excluded of artifacts.excludedText ?? []) assert(!text.includes(excluded), 'Actual PDF contains excluded text ' + excluded);
    await task.destroy();
    console.log('PASS NativeExecutor/registered PDF IPC/shared render-save: real PDF signature, ' + pages.length + ' page(s), expected card text and canceled no-file');
    console.log('PDF ' + pdfResult.filePath);

    for (const [label, result] of [['generic', artifacts.pngResult], ['captured', artifacts.capturedPngResult]]) {
      const image = unwrap(result);
      assert(image?.pages?.length > 1 && image.height > image.pages[0].height, label + ' long card must use actual complete-flow tiling');
      let area = 0, hasInk = false;
      for (const [index, page] of image.pages.entries()) {
        assert.equal(page.index, index + 1);
        assert(page.x >= 0 && page.y >= 0 && page.x + page.width <= image.width && page.y + page.height <= image.height);
        const png = Buffer.from(page.dataUrl.split(',')[1], 'base64');
        assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        const decoded = nativeImage.createFromBuffer(png);
        assert.deepEqual(decoded.getSize(), { width: page.pixelWidth, height: page.pixelHeight });
        assert.equal(page.pixelWidth, page.width * image.pixelRatio);
        assert.equal(page.pixelHeight, page.height * image.pixelRatio);
        const bitmap = decoded.toBitmap();
        for (let offset = 0; offset < bitmap.length; offset += 4) if (bitmap[offset] < 240 || bitmap[offset + 1] < 240 || bitmap[offset + 2] < 240) { hasInk = true; break; }
        area += page.width * page.height;
        const file = path.join(directory, 'card-' + label + '-' + page.index + '.png');
        fs.writeFileSync(file, png);
        console.log('SCREENSHOT ' + file);
      }
      assert.equal(area, image.width * image.height, label + ' tiles must cover complete output geometry');
      assert(hasInk, label + ' real card PNG compositor returned blank pixels');
      assert(image.sourceVersion && image.framing?.mode === 'complete-flow');
      console.log('PASS Registered PNG IPC ' + label + ': actual signature, dimensions, nonblank pixels and complete multi-tile card');
    }

    // MP4's consumer retains the same destination/filter/write behavior; this
    // is a shared byte-save regression control, not a transcode assertion.
    const control = Buffer.from('shared-mp4-save-control');
    const mp4 = await api.saveBytesViaDialog(win, control, 'shared-save-control.mp4', [{ name: 'MP4 Video', extensions: ['mp4'] }]);
    assert(mp4.ok);
    assert(fs.readFileSync(mp4.filePath).equals(control));
    assert.deepEqual(dialogs.at(-1).filters, [{ name: 'MP4 Video', extensions: ['mp4'] }]);
    const beforeNoWindow = dialogs.length;
    assert.deepEqual(await api.saveBytesViaDialog(null, control, 'no-window.mp4', []), { ok: false, error: 'no window' });
    assert.equal(dialogs.length, beforeNoWindow);
    console.log('PASS Shared MP4 byte-save helper preserves parent, filters, selected bytes and no-window response (no transcode claim)');
    dialog.showSaveDialog = originalShowSaveDialog;
    for (const channel of ['codex-entry-export:execute', 'aibridge:reply', 'export:scriptToPdf', 'document-image:capture']) ipcMain.removeHandler(channel);
    api.setBridgeWindowResolver(() => null);
    console.log('Card export Native QA ' + directory);
  },
}).catch(error => {
  dialog.showSaveDialog = originalShowSaveDialog;
  api?.setBridgeWindowResolver(() => null);
  console.error(error.stack || error);
  app.exit(1);
});
