import { app, ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FaustusFetchRequest, FaustusHostInfo } from '../../src/services/copilot/faustusProtocol';
import { FaustusRelay } from './faustusRelay';
import { setBridgeConfig } from '../aibridge/state';

let identity: Promise<string> | null = null;
function dataSpaceId(): Promise<string> {
  return identity ??= (async () => {
    const file = path.join(app.getPath('userData'), 'faustus-data-space.json');
    try { const saved = JSON.parse(await fs.readFile(file, 'utf8')); if (typeof saved.id === 'string' && saved.id) return saved.id; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const id = `writer-${randomUUID()}`;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ id }), 'utf8');
    return id;
  })();
}

export function registerFaustusIpc(assert: (event: Electron.IpcMainInvokeEvent, channel: string) => void, syncBridge: () => Promise<void>): void {
  const server = (process.env.WH_FAUSTUS_URL || process.env.FAUSTUS_URL || 'http://127.0.0.1:7000').replace(/\/+$/, '');
  const relay = new FaustusRelay(server, process.env.FAUSTUS_TOKEN || '');
  ipcMain.handle('faustus:getInfo', async (event): Promise<FaustusHostInfo> => {
    assert(event, 'faustus:getInfo');
    await setBridgeConfig({ enabled: true, writesEnabled: true });
    await syncBridge();
    return { server, embed_url: `${server}/api/hoard-copilot/panel.js`, data_space_id: await dataSpaceId(), tool_server_id: process.env.WH_FAUSTUS_MCP_SERVER_ID || undefined };
  });
  ipcMain.handle('faustus:request', async (event, request: FaustusFetchRequest) => {
    assert(event, 'faustus:request');
    if (!request || typeof request.id !== 'string' || typeof request.url !== 'string' || typeof request.method !== 'string' || !Array.isArray(request.headers)) throw new Error('Invalid Faustus request.');
    return relay.request(request, (payload) => { if (!event.sender.isDestroyed()) event.sender.send('faustus:event', payload); });
  });
  ipcMain.handle('faustus:cancel', (event, id: string) => { assert(event, 'faustus:cancel'); relay.cancel(id); });
}
