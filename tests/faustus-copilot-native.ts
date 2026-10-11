import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { registerFaustusIpc } from '../electron/ai/faustusIpc';
import { registerAiIpc } from '../electron/ai/ipc';
import { startAiBridge, stopAiBridge, undoBridgeChange, AI_BRIDGE_URL } from '../electron/aibridge/server';
import { getBridgeConfig, getBridgeToken, auditPath, readAudit, setBridgeConfig } from '../electron/aibridge/state';
import { resolveBridgeReply, setBridgeWindowResolver } from '../electron/aibridge/rpc';
import { BRIDGE_TOOLS } from '../src/services/aiBridge/manifest';

async function start() {
  const directory = process.env.WH_QA_DIRECTORY!;
  if (!directory) throw new Error('WH_QA_DIRECTORY must identify the isolated QA profile.');
  app.setPath('userData', path.join(directory, 'profile'));
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  await app.whenReady();
  const window = new BrowserWindow({ show: false, width: 1280, height: 900, minWidth: 100, minHeight: 100, webPreferences: { preload: path.join(directory, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  window.webContents.on('console-message', (details) => { if (details.level === 'error') console.error(details.message); });
  const assertSender = (event: Electron.IpcMainInvokeEvent) => { if (event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('Unexpected QA IPC sender.'); };
  const sync = () => startAiBridge({ version: '340-qa', hasWindow: () => !window.isDestroyed() });
  setBridgeWindowResolver(() => window);
  registerFaustusIpc(assertSender, sync);
  registerAiIpc({ assertIpcSender: assertSender, window: () => window });
  ipcMain.handle('aibridge:reply', (event, value) => { assertSender(event); resolveBridgeReply(value); });
  ipcMain.handle('aibridge:getInfo', async (event) => { assertSender(event); const config = await getBridgeConfig(); return { ...config, running: true, url: AI_BRIDGE_URL, port: Number(new URL(AI_BRIDGE_URL).port), token: await getBridgeToken(), adapterPath: path.resolve('dist-electron/aibridge/mcpStdio.cjs'), auditPath: auditPath(), toolCount: BRIDGE_TOOLS.length }; });
  ipcMain.handle('aibridge:undo', (event, index: number) => { assertSender(event); return undoBridgeChange(index); });
  ipcMain.handle('aibridge:readAudit', (event, limit?: number) => { assertSender(event); return readAudit(limit); });
  ipcMain.on('forge:memory', (event) => { event.returnValue = os.totalmem(); });
  ipcMain.handle('updates:getState', () => ({ phase: 'disabled', supported: false }));
  await setBridgeConfig({ enabled: true, writesEnabled: true });
  await getBridgeToken();
  await sync();
  await window.loadFile(path.join(directory, 'index.html'));
  const control = http.createServer((request, response) => {
    void (async () => {
      response.setHeader('content-type', 'application/json');
      if (request.method === 'GET') {
        const state = await window.webContents.executeJavaScript('window.__writerQa ? window.__writerQa.snapshot() : {notReady:true,error:window.__writerQaError}');
        response.end(JSON.stringify(state)); return;
      }
      let raw = ''; for await (const chunk of request) raw += chunk;
      const action = JSON.parse(raw);
      if (action.method === 'quit') { response.end('{"ok":true}'); control.close(); stopAiBridge(); app.quit(); return; }
      if (action.method === 'reload') { window.webContents.reload(); response.end('{"ok":true}'); return; }
      if (action.method === 'capture') { window.setContentSize(action.width || 1280, 900); const file = path.join(directory, `writer-${action.width || 1280}.png`); await fs.writeFile(file, (await window.webContents.capturePage()).toPNG()); response.end(JSON.stringify({ file })); return; }
      if (!['snapshot', 'send', 'select', 'undo', 'undoButton', 'newConversation', 'selectConversation', 'closeDock', 'openDock'].includes(action.method)) throw new Error('Unknown QA action.');
      const value = await window.webContents.executeJavaScript(`window.__writerQa[${JSON.stringify(action.method)}](...${JSON.stringify(action.args || [])})`);
      response.end(JSON.stringify({ ok: true, result: value }));
    })().catch((error) => { response.statusCode = 500; response.end(JSON.stringify({ error: String(error.stack || error) })); });
  });
  await new Promise<void>((resolve) => control.listen(Number(process.env.WH_QA_CONTROL_PORT || 62998), '127.0.0.1', resolve));
  console.log(JSON.stringify({ ready: true, profile: app.getPath('userData'), token_file: path.join(app.getPath('userData'), 'aibridge', 'token'), bridge_url: AI_BRIDGE_URL, control_port: process.env.WH_QA_CONTROL_PORT || 62998, pid: process.pid }));
}
void start().catch((error) => { console.error(error.stack || error); app.exit(1); });
