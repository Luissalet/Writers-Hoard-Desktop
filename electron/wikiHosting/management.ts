import type { IncomingMessage, ServerResponse } from 'node:http';
import { WIKI_HOST_MANAGE_PATH, type WikiHostChange, type WikiHostListScope, type WikiHostPublication } from '../../src/services/wikiProfiles/hostingTypes';
import type { createWikiHost } from './server';

type Host = ReturnType<typeof createWikiHost>;
type Command =
  | { action: 'list'; input: WikiHostListScope }
  | { action: 'publish'; input: WikiHostPublication }
  | { action: 'withdraw'; input: WikiHostChange };

/** Management lives on the incumbent editor origin only. */
export function wikiHostingManagement(host: Host, allowedHosts: () => readonly string[]) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== WIKI_HOST_MANAGE_PATH) return false;
    const reply = (code: number, body: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      reply(405, { error: 'wiki_host_method_invalid' });
      return true;
    }
    const name = req.headers.host;
    if (!name || !allowedHosts().includes(name) || req.headers.origin !== 'http://' + name) {
      reply(403, { error: 'wiki_host_origin_invalid' });
      return true;
    }
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
      reply(415, { error: 'wiki_host_request_invalid' });
      return true;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const command = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Command;
      if (command?.action === 'list' && command.input) {
        await host.resume();
        reply(200, host.list(command.input));
      }
      else if (command?.action === 'publish' && command.input) reply(200, await host.publish(command.input));
      else if (command?.action === 'withdraw' && command.input) reply(200, host.withdraw(command.input));
      else reply(400, { error: 'wiki_host_request_invalid' });
    } catch (error) {
      const message = error instanceof Error && /^wiki_host_[a-z_]+$/.test(error.message) ? error.message : 'wiki_host_unavailable';
      reply(message === 'wiki_host_conflict' ? 409 : message === 'wiki_host_unavailable' ? 503 : 400, { error: message });
    }
    return true;
  };
}
