import os from 'node:os';
import path from 'node:path';
import type { Plugin } from 'vite';
import { wikiHostingConfig } from '../electron/wikiHosting/config';
import { wikiHostingManagement } from '../electron/wikiHosting/management';
import { createWikiHost } from '../electron/wikiHosting/server';

export function wikiHostingPlugin(): Plugin {
  return {
    name: 'writer-wiki-hosting',
    configureServer(server) {
      const appData = process.platform === 'win32' ? process.env.APPDATA :
        process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') :
        process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
      const userData = process.env.WH_USER_DATA_DIR || path.join(appData || os.homedir(), 'writers-hoard');
      const host = createWikiHost(wikiHostingConfig(userData));
      const manage = wikiHostingManagement(host, () => {
        const address = server.httpServer?.address();
        const port = address && typeof address === 'object' ? address.port : server.config.server.port ?? 5174;
        return ['127.0.0.1:' + port, 'localhost:' + port];
      });
      server.middlewares.use((req, res, next) => { void manage(req, res).then(handled => { if (!handled) next(); }).catch(next); });
      server.httpServer?.once('listening', () => { void host.resume().catch(error => server.config.logger.warn(String(error))); });
      server.httpServer?.once('close', () => { void host.close(); });
    },
  };
}
