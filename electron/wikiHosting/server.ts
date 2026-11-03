import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WIKI_HOST_SLUG, type WikiHostAddress, type WikiHostChange, type WikiHostListScope, type WikiHostOwner, type WikiHostPublication } from '../../src/services/wikiProfiles/hostingTypes';

const BIND = '127.0.0.1';
const TOKEN = /^[A-Za-z0-9_-]{32}$/;
const hash = (html: string) => createHash('sha256').update(html).digest('hex');
const isId = (id: string) => typeof id === 'string' && id.length > 0 && id.length <= 200;

type Row = Omit<WikiHostAddress, 'active' | 'url'> & { active: number; token: string | null; html: string };

function checkOwner(owner: WikiHostOwner) {
  if (!isId(owner.projectId) || !isId(owner.profileId)) throw Error('wiki_host_owner_invalid');
}

function checkChange(input: WikiHostChange) {
  checkOwner(input);
  if (typeof input.slug !== 'string' || !WIKI_HOST_SLUG.test(input.slug)) throw Error('wiki_host_slug_invalid');
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw Error('wiki_host_revision_invalid');
}

/** One read-only HTTP origin, independent of the editor and its bridge. */
export function createWikiHost(options: { file: string; port: number; publicOrigin?: string }) {
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw Error('wiki_host_port_invalid');
  const publicUrl = options.publicOrigin ? new URL(options.publicOrigin) : null;
  if (publicUrl && (!['https:', 'http:'].includes(publicUrl.protocol) || publicUrl.href !== publicUrl.origin + '/')) {
    throw Error('wiki_host_origin_invalid');
  }
  let db: DatabaseSync | undefined;
  let origin: string | undefined;
  let starting: Promise<void> | undefined;

  function store() {
    if (db) return db;
    mkdirSync(path.dirname(options.file), { recursive: true });
    const opened = new DatabaseSync(options.file);
    try {
      opened.exec(`
        PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS wiki_addresses (
          slug TEXT PRIMARY KEY, projectId TEXT NOT NULL, profileId TEXT NOT NULL,
          editionId TEXT NOT NULL, audience TEXT NOT NULL, sha256 TEXT NOT NULL,
          revision INTEGER NOT NULL, active INTEGER NOT NULL, token TEXT, html TEXT NOT NULL
        );
      `);
      db = opened;
      return db;
    } catch (error) {
      opened.close();
      throw error;
    }
  }

  function find(slug: string): Row | undefined {
    return store().prepare('SELECT * FROM wiki_addresses WHERE slug=?').get(slug) as Row | undefined;
  }

  function summary(row: Omit<Row, 'html'>): WikiHostAddress {
    const base = publicUrl?.origin ?? origin;
    return {
      projectId: row.projectId, profileId: row.profileId, slug: row.slug, editionId: row.editionId,
      sha256: row.sha256, audience: row.audience, revision: row.revision, active: !!row.active,
      url: row.active && base ? base + '/wiki/' + row.slug + (row.token ? '/u/' + row.token : '') : null,
    };
  }

  function serve(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const local = origin && new URL(origin);
    if (!local || !req.headers.host || ![local.host, 'localhost:' + local.port, publicUrl?.host].includes(req.headers.host)) {
      res.writeHead(421).end();
      return;
    }
    const [prefix, section, slug, mode, token, ...extra] = (req.url ?? '').split('?')[0].split('/');
    if (prefix !== '' || section !== 'wiki' || !WIKI_HOST_SLUG.test(slug ?? '') || extra.length || (mode !== undefined && (mode !== 'u' || !TOKEN.test(token ?? '')))) {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const row = find(slug);
    if (!row?.active || (row.token ?? undefined) !== token) {
      res.writeHead(404).end();
      return;
    }
    if (hash(row.html) !== row.sha256) {
      res.writeHead(500).end();
      return;
    }
    if (row.token) res.setHeader('X-Robots-Tag', 'noindex');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(row.html),
      'Content-Security-Policy': "frame-ancestors 'none'",
      ETag: '"' + row.sha256 + '"',
    }).end(req.method === 'HEAD' ? undefined : row.html);
  }

  const server = createServer((req, res) => {
    try { serve(req, res); } catch { res.writeHead(500).end(); }
  });
  function start() {
    return starting ??= new Promise<void>((resolve, reject) => {
      function failed(error: Error) { starting = undefined; reject(error); }
      server.once('error', failed);
      server.listen(options.port, BIND, () => {
        server.off('error', failed);
        const address = server.address();
        if (!address || typeof address === 'string') throw Error('wiki_host_listener_invalid');
        origin = `http://${BIND}:${address.port}`;
        resolve();
      });
    });
  }

  return {
    async resume() {
      if (!db && !existsSync(options.file)) return;
      if (store().prepare('SELECT 1 FROM wiki_addresses LIMIT 1').get()) await start();
    },
    list(owner: WikiHostListScope) {
      if (!isId(owner.projectId) || (owner.profileId !== undefined && !isId(owner.profileId))) throw Error('wiki_host_owner_invalid');
      const rows = store().prepare('SELECT slug, projectId, profileId, editionId, audience, sha256, revision, active, token FROM wiki_addresses WHERE projectId=? AND (? IS NULL OR profileId=?) ORDER BY slug').all(owner.projectId, owner.profileId ?? null, owner.profileId ?? null);
      return (rows as Omit<Row, 'html'>[]).map(summary);
    },
    async publish(input: WikiHostPublication) {
      checkChange(input);
      if (!isId(input.editionId) || !['public', 'unlisted'].includes(input.audience) ||
        typeof input.html !== 'string' || !/^<!doctype html>/i.test(input.html) || hash(input.html) !== input.sha256) {
        throw Error('wiki_host_artifact_changed');
      }
      await start();
      const token = input.audience === 'unlisted' ? randomBytes(24).toString('base64url') : null;
      const sql = `
        INSERT INTO wiki_addresses (slug, projectId, profileId, editionId, audience, sha256, revision, active, token, html)
        SELECT ?, ?, ?, ?, ?, ?, 1, 1, ?, ?
        WHERE ?=0 OR EXISTS(SELECT 1 FROM wiki_addresses WHERE slug=?)
        ON CONFLICT(slug) DO UPDATE SET editionId=excluded.editionId, audience=excluded.audience,
          sha256=excluded.sha256, revision=wiki_addresses.revision+1, active=1,
          token=CASE WHEN wiki_addresses.audience=excluded.audience THEN wiki_addresses.token ELSE excluded.token END,
          html=excluded.html
        WHERE wiki_addresses.projectId=excluded.projectId AND wiki_addresses.profileId=excluded.profileId
          AND wiki_addresses.revision=?
        RETURNING slug, projectId, profileId, editionId, audience, sha256, revision, active, token
      `;
      const row = store().prepare(sql).get(input.slug, input.projectId, input.profileId, input.editionId, input.audience,
        input.sha256, token, input.html, input.expectedRevision, input.slug, input.expectedRevision);
      if (!row) throw Error('wiki_host_conflict');
      return summary(row as Omit<Row, 'html'>);
    },
    withdraw(input: WikiHostChange) {
      checkChange(input);
      const row = store().prepare(`
        UPDATE wiki_addresses SET active=0, revision=revision+1 WHERE slug=? AND projectId=? AND profileId=? AND revision=? AND active=1
        RETURNING slug, projectId, profileId, editionId, audience, sha256, revision, active, token
      `).get(input.slug, input.projectId, input.profileId, input.expectedRevision);
      if (!row) throw Error('wiki_host_conflict');
      return summary(row as Omit<Row, 'html'>);
    },
    async close() {
      try {
        await starting?.catch(() => undefined);
        if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
      } finally {
        starting = undefined;
        origin = undefined;
        db?.close();
        db = undefined;
      }
    },
  };
}
